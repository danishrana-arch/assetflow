const DB_NAME = "assetflow_offline"
const DB_VERSION = 1
const QUEUE_STORE = "attendanceQueue"
const META_STORE = "meta"
const LEGACY_QUEUE_KEY = "assetflow_attendance_offline_queue_v1"
const DEVICE_KEY = "assetflow_attendance_device_id_v1"

const ATTENDANCE_CACHE_KEY = "assetflow_attendance_snapshot_v1"
const SITES_CACHE_KEY = "assetflow_attendance_sites_v1"

export function cacheAttendanceSnapshot(snapshot) {
  try {
    localStorage.setItem(ATTENDANCE_CACHE_KEY, JSON.stringify(snapshot || null))
  } catch {}
}

export function readCachedAttendanceSnapshot() {
  try {
    const value = localStorage.getItem(ATTENDANCE_CACHE_KEY)
    return value ? JSON.parse(value) : undefined
  } catch {
    return undefined
  }
}

export function cacheAssignedSites(sites) {
  try {
    localStorage.setItem(SITES_CACHE_KEY, JSON.stringify(Array.isArray(sites) ? sites : []))
  } catch {}
}

export function readCachedAssignedSites() {
  try {
    const value = localStorage.getItem(SITES_CACHE_KEY)
    const parsed = value ? JSON.parse(value) : []
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
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

export async function getOfflineAttendanceQueue() {
  try {
    await migrateLegacyQueue()
    return await readAllIndexed()
  } catch {
    return readLegacyQueue()
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
