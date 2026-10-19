// "Get link": mint `@open-athena/auth` share links from the deck, for signed-in admins of a deck
// built behind the auth Worker (`publish.worker.auth`). Without that (`__SLIDEV_FEATURE_AUTH__`
// off) nothing here makes a request, and `canShare` stays false. See specs/share-links.md.

import type { Whoami } from '../logic/auth-client'
import { computed, ref, shallowRef } from 'vue'
import { canMintLinks, createAuthClient } from '../logic/auth-client'

export type ShareTab = 'new' | 'links'

export const authClient = createAuthClient({ basePath: `${import.meta.env.BASE_URL}api/auth` })

/** The signed-in principal, once `probeAuth` has asked; `null` when anonymous (or no auth routes). */
export const authWhoami = shallowRef<Whoami | null>(null)

/** Signed in with `*` / `admin`: may mint and manage links. */
export const canShare = computed(() => __SLIDEV_FEATURE_AUTH__ && canMintLinks(authWhoami.value))

export const showShareDialog = ref(false)
export const shareTab = ref<ShareTab>('new')

let probing: Promise<void> | undefined

/** Ask `api/auth/whoami` once (a no-op without `__SLIDEV_FEATURE_AUTH__`). */
export function probeAuth(): Promise<void> {
  if (!__SLIDEV_FEATURE_AUTH__)
    return Promise.resolve()
  probing ??= authClient.whoami()
    .then((me) => {
      authWhoami.value = me
    })
    .catch(() => {
      // 401 (anonymous), or no auth routes at all (the dev server): no admin.
      authWhoami.value = null
    })
  return probing
}

/** Open (on `tab`) or close the "Get link" dialog; admins only. Exported for decks' own palettes. */
export function toggleShareDialog(tab?: ShareTab): void {
  if (!canShare.value)
    return
  if (showShareDialog.value && (!tab || tab === shareTab.value)) {
    showShareDialog.value = false
    return
  }
  if (tab)
    shareTab.value = tab
  showShareDialog.value = true
}
