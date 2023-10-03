import assert from 'assert'
import { gql } from '@apollo/client'
import { Knex } from 'knex'
import { v4 as uuid } from 'uuid'

import { DepositEventType } from './liquidity'
import { createTestApp, TestContainer } from '../../tests/app'
import { IocContract } from '@adonisjs/fold'
import { AppServices } from '../../app'
import { initIocContainer } from '../..'
import { Config } from '../../config/app'
import {
  AccountingService,
  LiquidityAccount,
  LiquidityAccountType,
  Withdrawal
} from '../../accounting/service'
import { Asset } from '../../asset/model'
import {
  WalletAddress,
  WalletAddressEventType
} from '../../open_payments/wallet_address/model'
import {
  IncomingPayment,
  IncomingPaymentEventType
} from '../../open_payments/payment/incoming/model'
import {
  OutgoingPayment,
  PaymentEvent,
  PaymentWithdrawType,
  isPaymentEventType
} from '../../open_payments/payment/outgoing/model'
import { Peer } from '../../peer/model'
import { createAsset } from '../../tests/asset'
import { createIncomingPayment } from '../../tests/incomingPayment'
import { createOutgoingPayment } from '../../tests/outgoingPayment'
import { createWalletAddress } from '../../tests/walletAddress'
import { createPeer } from '../../tests/peer'
import { truncateTables } from '../../tests/tableManager'
import { WebhookEvent } from '../../webhook/model'
import {
  LiquidityError,
  LiquidityMutationResponse,
  WalletAddressWithdrawalMutationResponse
} from '../generated/graphql'

