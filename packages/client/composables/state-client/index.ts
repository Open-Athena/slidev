// Boot-time selection of the right IStateClient backend.
//
// The probe is a one-shot HEAD against `/__slidev/state`. In dev mode it returns 200 (the
// vite plugin handles GET — HEAD also passes through middleware), so we pick the remote
// client and talk to the SQLite-backed event log on the dev server. In a static deploy the
// endpoint doesn't exist, the response is 404 (or the request errors), and we fall back to
// the localStorage-backed local client.
//
// Cached as a Promise so concurrent callers (drawer mount + first user edit + connect-on-
// boot) all wait on the same probe. After the promise resolves, every call returns the
// same client instance.

import type { IStateClient } from './types'
import { LocalStateClient } from './local'
import { RemoteStateClient } from './remote'

export { LocalStateClient } from './local'
export { RemoteStateClient } from './remote'
export * from './types'

let clientPromise: Promise<IStateClient> | null = null

export function getStateClient(): Promise<IStateClient> {
  if (clientPromise)
    return clientPromise
  clientPromise = probeAndCreate()
  return clientPromise
}

// Force a particular backend (used by tests; production code should call getStateClient()).
export function _setStateClient(client: IStateClient): void {
  clientPromise = Promise.resolve(client)
}

async function probeAndCreate(): Promise<IStateClient> {
  // GET /__slidev/state — the dev-server returns the snapshot; a static deploy 404s. We
  // could use HEAD here for speed, but most static hosts don't actually save bytes on
  // HEAD vs GET, and a real GET means the response body is reusable for the first
  // hydrate (one fewer round-trip in dev).
  try {
    const r = await fetch('/__slidev/state', { method: 'GET' })
    if (r.ok && r.headers.get('content-type')?.includes('application/json')) {
      // Touch the response body so the connection is reused for streaming etc. We don't
      // need the parsed result here; useDragHistory will fetch it separately.
      await r.text()
      return new RemoteStateClient()
    }
  }
  catch {
    // Network error → fall through to local.
  }
  return new LocalStateClient()
}
