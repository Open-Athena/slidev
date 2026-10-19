// "Get link": the `@open-athena/auth` route wrappers (`packages/client/logic/auth-client.ts`), the
// share URL, and the dialog's mint request (`logic/share-link.ts`). Against a stub `fetch` that
// records each request; the Worker end of the same routes is in `og-worker-auth.test.ts`.
import { describe, expect, it } from 'vitest'
import { AuthClientError, canMintLinks, createAuthClient, holderOf, shareUrl } from '../packages/client/logic/auth-client'
import { DEFAULT_SHARE_FORM, endOfDay, landingUrl, mintInputFor } from '../packages/client/logic/share-link'

interface Sent { method: string, url: string, headers: Record<string, string>, body: unknown, credentials: string | undefined }

function stub(answer: (sent: Sent) => { status?: number, body: unknown }) {
  const sent: Sent[] = []
  const fetch = async (url: string | URL | Request, init: RequestInit = {}) => {
    const s: Sent = {
      method: init.method ?? 'GET',
      url: String(url),
      headers: init.headers as Record<string, string>,
      body: init.body === undefined ? undefined : JSON.parse(init.body as string),
      credentials: init.credentials,
    }
    sent.push(s)
    const { status = 200, body } = answer(s)
    return new Response(typeof body === 'string' ? body : JSON.stringify(body), { status })
  }
  return { sent, client: createAuthClient({ basePath: '/deck/api/auth/', fetch: fetch as typeof globalThis.fetch }) }
}

const GET = { Accept: 'application/json' }
const JSON_BODY = { 'Accept': 'application/json', 'Content-Type': 'application/json' }

const grant = {
  id: 'g1',
  name: null,
  note: 'for the review',
  subject: { name: 'Rae' },
  email: 'rae@example.org',
  scopes: ['deck'],
  maxRedeems: null,
  redeems: 0,
  expiresAt: 1800000000,
  sessionTtlS: null,
  createdAt: 1700000000,
  createdBy: 'boss@example.org',
  disabledAt: null,
  revokedAt: null,
  expiryEndsSessions: true,
  sessionsInvalidBefore: null,
  firstUsedAt: null,
  lastUsedAt: null,
}

describe('createAuthClient', () => {
  it('sends each route its method, path and body', async () => {
    const { sent, client } = stub(({ url }) => ({
      body: url.endsWith('/whoami')
        ? { kind: 'sso', email: 'boss@example.org', admin: true, scopes: ['*'], subject: null }
        : url.includes('/grants?') || url.endsWith('/grants') ? { grants: [grant], grant, token: 'tok' } : url.includes('/log') ? { events: [] } : { grant, ok: true, id: 'g1', token: 'tok2', grantId: 'g1' },
    }))
    await client.whoami()
    await client.grants.mint({ scopes: ['deck'], subjectName: 'Rae', avatar: null })
    expect(await client.grants.list()).toEqual([grant])
    await client.grants.list({ active: true })
    expect(await client.grants.update('g1', { note: 'n' })).toEqual(grant)
    expect(await client.grants.revoke('g1')).toBe(true)
    await client.grants.disable('g1')
    await client.grants.enable('g1')
    await client.grants.rotate('g1', { endSessions: true })
    await client.grants.activity('g/1')
    await client.log({ grant: 'g1', limit: 5 })
    await client.log()
    await client.logout()
    expect(sent.map(s => [s.method, s.url, s.headers, s.body])).toEqual([
      ['GET', '/deck/api/auth/whoami', GET, undefined],
      ['POST', '/deck/api/auth/grants', JSON_BODY, { scopes: ['deck'], subjectName: 'Rae', avatar: null }],
      ['GET', '/deck/api/auth/grants', GET, undefined],
      ['GET', '/deck/api/auth/grants?active=1', GET, undefined],
      ['PATCH', '/deck/api/auth/grants/g1', JSON_BODY, { note: 'n' }],
      ['POST', '/deck/api/auth/grants/g1/revoke', GET, undefined],
      ['POST', '/deck/api/auth/grants/g1/disable', GET, undefined],
      ['POST', '/deck/api/auth/grants/g1/enable', GET, undefined],
      ['POST', '/deck/api/auth/grants/g1/rotate', JSON_BODY, { endSessions: true }],
      ['GET', '/deck/api/auth/grants/g%2F1/activity', GET, undefined],
      ['GET', '/deck/api/auth/log?grant=g1&limit=5', GET, undefined],
      ['GET', '/deck/api/auth/log', GET, undefined],
      ['POST', '/deck/api/auth/logout', GET, undefined],
    ])
    expect(new Set(sent.map(s => s.credentials))).toEqual(new Set(['same-origin']))
  })

  it('throws `AuthClientError` with the status and the error body', async () => {
    const answers: Record<string, { status: number, body: unknown }> = {
      '/deck/api/auth/whoami': { status: 401, body: { error: 'unauthenticated' } },
      '/deck/api/auth/grants': { status: 403, body: { error: 'forbidden' } },
      '/deck/api/auth/grants/nope/revoke': { status: 404, body: { error: 'not found' } },
      '/deck/api/auth/grants/g1/activity': { status: 501, body: { error: 'audit query not configured' } },
    }
    const { client } = stub(({ url }) => answers[url])
    const caught = async (p: Promise<unknown>) => p.then(() => null, (e: AuthClientError) => [e.name, e.status, e.body, e.message])
    expect(await Promise.all([
      caught(client.whoami()),
      caught(client.grants.mint({ scopes: ['deck'] })),
      caught(client.grants.revoke('nope')),
      caught(client.grants.activity('g1')),
    ])).toEqual([
      ['AuthClientError', 401, { error: 'unauthenticated' }, 'unauthenticated (401)'],
      ['AuthClientError', 403, { error: 'forbidden' }, 'forbidden (403)'],
      ['AuthClientError', 404, { error: 'not found' }, 'not found (404)'],
      ['AuthClientError', 501, { error: 'audit query not configured' }, 'audit query not configured (501)'],
    ])
  })

  it('treats a non-JSON answer (a dev server\'s SPA fallback) as an error', async () => {
    const { client } = stub(() => ({ body: '<!DOCTYPE html><html></html>' }))
    const err = await client.whoami().catch((e: AuthClientError) => e)
    expect([err instanceof AuthClientError, (err as AuthClientError).status, (err as AuthClientError).body]).toEqual([true, 200, { error: 'not a JSON answer' }])
  })
})

