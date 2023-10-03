import { gql } from '@apollo/client'
import { v4 as uuid } from 'uuid'

import { getPageTests } from './page.test'
import { createTestApp, TestContainer } from '../../tests/app'
import { IocContract } from '@adonisjs/fold'
import { AppServices } from '../../app'
import { initIocContainer } from '../..'
import { Config } from '../../config/app'
import { Asset } from '../../asset/model'
import { createAsset } from '../../tests/asset'
import { createWalletAddress } from '../../tests/walletAddress'
import { createQuote } from '../../tests/quote'
import { truncateTables } from '../../tests/tableManager'
import { QuoteError, errorToMessage } from '../../open_payments/quote/errors'
import { QuoteService } from '../../open_payments/quote/service'
import { Quote as QuoteModel } from '../../open_payments/quote/model'
import { Amount } from '../../open_payments/amount'
import { CreateQuoteInput, Quote, QuoteResponse } from '../generated/graphql'

describe('Quote Resolvers', (): void => {
  let deps: IocContract<AppServices>
  let appContainer: TestContainer
  let quoteService: QuoteService
  let asset: Asset

  const receivingWalletAddress = 'http://wallet2.example/bob'
  const receiver = `${receivingWalletAddress}/incoming-payments/${uuid()}`

  beforeAll(async (): Promise<void> => {
    deps = await initIocContainer(Config)
    appContainer = await createTestApp(deps)
    quoteService = await deps.use('quoteService')
  })

  beforeEach(async (): Promise<void> => {
    asset = await createAsset(deps)
  })

  afterEach(async (): Promise<void> => {
    jest.restoreAllMocks()
    await truncateTables(appContainer.knex)
  })

  afterAll(async (): Promise<void> => {
    await appContainer.apolloClient.stop()
    await appContainer.shutdown()
  })

  const createWalletAddressQuote = async (
    walletAddressId: string
  ): Promise<QuoteModel> => {
    return await createQuote(deps, {
      walletAddressId,
      receiver,
      debitAmount: {
        value: BigInt(56),
        assetCode: asset.code,
        assetScale: asset.scale
      },
      validDestination: false
    })
  }

  describe('Query.quote', (): void => {
    test('200', async (): Promise<void> => {
      const { id: walletAddressId } = await createWalletAddress(deps, {
        assetId: asset.id
      })
      const quote = await createWalletAddressQuote(walletAddressId)

      const query = await appContainer.apolloClient
        .query({
          query: gql`
            query Quote($quoteId: String!) {
              quote(id: $quoteId) {
                id
                walletAddressId
                receiver
                debitAmount {
                  value
                  assetCode
                  assetScale
                }
                receiveAmount {
                  value
                  assetCode
                  assetScale
                }
                maxPacketAmount
                minExchangeRate
                lowEstimatedExchangeRate
                highEstimatedExchangeRate
                createdAt
                expiresAt
              }
            }
          `,
          variables: {
            quoteId: quote.id
          }
        })
        .then((query): Quote => query.data?.quote)

      expect(query).toEqual({
        id: quote.id,
        walletAddressId,
        receiver: quote.receiver,
        debitAmount: {
          value: quote.debitAmount.value.toString(),
          assetCode: quote.debitAmount.assetCode,
          assetScale: quote.debitAmount.assetScale,
          __typename: 'Amount'
        },
        receiveAmount: {
          value: quote.receiveAmount.value.toString(),
          assetCode: quote.receiveAmount.assetCode,
          assetScale: quote.receiveAmount.assetScale,
          __typename: 'Amount'
        },
        maxPacketAmount: quote.maxPacketAmount.toString(),
        minExchangeRate: quote.minExchangeRate.valueOf(),
        lowEstimatedExchangeRate: quote.lowEstimatedExchangeRate.valueOf(),
        highEstimatedExchangeRate: quote.highEstimatedExchangeRate.valueOf(),
        createdAt: quote.createdAt.toISOString(),
        expiresAt: quote.expiresAt.toISOString(),
        __typename: 'Quote'
      })
    })

    test('404', async (): Promise<void> => {
      jest.spyOn(quoteService, 'get').mockImplementation(async () => undefined)

      await expect(
        appContainer.apolloClient.query({
          query: gql`
            query Quote($quoteId: String!) {
              quote(id: $quoteId) {
                id
              }
            }
          `,
          variables: { quoteId: uuid() }
        })
      ).rejects.toThrow('quote does not exist')
    })
  })

  describe('Mutation.createQuote', (): void => {
    const receiveAsset = {
      code: 'XRP',
      scale: 9
    }
    const receiveAmount: Amount = {
      value: BigInt(56),
      assetCode: receiveAsset.code,
      assetScale: receiveAsset.scale
    }
    let debitAmount: Amount
    let input: CreateQuoteInput

    beforeEach((): void => {
      debitAmount = {
        value: BigInt(123),
        assetCode: asset.code,
        assetScale: asset.scale
      }
      input = {
        walletAddressId: uuid(),
        receiver,
        debitAmount
      }
    })

    test.each`
      withAmount | receiveAmount    | type
      ${true}    | ${undefined}     | ${'fixed send to incoming payment'}
      ${false}   | ${receiveAmount} | ${'fixed receive to incoming payment'}
      ${false}   | ${undefined}     | ${'incoming payment'}
    `('200 ($type)', async ({ withAmount, receiveAmount }): Promise<void> => {
      const amount = withAmount ? debitAmount : undefined
      const { id: walletAddressId } = await createWalletAddress(deps, {
        assetId: asset.id
      })
      const input = {
        walletAddressId,
        debitAmount: amount,
        receiveAmount,
        receiver
      }

      let quote: QuoteModel | undefined
      const createSpy = jest
        .spyOn(quoteService, 'create')
        .mockImplementationOnce(async (opts) => {
          quote = await createQuote(deps, {
            ...opts,
            validDestination: false
          })
          return quote
        })

      const query = await appContainer.apolloClient
        .query({
          query: gql`
            mutation CreateQuote($input: CreateQuoteInput!) {
              createQuote(input: $input) {
                code
                success
                quote {
                  id
                }
              }
            }
          `,
          variables: { input }
        })
        .then((query): QuoteResponse => query.data?.createQuote)

      expect(createSpy).toHaveBeenCalledWith(input)
      expect(query.code).toBe('200')
      expect(query.success).toBe(true)
      expect(query.quote?.id).toBe(quote?.id)
    })

    test('400', async (): Promise<void> => {
      const query = await appContainer.apolloClient
        .query({
          query: gql`
            mutation CreateQuote($input: CreateQuoteInput!) {
              createQuote(input: $input) {
                code
                success
                message
                quote {
                  id
                }
              }
            }
          `,
          variables: { input }
        })
        .then((query): QuoteResponse => query.data?.createQuote)
      expect(query.code).toBe('404')
      expect(query.success).toBe(false)
      expect(query.message).toBe(
        errorToMessage[QuoteError.UnknownWalletAddress]
      )
      expect(query.quote).toBeNull()
    })

    test('500', async (): Promise<void> => {
      const createSpy = jest
        .spyOn(quoteService, 'create')
        .mockRejectedValueOnce(new Error('unexpected'))

      const query = await appContainer.apolloClient
        .query({
          query: gql`
            mutation CreateQuote($input: CreateQuoteInput!) {
              createQuote(input: $input) {
                code
                success
                message
                quote {
                  id
                }
              }
            }
          `,
          variables: { input }
        })
        .then((query): QuoteResponse => query.data?.createQuote)
      expect(createSpy).toHaveBeenCalledWith(input)
      expect(query.code).toBe('500')
      expect(query.success).toBe(false)
      expect(query.message).toBe('Error trying to create quote')
      expect(query.quote).toBeNull()
    })
  })

  describe('Wallet address quotes', (): void => {
    let walletAddressId: string

    beforeEach(async (): Promise<void> => {
      walletAddressId = (
        await createWalletAddress(deps, {
          assetId: asset.id
        })
      ).id
    })

    getPageTests({
      getClient: () => appContainer.apolloClient,
      createModel: () => createWalletAddressQuote(walletAddressId),
      pagedQuery: 'quotes',
      parent: {
        query: 'walletAddress',
        getId: () => walletAddressId
      }
    })
  })
})
