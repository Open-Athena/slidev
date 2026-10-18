// Talks to the dev-server `/__slidev/state/*` middleware. Mechanical translation of the
// fetch + EventSource calls that previously lived inline in `useDragHistory.ts`.

import type {
  CommitResult,
  EditEvent,
  EditOptions,
  IStateClient,
  ListEventsOptions,
  ServerSnapshot,
  StateChangeMessage,
  UndoRedoResult,
} from './types'

export class RemoteStateClient implements IStateClient {
  private es: EventSource | null = null
  private subscribers = new Set<(msg: StateChangeMessage) => void>()

  async getSnapshot(): Promise<ServerSnapshot> {
    const r = await fetch('/__slidev/state')
    return await r.json() as ServerSnapshot
  }

  async listEvents(opts: ListEventsOptions = {}): Promise<EditEvent[]> {
    const params = new URLSearchParams()
    if (opts.limit !== undefined)
      params.set('limit', String(opts.limit))
    if (opts.sinceId !== undefined)
      params.set('since', String(opts.sinceId))
    if (opts.slideNo !== undefined)
      params.set('slide', String(opts.slideNo))
    const query = params.toString()
    const r = await fetch(`/__slidev/state/events${query ? `?${query}` : ''}`)
    const { events } = await r.json() as { events: EditEvent[] }
    return events
  }

  async edit(opts: EditOptions): Promise<EditEvent> {
    const r = await fetch('/__slidev/state/edit', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(opts),
    })
    const { event } = await r.json() as { event: EditEvent }
    return event
  }

  async undo(eventId?: number): Promise<UndoRedoResult | null> {
    const r = await fetch('/__slidev/state/undo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(eventId !== undefined ? { eventId } : {}),
    })
    const data = await r.json() as UndoRedoResult & { event: EditEvent | null }
    return data.event ? data : null
  }

  async redo(eventId?: number): Promise<UndoRedoResult | null> {
    const r = await fetch('/__slidev/state/redo', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(eventId !== undefined ? { eventId } : {}),
    })
    const data = await r.json() as UndoRedoResult & { event: EditEvent | null }
    return data.event ? data : null
  }

  async restore(eventId: number): Promise<EditEvent | null> {
    const r = await fetch('/__slidev/state/restore', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ eventId }),
    })
    const { event } = await r.json() as { event: EditEvent | null }
    return event
  }

  async commitYaml(): Promise<CommitResult> {
    const r = await fetch('/__slidev/state/commit-yaml', { method: 'POST' })
    return await r.json() as CommitResult
  }

  async revertToYaml(): Promise<EditEvent | null> {
    const r = await fetch('/__slidev/state/revert-to-yaml', { method: 'POST' })
    if (!r.ok)
      return null
    const body = await r.json() as { event: EditEvent | null }
    return body.event
  }

  subscribe(handler: (msg: StateChangeMessage) => void): () => void {
    this.subscribers.add(handler)
    if (!this.es && typeof EventSource !== 'undefined')
      this.openStream()
    return () => {
      this.subscribers.delete(handler)
    }
  }

  private openStream(): void {
    const es = new EventSource('/__slidev/state/stream')
    this.es = es
    es.addEventListener('message', (ev) => {
      let msg: StateChangeMessage | null = null
      try {
        msg = JSON.parse((ev as MessageEvent).data) as StateChangeMessage
      }
      catch {
        return
      }
      if (!msg || msg.type !== 'state-change')
        return
      for (const fn of this.subscribers) fn(msg)
    })
    es.addEventListener('error', () => {
      // Browser auto-reconnects per the server's `retry: 5000` directive. Nothing to do.
    })
  }

  dispose(): void {
    this.es?.close()
    this.es = null
    this.subscribers.clear()
  }
}
