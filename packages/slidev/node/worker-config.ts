// `publish.worker` (and `slidev build --worker / --auth`) resolved to one config. Kept apart from
// `commands/og.ts` so `options.ts` can read it (for the client's `__SLIDEV_FEATURE_AUTH__`)
// without pulling in the OG pipeline.

/** `publish.worker.auth`: the deck behind `@open-athena/auth`. */
export interface WorkerAuthConfig {
  provider: 'open-athena'
  /** Email domains whose (Google) accounts get the deck's scope. */
  staffDomains: string[]
  /** Addresses that always get in, with every scope (they can mint share links). */
  admins: string[]
  /** The scope a session needs; default `deck`. */
  scope: string
  /** D1 database name; default `<worker name>-auth`. */
  database?: string
  /** D1 database id; default looked up (or created) by `slidev deploy`. */
  databaseId?: string
}

export interface WorkerConfig {
  /** Worker name in the generated `wrangler.jsonc`; default the slugified deck title. */
  name?: string
  /** See `publish.worker.renderer`; `undefined` = detect. */
  renderer?: 'browser' | 'none'
  /** Cards (and blocked slides' share tags) stay public behind a gate; default `true`. */
  publicOg: boolean
  auth?: WorkerAuthConfig
}

export const AUTH_PROVIDERS = ['open-athena'] as const

function stringList(v: unknown): string[] {
  return (Array.isArray(v) ? v : typeof v === 'string' ? v.split(',') : []).map(x => String(x).trim()).filter(Boolean)
}

/**
 * `publish.worker` (`true` or an object), overridden by `--worker` / `--no-worker`; `null` when
 * off. `--auth <provider>` (`authFlag`) sets `auth` and turns the Worker on, unless `--no-worker`.
 * Throws on an unknown `auth` provider rather than build an ungated deck.
 */
export function resolveWorkerConfig(raw: unknown, flag: boolean | undefined, authFlag?: string): WorkerConfig | null {
  if (flag === false || (!flag && !raw && !authFlag))
    return null
  const obj = raw && typeof raw === 'object' ? raw as Record<string, unknown> : {}
  const provider = authFlag ?? obj.auth
  if (provider != null && provider !== false && !(AUTH_PROVIDERS as readonly unknown[]).includes(provider))
    throw new Error(`[Slidev] Worker: unknown \`auth\` provider ${JSON.stringify(provider)}; supported: ${AUTH_PROVIDERS.join(', ')}`)
  const config: WorkerConfig = {
    name: typeof obj.name === 'string' ? obj.name : undefined,
    renderer: obj.renderer === 'browser' || obj.renderer === 'none' ? obj.renderer : undefined,
    publicOg: obj.publicOg !== false,
  }
  if (provider) {
    config.auth = {
      provider: provider as WorkerAuthConfig['provider'],
      staffDomains: stringList(obj.staffDomain),
      admins: stringList(obj.admins),
      scope: typeof obj.scope === 'string' && obj.scope ? obj.scope : 'deck',
      database: typeof obj.database === 'string' ? obj.database : undefined,
      databaseId: typeof obj.databaseId === 'string' ? obj.databaseId : undefined,
    }
  }
  return config
}
