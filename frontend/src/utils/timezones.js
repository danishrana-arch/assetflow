// IANA timezone IDs don't include a literal "Gulf" entry — Gulf Standard
// Time (UTC+4) and nearby Arabia Standard Time (UTC+3) zones are listed per
// city, so they're easy to miss when scanning a dropdown. These labels
// surface the common name without changing the underlying IANA value that
// gets saved.
export const TIMEZONE_FRIENDLY_LABELS = {
  // GCC / Gulf countries (all six are covered).
  "Asia/Dubai": "Gulf Standard Time — Dubai / Abu Dhabi, UAE (UTC+4)",
  "Asia/Muscat": "Gulf Standard Time — Muscat, Oman (UTC+4)",
  "Asia/Qatar": "Arabia Standard Time — Doha, Qatar (UTC+3)",
  "Asia/Bahrain": "Arabia Standard Time — Manama, Bahrain (UTC+3)",
  "Asia/Kuwait": "Arabia Standard Time — Kuwait City, Kuwait (UTC+3)",
  "Asia/Riyadh": "Arabia Standard Time — Riyadh, Saudi Arabia (UTC+3)",
  "Asia/Karachi": "Pakistan Standard Time — Karachi (UTC+5)",
  "Asia/Kolkata": "India Standard Time — Kolkata (UTC+5:30)",
  "Asia/Calcutta": "India Standard Time — Kolkata (UTC+5:30)",
}

// Maps a zone's IANA top-level segment ("Asia/Karachi" -> "Asia") to the
// human-friendly region used to group the <optgroup>s in a timezone select.
const TIMEZONE_REGION_LABELS = {
  Africa: "Africa",
  America: "Americas",
  Antarctica: "Antarctica",
  Arctic: "Arctic",
  Asia: "Asia",
  Atlantic: "Atlantic Islands",
  Australia: "Oceania",
  Europe: "Europe",
  Indian: "Indian Ocean",
  Pacific: "Oceania",
  UTC: "UTC",
  Etc: "UTC",
}

function timezoneRegion(zone) {
  const prefix = zone.includes("/") ? zone.split("/")[0] : zone
  return TIMEZONE_REGION_LABELS[prefix] || "Other"
}

// Current UTC offset of a zone in minutes (DST-aware, computed live).
function timezoneOffsetMinutes(zone) {
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: zone, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit",
      hour: "2-digit", minute: "2-digit", second: "2-digit",
    }).formatToParts(new Date())
    const get = (type) => Number(parts.find((p) => p.type === type)?.value)
    const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"))
    return Math.round((asUtc - Date.now()) / 60000)
  } catch {
    return 0
  }
}

function formatOffset(minutes) {
  const sign = minutes < 0 ? "-" : "+"
  const abs = Math.abs(minutes)
  return `UTC${sign}${String(Math.floor(abs / 60)).padStart(2, "0")}:${String(abs % 60).padStart(2, "0")}`
}

// For zones with no hardcoded friendly name above, compute a live
// "City, Region (UTC±HH:MM)" label instead of hand-writing every one.
function timezoneOffsetLabel(zone) {
  if (zone === "UTC" || zone === "Etc/UTC") return "Coordinated Universal Time (UTC+00:00)"
  const segments = zone.split("/")
  const city = segments.slice(1).reverse().join(", ").replace(/_/g, " ") || zone
  return `${city} (${formatOffset(timezoneOffsetMinutes(zone))})`
}

export function timezoneLabel(zone) {
  return TIMEZONE_FRIENDLY_LABELS[zone] || timezoneOffsetLabel(zone)
}

