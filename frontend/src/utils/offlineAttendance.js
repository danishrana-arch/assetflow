const DB_NAME = "assetflow_offline"
const DB_VERSION = 1
const QUEUE_STORE = "attendanceQueue"
const META_STORE = "meta"
const LEGACY_QUEUE_KEY = "assetflow_attendance_offline_queue_v1"
const DEVICE_KEY = "assetflow_attendance_device_id_v1"

// Offline copies of My Attendance are kept per logged-in user. They used to
// be one shared key per browser, so the next person to log in on the same
// device was shown the previous person's attendance and sites.
const ATTENDANCE_CACHE_KEY = "assetflow_attendance_snapshot_v2"
const SITES_CACHE_KEY = "assetflow_attendance_sites_v2"
const LEGACY_CACHE_KEYS = ["assetflow_attendance_snapshot_v1", "assetflow_attendance_sites_v1"]
const USER_CACHE_KEY = "assetflow_user_cache" // written by AuthContext

// The logged-in user's id (from the auth cache), or null.
export function currentAttendanceUserId() {
  try {
    return JSON.parse(localStorage.getItem(USER_CACHE_KEY) || "null")?.user?.id || null
  } catch {
    return null
  }
}

function writeOwned(key, data) {
  const userId = currentAttendanceUserId()
  if (!userId) return
  try {
    LEGACY_CACHE_KEYS.forEach((k) => localStorage.removeItem(k))
    localStorage.setItem(key, JSON.stringify({ userId, savedAt: new Date().toISOString(), data }))
  } catch {}
}

// Only returns the copy if it belongs to whoever is logged in now.
function readOwned(key) {
  const userId = currentAttendanceUserId()
  if (!userId) return undefined
  try {
    const value = JSON.parse(localStorage.getItem(key) || "null")
    return value && value.userId === userId ? value.data : undefined
  } catch {
    return undefined
  }
}

export function cacheAttendanceSnapshot(snapshot) {
  writeOwned(ATTENDANCE_CACHE_KEY, snapshot || null)
}

export function readCachedAttendanceSnapshot() {
  return readOwned(ATTENDANCE_CACHE_KEY) || undefined
}

export function cacheAssignedSites(sites) {
  writeOwned(SITES_CACHE_KEY, Array.isArray(sites) ? sites : [])
}

export function readCachedAssignedSites() {
  const sites = readOwned(SITES_CACHE_KEY)
  return Array.isArray(sites) ? sites : []
}

// Called on logout: drop the offline copies (the queue is kept — it's
// tagged per user and only ever synced by its owner).
export function clearAttendanceCaches() {
  try {
    ;[ATTENDANCE_CACHE_KEY, SITES_CACHE_KEY, ...LEGACY_CACHE_KEYS, "assetflow_site_admin_rosters_v1", "assetflow_site_admin_rejected_v1"].forEach((k) => localStorage.removeItem(k))
  } catch {}
}

function createId(prefix = "evt") {
  if (globalThis.crypto?.randomUUID) return `${prefix}-${globalThis.crypto.randomUUID()}`
  return `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`
}

function openDb() {
  return new Promise((resolve, reject) => {
    if (!("indexedDB" in window)) return reject(new Error("IndexedDB is unavailable"))
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const db = request.result
      if (!db.objectStoreNames.contains(QUEUE_STORE)) {
        const store = db.createObjectStore(QUEUE_STORE, { keyPath: "clientEventId" })
        store.createIndex("queuedAt", "queuedAt")
      }
      if (!db.objectStoreNames.contains(META_STORE)) db.createObjectStore(META_STORE, { keyPath: "key" })
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error || new Error("Could not open offline storage"))
  })
}

async function withStore(mode, callback) {
  const db = await openDb()
  try {
    return await new Promise((resolve, reject) => {
      const tx = db.transaction([QUEUE_STORE], mode)
      const store = tx.objectStore(QUEUE_STORE)
      let result
      try {
        result = callback(store)
      } catch (error) {
        reject(error)
        return
      }
      tx.oncomplete = () => resolve(result)
      tx.onerror = () => reject(tx.error || new Error("Offline storage transaction failed"))
      tx.onabort = () => reject(tx.error || new Error("Offline storage transaction aborted"))
    })
  } finally {
    db.close()
  }
}

