import { useEffect, useRef, useState } from "react"
import { MapPinned, RotateCcw, Trash2 } from "lucide-react"

let mapsPromise

function loadGoogleMaps() {
  const key = import.meta.env.VITE_GOOGLE_MAPS_API_KEY
  if (!key) return Promise.reject(new Error("VITE_GOOGLE_MAPS_API_KEY is not configured"))
  if (window.google?.maps?.drawing) return Promise.resolve(window.google.maps)
  if (mapsPromise) return mapsPromise

  mapsPromise = new Promise((resolve, reject) => {
    const existing = document.querySelector('script[data-assetflow-google-maps="true"]')
    if (existing) {
      existing.addEventListener("load", () => resolve(window.google.maps), { once: true })
      existing.addEventListener("error", () => reject(new Error("Google Maps failed to load")), { once: true })
      return
    }
    const script = document.createElement("script")
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(key)}&libraries=drawing,geometry`
    script.async = true
    script.defer = true
    script.dataset.assetflowGoogleMaps = "true"
    script.onload = () => resolve(window.google.maps)
    script.onerror = () => reject(new Error("Google Maps failed to load. Check the API key and enabled APIs."))
    document.head.appendChild(script)
  })
  return mapsPromise
}

function closeRing(points) {
  return points.map((p) => ({ lat: Number(p.lat), lng: Number(p.lng) }))
}

export default function AttendanceSiteMap({ latitude, longitude, boundary, type = "POLYGON", onChange }) {
  const mapEl = useRef(null)
  const mapRef = useRef(null)
  const polygonRef = useRef(null)
  const drawingRef = useRef(null)
  const [error, setError] = useState("")
  const [loaded, setLoaded] = useState(false)
  const [measure, setMeasure] = useState({ area: 0, perimeter: 0 })

  const center = {
    lat: Number(latitude) || 31.5204,
    lng: Number(longitude) || 74.3587,
  }

  useEffect(() => {
    let cancelled = false
    loadGoogleMaps()
      .then((maps) => {
        if (cancelled || !mapEl.current || mapRef.current) return
        const map = new maps.Map(mapEl.current, {
          center,
          zoom: 17,
          mapTypeId: "satellite",
          streetViewControl: false,
          fullscreenControl: true,
          mapTypeControl: true,
        })
        mapRef.current = map
        setLoaded(true)
      })
      .catch((err) => setError(err.message))
    return () => { cancelled = true }
  }, [])

  useEffect(() => {
    if (!loaded || !mapRef.current) return
    mapRef.current.setCenter(center)
  }, [latitude, longitude, loaded])

  useEffect(() => {
    if (!loaded || !mapRef.current || !window.google?.maps?.drawing) return
    const maps = window.google.maps
    if (polygonRef.current) polygonRef.current.setMap(null)
    polygonRef.current = null
    if (drawingRef.current) drawingRef.current.setMap(null)

    if (type === "POLYGON" && Array.isArray(boundary) && boundary.length >= 3) {
      polygonRef.current = new maps.Polygon({
        paths: closeRing(boundary),
        editable: true,
        draggable: true,
        strokeOpacity: 0.95,
        strokeWeight: 2,
        fillOpacity: 0.22,
      })
      polygonRef.current.setMap(mapRef.current)
      mapRef.current.fitBounds(getBounds(maps, boundary))
      attachPolygonListeners(polygonRef.current, maps)
      updateMeasurement(polygonRef.current)
    }

    const manager = new maps.drawing.DrawingManager({
      drawingMode: type === "POLYGON" ? maps.drawing.OverlayType.POLYGON : null,
      drawingControl: false,
      polygonOptions: {
        editable: true,
        draggable: true,
        strokeOpacity: 0.95,
        strokeWeight: 2,
        fillOpacity: 0.22,
      },
    })
    drawingRef.current = manager
    manager.setMap(mapRef.current)
    maps.event.addListener(manager, "polygoncomplete", (polygon) => {
      if (polygonRef.current) polygonRef.current.setMap(null)
      polygonRef.current = polygon
      manager.setDrawingMode(null)
      attachPolygonListeners(polygon, maps)
      emitPolygon(polygon)
    })

    return () => {
      if (drawingRef.current) drawingRef.current.setMap(null)
      drawingRef.current = null
    }
  }, [loaded, type])

  function getBounds(maps, points) {
    const bounds = new maps.LatLngBounds()
    points.forEach((p) => bounds.extend(p))
    return bounds
  }

  function emitPolygon(polygon) {
    const path = polygon.getPath()
    const points = []
    for (let i = 0; i < path.getLength(); i += 1) {
      const point = path.getAt(i)
      points.push({ lat: point.lat(), lng: point.lng() })
    }
    const maps = window.google.maps
    const area = maps.geometry.spherical.computeArea(path)
    const perimeter = maps.geometry.spherical.computeLength(path)
    setMeasure({ area, perimeter })
    const bounds = getBounds(maps, points)
    const c = bounds.getCenter()
    onChange({
      type: "POLYGON",
      boundary: points,
      latitude: c.lat(),
      longitude: c.lng(),
      areaSqMeters: Math.round(area * 100) / 100,
      perimeterMeters: Math.round(perimeter * 100) / 100,
    })
  }

  function attachPolygonListeners(polygon, maps) {
    const path = polygon.getPath()
    ;["set_at", "insert_at", "remove_at"].forEach((eventName) => {
      maps.event.addListener(path, eventName, () => emitPolygon(polygon))
    })
    maps.event.addListener(polygon, "dragend", () => emitPolygon(polygon))
    emitPolygon(polygon)
  }

  function clearBoundary() {
    if (polygonRef.current) polygonRef.current.setMap(null)
    polygonRef.current = null
    setMeasure({ area: 0, perimeter: 0 })
    onChange({ type: "RADIUS", boundary: [], areaSqMeters: 0, perimeterMeters: 0 })
    if (drawingRef.current && window.google?.maps?.drawing) {
      drawingRef.current.setDrawingMode(type === "POLYGON" ? window.google.maps.drawing.OverlayType.POLYGON : null)
    }
  }

  function startDrawing() {
    if (drawingRef.current && window.google?.maps?.drawing) {
      drawingRef.current.setDrawingMode(window.google.maps.drawing.OverlayType.POLYGON)
    }
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={startDrawing} className="pill-secondary inline-flex items-center gap-1.5 px-3 py-2 text-xs">
          <MapPinned size={13} /> Draw site boundary
        </button>
        <button type="button" onClick={clearBoundary} className="pill-secondary inline-flex items-center gap-1.5 px-3 py-2 text-xs">
          <Trash2 size={13} /> Clear boundary
        </button>
        {Array.isArray(boundary) && boundary.length >= 3 && (
          <span className="text-[11px] text-muted">{Math.round(measure.area || 0).toLocaleString()} m² · {Math.round(measure.perimeter || 0).toLocaleString()} m perimeter</span>
        )}
      </div>
      <div ref={mapEl} className="h-[390px] w-full overflow-hidden rounded-2xl border border-border bg-surface-2" />
      {error ? (
        <div className="rounded-2xl bg-chip-yellow-bg px-3 py-2.5 text-xs text-chip-yellow-fg">
          {error}. Add <strong>VITE_GOOGLE_MAPS_API_KEY</strong> to the frontend environment to enable the map. Manual coordinates still work.
        </div>
      ) : !loaded ? (
        <p className="text-[11px] text-muted">Loading Google Maps…</p>
      ) : (
        <p className="text-[11px] text-muted">Satellite view. Draw the actual property boundary, then drag points to fine-tune it.</p>
      )}
    </div>
  )
}
