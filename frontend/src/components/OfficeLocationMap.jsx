import { useMemo } from "react"
import { MapContainer, TileLayer, Marker, Circle } from "react-leaflet"
import { ClickToPlace, LocationSearch } from "./AttendanceSiteMap"

// Lahore — just a sensible starting view before the office location is set.
const DEFAULT_CENTER = { lat: 31.5204, lng: 74.3587 }

// Single-marker map picker for the organization's one office location —
// a stripped-down sibling of AttendanceSiteMap (which also supports
// multi-point project-site boundaries, irrelevant here since an
// organization only ever has one office geofence).
export default function OfficeLocationMap({ latitude, longitude, radiusMeters, onChange }) {
  const initialCenter = useMemo(() => {
    if (latitude && longitude) return { lat: Number(latitude), lng: Number(longitude) }
    return DEFAULT_CENTER
    // Only used for the map's initial view — react-leaflet doesn't recenter
    // on prop changes after mount, and we don't want it fighting the admin
    // while they're placing the marker.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const markerPosition = latitude && longitude ? { lat: Number(latitude), lng: Number(longitude) } : null

  function place(latlng) {
    onChange({ latitude: latlng.lat, longitude: latlng.lng })
  }

  return (
    <div className="space-y-2">
      <div className="h-[340px] w-full overflow-hidden rounded-2xl border border-border">
        <MapContainer center={initialCenter} zoom={16} style={{ height: "100%", width: "100%" }}>
          <TileLayer
            attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
          />
          <ClickToPlace onPoint={place} />
          <LocationSearch onPick={place} />

          {markerPosition && (
            <>
              <Marker
                position={markerPosition}
                draggable
                eventHandlers={{
                  dragend: (e) => place(e.target.getLatLng()),
                }}
              />
              <Circle center={markerPosition} radius={Number(radiusMeters) || 200} pathOptions={{ color: "#3B82F6", fillOpacity: 0.15 }} />
            </>
          )}
        </MapContainer>
      </div>
      <p className="text-[11px] text-muted">
        Use the search box on the map to jump to an address, then click the map to place the office marker, or drag it
        to fine-tune the position. The shaded circle shows the allowed radius below.
      </p>
    </div>
  )
}