// Common zones/aliases always included, even where the browser's own list
// omits them (Chrome's Intl.supportedValuesOf leaves out "UTC" and legacy
// aliases like Asia/Calcutta that older saved settings may still use), and
// as the fallback for browsers without Intl.supportedValuesOf at all.
const BASE_TIMEZONES = [
  "UTC",
  // Asia
  "Asia/Karachi", "Asia/Dubai", "Asia/Muscat", "Asia/Qatar", "Asia/Bahrain", "Asia/Kuwait", "Asia/Riyadh",
  "Asia/Kolkata", "Asia/Calcutta", "Asia/Dhaka", "Asia/Kathmandu", "Asia/Colombo", "Asia/Kabul", "Asia/Tehran",
  "Asia/Baghdad", "Asia/Amman", "Asia/Beirut", "Asia/Damascus", "Asia/Jerusalem", "Asia/Aden", "Asia/Tashkent",
  "Asia/Almaty", "Asia/Bishkek", "Asia/Dushanbe", "Asia/Ashgabat", "Asia/Baku", "Asia/Tbilisi", "Asia/Yerevan",
  "Asia/Yangon", "Asia/Bangkok", "Asia/Ho_Chi_Minh", "Asia/Jakarta", "Asia/Kuala_Lumpur", "Asia/Singapore",
  "Asia/Manila", "Asia/Hong_Kong", "Asia/Shanghai", "Asia/Taipei", "Asia/Seoul", "Asia/Tokyo", "Asia/Ulaanbaatar",
  "Asia/Yekaterinburg", "Asia/Novosibirsk", "Asia/Krasnoyarsk", "Asia/Irkutsk", "Asia/Vladivostok", "Asia/Kamchatka",
  // Africa
  "Africa/Cairo", "Africa/Johannesburg", "Africa/Lagos", "Africa/Nairobi", "Africa/Casablanca", "Africa/Algiers",
  "Africa/Tunis", "Africa/Tripoli", "Africa/Khartoum", "Africa/Addis_Ababa", "Africa/Accra", "Africa/Abidjan",
  "Africa/Dakar", "Africa/Kinshasa", "Africa/Luanda", "Africa/Harare", "Africa/Maputo", "Africa/Dar_es_Salaam",
  "Africa/Kampala",
  // Europe
  "Europe/London", "Europe/Dublin", "Europe/Lisbon", "Europe/Paris", "Europe/Berlin", "Europe/Madrid", "Europe/Rome",
  "Europe/Amsterdam", "Europe/Brussels", "Europe/Zurich", "Europe/Vienna", "Europe/Stockholm", "Europe/Oslo",
  "Europe/Copenhagen", "Europe/Helsinki", "Europe/Warsaw", "Europe/Prague", "Europe/Budapest", "Europe/Athens",
  "Europe/Bucharest", "Europe/Sofia", "Europe/Kyiv", "Europe/Istanbul", "Europe/Moscow", "Europe/Minsk",
  // Americas
  "America/New_York", "America/Chicago", "America/Denver", "America/Phoenix", "America/Los_Angeles",
  "America/Anchorage", "America/Toronto", "America/Vancouver", "America/Halifax", "America/St_Johns",
  "America/Mexico_City", "America/Guatemala", "America/Panama", "America/Bogota", "America/Lima", "America/Caracas",
  "America/Santiago", "America/La_Paz", "America/Asuncion", "America/Sao_Paulo", "America/Argentina/Buenos_Aires",
  "America/Montevideo", "America/Havana", "America/Jamaica", "America/Puerto_Rico",
  // Oceania / Pacific
  "Australia/Perth", "Australia/Adelaide", "Australia/Darwin", "Australia/Brisbane", "Australia/Sydney",
  "Australia/Melbourne", "Australia/Hobart", "Pacific/Auckland", "Pacific/Fiji", "Pacific/Guam",
  "Pacific/Port_Moresby", "Pacific/Honolulu", "Pacific/Tongatapu", "Pacific/Apia", "Pacific/Kiritimati",
  // Indian Ocean / Atlantic
  "Indian/Maldives", "Indian/Mauritius", "Indian/Reunion", "Indian/Mahe", "Atlantic/Reykjavik", "Atlantic/Azores",
  "Atlantic/Canary", "Atlantic/Cape_Verde", "Atlantic/Bermuda",
]

// Every IANA zone the browser knows about (~420 — the full worldwide list),
// merged with the base list above so nothing common is ever missing.
export const ALL_TIMEZONES = (() => {
  const browserZones =
    typeof Intl !== "undefined" && typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : []
  const valid = BASE_TIMEZONES.filter((zone) => {
    try {
      new Intl.DateTimeFormat("en-US", { timeZone: zone })
      return true
    } catch {
      return false
    }
  })
  return Array.from(new Set([...browserZones, ...valid]))
})()

// Region display order — most-used groups for this org first, long tail last.
const TIMEZONE_REGION_ORDER = ["UTC", "Asia", "Africa", "Europe", "Americas", "Indian Ocean", "Oceania", "Atlantic Islands", "Antarctica", "Arctic", "Other"]

// All world timezones grouped into [regionLabel, zones[]] pairs, ready to
// render as <optgroup>s. Zones inside each group are sorted by current UTC
// offset, then name, so neighbouring options are neighbouring time zones.
export const TIMEZONE_GROUPS = (() => {
  const buckets = new Map()
  for (const zone of ALL_TIMEZONES) {
    const region = timezoneRegion(zone)
    if (!buckets.has(region)) buckets.set(region, [])
    buckets.get(region).push({ zone, offset: timezoneOffsetMinutes(zone) })
  }
  return TIMEZONE_REGION_ORDER.filter((region) => buckets.has(region)).map((region) => [
    region,
    buckets
      .get(region)
      .sort((a, b) => a.offset - b.offset || a.zone.localeCompare(b.zone))
      .map((entry) => entry.zone),
  ])
})()
