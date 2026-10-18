import { create } from 'zustand'
import { supabase, useAccount } from './cloud'
import { audioBytes, idb, idsIn, keepAudioBytes, missingAudio, putSketchLanes, SKETCHES, sketchLanes } from './audio/take'
import { deleteForever, NotOpened, openIsBehind, refreshLibrary, reshow, syncHooks, type SketchRecord } from './library'
import { useStore } from './store'
import { decide, stampOf } from './syncRules'

/**
 * Keeps a signed-in person's saved sketches the same on every device, through
 * the cloud copy (cloud.ts). The device's own copy stays the one worked on:
 * Bounce works as before offline or signed out, and catches up after.
 *
 * Each time (signing in, opening Bounce, coming back to it, and after a
 * sketch is saved, deleted or put back) it lists the sketches in the cloud,
 * only their ids and times, and goes through them with the device's. Whichever
 * changed last wins, as a whole sketch (see `decide`). Recordings go up once
 * each after the sketch that uses them, and come down when a sketch that uses
 * them is opened on a device without them.
 */

/** Where syncing has got to, for the account section to show. */
export const useSync = create<{ state: 'idle' | 'syncing' | 'offline' | 'error'; at: number | null; error: string | null }>(() => ({
  state: 'idle',
  at: null,
  error: null,
}))

/** A saved sketch as the cloud keeps it. */
interface Row {
  id: string
  song: SketchRecord['song']
  lanes: unknown
  updated: number
  deleted: number | null
}

/** What this device has synced for this account: its sketches and the recordings it knows are in the cloud. */
interface Known {
  sketches: string[]
  audio: string[]
}
const knownKey = (user: string) => `bounce-synced:${user}`
function loadKnown(user: string): { sketches: Set<string>; audio: Set<string> } {
  try {
    const known = JSON.parse(localStorage.getItem(knownKey(user)) ?? '{}') as Partial<Known>
    return { sketches: new Set(known.sketches ?? []), audio: new Set(known.audio ?? []) }
  } catch {
    return { sketches: new Set(), audio: new Set() }
  }
}
function saveKnown(user: string, known: { sketches: Set<string>; audio: Set<string> }) {
  try {
    localStorage.setItem(knownKey(user), JSON.stringify({ sketches: [...known.sketches], audio: [...known.audio] } satisfies Known))
  } catch {
    // Not kept: the next sync goes by the times alone, which is safe, if slower.
  }
}

/** Where a recording is kept in the cloud: in its owner's folder. */
const audioPath = (user: string, id: string) => `${user}/${id}`

async function signedIn() {
  if (!supabase) return null
  const { data } = await supabase.auth.getSession()
  return data.session?.user.id ?? null
}

let running: Promise<void> | null = null
let again = false

/** Syncs now, or straight after the sync under way, if there is one. */
export function syncSoon() {
  if (running) {
    again = true
    return
  }
  running = run().finally(() => {
    running = null
    if (again) {
      again = false
      syncSoon()
    }
  })
}

async function run() {
  const user = await signedIn()
  if (!supabase || !user) return
  useSync.setState({ state: 'syncing', error: null })
  try {
    const known = loadKnown(user)
    const { data: listed, error } = await supabase.from('sketches').select('id, updated, deleted')
    if (error) throw error
    const there = new Map(listed.map((r) => [r.id as string, r as { id: string; updated: number; deleted: number | null }]))
    const local = await idb<SketchRecord[]>(SKETCHES, 'readonly', (s) => s.getAll())
    const here = new Map(local.map((r) => [r.id, r]))
    let changedHere = false

    // One sketch that can't sync doesn't hold up the rest: each is tried, and the first trouble reported after.
    let failed: unknown = null
    for (const id of new Set([...here.keys(), ...there.keys()])) {
      try {
        const mine = here.get(id)
        const theirs = there.get(id)
        switch (decide(mine ? stampOf(mine) : null, theirs ? stampOf(theirs) : null, known.sketches.has(id))) {
          case 'up': {
            const lanes = (await sketchLanes(id)) ?? {}
            // The recordings first, so a device that gets the sketch can always fetch them.
            for (const take of idsIn(lanes) as Set<string>) {
              if (known.audio.has(take)) continue
              const bytes = await audioBytes(take)
              if (!bytes) continue
              const { error: upload } = await supabase.storage.from('takes').upload(audioPath(user, take), bytes, { upsert: true, contentType: 'application/octet-stream' })
              if (upload) throw upload
              known.audio.add(take)
            }
            const row: Row = { id, song: mine!.song, lanes, updated: mine!.updated, deleted: mine!.deleted ?? null }
            const { error: put } = await supabase.from('sketches').upsert({ ...row, owner: user })
            if (put) throw put
            known.sketches.add(id)
            break
          }
          case 'down': {
            const { data: row, error: get } = await supabase.from('sketches').select('id, song, lanes, updated, deleted').eq('id', id).single<Row>()
            if (get) throw get
            // The lanes before the sketch, so it never lists recordings its lanes don't know.
            await putSketchLanes(id, row.lanes ?? {})
            const record: SketchRecord = { id, updated: row.updated, song: row.song, ...(row.deleted ? { deleted: row.deleted } : {}) }
            await idb(SKETCHES, 'readwrite', (s) => s.put(record, id))
            known.sketches.add(id)
            changedHere = true
            break
          }
          case 'drop-here': {
            // Deleted for good on another device. (Deleting it here tells this sync again, which then finds nothing to do.)
            known.sketches.delete(id)
            saveKnown(user, known)
            if (useStore.getState().sketchId === id) useStore.getState().setSaved(null, null)
            await deleteForever(id, false)
            changedHere = true
            break
          }
          case 'drop-there': {
            const { error: drop } = await supabase.from('sketches').delete().eq('id', id)
            if (drop) throw drop
            known.sketches.delete(id)
            break
          }
        }
      } catch (error) {
        console.warn(`Sync: sketch ${id} didn’t sync:`, error)
        failed ??= error
      }
      saveKnown(user, known)
    }
    if (changedHere) await refreshLibrary()
    await catchUp(user, known)
    saveKnown(user, known)
    if (failed) throw failed
    useSync.setState({ state: 'idle', at: Date.now() })
  } catch (error) {
    console.warn('Sync stopped:', error)
    const offline = !navigator.onLine || (error instanceof TypeError && /fetch/i.test(error.message))
    useSync.setState({ state: offline ? 'offline' : 'error', error: offline ? null : error instanceof Error ? error.message : String((error as { message?: string })?.message ?? error) })
  }
}

