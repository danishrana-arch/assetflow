export function distanceMeters(lat1, lon1, lat2, lon2) {
  const R = 6371000
  const toRad = (v) => (v * Math.PI) / 180
  const dLat = toRad(lat2 - lat1)
  const dLon = toRad(lon2 - lon1)
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLon / 2) ** 2
  return 2 * R * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}
export function pointInPolygon(latitude, longitude, boundary) {
  if (!Array.isArray(boundary) || boundary.length < 3) return false
  let inside = false
  for (let i = 0, j = boundary.length - 1; i < boundary.length; j = i++) {
    const xi = Number(boundary[i].lng), yi = Number(boundary[i].lat), xj = Number(boundary[j].lng), yj = Number(boundary[j].lat)
    const intersects = ((yi > latitude) !== (yj > latitude)) && longitude < ((xj - xi) * (latitude - yi)) / ((yj - yi) || Number.EPSILON) + xi
    if (intersects) inside = !inside
  }
  return inside
}
export function siteMatch(site, latitude, longitude) {
  const distance = distanceMeters(latitude, longitude, Number(site.latitude), Number(site.longitude))
  const polygon = Array.isArray(site.boundary) && site.boundary.length >= 3
  return { site, distance, inside: polygon ? pointInPolygon(latitude, longitude, site.boundary) : distance <= Number(site.radiusMeters) }
}
export function nearestAssignedSite(sites, latitude, longitude) {
  let best = null
  for (const site of sites || []) {
    const candidate = siteMatch(site, latitude, longitude)
    if (!best || (candidate.inside && !best.inside) || (candidate.inside === best.inside && candidate.distance < best.distance)) best = candidate
  }
  return best
}
