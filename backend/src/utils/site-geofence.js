const { distanceMeters } = require('./geo')

function normalizeBoundary(boundary) {
  if (!Array.isArray(boundary)) return []
  return boundary
    .map((point) => ({ lat: Number(point?.lat), lng: Number(point?.lng) }))
    .filter((point) => Number.isFinite(point.lat) && Number.isFinite(point.lng))
}

function pointInPolygon(latitude, longitude, boundary) {
  const points = normalizeBoundary(boundary)
  if (points.length < 3) return false

  let inside = false
  for (let i = 0, j = points.length - 1; i < points.length; j = i++) {
    const xi = points[i].lng
    const yi = points[i].lat
    const xj = points[j].lng
    const yj = points[j].lat
    const intersects = ((yi > latitude) !== (yj > latitude)) &&
      (longitude < ((xj - xi) * (latitude - yi)) / ((yj - yi) || Number.EPSILON) + xi)
    if (intersects) inside = !inside
  }
  return inside
}

function siteDistance(site, latitude, longitude) {
  const centerDistance = distanceMeters(
    latitude,
    longitude,
    Number(site.latitude),
    Number(site.longitude),
  )
  const boundary = normalizeBoundary(site.boundary)
  if (boundary.length >= 3) {
    return {
      inside: pointInPolygon(latitude, longitude, boundary),
      distance: centerDistance,
      mode: 'POLYGON',
    }
  }
  const radius = Number(site.radiusMeters)
  return {
    inside: Number.isFinite(radius) && centerDistance <= radius,
    distance: centerDistance,
    mode: 'RADIUS',
  }
}

function polygonCentroid(boundary) {
  const points = normalizeBoundary(boundary)
  if (!points.length) return null
  let lat = 0
  let lng = 0
  for (const point of points) {
    lat += point.lat
    lng += point.lng
  }
  return { lat: lat / points.length, lng: lng / points.length }
}

function polygonPerimeterMeters(boundary) {
  const points = normalizeBoundary(boundary)
  if (points.length < 2) return 0
  let total = 0
  for (let i = 0; i < points.length; i += 1) {
    const a = points[i]
    const b = points[(i + 1) % points.length]
    total += distanceMeters(a.lat, a.lng, b.lat, b.lng)
  }
  return Math.round(total * 100) / 100
}

function polygonAreaSqMeters(boundary) {
  const points = normalizeBoundary(boundary)
  if (points.length < 3) return 0
  const R = 6371008.8
  const meanLat = points.reduce((sum, p) => sum + p.lat, 0) / points.length
  const latScale = Math.PI / 180
  const cosLat = Math.cos(meanLat * latScale)
  const projected = points.map((p) => ({
    x: R * p.lng * latScale * cosLat,
    y: R * p.lat * latScale,
  }))
  let area = 0
  for (let i = 0; i < projected.length; i += 1) {
    const a = projected[i]
    const b = projected[(i + 1) % projected.length]
    area += a.x * b.y - b.x * a.y
  }
  return Math.round(Math.abs(area / 2) * 100) / 100
}

module.exports = {
  normalizeBoundary,
  pointInPolygon,
  siteDistance,
  polygonCentroid,
  polygonPerimeterMeters,
  polygonAreaSqMeters,
}