describe('Liquidity Resolvers', (): void => {
  let deps: IocContract<AppServices>
  let appContainer: TestContainer
  let accountingService: AccountingService
  let knex: Knex
  const timeout = BigInt(10_000) // 10 seconds

  beforeAll(async (): Promise<void> => {
    deps = await initIocContainer(Config)
    appContainer = await createTestApp(deps)
    knex = appContainer.knex
    accountingService = await deps.use('accountingService')
  })

  afterAll(async (): Promise<void> => {
    await truncateTables(knex)
    await appContainer.apolloClient.stop()
    await appContainer.shutdown()
  })

  describe('Add peer liquidity', (): void => {
    let peer: Peer

    beforeEach(async (): Promise<void> => {
      peer = await createPeer(deps)
    })

    test('Can add liquidity to peer', async (): Promise<void> => {
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation AddPeerLiquidity($input: AddPeerLiquidityInput!) {
              addPeerLiquidity(input: $input) {
                code
                success
                message
                error
              }
            }
          `,
          variables: {
            input: {
              id: uuid(),
              peerId: peer.id,
              amount: '100',
              idempotencyKey: uuid()
            }
          }
        })
        .then((query): LiquidityMutationResponse => {
          if (query.data) {
            return query.data.addPeerLiquidity
          } else {
            throw new Error('Data was empty')
          }
        })

      expect(response.success).toBe(true)
      expect(response.code).toEqual('200')
      expect(response.error).toBeNull()
    })

    test('Returns an error for invalid id', async (): Promise<void> => {
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation AddPeerLiquidity($input: AddPeerLiquidityInput!) {
              addPeerLiquidity(input: $input) {
                code
                success
                message
                error
              }
            }
          `,
          variables: {
            input: {
              id: 'not a uuid v4',
              peerId: peer.id,
              amount: '100',
              idempotencyKey: uuid()
            }
          }
        })
        .then((query): LiquidityMutationResponse => {
          if (query.data) {
            return query.data.addPeerLiquidity
          } else {
            throw new Error('Data was empty')
          }
        })

      expect(response.success).toBe(false)
      expect(response.code).toEqual('400')
      expect(response.message).toEqual('Invalid id')
      expect(response.error).toEqual(LiquidityError.InvalidId)
    })

    test('Returns an error for unknown peer', async (): Promise<void> => {
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation AddPeerLiquidity($input: AddPeerLiquidityInput!) {
              addPeerLiquidity(input: $input) {
                code
                success
                message
                error
              }
            }
          `,
          variables: {
            input: {
              id: uuid(),
              peerId: uuid(),
              amount: '100',
              idempotencyKey: uuid()
            }
          }
        })
        .then((query): LiquidityMutationResponse => {
          if (query.data) {
            return query.data.addPeerLiquidity
          } else {
            throw new Error('Data was empty')
          }
        })

      expect(response.success).toBe(false)
      expect(response.code).toEqual('404')
      expect(response.message).toEqual('Unknown peer')
      expect(response.error).toEqual(LiquidityError.UnknownPeer)
    })

    test('Returns an error for existing transfer', async (): Promise<void> => {
      const id = uuid()
      await expect(
        accountingService.createDeposit({
          id,
          account: peer,
          amount: BigInt(100)
        })
      ).resolves.toBeUndefined()
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation AddPeerLiquidity($input: AddPeerLiquidityInput!) {
              addPeerLiquidity(input: $input) {
                code
                success
                message
                error
              }
            }
          `,
          variables: {
            input: {
              id,
              peerId: peer.id,
              amount: '100',
              idempotencyKey: uuid()
            }
          }
        })
        .then((query): LiquidityMutationResponse => {
          if (query.data) {
            return query.data.addPeerLiquidity
          } else {
            throw new Error('Data was empty')
          }
        })

      expect(response.success).toBe(false)
      expect(response.code).toEqual('409')
      expect(response.message).toEqual('Transfer exists')
      expect(response.error).toEqual(LiquidityError.TransferExists)
    })

    test('Returns an error for zero amount', async (): Promise<void> => {
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation AddPeerLiquidity($input: AddPeerLiquidityInput!) {
              addPeerLiquidity(input: $input) {
                code
                success
                message
                error
              }
            }
          `,
          variables: {
            input: {
              id: 'not a uuid v4',
              peerId: peer.id,
              amount: '0',
              idempotencyKey: uuid()
            }
          }
        })
        .then((query): LiquidityMutationResponse => {
          if (query.data) {
            return query.data.addPeerLiquidity
          } else {
            throw new Error('Data was empty')
          }
        })

      expect(response.success).toBe(false)
      expect(response.code).toEqual('400')
      expect(response.message).toEqual('Amount is zero')
      expect(response.error).toEqual(LiquidityError.AmountZero)
    })
  })

  describe('Add asset liquidity', (): void => {
    let asset: Asset

    beforeEach(async (): Promise<void> => {
      asset = await createAsset(deps)
    })

    test('Can add liquidity to asset', async (): Promise<void> => {
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation AddAssetLiquidity($input: AddAssetLiquidityInput!) {
              addAssetLiquidity(input: $input) {
                code
                success
                message
                error
              }
            }
          `,
          variables: {
            input: {
              id: uuid(),
              assetId: asset.id,
              amount: '100',
              idempotencyKey: uuid()
            }
          }
        })
        .then((query): LiquidityMutationResponse => {
          if (query.data) {
            return query.data.addAssetLiquidity
          } else {
            throw new Error('Data was empty')
          }
        })

      expect(response.success).toBe(true)
      expect(response.code).toEqual('200')
      expect(response.error).toBeNull()
    })

    test('Returns an error for invalid id', async (): Promise<void> => {
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation AddAssetLiquidity($input: AddAssetLiquidityInput!) {
              addAssetLiquidity(input: $input) {
                code
                success
                message
                error
              }
            }
          `,
          variables: {
            input: {
              id: 'not a uuid',
              assetId: asset.id,
              amount: '100',
              idempotencyKey: uuid()
            }
          }
        })
        .then((query): LiquidityMutationResponse => {
          if (query.data) {
            return query.data.addAssetLiquidity
          } else {
            throw new Error('Data was empty')
          }
        })

      expect(response.success).toBe(false)
      expect(response.code).toEqual('400')
      expect(response.message).toEqual('Invalid id')
      expect(response.error).toEqual(LiquidityError.InvalidId)
    })

    test('Returns an error for unknown asset', async (): Promise<void> => {
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation AddAssetLiquidity($input: AddAssetLiquidityInput!) {
              addAssetLiquidity(input: $input) {
                code
                success
                message
                error
              }
            }
          `,
          variables: {
            input: {
              id: uuid(),
              assetId: uuid(),
              amount: '100',
              idempotencyKey: uuid()
            }
          }
        })
        .then((query): LiquidityMutationResponse => {
          if (query.data) {
            return query.data.addAssetLiquidity
          } else {
            throw new Error('Data was empty')
          }
        })

      expect(response.success).toBe(false)
      expect(response.code).toEqual('404')
      expect(response.message).toEqual('Unknown asset')
      expect(response.error).toEqual(LiquidityError.UnknownAsset)
    })

    test('Returns an error for existing transfer', async (): Promise<void> => {
      const id = uuid()
      await expect(
        accountingService.createDeposit({
          id,
          account: asset,
          amount: BigInt(100)
        })
      ).resolves.toBeUndefined()
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation AddAssetLiquidity($input: AddAssetLiquidityInput!) {
              addAssetLiquidity(input: $input) {
                code
                success
                message
                error
              }
            }
          `,
          variables: {
            input: {
              id,
              assetId: asset.id,
              amount: '100',
              idempotencyKey: uuid()
            }
          }
        })
        .then((query): LiquidityMutationResponse => {
          if (query.data) {
            return query.data.addAssetLiquidity
          } else {
            throw new Error('Data was empty')
          }
        })

      expect(response.success).toBe(false)
      expect(response.code).toEqual('409')
      expect(response.message).toEqual('Transfer exists')
      expect(response.error).toEqual(LiquidityError.TransferExists)
    })

    test('Returns an error for zero amount', async (): Promise<void> => {
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation AddAssetLiquidity($input: AddAssetLiquidityInput!) {
              addAssetLiquidity(input: $input) {
                code
                success
                message
                error
              }
            }
          `,
          variables: {
            input: {
              id: uuid(),
              assetId: asset.id,
              amount: '0',
              idempotencyKey: uuid()
            }
          }
        })
        .then((query): LiquidityMutationResponse => {
          if (query.data) {
            return query.data.addAssetLiquidity
          } else {
            throw new Error('Data was empty')
          }
        })

      expect(response.success).toBe(false)
      expect(response.code).toEqual('400')
      expect(response.message).toEqual('Amount is zero')
      expect(response.error).toEqual(LiquidityError.AmountZero)
    })
  })

  describe('Create peer liquidity withdrawal', (): void => {
    let peer: Peer
    const startingBalance = BigInt(100)

    beforeEach(async (): Promise<void> => {
      peer = await createPeer(deps)
      await expect(
        accountingService.createDeposit({
          id: uuid(),
          account: peer,
          amount: startingBalance
        })
      ).resolves.toBeUndefined()
    })

    test('Can create liquidity withdrawal from peer', async (): Promise<void> => {
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation CreatePeerLiquidityWithdrawal(
              $input: CreatePeerLiquidityWithdrawalInput!
            ) {
              createPeerLiquidityWithdrawal(input: $input) {
                code
                success
                message
                error
              }
            }
          `,
          variables: {
            input: {
              id: uuid(),
              peerId: peer.id,
              amount: startingBalance.toString(),
              idempotencyKey: uuid()
            }
          }
        })
        .then((query): LiquidityMutationResponse => {
          if (query.data) {
            return query.data.createPeerLiquidityWithdrawal
          } else {
            throw new Error('Data was empty')
          }
        })

      expect(response.success).toBe(true)
      expect(response.code).toEqual('200')
      expect(response.error).toBeNull()
    })

    test('Returns an error for unknown peer', async (): Promise<void> => {
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation CreatePeerLiquidityWithdrawal(
              $input: CreatePeerLiquidityWithdrawalInput!
            ) {
              createPeerLiquidityWithdrawal(input: $input) {
                code
                success
                message
                error
              }
            }
          `,
          variables: {
            input: {
              id: uuid(),
              peerId: uuid(),
              amount: '100',
              idempotencyKey: uuid()
            }
          }
        })
        .then((query): LiquidityMutationResponse => {
          if (query.data) {
            return query.data.createPeerLiquidityWithdrawal
          } else {
            throw new Error('Data was empty')
          }
        })

      expect(response.success).toBe(false)
      expect(response.code).toEqual('404')
      expect(response.message).toEqual('Unknown peer')
      expect(response.error).toEqual(LiquidityError.UnknownPeer)
    })

    test('Returns an error for invalid id', async (): Promise<void> => {
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation CreatePeerLiquidityWithdrawal(
              $input: CreatePeerLiquidityWithdrawalInput!
            ) {
              createPeerLiquidityWithdrawal(input: $input) {
                code
                success
                message
                error
              }
            }
          `,
          variables: {
            input: {
              id: 'not a uuid',
              peerId: peer.id,
              amount: startingBalance.toString(),
              idempotencyKey: uuid()
            }
          }
        })
        .then((query): LiquidityMutationResponse => {
          if (query.data) {
            return query.data.createPeerLiquidityWithdrawal
          } else {
            throw new Error('Data was empty')
          }
        })

      expect(response.success).toBe(false)
      expect(response.code).toEqual('400')
      expect(response.message).toEqual('Invalid id')
      expect(response.error).toEqual(LiquidityError.InvalidId)
    })

    test('Returns an error for existing transfer', async (): Promise<void> => {
      const id = uuid()
      await expect(
        accountingService.createDeposit({
          id,
          account: peer,
          amount: 10n
        })
      ).resolves.toBeUndefined()
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation CreatePeerLiquidityWithdrawal(
              $input: CreatePeerLiquidityWithdrawalInput!
            ) {
              createPeerLiquidityWithdrawal(input: $input) {
                code
                success
                message
                error
              }
            }
          `,
          variables: {
            input: {
              id,
              peerId: peer.id,
              amount: startingBalance.toString(),
              idempotencyKey: uuid()
            }
          }
        })
        .then((query): LiquidityMutationResponse => {
          if (query.data) {
            return query.data.createPeerLiquidityWithdrawal
          } else {
            throw new Error('Data was empty')
          }
        })
      expect(response.success).toBe(false)
      expect(response.code).toEqual('409')
      expect(response.message).toEqual('Transfer exists')
      expect(response.error).toEqual(LiquidityError.TransferExists)
    })

    test.each`
      amount                         | code     | message                   | error
      ${startingBalance + BigInt(1)} | ${'403'} | ${'Insufficient balance'} | ${LiquidityError.InsufficientBalance}
      ${BigInt(0)}                   | ${'400'} | ${'Amount is zero'}       | ${LiquidityError.AmountZero}
    `(
      'Returns error for $error',
      async ({ amount, code, message, error }): Promise<void> => {
        const response = await appContainer.apolloClient
          .mutate({
            mutation: gql`
              mutation CreatePeerLiquidityWithdrawal(
                $input: CreatePeerLiquidityWithdrawalInput!
              ) {
                createPeerLiquidityWithdrawal(input: $input) {
                  code
                  success
                  message
                  error
                }
              }
            `,
            variables: {
              input: {
                id: uuid(),
                peerId: peer.id,
                amount: amount.toString(),
                idempotencyKey: uuid()
              }
            }
          })
          .then((query): LiquidityMutationResponse => {
            if (query.data) {
              return query.data.createPeerLiquidityWithdrawal
            } else {
              throw new Error('Data was empty')
            }
          })

        expect(response.success).toBe(false)
        expect(response.code).toEqual(code)
        expect(response.message).toEqual(message)
        expect(response.error).toEqual(error)
      }
    )
  })

  describe('Create asset liquidity withdrawal', (): void => {
    let asset: Asset
    const startingBalance = BigInt(100)

    beforeEach(async (): Promise<void> => {
      asset = await createAsset(deps)
      await expect(
        accountingService.createDeposit({
          id: uuid(),
          account: asset,
          amount: startingBalance
        })
      ).resolves.toBeUndefined()
    })

    test('Can create liquidity withdrawal from asset', async (): Promise<void> => {
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation CreateAssetLiquidityWithdrawal(
              $input: CreateAssetLiquidityWithdrawalInput!
            ) {
              createAssetLiquidityWithdrawal(input: $input) {
                code
                success
                message
                error
              }
            }
          `,
          variables: {
            input: {
              id: uuid(),
              assetId: asset.id,
              amount: startingBalance.toString(),
              idempotencyKey: uuid()
            }
          }
        })
        .then((query): LiquidityMutationResponse => {
          if (query.data) {
            return query.data.createAssetLiquidityWithdrawal
          } else {
            throw new Error('Data was empty')
          }
        })

      expect(response.success).toBe(true)
      expect(response.code).toEqual('200')
      expect(response.error).toBeNull()
    })

    test('Returns an error for unknown asset', async (): Promise<void> => {
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation CreateAssetLiquidityWithdrawal(
              $input: CreateAssetLiquidityWithdrawalInput!
            ) {
              createAssetLiquidityWithdrawal(input: $input) {
                code
                success
                message
                error
              }
            }
          `,
          variables: {
            input: {
              id: uuid(),
              assetId: uuid(),
              amount: '100',
              idempotencyKey: uuid()
            }
          }
        })
        .then((query): LiquidityMutationResponse => {
          if (query.data) {
            return query.data.createAssetLiquidityWithdrawal
          } else {
            throw new Error('Data was empty')
          }
        })

      expect(response.success).toBe(false)
      expect(response.code).toEqual('404')
      expect(response.message).toEqual('Unknown asset')
      expect(response.error).toEqual(LiquidityError.UnknownAsset)
    })

    test('Returns an error for invalid id', async (): Promise<void> => {
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation CreateAssetLiquidityWithdrawal(
              $input: CreateAssetLiquidityWithdrawalInput!
            ) {
              createAssetLiquidityWithdrawal(input: $input) {
                code
                success
                message
                error
              }
            }
          `,
          variables: {
            input: {
              id: 'not a uuid',
              assetId: asset.id,
              amount: startingBalance.toString(),
              idempotencyKey: uuid()
            }
          }
        })
        .then((query): LiquidityMutationResponse => {
          if (query.data) {
            return query.data.createAssetLiquidityWithdrawal
          } else {
            throw new Error('Data was empty')
          }
        })

      expect(response.success).toBe(false)
      expect(response.code).toEqual('400')
      expect(response.message).toEqual('Invalid id')
      expect(response.error).toEqual(LiquidityError.InvalidId)
    })

    test('Returns an error for existing transfer', async (): Promise<void> => {
      const id = uuid()
      await expect(
        accountingService.createDeposit({
          id,
          account: asset,
          amount: BigInt(10)
        })
      ).resolves.toBeUndefined()
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation CreateAssetLiquidityWithdrawal(
              $input: CreateAssetLiquidityWithdrawalInput!
            ) {
              createAssetLiquidityWithdrawal(input: $input) {
                code
                success
                message
                error
              }
            }
          `,
          variables: {
            input: {
              id,
              assetId: asset.id,
              amount: startingBalance.toString(),
              idempotencyKey: uuid()
            }
          }
        })
        .then((query): LiquidityMutationResponse => {
          if (query.data) {
            return query.data.createAssetLiquidityWithdrawal
          } else {
            throw new Error('Data was empty')
          }
        })
      expect(response.success).toBe(false)
      expect(response.code).toEqual('409')
      expect(response.message).toEqual('Transfer exists')
      expect(response.error).toEqual(LiquidityError.TransferExists)
    })

    test.each`
      amount                         | code     | message                   | error
      ${startingBalance + BigInt(1)} | ${'403'} | ${'Insufficient balance'} | ${LiquidityError.InsufficientBalance}
      ${BigInt(0)}                   | ${'400'} | ${'Amount is zero'}       | ${LiquidityError.AmountZero}
    `(
      'Returns error for $error',
      async ({ amount, code, message, error }): Promise<void> => {
        const response = await appContainer.apolloClient
          .mutate({
            mutation: gql`
              mutation CreateAssetLiquidityWithdrawal(
                $input: CreateAssetLiquidityWithdrawalInput!
              ) {
                createAssetLiquidityWithdrawal(input: $input) {
                  code
                  success
                  message
                  error
                }
              }
            `,
            variables: {
              input: {
                id: uuid(),
                assetId: asset.id,
                amount: amount.toString(),
                idempotencyKey: uuid()
              }
            }
          })
          .then((query): LiquidityMutationResponse => {
            if (query.data) {
              return query.data.createAssetLiquidityWithdrawal
            } else {
              throw new Error('Data was empty')
            }
          })

        expect(response.success).toBe(false)
        expect(response.code).toEqual(code)
        expect(response.message).toEqual(message)
        expect(response.error).toEqual(error)
      }
    )
  })

  describe('Create payment pointer withdrawal', (): void => {
    let walletAddress: WalletAddress
    const amount = BigInt(100)

    beforeEach(async (): Promise<void> => {
      walletAddress = await createWalletAddress(deps, {
        createLiquidityAccount: true
      })

      await expect(
        accountingService.createDeposit({
          id: uuid(),
          account: walletAddress,
          amount
        })
      ).resolves.toBeUndefined()
    })

    test('Can create withdrawal from payment pointer', async (): Promise<void> => {
      const id = uuid()
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation CreateWalletAddressWithdrawal(
              $input: CreateWalletAddressWithdrawalInput!
            ) {
              createWalletAddressWithdrawal(input: $input) {
                code
                success
                message
                error
                withdrawal {
                  id
                  amount
                  walletAddress {
                    id
                  }
                }
              }
            }
          `,
          variables: {
            input: {
              id,
              walletAddressId: walletAddress.id,
              idempotencyKey: uuid()
            }
          }
        })
        .then((query): WalletAddressWithdrawalMutationResponse => {
          if (query.data) {
            return query.data.createWalletAddressWithdrawal
          } else {
            throw new Error('Data was empty')
          }
        })

      expect(response.success).toBe(true)
      expect(response.code).toEqual('200')
      expect(response.error).toBeNull()
      expect(response.withdrawal).toMatchObject({
        id,
        amount: amount.toString(),
        walletAddress: {
          id: walletAddress.id
        }
      })
    })

    test('Returns an error for unknown payment pointer', async (): Promise<void> => {
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation CreateWalletAddressWithdrawal(
              $input: CreateWalletAddressWithdrawalInput!
            ) {
              createWalletAddressWithdrawal(input: $input) {
                code
                success
                message
                error
                withdrawal {
                  id
                }
              }
            }
          `,
          variables: {
            input: {
              id: uuid(),
              walletAddressId: uuid(),
              idempotencyKey: uuid()
            }
          }
        })
        .then((query): WalletAddressWithdrawalMutationResponse => {
          if (query.data) {
            return query.data.createWalletAddressWithdrawal
          } else {
            throw new Error('Data was empty')
          }
        })

      expect(response.success).toBe(false)
      expect(response.code).toEqual('404')
      expect(response.message).toEqual('Unknown payment pointer')
      expect(response.error).toEqual(LiquidityError.UnknownWalletAddress)
      expect(response.withdrawal).toBeNull()
    })

    test('Returns an error for invalid id', async (): Promise<void> => {
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation CreateWalletAddressWithdrawal(
              $input: CreateWalletAddressWithdrawalInput!
            ) {
              createWalletAddressWithdrawal(input: $input) {
                code
                success
                message
                error
                withdrawal {
                  id
                }
              }
            }
          `,
          variables: {
            input: {
              id: 'not a uuid',
              walletAddressId: walletAddress.id,
              idempotencyKey: uuid()
            }
          }
        })
        .then((query): WalletAddressWithdrawalMutationResponse => {
          if (query.data) {
            return query.data.createWalletAddressWithdrawal
          } else {
            throw new Error('Data was empty')
          }
        })

      expect(response.success).toBe(false)
      expect(response.code).toEqual('400')
      expect(response.message).toEqual('Invalid id')
      expect(response.error).toEqual(LiquidityError.InvalidId)
      expect(response.withdrawal).toBeNull()
    })

    test('Returns an error for existing transfer', async (): Promise<void> => {
      const id = uuid()
      await expect(
        accountingService.createDeposit({
          id,
          account: walletAddress,
          amount: BigInt(10)
        })
      ).resolves.toBeUndefined()
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation CreateWalletAddressWithdrawal(
              $input: CreateWalletAddressWithdrawalInput!
            ) {
              createWalletAddressWithdrawal(input: $input) {
                code
                success
                message
                error
                withdrawal {
                  id
                }
              }
            }
          `,
          variables: {
            input: {
              id,
              walletAddressId: walletAddress.id,
              idempotencyKey: uuid()
            }
          }
        })
        .then((query): WalletAddressWithdrawalMutationResponse => {
          if (query.data) {
            return query.data.createWalletAddressWithdrawal
          } else {
            throw new Error('Data was empty')
          }
        })
      expect(response.success).toBe(false)
      expect(response.code).toEqual('409')
      expect(response.message).toEqual('Transfer exists')
      expect(response.error).toEqual(LiquidityError.TransferExists)
      expect(response.withdrawal).toBeNull()
    })

    test('Returns an error for empty balance', async (): Promise<void> => {
      await expect(
        accountingService.createWithdrawal({
          id: uuid(),
          account: walletAddress,
          amount,
          timeout
        })
      ).resolves.toBeUndefined()
      const response = await appContainer.apolloClient
        .mutate({
          mutation: gql`
            mutation CreateWalletAddressWithdrawal(
              $input: CreateWalletAddressWithdrawalInput!
            ) {
              createWalletAddressWithdrawal(input: $input) {
                code
                success
                message
                error
                withdrawal {
                  id
                }
              }
            }
          `,
          variables: {
            input: {
              id: uuid(),
              walletAddressId: walletAddress.id,
              idempotencyKey: uuid()
            }
          }
        })
        .then((query): WalletAddressWithdrawalMutationResponse => {
          if (query.data) {
            return query.data.createWalletAddressWithdrawal
          } else {
            throw new Error('Data was empty')
          }
        })
      expect(response.success).toBe(false)
      expect(response.code).toEqual('400')
      expect(response.message).toEqual('Amount is zero')
      expect(response.error).toEqual(LiquidityError.AmountZero)
      expect(response.withdrawal).toBeNull()
    })
  })

  describe.each(['peer', 'asset'])(
    'Post %s liquidity withdrawal',
    (type): void => {
      let withdrawalId: string

      beforeEach(async (): Promise<void> => {
        const peer = await createPeer(deps)
        const deposit = {
          id: uuid(),
          account: type === 'peer' ? peer : peer.asset,
          amount: BigInt(100)
        }
        await expect(
          accountingService.createDeposit(deposit)
        ).resolves.toBeUndefined()
        withdrawalId = uuid()
        await expect(
          accountingService.createWithdrawal({
            ...deposit,
            id: withdrawalId,
            amount: BigInt(10),
            timeout
          })
        ).resolves.toBeUndefined()
      })

      test(`Can post a(n) ${type} liquidity withdrawal`, async (): Promise<void> => {
        const response = await appContainer.apolloClient
          .mutate({
            mutation: gql`
              mutation PostLiquidityWithdrawal(
                $input: PostLiquidityWithdrawalInput!
              ) {
                postLiquidityWithdrawal(input: $input) {
                  code
                  success
                  message
                  error
                }
              }
            `,
            variables: {
              input: {
                withdrawalId,
                idempotencyKey: uuid()
              }
            }
          })
          .then((query): LiquidityMutationResponse => {
            if (query.data) {
              return query.data.postLiquidityWithdrawal
            } else {
              throw new Error('Data was empty')
            }
          })

        expect(response.success).toBe(true)
        expect(response.code).toEqual('200')
        expect(response.error).toBeNull()
      })

      test("Can't post non-existent withdrawal", async (): Promise<void> => {
        const response = await appContainer.apolloClient
          .mutate({
            mutation: gql`
              mutation PostLiquidityWithdrawal(
                $input: PostLiquidityWithdrawalInput!
              ) {
                postLiquidityWithdrawal(input: $input) {
                  code
                  success
                  message
                  error
                }
              }
            `,
            variables: {
              input: {
                withdrawalId: uuid(),
                idempotencyKey: uuid()
              }
            }
          })
          .then((query): LiquidityMutationResponse => {
            if (query.data) {
              return query.data.postLiquidityWithdrawal
            } else {
              throw new Error('Data was empty')
            }
          })

        expect(response.success).toBe(false)
        expect(response.code).toEqual('404')
        expect(response.message).toEqual('Unknown withdrawal')
        expect(response.error).toEqual(LiquidityError.UnknownTransfer)
      })

      test("Can't post invalid withdrawal id", async (): Promise<void> => {
        const response = await appContainer.apolloClient
          .mutate({
            mutation: gql`
              mutation PostLiquidityWithdrawal(
                $input: PostLiquidityWithdrawalInput!
              ) {
                postLiquidityWithdrawal(input: $input) {
                  code
                  success
                  message
                  error
                }
              }
            `,
            variables: {
              input: {
                withdrawalId: 'not a uuid',
                idempotencyKey: uuid()
              }
            }
          })
          .then((query): LiquidityMutationResponse => {
            if (query.data) {
              return query.data.postLiquidityWithdrawal
            } else {
              throw new Error('Data was empty')
            }
          })

        expect(response.success).toBe(false)
        expect(response.code).toEqual('400')
        expect(response.message).toEqual('Invalid id')
        expect(response.error).toEqual(LiquidityError.InvalidId)
      })

      test("Can't post posted withdrawal", async (): Promise<void> => {
        await expect(
          accountingService.postWithdrawal(withdrawalId)
        ).resolves.toBeUndefined()
        const response = await appContainer.apolloClient
          .mutate({
            mutation: gql`
              mutation PostLiquidityWithdrawal(
                $input: PostLiquidityWithdrawalInput!
              ) {
                postLiquidityWithdrawal(input: $input) {
                  code
                  success
                  message
                  error
                }
              }
            `,
            variables: {
              input: {
                withdrawalId,
                idempotencyKey: uuid()
              }
            }
          })
          .then((query): LiquidityMutationResponse => {
            if (query.data) {
              return query.data.postLiquidityWithdrawal
            } else {
              throw new Error('Data was empty')
            }
          })

        expect(response.success).toBe(false)
        expect(response.code).toEqual('409')
        expect(response.message).toEqual('Withdrawal already posted')
        expect(response.error).toEqual(LiquidityError.AlreadyPosted)
      })

      test("Can't post voided withdrawal", async (): Promise<void> => {
        await expect(
          accountingService.voidWithdrawal(withdrawalId)
        ).resolves.toBeUndefined()
        const response = await appContainer.apolloClient
          .mutate({
            mutation: gql`
              mutation PostLiquidityWithdrawal(
                $input: PostLiquidityWithdrawalInput!
              ) {
                postLiquidityWithdrawal(input: $input) {
                  code
                  success
                  message
                  error
                }
              }
            `,
            variables: {
              input: {
                withdrawalId,
                idempotencyKey: uuid()
              }
            }
          })
          .then((query): LiquidityMutationResponse => {
            if (query.data) {
              return query.data.postLiquidityWithdrawal
            } else {
              throw new Error('Data was empty')
            }
          })

        expect(response.success).toBe(false)
        expect(response.code).toEqual('409')
        expect(response.message).toEqual('Withdrawal already voided')
        expect(response.error).toEqual(LiquidityError.AlreadyVoided)
      })
    }
  )

  describe.each(['peer', 'asset'])(
    'Roll back %s liquidity withdrawal',
    (type): void => {
      let withdrawalId: string

      beforeEach(async (): Promise<void> => {
        const peer = await createPeer(deps)
        const deposit = {
          id: uuid(),
          account: type === 'peer' ? peer : peer.asset,
          amount: BigInt(100)
        }
        await expect(
          accountingService.createDeposit(deposit)
        ).resolves.toBeUndefined()
        withdrawalId = uuid()
        await expect(
          accountingService.createWithdrawal({
            ...deposit,
            id: withdrawalId,
            amount: BigInt(10),
            timeout
          })
        ).resolves.toBeUndefined()
      })

      test(`Can void a(n) ${type} liquidity withdrawal`, async (): Promise<void> => {
        const response = await appContainer.apolloClient
          .mutate({
            mutation: gql`
              mutation VoidLiquidityWithdrawal(
                $input: VoidLiquidityWithdrawalInput!
              ) {
                voidLiquidityWithdrawal(input: $input) {
                  code
                  success
                  message
                  error
                }
              }
            `,
            variables: {
              input: {
                withdrawalId,
                idempotencyKey: uuid()
              }
            }
          })
          .then((query): LiquidityMutationResponse => {
            if (query.data) {
              return query.data.voidLiquidityWithdrawal
            } else {
              throw new Error('Data was empty')
            }
          })

        expect(response.success).toBe(true)
        expect(response.code).toEqual('200')
        expect(response.error).toBeNull()
      })

      test("Can't void non-existent withdrawal", async (): Promise<void> => {
        const response = await appContainer.apolloClient
          .mutate({
            mutation: gql`
              mutation VoidLiquidityWithdrawal(
                $input: VoidLiquidityWithdrawalInput!
              ) {
                voidLiquidityWithdrawal(input: $input) {
                  code
                  success
                  message
                  error
                }
              }
            `,
            variables: {
              input: {
                withdrawalId: uuid(),
                idempotencyKey: uuid()
              }
            }
          })
          .then((query): LiquidityMutationResponse => {
            if (query.data) {
              return query.data.voidLiquidityWithdrawal
            } else {
              throw new Error('Data was empty')
            }
          })

        expect(response.success).toBe(false)
        expect(response.code).toEqual('404')
        expect(response.message).toEqual('Unknown withdrawal')
        expect(response.error).toEqual(LiquidityError.UnknownTransfer)
      })

      test("Can't void invalid withdrawal id", async (): Promise<void> => {
        const response = await appContainer.apolloClient
          .mutate({
            mutation: gql`
              mutation VoidLiquidityWithdrawal(
                $input: VoidLiquidityWithdrawalInput!
              ) {
                voidLiquidityWithdrawal(input: $input) {
                  code
                  success
                  message
                  error
                }
              }
            `,
            variables: {
              input: {
                withdrawalId: 'not a uuid',
                idempotencyKey: uuid()
              }
            }
          })
          .then((query): LiquidityMutationResponse => {
            if (query.data) {
              return query.data.voidLiquidityWithdrawal
            } else {
              throw new Error('Data was empty')
            }
          })

        expect(response.success).toBe(false)
        expect(response.code).toEqual('400')
        expect(response.message).toEqual('Invalid id')
        expect(response.error).toEqual(LiquidityError.InvalidId)
      })

      test("Can't void posted withdrawal", async (): Promise<void> => {
        await expect(
          accountingService.postWithdrawal(withdrawalId)
        ).resolves.toBeUndefined()
        const response = await appContainer.apolloClient
          .mutate({
            mutation: gql`
              mutation VoidLiquidityWithdrawal(
                $input: VoidLiquidityWithdrawalInput!
              ) {
                voidLiquidityWithdrawal(input: $input) {
                  code
                  success
                  message
                  error
                }
              }
            `,
            variables: {
              input: {
                withdrawalId,
                idempotencyKey: uuid()
              }
            }
          })
          .then((query): LiquidityMutationResponse => {
            if (query.data) {
              return query.data.voidLiquidityWithdrawal
            } else {
              throw new Error('Data was empty')
            }
          })

        expect(response.success).toBe(false)
        expect(response.code).toEqual('409')
        expect(response.message).toEqual('Withdrawal already posted')
        expect(response.error).toEqual(LiquidityError.AlreadyPosted)
      })

      test("Can't void voided withdrawal", async (): Promise<void> => {
        await expect(
          accountingService.voidWithdrawal(withdrawalId)
        ).resolves.toBeUndefined()
        const response = await appContainer.apolloClient
          .mutate({
            mutation: gql`
              mutation voidLiquidityWithdrawal(
                $input: VoidLiquidityWithdrawalInput!
              ) {
                voidLiquidityWithdrawal(input: $input) {
                  code
                  success
                  message
                  error
                }
              }
            `,
            variables: {
              input: {
                withdrawalId,
                idempotencyKey: uuid()
              }
            }
          })
          .then((query): LiquidityMutationResponse => {
            if (query.data) {
              return query.data.voidLiquidityWithdrawal
            } else {
              throw new Error('Data was empty')
            }
          })

        expect(response.success).toBe(false)
        expect(response.code).toEqual('409')
        expect(response.message).toEqual('Withdrawal already voided')
        expect(response.error).toEqual(LiquidityError.AlreadyVoided)
      })
    }
  )

  {
    let walletAddress: WalletAddress
    let incomingPayment: IncomingPayment
    let payment: OutgoingPayment

    beforeEach(async (): Promise<void> => {
      walletAddress = await createWalletAddress(deps)
      const walletAddressId = walletAddress.id
      incomingPayment = await createIncomingPayment(deps, {
        walletAddressId,
        incomingAmount: {
          value: BigInt(56),
          assetCode: walletAddress.asset.code,
          assetScale: walletAddress.asset.scale
        },
        expiresAt: new Date(Date.now() + 60 * 1000)
      })
      payment = await createOutgoingPayment(deps, {
        walletAddressId,
        receiver: `${Config.publicHost}/${uuid()}/incoming-payments/${uuid()}`,
        debitAmount: {
          value: BigInt(456),
          assetCode: walletAddress.asset.code,
          assetScale: walletAddress.asset.scale
        },
        validDestination: false
      })
      await expect(accountingService.getBalance(payment.id)).resolves.toEqual(
        BigInt(0)
      )
    })

    describe('depositEventLiquidity', (): void => {
      describe.each(Object.values(DepositEventType).map((type) => [type]))(
        '%s',
        (type): void => {
          let eventId: string

          beforeEach(async (): Promise<void> => {
            eventId = uuid()
            await PaymentEvent.query(knex).insertAndFetch({
              id: eventId,
              type,
              data: payment.toData({
                amountSent: BigInt(0),
                balance: BigInt(0)
              })
            })
          })

          test('Can deposit account liquidity', async (): Promise<void> => {
            const depositSpy = jest.spyOn(accountingService, 'createDeposit')
            const response = await appContainer.apolloClient
              .mutate({
                mutation: gql`
                  mutation DepositLiquidity(
                    $input: DepositEventLiquidityInput!
                  ) {
                    depositEventLiquidity(input: $input) {
                      code
                      success
                      message
                      error
                    }
                  }
                `,
                variables: {
                  input: {
                    eventId,
                    idempotencyKey: uuid()
                  }
                }
              })
              .then((query): LiquidityMutationResponse => {
                if (query.data) {
                  return query.data.depositEventLiquidity
                } else {
                  throw new Error('Data was empty')
                }
              })

            expect(response.success).toBe(true)
            expect(response.code).toEqual('200')
            expect(response.error).toBeNull()
            assert.ok(payment.debitAmount)
            await expect(depositSpy).toHaveBeenCalledWith({
              id: eventId,
              account: expect.any(OutgoingPayment),
              amount: payment.debitAmount.value
            })
            await expect(
              accountingService.getBalance(payment.id)
            ).resolves.toEqual(payment.debitAmount.value)
          })

          test("Can't deposit for non-existent webhook event id", async (): Promise<void> => {
            const response = await appContainer.apolloClient
              .mutate({
                mutation: gql`
                  mutation DepositLiquidity(
                    $input: DepositEventLiquidityInput!
                  ) {
                    depositEventLiquidity(input: $input) {
                      code
                      success
                      message
                      error
                    }
                  }
                `,
                variables: {
                  input: {
                    eventId: uuid(),
                    idempotencyKey: uuid()
                  }
                }
              })
              .then((query): LiquidityMutationResponse => {
                if (query.data) {
                  return query.data.depositEventLiquidity
                } else {
                  throw new Error('Data was empty')
                }
              })

            expect(response.success).toBe(false)
            expect(response.code).toEqual('400')
            expect(response.message).toEqual('Invalid id')
            expect(response.error).toEqual(LiquidityError.InvalidId)
          })

          test('Returns an error for existing transfer', async (): Promise<void> => {
            await expect(
              accountingService.createDeposit({
                id: eventId,
                account: incomingPayment,
                amount: BigInt(100)
              })
            ).resolves.toBeUndefined()
            const response = await appContainer.apolloClient
              .mutate({
                mutation: gql`
                  mutation DepositLiquidity(
                    $input: DepositEventLiquidityInput!
                  ) {
                    depositEventLiquidity(input: $input) {
                      code
                      success
                      message
                      error
                    }
                  }
                `,
                variables: {
                  input: {
                    eventId,
                    idempotencyKey: uuid()
                  }
                }
              })
              .then((query): LiquidityMutationResponse => {
                if (query.data) {
                  return query.data.depositEventLiquidity
                } else {
                  throw new Error('Data was empty')
                }
              })

            expect(response.success).toBe(false)
            expect(response.code).toEqual('409')
            expect(response.message).toEqual('Transfer exists')
            expect(response.error).toEqual(LiquidityError.TransferExists)
          })
        }
      )
    })

    const WithdrawEventType = {
      ...WalletAddressEventType,
      ...IncomingPaymentEventType,
      ...PaymentWithdrawType
    }
    type WithdrawEventType =
      | WalletAddressEventType
      | IncomingPaymentEventType
      | PaymentWithdrawType

    const isIncomingPaymentEventType = (
      // eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-module-boundary-types
      o: any
    ): o is IncomingPaymentEventType =>
      Object.values(IncomingPaymentEventType).includes(o)

    describe('withdrawEventLiquidity', (): void => {
      describe.each(Object.values(WithdrawEventType).map((type) => [type]))(
        '%s',
        (type): void => {
          let eventId: string
          let withdrawal: Withdrawal

          beforeEach(async (): Promise<void> => {
            eventId = uuid()
            const amount = BigInt(10)
            let liquidityAccount: LiquidityAccount
            let data: Record<string, unknown>
            if (isPaymentEventType(type)) {
              liquidityAccount = payment
              data = payment.toData({
                amountSent: BigInt(0),
                balance: amount
              })
            } else if (isIncomingPaymentEventType(type)) {
              liquidityAccount = incomingPayment
              data = incomingPayment.toData(amount)
            } else {
              liquidityAccount = walletAddress
              await accountingService.createLiquidityAccount(
                walletAddress,
                LiquidityAccountType.WEB_MONETIZATION
              )
              data = walletAddress.toData(amount)
            }
            await WebhookEvent.query(knex).insertAndFetch({
              id: eventId,
              type,
              data,
              withdrawal: {
                accountId: liquidityAccount.id,
                assetId: liquidityAccount.asset.id,
                amount
              }
            })
            await expect(
              accountingService.createDeposit({
                id: uuid(),
                account: liquidityAccount,
                amount
              })
            ).resolves.toBeUndefined()
            await expect(
              accountingService.getBalance(liquidityAccount.id)
            ).resolves.toEqual(amount)
            withdrawal = {
              id: eventId,
              account: liquidityAccount,
              amount
            }
          })

          test('Can withdraw account liquidity', async (): Promise<void> => {
            const response = await appContainer.apolloClient
              .mutate({
                mutation: gql`
                  mutation WithdrawLiquidity(
                    $input: WithdrawEventLiquidityInput!
                  ) {
                    withdrawEventLiquidity(input: $input) {
                      code
                      success
                      message
                      error
                    }
                  }
                `,
                variables: {
                  input: {
                    eventId,
                    idempotencyKey: uuid()
                  }
                }
              })
              .then((query): LiquidityMutationResponse => {
                if (query.data) {
                  return query.data.withdrawEventLiquidity
                } else {
                  throw new Error('Data was empty')
                }
              })

            expect(response.success).toBe(true)
            expect(response.code).toEqual('200')
            expect(response.error).toBeNull()
          })

          test('Returns error for non-existent webhook event id', async (): Promise<void> => {
            const response = await appContainer.apolloClient
              .mutate({
                mutation: gql`
                  mutation WithdrawLiquidity(
                    $input: WithdrawEventLiquidityInput!
                  ) {
                    withdrawEventLiquidity(input: $input) {
                      code
                      success
                      message
                      error
                    }
                  }
                `,
                variables: {
                  input: {
                    eventId: uuid(),
                    idempotencyKey: uuid()
                  }
                }
              })
              .then((query): LiquidityMutationResponse => {
                if (query.data) {
                  return query.data.withdrawEventLiquidity
                } else {
                  throw new Error('Data was empty')
                }
              })

            expect(response.success).toBe(false)
            expect(response.code).toEqual('400')
            expect(response.message).toEqual('Invalid id')
            expect(response.error).toEqual(LiquidityError.InvalidId)
          })

          test('Returns error for already completed withdrawal', async (): Promise<void> => {
            await expect(
              accountingService.createWithdrawal(withdrawal)
            ).resolves.toBeUndefined()
            const response = await appContainer.apolloClient
              .mutate({
                mutation: gql`
                  mutation WithdrawLiquidity(
                    $input: WithdrawEventLiquidityInput!
                  ) {
                    withdrawEventLiquidity(input: $input) {
                      code
                      success
                      message
                      error
                    }
                  }
                `,
                variables: {
                  input: {
                    eventId,
                    idempotencyKey: uuid()
                  }
                }
              })
              .then((query): LiquidityMutationResponse => {
                if (query.data) {
                  return query.data.withdrawEventLiquidity
                } else {
                  throw new Error('Data was empty')
                }
              })

            expect(response.success).toBe(false)
            expect(response.code).toEqual('409')
            expect(response.message).toEqual('Transfer exists')
            expect(response.error).toEqual(LiquidityError.TransferExists)
          })
        }
      )
    })
  }
})
