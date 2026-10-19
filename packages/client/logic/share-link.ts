// Pure helpers for "Get link" (`internals/ShareLinkDialog.vue`): where a minted link lands, and
// the mint request the dialog's form makes.

import type { MintInput } from './auth-client'

/**
 * The URL a share link opens: `path` (a slide path from `getSlidePath`, `/3-intro`) under the app
 * prefix (`BASE_URL`, plus `#/` with hash routing), with the current query (URL state such as
 * `?m=heatmap`) minus any `key`. Without `path`: the deck's start, with no query.
 */
export function landingUrl(opts: { origin: string, base: string, prefix: string, path?: string, search?: string }): string {
  const { origin, base, prefix, path, search = '' } = opts
  if (!path)
    return `${origin}${base}`
  const query = new URLSearchParams(search)
  query.delete('key')
  const qs = query.toString()
  return `${origin}${prefix}${path.replace(/^\/+/, '')}${qs ? `?${qs}` : ''}`
}

export interface ShareForm {
  /** The recipient's name. */
  name: string
  /** Optional: binds the link to this address and adds it to the allowlist. */
  email: string
  note: string
  /** Days until the link stops working; blank = never. */
  days: string
  unlimited: boolean
  /** With `unlimited` off. */
  maxUses: number
}

export const DEFAULT_SHARE_FORM: ShareForm = { name: '', email: '', note: '', days: '30', unlimited: true, maxUses: 1 }

const DAY_S = 86400

/** The `POST grants` body for `form`, granting `scope`. */
export function mintInputFor(form: ShareForm, scope: string): MintInput {
  const email = form.email.trim().toLowerCase()
  const days = form.days.trim() ? Number(form.days) : null
  if (days !== null && !(Number.isFinite(days) && days > 0))
    throw new Error('Expiry must be a positive number of days, or blank for never')
  if (!form.unlimited && !(Number.isInteger(form.maxUses) && form.maxUses > 0))
    throw new Error('Uses must be a whole number, at least 1')
  return {
    scopes: [scope],
    subjectName: form.name.trim() || null,
    email: email || null,
    note: form.note.trim() || null,
    // No avatar UI yet; without `null` the Worker would look the email up on Gravatar.
    avatar: null,
    maxRedeems: form.unlimited ? null : form.maxUses,
    expiresInS: days === null ? null : Math.round(days * DAY_S),
    allowlist: !!email,
  }
}

/** `<input type="date">`'s value for an epoch-seconds time (local day). */
export function dateInputValue(epochS: number): string {
  const d = new Date(epochS * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

/** The end of a `YYYY-MM-DD` day (local), in epoch seconds; `null` for anything else (blank). */
export function endOfDay(value: string): number | null {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value)
  if (!m)
    return null
  return Math.floor(new Date(+m[1], +m[2] - 1, +m[3], 23, 59, 59).getTime() / 1000)
}
