const STORAGE_KEY = "assetflow_attendance_offline_queue_v1"
const DEVICE_KEY = "assetflow_attendance_device_id_v1"

function readQueue() {
  try {
    const value = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]")
    return Array.isArray(value) ? value : []
  } catch {
    return []
  }
}

function writeQueue(items) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(items.slice(-200)))
}

export function getAttendanceDeviceId() {
  let id = localStorage.getItem(DEVICE_KEY)
  if (!id) {
    id = `web-${crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random().toString(16).slice(2)}`}`
    localStorage.setItem(DEVICE_KEY, id)
  }
  return id
}

export function queueOfflineAttendance(event) {
  const items = readQueue()
  const item = {
    ...event,
    clientEventId: event.clientEventId || (crypto.randomUUID ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`),
    queuedAt: new Date().toISOString(),
    deviceId: event.deviceId || getAttendanceDeviceId(),
  }
  items.push(item)
  writeQueue(items)
  return item
}

export function getOfflineAttendanceQueue() {
  return readQueue()
}

export function clearOfflineAttendanceEvents(clientEventIds) {
  const ids = new Set(clientEventIds)
  writeQueue(readQueue().filter((x) => !ids.has(x.clientEventId)))
}

export function pendingOfflineAttendanceCount() {
  return readQueue().length
}

export async function syncOfflineAttendanceQueue(api) {
  const items = readQueue()
  if (!items.length || !navigator.onLine) return { synced: 0, duplicates: 0, rejected: [] }

  const response = await api.post("/attendance/self/offline-sync", { events: items })
  const data = response.data || {}
  const accepted = Number(data.synced || 0) + Number(data.duplicates || 0)
  if (accepted > 0) {
    const rejectedIds = new Set((data.rejected || []).map((x) => x.clientEventId).filter(Boolean))
    const acceptedIds = items.map((x) => x.clientEventId).filter((id) => !rejectedIds.has(id))
    clearOfflineAttendanceEvents(acceptedIds)
  }
  return data
}
