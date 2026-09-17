import { useEffect, useMemo, useRef, useState } from "react"
import { MapContainer, TileLayer, Marker, Circle, Polygon, useMap, useMapEvents } from "react-leaflet"
import L from "leaflet"
import markerIcon2x from "leaflet/dist/images/marker-icon-2x.png"
import markerIcon from "leaflet/dist/images/marker-icon.png"
import markerShadow from "leaflet/dist/images/marker-shadow.png"
import { MapPinned, RotateCcw, Search, Trash2 } from "lucide-react"
import { polygonAreaMeters, polygonPerimeterMeters } from "../utils/siteGeofence"

// Standard Leaflet + bundler workaround — Leaflet's default marker icon URLs
// are relative paths meant for a plain <script> include, so under Vite they
// 404. Point the default icon at the actual bundled asset URLs instead.
delete L.Icon.Default.prototype._getIconUrl
L.Icon.Default.mergeOptions({
  iconRetinaUrl: markerIcon2x,
  iconUrl: markerIcon,
  shadowUrl: markerShadow,
})

// Lahore — just a sensible starting view before any site has coordinates.
const DEFAULT_CENTER = { lat: 31.5204, lng: 74.3587 }

// A triangle is technically a valid polygon, but for real property
// boundaries we require at least one more point so the shape actually
// tracks the site's corners rather than a rough approximation.
const MIN_POLYGON_POINTS = 4

function boundaryCenter(boundary) {
  return {
    lat: boundary.reduce((sum, p) => sum + Number(p.lat), 0) / boundary.length,
    lng: boundary.reduce((sum, p) => sum + Number(p.lng), 0) / boundary.length,
  }
}

// Exported so other single-marker map pickers (e.g. the organization's
// office-location setting) can reuse click-to-place + the geocoder search
// box without duplicating this logic or re-running the Leaflet icon-URL fix.
export function ClickToPlace({ onPoint }) {
  useMapEvents({ click: (e) => onPoint(e.latlng) })
  return null
}

