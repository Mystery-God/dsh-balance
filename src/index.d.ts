/**
 * Type surface of the dsh-balance host half. Minimal — the implementation is
 * plain JavaScript; this declaration documents the plugin contract and the
 * settings shape for TypeScript consumers.
 */

/** Services the host half requires before mounting. */
export declare const name: 'balance'
export declare const inject: ['webServer', 'systemPrompt']

/** Model-facing announcement text. */
export declare const BALANCE_GUIDANCE: string

/** The settings document persisted at ~/.dsh/balance/settings.json. */
export interface BalanceSettings {
  /** Master switch for the floating window. */
  floatingWindow: boolean
}

/** One balance row (label + provider value). */
export interface BalanceEntry {
  label: string
  value: string | number
}

/** The normalized balance payload served to the browser half. */
export interface BalancePayload {
  ok: boolean
  provider?: string
  currency?: string
  balances?: BalanceEntry[]
  note?: string
  updatedAt?: string
  error?: string
}

/** Mount the routes and the system-prompt announcement. */
export declare function apply(ctx: unknown): void
