import assert from 'assert'
import { faker } from '@faker-js/faker'
import nock from 'nock'
import { Knex } from 'knex'
import { v4 as uuid } from 'uuid'

import { QuoteError, isQuoteError } from './errors'
import { QuoteService, CreateQuoteOptions } from './service'
import { createTestApp, TestContainer } from '../../tests/app'
import { IAppConfig, Config } from '../../config/app'
import { IocContract } from '@adonisjs/fold'
import { initIocContainer } from '../../'
import { AppServices } from '../../app'
import { createAsset } from '../../tests/asset'
import { createIncomingPayment } from '../../tests/incomingPayment'
import {
  createWalletAddress,
  MockWalletAddress
} from '../../tests/walletAddress'
import { createQuote } from '../../tests/quote'
import { truncateTables } from '../../tests/tableManager'
import { AssetOptions } from '../../asset/service'
import {
  IncomingPayment,
  IncomingPaymentState
} from '../payment/incoming/model'
import { getTests } from '../wallet_address/model.test'
import { WalletAddress } from '../wallet_address/model'
import { Fee, FeeType } from '../../fee/model'
import { Asset } from '../../asset/model'
import { withConfigOverride } from '../../tests/helpers'

describe('QuoteService', (): void => {
  let deps: IocContract<AppServices>
  let appContainer: TestContainer
  let quoteService: QuoteService
  let knex: Knex
  let sendingWalletAddress: MockWalletAddress
  let receivingWalletAddress: MockWalletAddress
  let config: IAppConfig

  const asset: AssetOptions = {
    scale: 9,
    code: 'USD'
  }

  const debitAmount = {
    value: BigInt(123),
    assetCode: asset.code,
    assetScale: asset.scale
  }

  const destinationAsset = {
    scale: 9,
    code: 'XRP'
  }

  const receiveAmount = {
    value: BigInt(56),
    assetCode: destinationAsset.code,
    assetScale: destinationAsset.scale
  }

  beforeAll(async (): Promise<void> => {
    Config.exchangeRatesUrl = 'https://test.rates'
    nock(Config.exchangeRatesUrl)
      .get('/')
      .query(true)
      .reply(200, () => ({
        base: 'USD',
        rates: {
          XRP: 0.5
        }
      }))
      .persist()
    deps = await initIocContainer(Config)
    appContainer = await createTestApp(deps)

    knex = appContainer.knex
    config = await deps.use('config')
  })

  beforeEach(async (): Promise<void> => {
    quoteService = await deps.use('quoteService')
    const { id: sendAssetId } = await createAsset(deps, {
      code: debitAmount.assetCode,
      scale: debitAmount.assetScale
    })
    sendingWalletAddress = await createWalletAddress(deps, {
      assetId: sendAssetId
    })
    const { id: destinationAssetId } = await createAsset(deps, destinationAsset)
    receivingWalletAddress = await createWalletAddress(deps, {
      assetId: destinationAssetId,
      mockServerPort: appContainer.openPaymentsPort
    })
    const accountingService = await deps.use('accountingService')
    await expect(
      accountingService.createDeposit({
        id: uuid(),
        account: receivingWalletAddress.asset,
        amount: BigInt(123)
      })
    ).resolves.toBeUndefined()
  })

  afterEach(async (): Promise<void> => {
    jest.restoreAllMocks()
    receivingWalletAddress.scope?.persist(false)
    await truncateTables(knex)
  })

  afterAll(async (): Promise<void> => {
    await appContainer.shutdown()
  })

  describe('get/getWalletAddressPage', (): void => {
    getTests({
      createModel: ({ client }) =>
        createQuote(deps, {
          walletAddressId: sendingWalletAddress.id,
          receiver: `${
            receivingWalletAddress.url
          }/incoming-payments/${uuid()}`,
          debitAmount: {
            value: BigInt(56),
            assetCode: asset.code,
            assetScale: asset.scale
          },
          client,
          validDestination: false,
          withFee: true
        }),
      get: (options) => quoteService.get(options),
      list: (options) => quoteService.getWalletAddressPage(options)
    })
  })

  describe('create', (): void => {
    const incomingAmount = {
      ...receiveAmount,
      value: BigInt(1000)
    }

    describe.each`
      toConnection | incomingAmount    | description
      ${true}      | ${undefined}      | ${'connection'}
      ${false}     | ${undefined}      | ${'incomingPayment'}
      ${false}     | ${incomingAmount} | ${'incomingPayment.incomingAmount'}
    `('$description', ({ toConnection, incomingAmount }): void => {
      describe.each`
        debitAmount    | receiveAmount    | description
        ${debitAmount} | ${undefined}     | ${'debitAmount'}
        ${undefined}   | ${receiveAmount} | ${'receiveAmount'}
        ${undefined}   | ${undefined}     | ${'receiver.incomingAmount'}
      `('$description', ({ debitAmount, receiveAmount }): void => {
        let options: CreateQuoteOptions
        let incomingPayment: IncomingPayment
        const client = faker.internet.url({ appendSlash: false })

        beforeEach(async (): Promise<void> => {
          incomingPayment = await createIncomingPayment(deps, {
            walletAddressId: receivingWalletAddress.id,
            incomingAmount
          })
          const connectionService = await deps.use('connectionService')
          options = {
            walletAddressId: sendingWalletAddress.id,
            receiver: toConnection
              ? connectionService.getUrl(incomingPayment)
              : incomingPayment.getUrl(receivingWalletAddress)
          }
          if (debitAmount) options.debitAmount = debitAmount
          if (receiveAmount) options.receiveAmount = receiveAmount
        })

        if (!debitAmount && !receiveAmount && !incomingAmount) {
          it('fails without receiver.incomingAmount', async (): Promise<void> => {
            await expect(quoteService.create(options)).resolves.toEqual(
              QuoteError.InvalidReceiver
            )
          })
        } else {
          if (debitAmount || receiveAmount) {
            it.each`
              client       | description
              ${client}    | ${'with a client'}
              ${undefined} | ${'without a client'}
            `(
              'creates a Quote $description',
              async ({ client }): Promise<void> => {
                const quote = await quoteService.create({
                  ...options,
                  client
                })
                assert.ok(!isQuoteError(quote))

                expect(quote).toMatchObject({
                  walletAddressId: sendingWalletAddress.id,
                  receiver: options.receiver,
                  debitAmount: debitAmount || {
                    value: BigInt(
                      Math.ceil(
                        Number(receiveAmount.value) /
                          quote.minExchangeRate.valueOf()
                      )
                    ),
                    assetCode: asset.code,
                    assetScale: asset.scale
                  },
                  receiveAmount: receiveAmount || {
                    value: BigInt(
                      Math.ceil(
                        Number(debitAmount.value) *
                          quote.minExchangeRate.valueOf()
                      )
                    ),
                    assetCode: destinationAsset.code,
                    assetScale: destinationAsset.scale
                  },
                  maxPacketAmount: BigInt('9223372036854775807'),
                  createdAt: expect.any(Date),
                  updatedAt: expect.any(Date),
                  expiresAt: new Date(
                    quote.createdAt.getTime() + config.quoteLifespan
                  ),
                  client: client || null
                })
                expect(quote.minExchangeRate.valueOf()).toBe(
                  0.5 * (1 - config.slippage)
                )
                expect(quote.lowEstimatedExchangeRate.valueOf()).toBe(0.5)
                expect(quote.highEstimatedExchangeRate.valueOf()).toBe(
                  0.500000000001
                )

                await expect(
                  quoteService.get({
                    id: quote.id
                  })
                ).resolves.toEqual(quote)
              }
            )

            if (incomingAmount) {
              it('fails if receiveAmount exceeds receiver.incomingAmount', async (): Promise<void> => {
                await incomingPayment.$query(knex).patch({
                  incomingAmount: {
                    value: BigInt(1),
                    assetCode: destinationAsset.code,
                    assetScale: destinationAsset.scale
                  }
                })
                await expect(quoteService.create(options)).resolves.toEqual(
                  QuoteError.InvalidAmount
                )
              })
            }
          } else if (incomingAmount) {
            it.each`
              client       | description
              ${client}    | ${'with a client'}
              ${undefined} | ${'without a client'}
            `(
              'creates a Quote $description',
              async ({ client }): Promise<void> => {
                const quote = await quoteService.create({
                  ...options,
                  client
                })
                assert.ok(!isQuoteError(quote))
                expect(quote).toMatchObject({
                  ...options,
                  maxPacketAmount: BigInt('9223372036854775807'),
                  debitAmount: {
                    value: BigInt(
                      Math.ceil(
                        Number(incomingAmount.value) /
                          quote.minExchangeRate.valueOf()
                      )
                    ),
                    assetCode: asset.code,
                    assetScale: asset.scale
                  },
                  receiveAmount: incomingAmount,
                  createdAt: expect.any(Date),
                  updatedAt: expect.any(Date),
                  expiresAt: new Date(
                    quote.createdAt.getTime() + config.quoteLifespan
                  ),
                  client: client || null
                })
                expect(quote.minExchangeRate.valueOf()).toBe(
                  0.5 * (1 - config.slippage)
                )
                expect(quote.lowEstimatedExchangeRate.valueOf()).toBe(0.5)
                expect(quote.highEstimatedExchangeRate.valueOf()).toBe(
                  0.500000000001
                )
                await expect(
                  quoteService.get({
                    id: quote.id
                  })
                ).resolves.toEqual(quote)
              }
            )
          }

          if (!toConnection) {
            test.each`
              state
              ${IncomingPaymentState.Completed}
              ${IncomingPaymentState.Expired}
            `(
              `returns ${QuoteError.InvalidReceiver} on $state receiver`,
              async ({ state }): Promise<void> => {
                await incomingPayment.$query(knex).patch({
                  state,
                  expiresAt:
                    state === IncomingPaymentState.Expired
                      ? new Date()
                      : undefined
                })
                await expect(quoteService.create(options)).resolves.toEqual(
                  QuoteError.InvalidReceiver
                )
              }
            )
          }
        }
      })
    })

    it.each`
      expiryDate                                                            | description
      ${new Date(new Date().getTime() + Config.quoteLifespan - 2 * 60_000)} | ${"the incoming payment's expirataion date"}
      ${new Date(new Date().getTime() + Config.quoteLifespan + 2 * 60_000)} | ${"the quotation's creation date plus its lifespan"}
    `(
      'sets expiry date to $description',
      async ({ expiryDate }): Promise<void> => {
        const incomingPayment = await createIncomingPayment(deps, {
          walletAddressId: receivingWalletAddress.id,
          incomingAmount,
          expiresAt: expiryDate
        })
        const options: CreateQuoteOptions = {
          walletAddressId: sendingWalletAddress.id,
          receiver: incomingPayment.getUrl(receivingWalletAddress),
          receiveAmount
        }

        const quote = await quoteService.create(options)
        assert.ok(!isQuoteError(quote))
        const maxExpiration = new Date(
          quote.createdAt.getTime() + config.quoteLifespan
        )
        expect(quote).toMatchObject({
          walletAddressId: sendingWalletAddress.id,
          receiver: options.receiver,
          debitAmount: {
            value: BigInt(
              Math.ceil(
                Number(receiveAmount.value) / quote.minExchangeRate.valueOf()
              )
            ),
            assetCode: asset.code,
            assetScale: asset.scale
          },
          receiveAmount: receiveAmount,
          maxPacketAmount: BigInt('9223372036854775807'),
          createdAt: expect.any(Date),
          updatedAt: expect.any(Date),
          expiresAt:
            maxExpiration.getTime() > expiryDate.getTime()
              ? expiryDate
              : maxExpiration
        })
      }
    )

    it('fails on unknown wallet address', async (): Promise<void> => {
      await expect(
        quoteService.create({
          walletAddressId: uuid(),
          receiver: `${
            receivingWalletAddress.url
          }/incoming-payments/${uuid()}`,
          debitAmount
        })
      ).resolves.toEqual(QuoteError.UnknownWalletAddress)
    })

    it('fails on inactive wallet address', async () => {
      const walletAddress = await createWalletAddress(deps)
      const walletAddressUpdated = await WalletAddress.query(
        knex
      ).patchAndFetchById(walletAddress.id, { deactivatedAt: new Date() })
      assert.ok(!walletAddressUpdated.isActive)
      await expect(
        quoteService.create({
          walletAddressId: walletAddress.id,
          receiver: `${
            receivingWalletAddress.url
          }/incoming-payments/${uuid()}`,
          debitAmount
        })
      ).resolves.toEqual(QuoteError.InactiveWalletAddress)
    })

    it('fails on invalid receiver', async (): Promise<void> => {
      await expect(
        quoteService.create({
          walletAddressId: sendingWalletAddress.id,
          receiver: `${
            receivingWalletAddress.url
          }/incoming-payments/${uuid()}`,
          debitAmount
        })
      ).resolves.toEqual(QuoteError.InvalidReceiver)
    })

    test.each`
      debitAmount                              | receiveAmount                              | description
      ${{ ...debitAmount, value: BigInt(0) }}  | ${undefined}                               | ${'with debitAmount of zero'}
      ${{ ...debitAmount, value: BigInt(-1) }} | ${undefined}                               | ${'with negative debitAmount'}
      ${{ ...debitAmount, assetScale: 3 }}     | ${undefined}                               | ${'with wrong debitAmount asset'}
      ${undefined}                             | ${{ ...receiveAmount, value: BigInt(0) }}  | ${'with receiveAmount of zero'}
      ${undefined}                             | ${{ ...receiveAmount, value: BigInt(-1) }} | ${'with negative receiveAmount'}
      ${undefined}                             | ${{ ...receiveAmount, assetScale: 3 }}     | ${'with wrong receiveAmount asset'}
      ${debitAmount}                           | ${receiveAmount}                           | ${'with both send and receive amount'}
    `(
      'fails to create $description',
      async ({ debitAmount, receiveAmount }): Promise<void> => {
        const incomingPayment = await createIncomingPayment(deps, {
          walletAddressId: receivingWalletAddress.id
        })
        const options: CreateQuoteOptions = {
          walletAddressId: sendingWalletAddress.id,
          receiver: incomingPayment.getUrl(receivingWalletAddress)
        }
        if (debitAmount) options.debitAmount = debitAmount
        if (receiveAmount) options.receiveAmount = receiveAmount
        await expect(quoteService.create(options)).resolves.toEqual(
          QuoteError.InvalidAmount
        )
      }
    )

    it('calls rates service with correct base asset', async (): Promise<void> => {
      const incomingPayment = await createIncomingPayment(deps, {
        walletAddressId: receivingWalletAddress.id,
        incomingAmount
      })
      const options: CreateQuoteOptions = {
        walletAddressId: sendingWalletAddress.id,
        receiver: incomingPayment.getUrl(receivingWalletAddress),
        receiveAmount
      }

      const ratesService = await deps.use('ratesService')
      const ratesServiceSpy = jest.spyOn(ratesService, 'rates')

      const quote = await quoteService.create(options)
      assert.ok(!isQuoteError(quote))

      expect(ratesServiceSpy).toHaveBeenCalledWith(
        sendingWalletAddress.asset.code
      )
    })

    it('fails on rate service error', async (): Promise<void> => {
      const ratesService = await deps.use('ratesService')
      jest
        .spyOn(ratesService, 'rates')
        .mockImplementation(() => Promise.reject(new Error('fail')))
      const incomingPayment = await createIncomingPayment(deps, {
        walletAddressId: receivingWalletAddress.id
      })

      await expect(
        quoteService.create({
          walletAddressId: sendingWalletAddress.id,
          receiver: incomingPayment.getUrl(receivingWalletAddress),
          debitAmount
        })
      ).rejects.toThrow('missing rates')
    })

    describe('fees - fixed delivery', (): void => {
      let asset: Asset
      let sendingWalletAddress: WalletAddress
      let receivingWalletAddress: WalletAddress

      beforeEach(async (): Promise<void> => {
        asset = await createAsset(deps, {
          code: 'USD',
          scale: 2
        })
        sendingWalletAddress = await createWalletAddress(deps, {
          assetId: asset.id
        })
        receivingWalletAddress = await createWalletAddress(deps, {
          assetId: asset.id
        })
      })

      test.each`
        incomingAmountValue | fixedFee | basisPointFee | expectedQuoteDebitAmountValue | description
        ${3364n}            | ${0}     | ${0}          | ${3365n}                      | ${'no fees'}
        ${3364n}            | ${150}   | ${0}          | ${3515n}                      | ${'fixed fee'}
        ${3364n}            | ${0}     | ${200}        | ${3432n}                      | ${'basis point fee'}
        ${3364n}            | ${150}   | ${200}        | ${3582n}                      | ${'fixed and basis point fee'}
      `(
        '$description',
        withConfigOverride(
          () => config,
          { slippage: 0 },
          async ({
            incomingAmountValue,
            fixedFee,
            basisPointFee,
            expectedQuoteDebitAmountValue
          }): Promise<void> => {
            const incomingPayment = await createIncomingPayment(deps, {
              walletAddressId: receivingWalletAddress.id,
              incomingAmount: {
                assetCode: asset.code,
                assetScale: asset.scale,
                value: incomingAmountValue
              }
            })
            await Fee.query().insertAndFetch({
              assetId: asset.id,
              type: FeeType.Sending,
              fixedFee,
              basisPointFee
            })

            const quote = await quoteService.create({
              walletAddressId: sendingWalletAddress.id,
              receiver: incomingPayment.getUrl(receivingWalletAddress)
            })
            assert.ok(!isQuoteError(quote))

            expect(quote.debitAmount).toEqual({
              assetCode: asset.code,
              assetScale: asset.scale,
              value: expectedQuoteDebitAmountValue
            })
          }
        )
      )
    })

    describe('fees - fixed send with cross-currency', (): void => {
      let sendAsset: Asset
      let receiveAsset: Asset
      let sendingWalletAddress: WalletAddress
      let receivingWalletAddress: WalletAddress

      beforeEach(async (): Promise<void> => {
        sendAsset = await createAsset(deps, {
          code: 'USD',
          scale: 2
        })
        receiveAsset = await createAsset(deps, {
          code: 'XRP',
          scale: 2
        })
        sendingWalletAddress = await createWalletAddress(deps, {
          assetId: sendAsset.id
        })
        receivingWalletAddress = await createWalletAddress(deps, {
          assetId: receiveAsset.id
        })
      })

      test.each`
        debitAmountValue | fixedFee | basisPointFee | expectedReceiveAmountValue | description
        ${200n}          | ${0}     | ${0}          | ${100n}                    | ${'no fees'}
        ${200n}          | ${20}    | ${0}          | ${90n}                     | ${'fixed fee'}
        ${200n}          | ${0}     | ${200}        | ${99n}                     | ${'basis point fee'}
        ${200n}          | ${20}    | ${200}        | ${89n}                     | ${'fixed and basis point fee'}
      `(
        '$description',
        withConfigOverride(
          () => config,
          { slippage: 0 },
          async ({
            debitAmountValue,
            fixedFee,
            basisPointFee,
            expectedReceiveAmountValue
          }): Promise<void> => {
            const incomingPayment = await createIncomingPayment(deps, {
              walletAddressId: receivingWalletAddress.id,
              incomingAmount: {
                assetCode: receiveAsset.code,
                assetScale: receiveAsset.scale,
                value: debitAmountValue
              }
            })
            await Fee.query().insertAndFetch({
              assetId: sendAsset.id,
              type: FeeType.Sending,
              fixedFee,
              basisPointFee
            })

            const quote = await quoteService.create({
              walletAddressId: sendingWalletAddress.id,
              receiver: incomingPayment.getUrl(receivingWalletAddress),
              debitAmount: {
                value: debitAmountValue,
                assetCode: sendAsset.code,
                assetScale: sendAsset.scale
              }
            })
            assert.ok(!isQuoteError(quote))

            expect(quote.receiveAmount).toEqual({
              assetCode: receiveAsset.code,
              assetScale: receiveAsset.scale,
              value: expectedReceiveAmountValue
            })
          }
        )
      )
    })
  })
})
