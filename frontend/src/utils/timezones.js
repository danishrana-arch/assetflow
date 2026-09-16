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
  Indian: "Indian Ocean",
  Pacific: "Oceania",
}

function timezoneRegion(zone) {
  const prefix = zone.includes("/") ? zone.split("/")[0] : zone
  return TIMEZONE_REGION_LABELS[prefix] || "Other"
}

// For the ~400 zones with no hardcoded friendly name above, compute a
// live "City (UTC offset)" label instead of hand-writing every one.
function timezoneOffsetLabel(zone) {
  const city = zone.includes("/") ? zone.split("/").pop().replace(/_/g, " ") : zone
  try {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: zone, timeZoneName: "short" }).formatToParts(new Date())
    const offset = parts.find((p) => p.type === "timeZoneName")?.value
    return offset ? `${city} (${offset})` : zone
  } catch {
    return zone
  }
}

export function timezoneLabel(zone) {
  return TIMEZONE_FRIENDLY_LABELS[zone] || timezoneOffsetLabel(zone)
}

// Every IANA zone the browser knows about — this is the full worldwide
// list, not a hand-picked subset. Only the fallback (browsers without
// Intl.supportedValuesOf) is a short hardcoded list, and even that still
// includes a Gulf zone so it isn't missing entirely there either.
export const ALL_TIMEZONES =
  typeof Intl !== "undefined" && typeof Intl.supportedValuesOf === "function"
    ? Intl.supportedValuesOf("timeZone")
    : [
        "UTC", "Asia/Karachi", "Asia/Dubai", "Asia/Muscat", "Asia/Qatar", "Asia/Bahrain", "Asia/Kuwait", "Asia/Riyadh",
        "Asia/Kolkata", "Europe/London", "Europe/Paris", "America/New_York", "America/Chicago", "America/Denver",
        "America/Los_Angeles", "Australia/Sydney",
      ]

// Region display order — most-used groups for this org first, long tail last.
const TIMEZONE_REGION_ORDER = ["Asia", "Africa", "Europe", "Americas", "Indian Ocean", "Oceania", "Atlantic Islands", "Antarctica", "Arctic", "Other"]

// All world timezones grouped into [regionLabel, zones[]] pairs, ready to
// render as <optgroup>s.
export const TIMEZONE_GROUPS = (() => {
  const buckets = new Map()
  for (const zone of ALL_TIMEZONES) {
    const region = timezoneRegion(zone)
    if (!buckets.has(region)) buckets.set(region, [])
    buckets.get(region).push(zone)
  }
  return TIMEZONE_REGION_ORDER.filter((region) => buckets.has(region)).map((region) => [region, buckets.get(region)])
})()
