import { Model, Pojo } from 'objection'
import * as Pay from '@interledger/pay'

import { Amount, serializeAmount } from '../amount'
import {
  WalletAddress,
  WalletAddressSubresource
} from '../wallet_address/model'
import { Asset } from '../../asset/model'
import { Quote as OpenPaymentsQuote } from '@interledger/open-payments'
import { Fee } from '../../fee/model'

export class Quote extends WalletAddressSubresource {
  public static readonly tableName = 'quotes'
  public static readonly urlPath = '/quotes'

  static get virtualAttributes(): string[] {
    return [
      'debitAmount',
      'receiveAmount',
      'minExchangeRate',
      'lowEstimatedExchangeRate',
      'highEstimatedExchangeRate'
    ]
  }

  // Asset id of the sender
  public assetId!: string
  public asset!: Asset

  public feeId?: string
  public fee?: Fee

  static get relationMappings() {
    return {
      ...super.relationMappings,
      asset: {
        relation: Model.HasOneRelation,
        modelClass: Asset,
        join: {
          from: 'quotes.assetId',
          to: 'assets.id'
        }
      },
      fee: {
        relation: Model.HasOneRelation,
        modelClass: Fee,
        join: {
          from: 'quotes.feeId',
          to: 'fees.id'
        }
      }
    }
  }

  public expiresAt!: Date

  public receiver!: string

  private debitAmountValue!: bigint

  public getUrl(walletAddress: WalletAddress): string {
    return `${walletAddress.url}${Quote.urlPath}/${this.id}`
  }

  public get debitAmount(): Amount {
    return {
      value: this.debitAmountValue,
      assetCode: this.asset.code,
      assetScale: this.asset.scale
    }
  }

  public set debitAmount(amount: Amount) {
    this.debitAmountValue = amount.value
  }

  private receiveAmountValue!: bigint
  private receiveAmountAssetCode!: string
  private receiveAmountAssetScale!: number

  public get receiveAmount(): Amount {
    return {
      value: this.receiveAmountValue,
      assetCode: this.receiveAmountAssetCode,
      assetScale: this.receiveAmountAssetScale
    }
  }

  public set receiveAmount(amount: Amount) {
    this.receiveAmountValue = amount.value
    this.receiveAmountAssetCode = amount.assetCode
    this.receiveAmountAssetScale = amount?.assetScale
  }

  public maxPacketAmount!: bigint
  private minExchangeRateNumerator!: bigint
  private minExchangeRateDenominator!: bigint
  private lowEstimatedExchangeRateNumerator!: bigint
  private lowEstimatedExchangeRateDenominator!: bigint
  private highEstimatedExchangeRateNumerator!: bigint
  private highEstimatedExchangeRateDenominator!: bigint

  public get maxSourceAmount(): bigint {
    return this.debitAmountValue
  }

  public get minDeliveryAmount(): bigint {
    return this.receiveAmountValue
  }

  public get minExchangeRate(): Pay.Ratio {
    return Pay.Ratio.of(
      Pay.Int.from(this.minExchangeRateNumerator) as Pay.PositiveInt,
      Pay.Int.from(this.minExchangeRateDenominator) as Pay.PositiveInt
    )
  }

  public set minExchangeRate(value: Pay.Ratio) {
    this.minExchangeRateNumerator = value.a.value
    this.minExchangeRateDenominator = value.b.value
  }

  public get lowEstimatedExchangeRate(): Pay.Ratio {
    return Pay.Ratio.of(
      Pay.Int.from(this.lowEstimatedExchangeRateNumerator) as Pay.PositiveInt,
      Pay.Int.from(this.lowEstimatedExchangeRateDenominator) as Pay.PositiveInt
    )
  }

  public set lowEstimatedExchangeRate(value: Pay.Ratio) {
    this.lowEstimatedExchangeRateNumerator = value.a.value
    this.lowEstimatedExchangeRateDenominator = value.b.value
  }

  // Note that the upper exchange rate bound is *exclusive*.
  public get highEstimatedExchangeRate(): Pay.PositiveRatio {
    const highEstimatedExchangeRate = Pay.Ratio.of(
      Pay.Int.from(this.highEstimatedExchangeRateNumerator) as Pay.PositiveInt,
      Pay.Int.from(this.highEstimatedExchangeRateDenominator) as Pay.PositiveInt
    )
    if (!highEstimatedExchangeRate.isPositive()) {
      throw new Error()
    }
    return highEstimatedExchangeRate
  }

  public set highEstimatedExchangeRate(value: Pay.PositiveRatio) {
    this.highEstimatedExchangeRateNumerator = value.a.value
    this.highEstimatedExchangeRateDenominator = value.b.value
  }

  $formatJson(json: Pojo): Pojo {
    json = super.$formatJson(json)
    return {
      id: json.id,
      walletAddressId: json.walletAddressId,
      receiver: json.receiver,
      debitAmount: {
        ...json.debitAmount,
        value: json.debitAmount.value.toString()
      },
      receiveAmount: {
        ...json.receiveAmount,
        value: json.receiveAmount.value.toString()
      },
      createdAt: json.createdAt,
      expiresAt: json.expiresAt.toISOString()
    }
  }

  public toOpenPaymentsType(walletAddress: WalletAddress): OpenPaymentsQuote {
    return {
      id: this.getUrl(walletAddress),
      walletAddress: walletAddress.url,
      receiveAmount: serializeAmount(this.receiveAmount),
      debitAmount: serializeAmount(this.debitAmount),
      receiver: this.receiver,
      expiresAt: this.expiresAt.toISOString(),
      createdAt: this.createdAt.toISOString()
    }
  }
}
