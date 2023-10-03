import { Model, ModelOptions, QueryContext } from 'objection'
import { DbErrors } from 'objection-db-errors'

import { LiquidityAccount } from '../../../accounting/service'
import { Asset } from '../../../asset/model'
import { ConnectorAccount } from '../../../connector/core/rafiki'
import {
  WalletAddressSubresource,
  WalletAddress
} from '../../wallet_address/model'
import { Quote } from '../../quote/model'
import { Amount, AmountJSON, serializeAmount } from '../../amount'
import { WebhookEvent } from '../../../webhook/model'
import { OutgoingPayment as OpenPaymentsOutgoingPayment } from '@interledger/open-payments'

export class OutgoingPaymentGrant extends DbErrors(Model) {
  public static get modelPaths(): string[] {
    return [__dirname]
  }
  public static readonly tableName = 'outgoingPaymentGrants'
  public id!: string
}

export class OutgoingPayment
  extends WalletAddressSubresource
  implements ConnectorAccount, LiquidityAccount
{
  public static readonly tableName = 'outgoingPayments'
  public static readonly urlPath = '/outgoing-payments'

  static get virtualAttributes(): string[] {
    return ['debitAmount', 'receiveAmount', 'quote', 'sentAmount', 'receiver']
  }

  public state!: OutgoingPaymentState
  // The "| null" is necessary so that `$beforeUpdate` can modify a patch to remove the error. If `$beforeUpdate` set `error = undefined`, the patch would ignore the modification.
  public error?: string | null
  public stateAttempts!: number

  public grantId?: string

  public get receiver(): string {
    return this.quote.receiver
  }

  public get debitAmount(): Amount {
    return this.quote.debitAmount
  }

  private sentAmountValue?: bigint

  public get sentAmount(): Amount {
    return {
      value: this.sentAmountValue || BigInt(0),
      assetCode: this.asset.code,
      assetScale: this.asset.scale
    }
  }
  public set sentAmount(amount: Amount) {
    this.sentAmountValue = amount.value
  }
  public get receiveAmount(): Amount {
    return this.quote.receiveAmount
  }

  public metadata?: Record<string, unknown>

  public quote!: Quote

  public get assetId(): string {
    return this.quote.assetId
  }

  public getUrl(walletAddress: WalletAddress): string {
    return `${walletAddress.url}${OutgoingPayment.urlPath}/${this.id}`
  }

  public get asset(): Asset {
    return this.quote.asset
  }

  public get failed(): boolean {
    return this.state === OutgoingPaymentState.Failed
  }

  // Outgoing peer
  public peerId?: string

  static get relationMappings() {
    return {
      ...super.relationMappings,
      quote: {
        relation: Model.HasOneRelation,
        modelClass: Quote,
        join: {
          from: 'outgoingPayments.id',
          to: 'quotes.id'
        }
      }
    }
  }

  $beforeUpdate(opts: ModelOptions, queryContext: QueryContext): void {
    super.$beforeUpdate(opts, queryContext)
    if (opts.old && this.state) {
      if (!this.stateAttempts) {
        this.stateAttempts = 0
      }
    }
  }

  public toData({
    amountSent,
    balance
  }: {
    amountSent: bigint
    balance: bigint
  }): PaymentData {
    const data: PaymentData = {
      payment: {
        id: this.id,
        walletAddressId: this.walletAddressId,
        state: this.state,
        receiver: this.receiver,
        debitAmount: {
          ...this.debitAmount,
          value: this.debitAmount.value.toString()
        },
        receiveAmount: {
          ...this.receiveAmount,
          value: this.receiveAmount.value.toString()
        },
        sentAmount: {
          ...this.debitAmount,
          value: amountSent.toString()
        },
        stateAttempts: this.stateAttempts,
        createdAt: new Date(+this.createdAt).toISOString(),
        updatedAt: new Date(+this.updatedAt).toISOString(),
        balance: balance.toString()
      }
    }
    if (this.metadata) {
      data.payment.metadata = this.metadata
    }
    if (this.error) {
      data.payment.error = this.error
    }
    if (this.peerId) {
      data.payment.peerId = this.peerId
    }
    return data
  }

  public toOpenPaymentsType(
    walletAddress: WalletAddress
  ): OpenPaymentsOutgoingPayment {
    return {
      id: this.getUrl(walletAddress),
      walletAddress: walletAddress.url,
      quoteId: this.quote?.getUrl(walletAddress) ?? undefined,
      receiveAmount: serializeAmount(this.receiveAmount),
      debitAmount: serializeAmount(this.debitAmount),
      sentAmount: serializeAmount(this.sentAmount),
      receiver: this.receiver,
      failed: this.failed,
      metadata: this.metadata ?? undefined,
      createdAt: this.createdAt.toISOString(),
      updatedAt: this.updatedAt.toISOString()
    }
  }
}

export enum OutgoingPaymentState {
  // Initial state.
  // Awaiting money from the user's wallet account to be deposited to the payment account to reserve it for the payment.
  // On success, transition to `SENDING`.
  // On failure, transition to `FAILED`.
  Funding = 'FUNDING',
  // Pay from the account to the destination.
  // On success, transition to `COMPLETED`.
  Sending = 'SENDING',
  // The payment failed. (Though some money may have been delivered).
  Failed = 'FAILED',
  // Successful completion.
  Completed = 'COMPLETED'
}

export enum PaymentDepositType {
  PaymentCreated = 'outgoing_payment.created'
}

export enum PaymentWithdrawType {
  PaymentFailed = 'outgoing_payment.failed',
  PaymentCompleted = 'outgoing_payment.completed'
}

export const PaymentEventType = {
  ...PaymentDepositType,
  ...PaymentWithdrawType
}
export type PaymentEventType = PaymentDepositType | PaymentWithdrawType

export interface OutgoingPaymentResponse {
  id: string
  walletAddressId: string
  createdAt: string
  receiver: string
  debitAmount: AmountJSON
  receiveAmount: AmountJSON
  metadata?: Record<string, unknown>
  failed: boolean
  updatedAt: string
  sentAmount: AmountJSON
}

export type PaymentData = {
  payment: Omit<OutgoingPaymentResponse, 'failed'> & {
    error?: string
    state: OutgoingPaymentState
    stateAttempts: number
    balance: string
    peerId?: string
  }
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-module-boundary-types
export const isPaymentEventType = (o: any): o is PaymentEventType =>
  Object.values(PaymentEventType).includes(o)

// eslint-disable-next-line @typescript-eslint/no-explicit-any, @typescript-eslint/explicit-module-boundary-types
export const isPaymentEvent = (o: any): o is PaymentEvent =>
  o instanceof WebhookEvent && isPaymentEventType(o.type)

export class PaymentEvent extends WebhookEvent {
  public type!: PaymentEventType
  public data!: PaymentData
}