// Mailing-address details like a commercial registration number, PO box or
// postal code aren't physical map locations, so the geocoder can't place
// them — stripping them out and retrying with what's left (typically the
// city/area) turns an address like "C.R. 1433560, P.O. Box: 800, P.C. 121,
// Muscat Oman" into a searchable "Muscat Oman".
function simplifyAddressQuery(q) {
  return q
    .replace(/\bC\.?\s*R\.?\s*[:#-]?\s*\d+/gi, "")
    .replace(/\bP\.?\s*O\.?\s*Box\s*[:#-]?\s*\d+/gi, "")
    .replace(/\bP\.?\s*C\.?\s*[:#-]?\s*\d+/gi, "")
    .replace(/[,\s]+/g, " ")
    .trim()
}

async function geocode(q) {
  const res = await fetch(`https://nominatim.openstreetmap.org/search?format=json&limit=5&accept-language=en&q=${encodeURIComponent(q)}`)
  const data = await res.json()
  return Array.isArray(data) ? data : []
}

// Free-text location search using OpenStreetMap's Nominatim geocoder (no
// API key). Results are requested in English regardless of the searched
// place's local language, to match the English basemap.
export function LocationSearch({ onPick }) {
  const map = useMap()
  const boxRef = useRef(null)
  const debounceRef = useRef(null)
  const [query, setQuery] = useState("")
  const [results, setResults] = useState([])
  const [loading, setLoading] = useState(false)
  const [open, setOpen] = useState(false)
  const [fallbackUsed, setFallbackUsed] = useState(null)

  useEffect(() => {
    if (!boxRef.current) return
    // Same trick Leaflet's own controls use — stops map drag/zoom/click
    // from firing when the user is interacting with this overlay instead.
    L.DomEvent.disableClickPropagation(boxRef.current)
    L.DomEvent.disableScrollPropagation(boxRef.current)
  }, [])

  async function runSearch(q) {
    setLoading(true)
    setFallbackUsed(null)
    try {
      let data = await geocode(q)
      if (!data.length) {
        const simplified = simplifyAddressQuery(q)
        if (simplified && simplified.toLowerCase() !== q.trim().toLowerCase()) {
          data = await geocode(simplified)
          if (data.length) setFallbackUsed(simplified)
        }
      }
      setResults(data)
      setOpen(true)
    } catch {
      setResults([])
    } finally {
      setLoading(false)
    }
  }

  function handleChange(e) {
    const value = e.target.value
    setQuery(value)
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (!value.trim()) {
      setResults([])
      setOpen(false)
      return
    }
    debounceRef.current = setTimeout(() => runSearch(value), 400)
  }

  function handleKeyDown(e) {
    if (e.key !== "Enter") return
    e.preventDefault()
    if (debounceRef.current) clearTimeout(debounceRef.current)
    if (query.trim()) runSearch(query)
  }

  function pick(result) {
    const lat = Number(result.lat)
    const lng = Number(result.lon)
    map.flyTo([lat, lng], 17)
    onPick({ lat, lng })
    setQuery(result.display_name)
    setResults([])
    setOpen(false)
  }

  return (
    <div className="leaflet-top leaflet-left" style={{ left: 8, top: 8 }}>
      <div ref={boxRef} className="leaflet-control relative w-64 max-w-[70vw]">
        <div className="flex items-center gap-1.5 rounded-xl border border-border bg-surface px-2.5 py-2 shadow-lg">
          <Search size={13} className="shrink-0 text-muted" />
          <input
            value={query}
            onChange={handleChange}
            onKeyDown={handleKeyDown}
            onFocus={() => results.length && setOpen(true)}
            placeholder="Search for a location…"
            className="w-full bg-transparent text-xs text-ink outline-none placeholder:text-muted"
          />
        </div>
        {open && (loading || query.trim()) && (
          <ul className="absolute mt-1 max-h-64 w-full overflow-y-auto rounded-xl border border-border bg-surface shadow-lg">
            {loading && <li className="px-3 py-2 text-xs text-muted">Searching…</li>}
            {!loading && fallbackUsed && (
              <li className="border-b border-border px-3 py-1.5 text-[10px] text-muted">No exact match — showing results for "{fallbackUsed}"</li>
            )}
            {!loading && results.map((r) => (
              <li key={r.place_id}>
                <button
                  type="button"
                  onClick={() => pick(r)}
                  className="block w-full truncate px-3 py-2 text-left text-xs text-ink hover:bg-surface-2"
                  title={r.display_name}
                >
                  {r.display_name}
                </button>
              </li>
            ))}
            {!loading && results.length === 0 && (
              <li className="px-3 py-2 text-xs text-muted">
                No results. PO boxes, postal codes and registration numbers aren't map locations — try searching the city or area name instead.
              </li>
            )}
          </ul>
        )}
      </div>
    </div>
  )
}

/**
 * Click-to-place site map. Two modes:
 *  - RADIUS: click/drag a single marker; the shaded circle shows the
 *    radiusMeters fallback geofence used at check-in/check-out time.
 *  - POLYGON: click to add boundary vertices, drag a vertex to fine-tune it.
 */
export default function AttendanceSiteMap({ latitude, longitude, boundary = [], radiusMeters, type = "RADIUS", onChange }) {
  const initialCenter = useMemo(() => {
    if (latitude && longitude) return { lat: Number(latitude), lng: Number(longitude) }
    if (boundary.length) return boundaryCenter(boundary)
    return DEFAULT_CENTER
    // Only used for the map's initial view — react-leaflet doesn't recenter
    // on prop changes after mount, and we don't want it to fight the user
    // while they're actively placing points.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const markerPosition = latitude && longitude ? { lat: Number(latitude), lng: Number(longitude) } : null

  function emitPolygon(points) {
    if (points.length < MIN_POLYGON_POINTS) {
      onChange({ type: "POLYGON", boundary: points })
      return
    }
    const c = boundaryCenter(points)
    onChange({
      type: "POLYGON",
      boundary: points,
      latitude: c.lat,
      longitude: c.lng,
      areaSqMeters: Math.round(polygonAreaMeters(points) * 100) / 100,
      perimeterMeters: Math.round(polygonPerimeterMeters(points) * 100) / 100,
    })
  }

  function handleMapClick(latlng) {
    if (type === "POLYGON") {
      emitPolygon([...boundary, { lat: latlng.lat, lng: latlng.lng }])
    } else {
      onChange({ type: "RADIUS", latitude: latlng.lat, longitude: latlng.lng })
    }
  }

  function handleSearchPick(latlng) {
    // POLYGON mode: searching just recenters the map (handled by the
    // search box itself) — the user still clicks to place boundary points.
    if (type === "RADIUS") {
      onChange({ type: "RADIUS", latitude: latlng.lat, longitude: latlng.lng })
    }
  }

  function moveVertex(index, latlng) {
    emitPolygon(boundary.map((p, i) => (i === index ? { lat: latlng.lat, lng: latlng.lng } : p)))
  }

  function startDrawing() {
    onChange({ type: "POLYGON", boundary: [] })
  }

  function undoLastPoint() {
    emitPolygon(boundary.slice(0, -1))
  }

  function clearBoundary() {
    onChange({ type: "RADIUS", boundary: [], areaSqMeters: 0, perimeterMeters: 0 })
  }

  return (
    <div className="space-y-2">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" onClick={startDrawing} className="pill-secondary inline-flex items-center gap-1.5 px-3 py-2 text-xs">
          <MapPinned size={13} /> Draw site boundary
        </button>
        {type === "POLYGON" && boundary.length > 0 && (
          <button type="button" onClick={undoLastPoint} className="pill-secondary inline-flex items-center gap-1.5 px-3 py-2 text-xs">
            <RotateCcw size={13} /> Undo last point
          </button>
        )}
        <button type="button" onClick={clearBoundary} className="pill-secondary inline-flex items-center gap-1.5 px-3 py-2 text-xs">
          <Trash2 size={13} /> Clear boundary
        </button>
        {type === "POLYGON" && boundary.length >= MIN_POLYGON_POINTS && (
          <span className="text-[11px] text-muted">
            {Math.round(polygonAreaMeters(boundary)).toLocaleString()} m² · {Math.round(polygonPerimeterMeters(boundary)).toLocaleString()} m perimeter
          </span>
        )}
      </div>
      <div className="h-[390px] w-full overflow-hidden rounded-2xl border border-border">
        <MapContainer center={initialCenter} zoom={16} style={{ height: "100%", width: "100%" }}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <ClickToPlace onPoint={handleMapClick} />
          <LocationSearch onPick={handleSearchPick} />

          {type === "RADIUS" && markerPosition && (
            <>
              <Marker
                position={markerPosition}
                draggable
                eventHandlers={{
                  dragend: (e) => {
                    const pos = e.target.getLatLng()
                    onChange({ type: "RADIUS", latitude: pos.lat, longitude: pos.lng })
                  },
                }}
              />
              <Circle center={markerPosition} radius={Number(radiusMeters) || 250} pathOptions={{ color: "#3B82F6", fillOpacity: 0.15 }} />
            </>
          )}

          {type === "POLYGON" && boundary.length > 0 && (
            <>
              {boundary.length >= MIN_POLYGON_POINTS && (
                <Polygon positions={boundary.map((p) => [Number(p.lat), Number(p.lng)])} pathOptions={{ color: "#3B82F6", fillOpacity: 0.2 }} />
              )}
              {boundary.map((p, i) => (
                <Marker
                  key={i}
                  position={[Number(p.lat), Number(p.lng)]}
                  draggable
                  eventHandlers={{ dragend: (e) => moveVertex(i, e.target.getLatLng()) }}
                />
              ))}
            </>
          )}
        </MapContainer>
      </div>
      <p className="text-[11px] text-muted">
        Use the search box on the map to jump to an address, then{" "}
        {type === "POLYGON"
          ? "click the map to add boundary points, drag a point to fine-tune it."
          : "click the map to place the site marker, or drag it to fine-tune the position. The shaded circle shows the fallback radius."}
      </p>
    </div>
  )
}
