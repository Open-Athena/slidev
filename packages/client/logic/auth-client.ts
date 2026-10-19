// Typed `fetch` wrappers for `@open-athena/auth`'s `authRoutes` (`<base>api/auth/*`, mounted by
// the Worker `slidev build --worker --auth open-athena` writes). Shaped like the proposed
// framework-free `@open-athena/auth/client` (`~/c/oa/auth/specs/client-module.md`); switch to the
// package when it ships. Pure: no Vue, no globals beyond `fetch` / `URL`.

/** The holder identity a link signs in as. */
export interface Subject {
  name?: string
  email?: string
  avatar?: string
}

/** A grant (share link) as the routes serialize it. Never carries its token. */
export interface Grant {
  id: string
  name: string | null
  note: string | null
  subject: Subject | null
  email: string | null
  scopes: string[]
  maxRedeems: number | null
  redeems: number
  /** Epoch seconds; `null` = never. */
  expiresAt: number | null
  sessionTtlS: number | null
  createdAt: number
  createdBy: string
  disabledAt: number | null
  revokedAt: number | null
  expiryEndsSessions: boolean
  sessionsInvalidBefore: number | null
  firstUsedAt: number | null
  lastUsedAt: number | null
}

export type Whoami
  = | { kind: 'sso', email: string, admin: boolean, scopes: string[], subject: Subject | null }
    | { kind: 'grant', id: string, name: string | null, subject: Subject | null, email: string | null, scopes: string[], admin: false, expiresAt: number | null }

/** `POST grants`'s body. */
export interface MintInput {
  scopes: string[]
  /** The link's admin-side label. */
  name?: string | null
  note?: string | null
  /** Binds the link to this address. */
  email?: string | null
  /** The recipient's name (`subject.name`). */
  subjectName?: string | null
  /** `null`: no face (absent: the recipient's Gravatar, fetched by the Worker). */
  avatar?: string | null
  /** `null` = unlimited. */
  maxRedeems?: number | null
  /** `null` = never expires. */
  expiresInS?: number | null
  sessionTtlS?: number | null
  expiryEndsSessions?: boolean
  /** Also put `email` on the allowlist with the link's scopes. */
  allowlist?: boolean
}

export interface MintResult {
  grant: Grant
  /** The only time the raw token is visible. */
  token: string
  allowed?: { email: string, status: 'added' | 'widened' | 'already' }
}

/** What `PATCH grants/:id` accepts. */
export interface GrantPatch {
  name?: string | null
  note?: string | null
  expiresAt?: number | null
  maxRedeems?: number | null
  sessionTtlS?: number | null
  expiryEndsSessions?: boolean
  subjectName?: string | null
  avatar?: string | null
}

export interface GrantActivity {
  grantId: string
  distinctIps: number
  countries: string[]
  views: number
  firstSeen: number | null
  lastSeen: number | null
  topPaths: { path: string, views: number }[]
}

export interface AuditEvent {
  id: number
  ts: number
  event: string
  grantId: string | null
  sessionSub: string | null
  path: string | null
  reason: string | null
  country: string | null
  city: string | null
  region: string | null
  asOrg: string | null
  ua: string | null
  ipHash: string | null
  referer: string | null
}

/** A non-2xx answer: `status` and the route's JSON error body (`null` if it wasn't JSON). */
export class AuthClientError extends Error {
  constructor(readonly status: number, readonly body: { error?: string, detail?: string, [k: string]: unknown } | null) {
    super(body?.error ? `${body.error}${body.detail ? `: ${body.detail}` : ''} (${status})` : `auth request failed (${status})`)
    this.name = 'AuthClientError'
  }
}

export interface AuthClientOptions {
  /** Default `/api/auth`. */
  basePath?: string
  fetch?: typeof globalThis.fetch
}

export function createAuthClient({ basePath = '/api/auth', fetch: fetchFn = (...args) => globalThis.fetch(...args) }: AuthClientOptions = {}) {
  const base = basePath.replace(/\/+$/, '')
  async function call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetchFn(`${base}${path}`, {
      method,
      credentials: 'same-origin',
      headers: body === undefined ? { Accept: 'application/json' } : { 'Accept': 'application/json', 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    })
    const text = await res.text()
    let json: any = null
    try {
      json = text ? JSON.parse(text) : null
    }
    catch {
      // Not JSON (e.g. a dev server's SPA fallback): handled below.
    }
    if (!res.ok)
      throw new AuthClientError(res.status, json && typeof json === 'object' ? json : null)
    if (json === null || typeof json !== 'object')
      throw new AuthClientError(res.status, { error: 'not a JSON answer' })
    return json as T
  }
  const grant = (id: string) => `/grants/${encodeURIComponent(id)}`
  return {
    whoami: () => call<Whoami>('GET', '/whoami'),
    logout: () => call<{ ok: true }>('POST', '/logout'),
    grants: {
      mint: (input: MintInput) => call<MintResult>('POST', '/grants', input),
      /** `active`: leave out revoked links (the route includes them by default). */
      list: async ({ active }: { active?: boolean } = {}) => (await call<{ grants: Grant[] }>('GET', `/grants${active ? '?active=1' : ''}`)).grants,
      update: async (id: string, patch: GrantPatch) => (await call<{ grant: Grant }>('PATCH', grant(id), patch)).grant,
      revoke: async (id: string) => (await call<{ ok: boolean }>('POST', `${grant(id)}/revoke`)).ok,
      disable: async (id: string) => (await call<{ ok: boolean }>('POST', `${grant(id)}/disable`)).ok,
      enable: async (id: string) => (await call<{ ok: boolean }>('POST', `${grant(id)}/enable`)).ok,
      rotate: (id: string, { endSessions = false }: { endSessions?: boolean } = {}) => call<{ id: string, token: string }>('POST', `${grant(id)}/rotate`, { endSessions }),
      activity: (id: string) => call<GrantActivity>('GET', `${grant(id)}/activity`),
    },
    log: async ({ grant: grantId, limit }: { grant?: string, limit?: number } = {}) => {
      const q = new URLSearchParams()
      if (grantId)
        q.set('grant', grantId)
      if (limit)
        q.set('limit', String(limit))
      const qs = q.toString()
      return (await call<{ events: AuditEvent[] }>('GET', `/log${qs ? `?${qs}` : ''}`)).events
    },
  }
}

export type AuthClient = ReturnType<typeof createAuthClient>

/** `*` (every scope, as `ADMIN_EMAILS` get) or `admin`: may mint and manage links. */
export function canMintLinks(me: Whoami | null | undefined): boolean {
  return !!me && (me.scopes.includes('*') || me.scopes.includes('admin'))
}

/** `target` with `key=<token>` set, its other query params and hash kept. */
export function shareUrl(token: string, target: string): string {
  const url = new URL(target)
  url.searchParams.set('key', token)
  return url.toString()
}

/** The holder's name for a table: the subject's name, else the bound email, else the link's label. */
export function holderOf(g: Pick<Grant, 'subject' | 'email' | 'name'>): string | null {
  return g.subject?.name || g.email || g.subject?.email || g.name || null
}