async function readAllIndexed() {
  return withStore("readonly", (store) => new Promise((resolve, reject) => {
    const request = store.getAll()
    request.onsuccess = () => resolve(Array.isArray(request.result) ? request.result : [])
    request.onerror = () => reject(request.error)
  }))
}

function readLegacyQueue() {
  try {
    const value = JSON.parse(localStorage.getItem(LEGACY_QUEUE_KEY) || "[]")
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

async function migrateLegacyQueue() {
  const legacy = readLegacyQueue()
  if (!legacy.length) return
  try {
    await withStore("readwrite", (store) => {
      legacy.forEach((item) => {
        if (item?.clientEventId) store.put(item)
      })
    })
    localStorage.removeItem(LEGACY_QUEUE_KEY)
  } catch {
    // The fallback queue below still protects attendance if IndexedDB is unavailable.
  }
}

export function getAttendanceDeviceId() {
  let id = localStorage.getItem(DEVICE_KEY)
  if (!id) {
    id = createId("web")
    localStorage.setItem(DEVICE_KEY, id)
  }
  return id
}

export async function queueOfflineAttendance(event) {
  const item = {
    ...event,
    clientEventId: event.clientEventId || createId("att"),
    queuedAt: new Date().toISOString(),
    // Owner — only this user's session ever syncs it (a shared device must
    // never submit one person's check-in under someone else's login).
    ownerUserId: event.ownerUserId || currentAttendanceUserId(),
    deviceId: event.deviceId || getAttendanceDeviceId(),
    syncAttempts: 0,
  }

  try {
    await migrateLegacyQueue()
    await withStore("readwrite", (store) => store.put(item))
    return item
  } catch {
    // Last-resort fallback for browsers where IndexedDB is disabled.
    const queue = readLegacyQueue().filter((x) => x.clientEventId !== item.clientEventId)
    queue.push(item)
    localStorage.setItem(LEGACY_QUEUE_KEY, JSON.stringify(queue.slice(-200)))
    return item
  }
}

async function readWholeQueue() {
  try {
    await migrateLegacyQueue()
    return await readAllIndexed()
  } catch {
    return readLegacyQueue()
  }
}

// Site Admin actions (marking other workers' attendance) share the same
// queue/store, tagged kind "SITE_ADMIN", and sync to their own endpoint.
export const SITE_ADMIN_KIND = "SITE_ADMIN"

async function ownQueue() {
  const userId = currentAttendanceUserId()
  const all = await readWholeQueue()
  if (!userId) return []
  return all.filter((item) => !item.ownerUserId || item.ownerUserId === userId)
}

// The current user's own queued check-ins/outs only. Events queued before
// owners were recorded (no ownerUserId) are kept as before — they can only
// have come from the single user this device had then.
export async function getOfflineAttendanceQueue() {
  return (await ownQueue()).filter((item) => item.kind !== SITE_ADMIN_KIND)
}

// The current Site Admin's queued actions for other workers.
export async function getSiteAdminQueue() {
  return (await ownQueue()).filter((item) => item.kind === SITE_ADMIN_KIND)
}

export async function queueSiteAdminAction(action) {
  return queueOfflineAttendance({ ...action, kind: SITE_ADMIN_KIND, localRecordedAt: action.localRecordedAt || new Date().toISOString() })
}

// Rejections the server says can't succeed on retry (e.g. the site was
// unassigned, the worker was already checked in) are dropped from the queue
// and kept here so the Site Admin can see what didn't go through.
const SITE_ADMIN_REJECTED_KEY = "assetflow_site_admin_rejected_v1"

export function readSiteAdminRejections() {
  const userId = currentAttendanceUserId()
  try {
    const value = JSON.parse(localStorage.getItem(SITE_ADMIN_REJECTED_KEY) || "null")
    return value && value.userId === userId && Array.isArray(value.items) ? value.items : []
  } catch {
    return []
  }
}

export function clearSiteAdminRejections() {
  try { localStorage.removeItem(SITE_ADMIN_REJECTED_KEY) } catch {}
}

function rememberSiteAdminRejections(items) {
  const userId = currentAttendanceUserId()
  if (!userId || !items.length) return
  try {
    const merged = [...items, ...readSiteAdminRejections()].slice(0, 50)
    localStorage.setItem(SITE_ADMIN_REJECTED_KEY, JSON.stringify({ userId, items: merged }))
  } catch {}
}

let siteAdminSyncRunning = null

// Sends the queued Site Admin actions (oldest first). The server is
// authoritative and idempotent per clientEventId, so a retry after a dropped
// response never creates a second check-in.
export async function syncSiteAdminQueue(api) {
  if (siteAdminSyncRunning) return siteAdminSyncRunning
  siteAdminSyncRunning = (async () => {
    if (!navigator.onLine) return { synced: 0, duplicates: 0, rejected: [], remaining: (await getSiteAdminQueue()).length }
    const items = (await getSiteAdminQueue()).sort((a, b) => String(a.localRecordedAt).localeCompare(String(b.localRecordedAt)))
    if (!items.length) return { synced: 0, duplicates: 0, rejected: [], remaining: 0 }
    const response = await api.post("/site-admin/sync", { events: items.slice(0, 200) })
    const data = response.data || {}
    const rejected = data.rejected || []
    const retryIds = new Set(rejected.filter((x) => !x.permanent).map((x) => x.clientEventId).filter(Boolean))
    const sent = items.slice(0, 200)
    await clearOfflineAttendanceEvents(sent.map((x) => x.clientEventId).filter((id) => !retryIds.has(id)))
    const byId = new Map(sent.map((x) => [x.clientEventId, x]))
    rememberSiteAdminRejections(
      rejected.filter((x) => x.permanent).map((x) => ({ ...x, event: byId.get(x.clientEventId) || null, at: new Date().toISOString() }))
    )
    return { ...data, remaining: (await getSiteAdminQueue()).length }
  })()
  try {
    return await siteAdminSyncRunning
  } finally {
    siteAdminSyncRunning = null
  }
}

// Last-known roster per site, so the Site Admin can keep working offline.
const SITE_ROSTER_CACHE_KEY = "assetflow_site_admin_rosters_v1"

export function cacheSiteAdminData(key, data) {
  const userId = currentAttendanceUserId()
  if (!userId) return
  try {
    const value = JSON.parse(localStorage.getItem(SITE_ROSTER_CACHE_KEY) || "null")
    const entries = value && value.userId === userId ? value.entries || {} : {}
    entries[key] = { savedAt: new Date().toISOString(), data }
    localStorage.setItem(SITE_ROSTER_CACHE_KEY, JSON.stringify({ userId, entries }))
  } catch {}
}

export function readCachedSiteAdminData(key) {
  const userId = currentAttendanceUserId()
  try {
    const value = JSON.parse(localStorage.getItem(SITE_ROSTER_CACHE_KEY) || "null")
    return value && value.userId === userId ? value.entries?.[key]?.data : undefined
  } catch {
    return undefined
  }
}

export async function clearOfflineAttendanceEvents(clientEventIds) {
  const ids = [...new Set(clientEventIds || [])]
  if (!ids.length) return
  try {
    await withStore("readwrite", (store) => ids.forEach((id) => store.delete(id)))
  } catch {
    const idSet = new Set(ids)
    const remaining = readLegacyQueue().filter((x) => !idSet.has(x.clientEventId))
    localStorage.setItem(LEGACY_QUEUE_KEY, JSON.stringify(remaining))
  }
}

export async function pendingOfflineAttendanceCount() {
  return (await getOfflineAttendanceQueue()).length
}

export async function syncOfflineAttendanceQueue(api) {
  if (!navigator.onLine) return { synced: 0, duplicates: 0, rejected: [], remaining: await pendingOfflineAttendanceCount() }

  const items = await getOfflineAttendanceQueue()
  if (!items.length) return { synced: 0, duplicates: 0, rejected: [], remaining: 0 }

  const response = await api.post("/attendance/self/offline-sync", { events: items.slice(0, 100) })
  const data = response.data || {}
  const rejectedIds = new Set((data.rejected || []).map((x) => x.clientEventId).filter(Boolean))
  const acceptedIds = items.map((x) => x.clientEventId).filter((id) => !rejectedIds.has(id))

  if (acceptedIds.length) await clearOfflineAttendanceEvents(acceptedIds)

  const remaining = await pendingOfflineAttendanceCount()
  return { ...data, remaining }
}
