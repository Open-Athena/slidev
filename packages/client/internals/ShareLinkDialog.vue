<script setup lang="ts">
import type { Grant, GrantActivity } from '../logic/auth-client'
import type { ShareForm } from '../logic/share-link'
import { renderSVG } from 'uqr'
import { computed, reactive, ref, watch } from 'vue'
import { showNotice } from '../composables/notice'
import { useNav } from '../composables/useNav'
import { authClient, shareTab, showShareDialog } from '../composables/useShareLinks'
import { pathPrefix } from '../env'
import { AuthClientError, holderOf, shareUrl } from '../logic/auth-client'
import { dateInputValue, DEFAULT_SHARE_FORM, endOfDay, landingUrl, mintInputFor } from '../logic/share-link'
import { getSlidePath } from '../logic/slides'
import Modal from './Modal.vue'

// "Get link" (admins of an auth-gated deck): mint a share link for someone, and manage the links
// already out there. The token is only ever shown here, right after minting.

const { currentSlideNo, currentSlideRoute } = useNav()

const form = reactive<ShareForm>({ ...DEFAULT_SHARE_FORM })
const landsOn = ref<'slide' | 'start'>('slide')
const minting = ref(false)
const mintError = ref<string | null>(null)
const minted = ref<{ url: string, holder: string | null } | null>(null)
/** The links table's rows, once loaded (`undefined` again after a mint, to reload). */
const links = ref<Grant[] | undefined>()

const slideTitle = computed(() => currentSlideRoute.value?.meta?.slide?.title)

const target = computed(() => {
  const route = currentSlideRoute.value
  return landingUrl({
    origin: location.origin,
    base: import.meta.env.BASE_URL,
    prefix: pathPrefix,
    path: landsOn.value === 'slide' && route ? getSlidePath(route, false) : undefined,
    search: location.search,
  })
})

const qrSvg = computed(() => minted.value ? renderSVG(minted.value.url, { ecc: 'L', border: 1 }) : '')

function errorText(e: unknown): string {
  if (e instanceof AuthClientError && e.status === 403)
    return 'Only admins can mint and manage links.'
  if (e instanceof AuthClientError && e.status === 401)
    return 'Your session has ended: reload and sign in again.'
  return e instanceof Error ? e.message : String(e)
}

async function mint() {
  mintError.value = null
  minting.value = true
  try {
    const { grant, token } = await authClient.grants.mint(mintInputFor(form, __SLIDEV_AUTH_SCOPE__))
    minted.value = { url: shareUrl(token, target.value), holder: holderOf(grant) }
    Object.assign(form, DEFAULT_SHARE_FORM)
    links.value = undefined
  }
  catch (e) {
    mintError.value = errorText(e)
  }
  finally {
    minting.value = false
  }
}

async function copy(url: string) {
  try {
    await navigator.clipboard.writeText(url)
    showNotice('Link copied')
  }
  catch {
    showNotice('Couldn\'t copy: select the link and copy it by hand')
  }
}

// ---- links table ----

const linksError = ref<string | null>(null)
const showRevoked = ref(false)
const editing = ref<{ id: string, field: 'note' | 'expires', value: string } | null>(null)
const activity = ref<Record<string, GrantActivity | 'none' | 'loading'>>({})

const shownLinks = computed(() => (links.value ?? []).filter(g => showRevoked.value || g.revokedAt == null))
const revokedCount = computed(() => (links.value ?? []).filter(g => g.revokedAt != null).length)

async function loadLinks() {
  linksError.value = null
  try {
    links.value = (await authClient.grants.list()).sort((a, b) => b.createdAt - a.createdAt)
  }
  catch (e) {
    linksError.value = errorText(e)
  }
}

function replace(grant: Grant) {
  links.value = links.value?.map(g => g.id === grant.id ? grant : g)
}

async function saveEdit() {
  const edit = editing.value
  if (!edit)
    return
  editing.value = null
  try {
    const patch = edit.field === 'note'
      ? { note: edit.value.trim() || null }
      : { expiresAt: endOfDay(edit.value) }
    replace(await authClient.grants.update(edit.id, patch))
  }
  catch (e) {
    linksError.value = errorText(e)
  }
}

