import { IocContract } from '@adonisjs/fold'
import { Knex } from 'knex'
import jestOpenAPI from 'jest-openapi'

import { AppServices } from '../../app'
import { Config, IAppConfig } from '../../config/app'
import { createTestApp, TestContainer } from '../../tests/app'
import { truncateTables } from '../../tests/tableManager'
import { initIocContainer } from '../../'
import { ConnectionContext } from './middleware'
import { ConnectionRoutes } from './routes'
import { createAsset } from '../../tests/asset'
import { createContext } from '../../tests/context'
import { WalletAddress } from '../wallet_address/model'
import {
  IncomingPayment,
  IncomingPaymentState
} from '../payment/incoming/model'
import { createIncomingPayment } from '../../tests/incomingPayment'
import { createWalletAddress } from '../../tests/walletAddress'
import base64url from 'base64url'

describe('Connection Routes', (): void => {
  let deps: IocContract<AppServices>
  let appContainer: TestContainer
  let knex: Knex
  let config: IAppConfig
  let connectionRoutes: ConnectionRoutes

  beforeAll(async (): Promise<void> => {
    config = Config
    config.authServerGrantUrl = 'https://auth.wallet.example/authorize'
    deps = await initIocContainer(config)
    appContainer = await createTestApp(deps)
    knex = appContainer.knex
    const { resourceServerSpec } = await deps.use('openApi')
    jestOpenAPI(resourceServerSpec)
  })

  let walletAddress: WalletAddress
  let incomingPayment: IncomingPayment
  beforeEach(async (): Promise<void> => {
    connectionRoutes = await deps.use('connectionRoutes')
    config = await deps.use('config')

    const asset = await createAsset(deps)
    walletAddress = await createWalletAddress(deps, { assetId: asset.id })
    incomingPayment = await createIncomingPayment(deps, {
      walletAddressId: walletAddress.id,
      expiresAt: new Date(Date.now() + 30_000),
      incomingAmount: {
        value: BigInt('123'),
        assetScale: asset.scale,
        assetCode: asset.code
      },
      metadata: {
        description: 'hello world',
        externalRef: '#123'
      }
    })
  })

  afterEach(async (): Promise<void> => {
    await truncateTables(knex)
  })

  afterAll(async (): Promise<void> => {
    await appContainer.shutdown()
  })

  describe('get', (): void => {
    test.each`
      state
      ${IncomingPaymentState.Completed}
      ${IncomingPaymentState.Expired}
    `(
      `returns 404 for $state incoming payment`,
      async ({ state }): Promise<void> => {
        await incomingPayment.$query(knex).patch({
          state,
          expiresAt:
            state === IncomingPaymentState.Expired ? new Date() : undefined
        })
        const ctx = createContext<ConnectionContext>({
          headers: { Accept: 'application/json' },
          url: `/connections/${incomingPayment.connectionId}`
        })
        ctx.incomingPayment = incomingPayment
        await expect(connectionRoutes.get(ctx)).rejects.toHaveProperty(
          'status',
          404
        )
      }
    )

    test('returns 200 with connection', async (): Promise<void> => {
      const ctx = createContext<ConnectionContext>({
        headers: { Accept: 'application/json' },
        url: `/connections/${incomingPayment.connectionId}`
      })
      ctx.incomingPayment = incomingPayment
      await expect(connectionRoutes.get(ctx)).resolves.toBeUndefined()
      expect(ctx.response).toSatisfyApiSpec()

      const sharedSecret = (ctx.response.body as Record<string, unknown>)[
        'sharedSecret'
      ]

      expect(ctx.body).toEqual({
        id: `${config.openPaymentsUrl}/connections/${incomingPayment.connectionId}`,
        ilpAddress: expect.stringMatching(/^test\.rafiki\.[a-zA-Z0-9_-]{95}$/),
        sharedSecret,
        assetCode: incomingPayment.asset.code,
        assetScale: incomingPayment.asset.scale
      })
      const sharedSecretBuffer = Buffer.from(sharedSecret as string, 'base64')
      expect(sharedSecretBuffer).toHaveLength(32)
      expect(sharedSecret).toEqual(base64url(sharedSecretBuffer))
    })
  })
})
