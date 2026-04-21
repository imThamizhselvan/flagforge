import { evaluate } from '@flagforge/shared'
import type { EvaluationContext, FlagConfig, SdkConfig } from '@flagforge/shared'

export type { EvaluationContext, EvaluationResult } from '@flagforge/shared'

export interface FlagForgeOptions {
  apiKey: string
  apiUrl?: string
  pollingInterval?: number
  bootstrap?: SdkConfig
  onError?: (error: Error) => void
  onConfigUpdate?: (config: SdkConfig) => void
}

type AttributeValue = string | number | boolean
type UserContext = { key: string; attributes?: Record<string, AttributeValue> }

export class FlagForgeClient {
  private readonly apiKey: string
  private readonly apiUrl: string
  private readonly onError: (e: Error) => void
  private readonly onConfigUpdate: (c: SdkConfig) => void

  private flags: Map<string, FlagConfig> = new Map()
  private etag: string | null = null
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private sseSource: EventSource | null = null
  private readyPromise: Promise<void>
  private resolveReady!: () => void
  private eventBuffer: object[] = []
  private flushTimer: ReturnType<typeof setInterval> | null = null

  constructor(private readonly options: FlagForgeOptions) {
    this.apiKey = options.apiKey
    this.apiUrl = options.apiUrl ?? 'https://api.flagforge.dev'
    this.onError = options.onError ?? (() => {})
    this.onConfigUpdate = options.onConfigUpdate ?? (() => {})

    this.readyPromise = new Promise((resolve) => {
      this.resolveReady = resolve
    })

    if (options.bootstrap) {
      this.applyConfig(options.bootstrap)
      this.resolveReady()
    }

    this.connect()
    this.startEventFlush()
  }

  static init(options: FlagForgeOptions): FlagForgeClient {
    return new FlagForgeClient(options)
  }

  ready(): Promise<void> {
    return this.readyPromise
  }

  isEnabled(flagKey: string, user: UserContext): boolean {
    const flag = this.flags.get(flagKey)
    if (!flag) return false
    const result = evaluate(flag, user)
    this.bufferEvent(flagKey, result.variantKey, user)
    return result.value === true
  }

  getVariant<T = unknown>(flagKey: string, user: UserContext): { key: string; value: T } | null {
    const flag = this.flags.get(flagKey)
    if (!flag) return null
    const result = evaluate(flag, user)
    this.bufferEvent(flagKey, result.variantKey, user)
    return { key: result.variantKey, value: result.value as T }
  }

  getAllFlags(user: UserContext): Record<string, unknown> {
    const out: Record<string, unknown> = {}
    for (const [key, flag] of this.flags) {
      const result = evaluate(flag, user)
      out[key] = result.value
    }
    return out
  }

  destroy() {
    if (this.pollTimer) clearInterval(this.pollTimer)
    if (this.flushTimer) clearInterval(this.flushTimer)
    if (this.sseSource) this.sseSource.close()
    this.flushEvents()
  }

  private applyConfig(config: SdkConfig) {
    const next = new Map<string, FlagConfig>()
    for (const flag of config.flags) {
      next.set(flag.key, flag)
    }
    this.flags = next
    this.etag = config.etag
    this.onConfigUpdate(config)
  }

  private connect() {
    if (typeof EventSource !== 'undefined') {
      this.connectSSE()
    } else {
      this.startPolling()
    }
  }

  private connectSSE() {
    const url = `${this.apiUrl}/sdk/v1/stream`
    const source = new EventSource(url, {
      // @ts-expect-error — non-standard but widely supported
      headers: { Authorization: `Bearer ${this.apiKey}` },
    })

    source.onmessage = (event) => {
      try {
        const msg = JSON.parse(event.data as string) as { type: string; payload: SdkConfig }
        if (msg.type === 'config') {
          this.applyConfig(msg.payload)
          this.resolveReady()
        }
      } catch (e) {
        this.onError(e instanceof Error ? e : new Error(String(e)))
      }
    }

    source.onerror = () => {
      source.close()
      this.sseSource = null
      // Fallback to polling on SSE failure
      setTimeout(() => this.startPolling(), 5_000)
    }

    this.sseSource = source
  }

  private startPolling() {
    const interval = this.options.pollingInterval ?? 30_000
    this.fetchConfig()
    this.pollTimer = setInterval(() => this.fetchConfig(), interval)
  }

  private async fetchConfig() {
    try {
      const res = await fetch(`${this.apiUrl}/sdk/v1/config`, {
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          ...(this.etag ? { 'If-None-Match': this.etag } : {}),
        },
      })

      if (res.status === 304) return
      if (!res.ok) throw new Error(`FlagForge: config fetch failed with ${res.status}`)

      const config = (await res.json()) as SdkConfig
      this.applyConfig(config)
      this.resolveReady()
    } catch (e) {
      this.onError(e instanceof Error ? e : new Error(String(e)))
    }
  }

  private bufferEvent(flagKey: string, variantKey: string, user: UserContext) {
    this.eventBuffer.push({
      flagKey,
      variantKey,
      userKey: user.key,
      attributes: user.attributes,
      ts: Date.now(),
    })

    if (this.eventBuffer.length >= 100) {
      this.flushEvents()
    }
  }

  private startEventFlush() {
    this.flushTimer = setInterval(() => this.flushEvents(), 10_000)
  }

  private async flushEvents() {
    if (this.eventBuffer.length === 0) return

    const events = this.eventBuffer.splice(0)
    try {
      await fetch(`${this.apiUrl}/sdk/v1/events`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({ events }),
      })
    } catch (e) {
      // Re-queue on failure (bounded to prevent unbounded growth)
      if (this.eventBuffer.length < 1000) {
        this.eventBuffer.unshift(...events)
      }
      this.onError(e instanceof Error ? e : new Error(String(e)))
    }
  }
}

export const FlagForge = FlagForgeClient