/**
 * Shows the open sketch again as it's now saved, when it has changed on
 * another device since this one showed it, with any new recordings fetched
 * first. Tried after every sync, so one put off (by playing, recording or
 * unsaved changes) happens later rather than never.
 */
async function catchUp(user: string, known: { audio: Set<string> }) {
  const record = await openIsBehind()
  if (!record) return
  await download(user, await missingAudio(idsIn((await sketchLanes(record.id)) ?? {}) as Set<string>), known)
  await reshow(record)
}

/**
 * Fetches these recordings from the account and keeps them on this device.
 * One that isn't there (its device saved the sketch without it) is left out,
 * as a take that's gone, rather than stopping the sketch opening for good.
 */
async function download(user: string, takes: string[], known: { audio: Set<string> }) {
  for (const take of takes) {
    const { data, error } = await supabase!.storage.from('takes').download(audioPath(user, take))
    if (error && isMissing(error)) {
      console.warn(`Sync: recording ${take} isn’t in the account; left out`)
      continue
    }
    if (error) throw error
    await keepAudioBytes(take, await data.arrayBuffer())
    known.audio.add(take)
  }
}

/** Whether a storage error says the file isn't there. */
const isMissing = (error: { message?: string; status?: number; statusCode?: string }) =>
  error.status === 404 || error.statusCode === '404' || /not.?found/i.test(error.message ?? '')

/**
 * Before a saved sketch opens, fetches any of its recordings this device
 * doesn't have. If they can't be, it isn't opened (saving it without them
 * would leave them out of it everywhere), and the person is told why.
 */
async function fetchRecordings(id: string) {
  const lanes = await sketchLanes(id)
  const missing = await missingAudio(idsIn(lanes ?? {}) as Set<string>)
  if (!missing.length) return
  const user = await signedIn()
  if (!supabase || !user) {
    window.alert('Some of this sketch’s recordings are in your account, not on this device. Sign in to open it.')
    throw new NotOpened()
  }
  const known = loadKnown(user)
  try {
    await download(user, missing, known)
  } catch (error) {
    console.warn('Couldn’t fetch recordings:', error)
    window.alert('Bounce couldn’t fetch this sketch’s recordings from your account. Check your connection and try again.')
    throw new NotOpened()
  } finally {
    saveKnown(user, known)
  }
}

syncHooks.changed = () => syncSoon()
syncHooks.beforeOpen = fetchRecordings

// On signing in (and on opening Bounce signed in), and on coming back to it, now and then.
let lastEmail: string | null = useAccount.getState().email
if (lastEmail) syncSoon()
useAccount.subscribe(({ email }) => {
  if (email && email !== lastEmail) syncSoon()
  if (!email) useSync.setState({ state: 'idle', at: null, error: null })
  lastEmail = email
})
// A change put off while playing or recording is shown when that stops.
useStore.subscribe((now, before) => {
  if ((before.playing && !now.playing) || (before.recording !== 'off' && now.recording === 'off')) syncSoon()
})
// Coming back to Bounce (its tab shown again, or its window clicked into, as with two side by side), and every half minute while it's showing.
let lastLook = 0
const lookAgain = () => {
  if (document.visibilityState !== 'visible' || Date.now() - lastLook < 5_000) return
  lastLook = Date.now()
  syncSoon()
}
if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', lookAgain)
  window.addEventListener('focus', lookAgain)
  window.addEventListener('online', () => syncSoon())
  setInterval(lookAgain, 30_000)
}