async function revoke(g: Grant) {
  // eslint-disable-next-line no-alert -- irreversible: ends every session the link minted
  if (!window.confirm(`Revoke the link for ${holderOf(g) ?? 'this holder'}? It stops working, and signs out whoever used it.`))
    return
  try {
    await authClient.grants.revoke(g.id)
    await loadLinks()
  }
  catch (e) {
    linksError.value = errorText(e)
  }
}

async function toggleActivity(id: string) {
  if (activity.value[id]) {
    const { [id]: _, ...rest } = activity.value
    activity.value = rest
    return
  }
  activity.value = { ...activity.value, [id]: 'loading' }
  try {
    activity.value = { ...activity.value, [id]: await authClient.grants.activity(id) }
  }
  catch {
    // 501: no access log on this deployment.
    activity.value = { ...activity.value, [id]: 'none' }
  }
}

function fmt(epochS: number | null): string {
  return epochS == null ? '—' : new Date(epochS * 1000).toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' })
}
function fmtDay(epochS: number | null): string {
  return epochS == null ? 'never' : new Date(epochS * 1000).toLocaleDateString(undefined, { dateStyle: 'medium' })
}
const expired = (g: Grant) => g.expiresAt != null && g.expiresAt * 1000 < Date.now()

watch([showShareDialog, shareTab], ([show, tab]) => {
  if (show && tab === 'links' && !links.value)
    void loadLinks()
  if (show && tab === 'new')
    mintError.value = null
}, { immediate: true })
</script>

