import {
  Counter,
  DiagConsoleLogger,
  DiagLogLevel,
  MetricOptions,
  ValueType,
  diag,
  metrics
} from '@opentelemetry/api'
import { OTLPMetricExporter } from '@opentelemetry/exporter-metrics-otlp-grpc'
import { Resource } from '@opentelemetry/resources'
import {
  MeterProvider,
  PeriodicExportingMetricReader
} from '@opentelemetry/sdk-metrics'

import { BaseService } from '../shared/baseService'

export interface TelemetryService {
  getCounter(name: string): Counter | undefined
}

interface TelemetryServiceDependencies extends BaseService {
  serviceName?: string
  collectorUrl?: string
  exportIntervalMillis?: number
}

export enum Metrics {
  TRANSACTIONS_TOTAL = 'transactions_total',
  TRANSACTIONS_AMOUNT = 'transactions_amount'
}

export function createTelemetryService(
  deps: TelemetryServiceDependencies
): TelemetryService {
  return new TelemetryServiceImpl(deps)
}

class TelemetryServiceImpl implements TelemetryService {
  private counters = new Map()
  constructor(private deps: TelemetryServiceDependencies) {
    diag.setLogger(new DiagConsoleLogger(), DiagLogLevel.DEBUG)

    console.log(
      `serviceName: ${deps.serviceName}, collectorUrl: ${deps.collectorUrl} }`
    )

    const meterProvider = new MeterProvider({
      resource: new Resource({ 'service.name': deps.serviceName ?? 'Rafiki' })
    })

    const metricExporter = new OTLPMetricExporter({
      url: deps.collectorUrl ?? 'http://otel-collector:4317'
    })

    const metricReader = new PeriodicExportingMetricReader({
      exporter: metricExporter,
      exportIntervalMillis: deps.exportIntervalMillis ?? 60000
    })

    meterProvider.addMetricReader(metricReader)

    metrics.setGlobalMeterProvider(meterProvider)

    //* init counters
    this.createCounter(Metrics.TRANSACTIONS_TOTAL, {
      description: 'Count of funded transactions'
    })

    this.createCounter(Metrics.TRANSACTIONS_AMOUNT, {
      description:
        'Amount sent through the network. Asset Code & Asset Scale are sent as attributes',
      valueType: ValueType.DOUBLE
    })

    this.createCounter(Metrics.TRANSACTIONS_TOTAL, {
      description: 'Count of funded transactions'
    })
  }

  private createCounter(
    name: string,
    options: MetricOptions | undefined
  ): void {
    const counter = metrics.getMeter('Rafiki').createCounter(name, options)
    this.counters.set(name, counter)
  }

  public getCounter(name: string): Counter | undefined {
    return this.counters.get(name)
  }
}