describe('canMintLinks', () => {
  it('is true for `*` and `admin` only', () => {
    expect([
      canMintLinks(null),
      canMintLinks({ kind: 'sso', email: 'a@x', admin: true, scopes: ['*'], subject: null }),
      canMintLinks({ kind: 'sso', email: 'a@x', admin: false, scopes: ['admin'], subject: null }),
      canMintLinks({ kind: 'sso', email: 'a@x', admin: false, scopes: ['deck'], subject: null }),
      canMintLinks({ kind: 'grant', id: 'g', name: null, subject: null, email: null, scopes: ['deck'], admin: false, expiresAt: null }),
    ]).toEqual([false, true, true, false, false])
  })
})

describe('shareUrl / landingUrl', () => {
  it('appends the key, keeping the query and the hash', () => {
    expect([
      shareUrl('tok', 'https://deck.example/3-intro'),
      shareUrl('tok', 'https://deck.example/3-intro?m=heatmap'),
      shareUrl('tok', 'https://deck.example/3-intro?key=old&m=heatmap'),
      shareUrl('tok', 'https://deck.example/talk/#/3'),
    ]).toEqual([
      'https://deck.example/3-intro?key=tok',
      'https://deck.example/3-intro?m=heatmap&key=tok',
      'https://deck.example/3-intro?key=tok&m=heatmap',
      'https://deck.example/talk/?key=tok#/3',
    ])
  })

  it('lands on the slide\'s canonical path with the current query, or on the deck\'s start', () => {
    const origin = 'https://deck.example'
    expect([
      landingUrl({ origin, base: '/', prefix: '/', path: '/3-intro', search: '' }),
      landingUrl({ origin, base: '/', prefix: '/', path: '/3-intro', search: '?m=heatmap&key=spent' }),
      landingUrl({ origin, base: '/talk/', prefix: '/talk/', path: '/3-intro', search: '?m=heatmap' }),
      landingUrl({ origin, base: '/talk/', prefix: '/talk/#/', path: '/3' }),
      landingUrl({ origin, base: '/talk/', prefix: '/talk/', search: '?m=heatmap' }),
    ]).toEqual([
      'https://deck.example/3-intro',
      'https://deck.example/3-intro?m=heatmap',
      'https://deck.example/talk/3-intro?m=heatmap',
      'https://deck.example/talk/#/3',
      'https://deck.example/talk/',
    ])
  })
})

describe('mintInputFor', () => {
  it('maps the form to the mint body', () => {
    expect(mintInputFor(DEFAULT_SHARE_FORM, 'deck')).toEqual({
      scopes: ['deck'],
      subjectName: null,
      email: null,
      note: null,
      avatar: null,
      maxRedeems: null,
      expiresInS: 30 * 86400,
      allowlist: false,
    })
    expect(mintInputFor({ name: ' Rae ', email: ' Rae@Example.org ', note: 'review', days: '', unlimited: false, maxUses: 3 }, 'talk')).toEqual({
      scopes: ['talk'],
      subjectName: 'Rae',
      email: 'rae@example.org',
      note: 'review',
      avatar: null,
      maxRedeems: 3,
      expiresInS: null,
      allowlist: true,
    })
  })

  it('refuses a bad expiry or use count', () => {
    expect(() => mintInputFor({ ...DEFAULT_SHARE_FORM, days: 'soon' }, 'deck')).toThrow('Expiry must be a positive number of days, or blank for never')
    expect(() => mintInputFor({ ...DEFAULT_SHARE_FORM, unlimited: false, maxUses: 0 }, 'deck')).toThrow('Uses must be a whole number, at least 1')
  })
})

describe('table helpers', () => {
  it('names the holder', () => {
    expect([
      holderOf(grant),
      holderOf({ ...grant, subject: null }),
      holderOf({ subject: null, email: null, name: 'label' }),
      holderOf({ subject: null, email: null, name: null }),
    ]).toEqual(['Rae', 'rae@example.org', 'label', null])
  })

  it('reads a date input as the end of that local day', () => {
    expect([endOfDay(''), endOfDay('2027-03-04')]).toEqual([null, Math.floor(new Date(2027, 2, 4, 23, 59, 59).getTime() / 1000)])
  })
})