<template>
  <Modal v-model="showShareDialog" class="slidev-share-dialog w-180 max-w-[calc(100vw-2rem)] max-h-[calc(100vh-2rem)] overflow-y-auto">
    <div class="p-5 text-sm font-sans" data-share-dialog @keydown.escape="showShareDialog = false">
      <div class="flex items-center gap-3 mb-4">
        <h2 class="text-lg font-semibold mr-auto">
          Share links
        </h2>
        <div class="flex gap-1" role="tablist">
          <button
            v-for="t in (['new', 'links'] as const)"
            :key="t"
            role="tab"
            :aria-selected="shareTab === t"
            :data-share-tab="t"
            class="px-2 py-0.5 rounded"
            :class="shareTab === t ? 'bg-active op100' : 'op60 hover:op100'"
            @click="shareTab = t"
          >
            {{ t === 'new' ? 'New link' : 'Links' }}
          </button>
        </div>
        <button class="op60 hover:op100" aria-label="Close" @click="showShareDialog = false">
          <div class="i-carbon:close text-lg" />
        </button>
      </div>

      <template v-if="shareTab === 'new'">
        <div v-if="minted" data-share-minted>
          <p class="mb-2">
            Link for <strong>{{ minted.holder ?? 'an unnamed holder' }}</strong>: copy it now, it won't be shown again.
          </p>
          <div class="flex gap-2 items-center">
            <input class="flex-1 font-mono text-xs bg-transparent border border-main rounded px-2 py-1" readonly :value="minted.url" data-share-url @focus="($event.target as HTMLInputElement).select()">
            <button class="px-3 py-1 bg-active rounded" data-share-copy @click="copy(minted.url)">
              Copy
            </button>
          </div>
          <!-- eslint-disable-next-line vue/no-v-html -- `uqr`'s SVG, from the link we just minted -->
          <div class="w-40 h-40 mt-3 bg-white rounded" data-share-qr v-html="qrSvg" />
          <div class="mt-4 flex justify-end">
            <button class="px-3 py-1 op70 hover:op100" data-share-another @click="minted = null">
              Make another
            </button>
          </div>
        </div>
        <form v-else class="grid gap-3" @submit.prevent="mint">
          <p class="op75">
            A link signs whoever holds it in to the <strong>whole deck</strong>. "This slide" only picks where it opens (and the preview card it unfurls to).
          </p>
          <fieldset class="flex gap-4">
            <legend class="op60 mb-1">
              Opens at
            </legend>
            <label class="flex gap-1.5 items-center">
              <input v-model="landsOn" type="radio" value="slide" name="share-lands-on" data-share-lands="slide">
              this slide ({{ currentSlideNo }}{{ slideTitle ? `: ${slideTitle}` : '' }})
            </label>
            <label class="flex gap-1.5 items-center">
              <input v-model="landsOn" type="radio" value="start" name="share-lands-on" data-share-lands="start">
              the deck's start
            </label>
          </fieldset>
          <label class="grid gap-1">
            <span class="op60">Name</span>
            <input v-model="form.name" class="bg-transparent border border-main rounded px-2 py-1" placeholder="who it's for" autocomplete="off" data-share-name>
          </label>
          <label class="grid gap-1">
            <span class="op60">Email <span class="op70">(optional: binds the link to this address, and lets them sign in with it later)</span></span>
            <input v-model="form.email" type="email" class="bg-transparent border border-main rounded px-2 py-1" autocomplete="off" data-share-email>
          </label>
          <label class="grid gap-1">
            <span class="op60">Note <span class="op70">(for you: where it's shared, why)</span></span>
            <input v-model="form.note" class="bg-transparent border border-main rounded px-2 py-1" autocomplete="off" data-share-note>
          </label>
          <div class="flex gap-6 items-center flex-wrap">
            <label class="flex gap-1.5 items-center">
              <span class="op60">Expires after</span>
              <input v-model="form.days" class="w-14 bg-transparent border border-main rounded px-2 py-1" inputmode="numeric" data-share-days>
              <span class="op60">days (blank: never)</span>
            </label>
            <label class="flex gap-1.5 items-center">
              <input v-model="form.unlimited" type="checkbox" data-share-unlimited>
              unlimited uses
            </label>
            <label v-if="!form.unlimited" class="flex gap-1.5 items-center">
              <input v-model.number="form.maxUses" type="number" min="1" class="w-16 bg-transparent border border-main rounded px-2 py-1" data-share-max-uses>
              <span class="op60">sign-ins</span>
            </label>
          </div>
          <div v-if="mintError" class="text-red-400" data-share-error>
            {{ mintError }}
          </div>
          <div class="flex justify-end gap-2">
            <button type="button" class="px-3 py-1 op70 hover:op100" @click="showShareDialog = false">
              Cancel
            </button>
            <button type="submit" class="px-3 py-1 bg-active rounded disabled:op40" :disabled="minting" data-share-mint>
              {{ minting ? 'Creating…' : 'Create link' }}
            </button>
          </div>
        </form>
      </template>

      <template v-else>
        <div class="flex gap-3 items-center mb-2">
          <label class="flex gap-1.5 items-center">
            <input v-model="showRevoked" type="checkbox" data-share-show-revoked>
            show revoked ({{ revokedCount }})
          </label>
          <button class="ml-auto op60 hover:op100" data-share-refresh @click="loadLinks">
            Refresh
          </button>
        </div>
        <div v-if="linksError" class="text-red-400 mb-2" data-share-links-error>
          {{ linksError }}
        </div>
        <div v-if="links === undefined && !linksError" class="op60">
          Loading…
        </div>
        <div v-else-if="links && !shownLinks.length" class="op60" data-share-empty>
          {{ revokedCount ? 'No active links.' : 'No links yet.' }}
        </div>
        <table v-else-if="links" class="w-full text-left border-collapse" data-share-links>
          <thead class="op60">
            <tr>
              <th class="py-1 pr-2 font-normal">
                Holder
              </th>
              <th class="py-1 pr-2 font-normal">
                Note
              </th>
              <th class="py-1 pr-2 font-normal">
                Uses
              </th>
              <th class="py-1 pr-2 font-normal">
                Last used
              </th>
              <th class="py-1 pr-2 font-normal">
                Expires
              </th>
              <th class="py-1 pr-2 font-normal">
                Created
              </th>
              <th />
            </tr>
          </thead>
          <tbody>
            <template v-for="g in shownLinks" :key="g.id">
              <tr class="border-t border-main align-top" :class="g.revokedAt != null ? 'op50' : ''" :data-share-link="g.id">
                <td class="py-1 pr-2" data-col="holder">
                  {{ holderOf(g) ?? '—' }}
                  <div v-if="g.email && g.subject?.name" class="op60 text-xs">
                    {{ g.email }}
                  </div>
                </td>
                <td class="py-1 pr-2" data-col="note">
                  <input
                    v-if="editing?.id === g.id && editing.field === 'note'"
                    v-model="editing.value"
                    class="w-full bg-transparent border border-main rounded px-1"
                    data-share-edit-note
                    @keydown.enter.prevent="saveEdit"
                    @keydown.escape.stop="editing = null"
                    @blur="saveEdit"
                  >
                  <button v-else class="text-left hover:underline" :disabled="g.revokedAt != null" title="Edit the note" @click="editing = { id: g.id, field: 'note', value: g.note ?? '' }">
                    {{ g.note || '—' }}
                  </button>
                </td>
                <td class="py-1 pr-2" data-col="uses">
                  {{ g.redeems }}{{ g.maxRedeems != null ? ` / ${g.maxRedeems}` : '' }}
                </td>
                <td class="py-1 pr-2" data-col="last-used">
                  {{ fmt(g.lastUsedAt) }}
                </td>
                <td class="py-1 pr-2" data-col="expires">
                  <input
                    v-if="editing?.id === g.id && editing.field === 'expires'"
                    v-model="editing.value"
                    type="date"
                    class="bg-transparent border border-main rounded px-1"
                    data-share-edit-expires
                    @keydown.enter.prevent="saveEdit"
                    @keydown.escape.stop="editing = null"
                    @blur="saveEdit"
                  >
                  <button v-else class="text-left hover:underline" :disabled="g.revokedAt != null" title="Change the expiry (clear the date: never)" @click="editing = { id: g.id, field: 'expires', value: g.expiresAt != null ? dateInputValue(g.expiresAt) : '' }">
                    {{ fmtDay(g.expiresAt) }}<span v-if="expired(g)" class="text-red-400"> (expired)</span>
                  </button>
                </td>
                <td class="py-1 pr-2" data-col="created">
                  {{ fmt(g.createdAt) }}
                </td>
                <td class="py-1 whitespace-nowrap text-right">
                  <button class="op60 hover:op100 mr-2" data-share-activity @click="toggleActivity(g.id)">
                    Activity
                  </button>
                  <span v-if="g.revokedAt != null" class="op70" data-share-revoked>revoked</span>
                  <button v-else class="text-red-400 hover:underline" data-share-revoke @click="revoke(g)">
                    Revoke
                  </button>
                </td>
              </tr>
              <tr v-if="activity[g.id]" :data-share-activity-for="g.id">
                <td colspan="7" class="pb-2 pl-3 op80">
                  <template v-if="activity[g.id] === 'loading'">
                    Loading…
                  </template>
                  <template v-else-if="activity[g.id] === 'none'">
                    No access log on this deployment.
                  </template>
                  <template v-else>
                    {{ (activity[g.id] as GrantActivity).views }} views from {{ (activity[g.id] as GrantActivity).distinctIps }} address(es){{ (activity[g.id] as GrantActivity).countries.length ? ` in ${(activity[g.id] as GrantActivity).countries.join(', ')}` : '' }}; last seen {{ fmt((activity[g.id] as GrantActivity).lastSeen) }}
                    <span v-if="(activity[g.id] as GrantActivity).topPaths.length" class="block op70">
                      Most viewed: {{ (activity[g.id] as GrantActivity).topPaths.map(p => `${p.path} (${p.views})`).join(', ') }}
                    </span>
                  </template>
                </td>
              </tr>
            </template>
          </tbody>
        </table>
      </template>
    </div>
  </Modal>
</template>
