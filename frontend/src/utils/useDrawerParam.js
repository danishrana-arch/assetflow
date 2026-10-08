import { useCallback } from "react"
import { useSearchParams } from "react-router-dom"

// Keeps "which record is open in the drawer" in the URL (?view=<id>), so a
// drawer survives a refresh, can be linked to, and the browser Back button
// closes it (or steps back to the previously opened record).
// open(id) pushes a history entry; close() removes the param in place.
export default function useDrawerParam(key = "view") {
  const [params, setParams] = useSearchParams()
  const id = params.get(key)

  const open = useCallback((next) => {
    setParams((p) => { const n = new URLSearchParams(p); n.set(key, next); return n })
  }, [key, setParams])

  const close = useCallback(() => {
    setParams((p) => { const n = new URLSearchParams(p); n.delete(key); return n }, { replace: true })
  }, [key, setParams])

  return { id, open, close }
}
