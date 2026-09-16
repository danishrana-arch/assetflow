# AssetFlow — pending implementation modules

This file tracks a batch of prepared patches (originally shipped as
`NN-*.patch` unified diffs) implementing an approved implementation brief.
They must be applied **in order (01 → 07)**, verifying the app still boots
after each one, since later modules assume earlier ones are already in
place. Update the Status column as each module lands.

| # | Module | Status |
|---|--------|--------|
| 01 | Security checklist (HSTS, no-store caching) | ✅ applied |
| 02 | Refresh/logout 401 fix | ✅ applied |
| 03 | CEO limit 2 → 3 | ✅ applied |
| 04 | Timezone list — GCC + full region grouping | ✅ applied |
| 05 | Leaflet geofence rewrite (drops Google Maps) + bundled §6/§7/§8 | ✅ applied (`npm install leaflet react-leaflet@4` done, frontend build verified) |
| 07 | WFH schema migration (`AttendanceLocationMode`) | ⚠️ schema + migration file written; **`npx prisma migrate deploy` and `npx prisma generate` still need to be run manually** — blocked here by a Windows file lock (EPERM) from a running dev node process holding the query engine DLL. Stop your dev backend, then run both commands from `backend/`. |

There is intentionally no `06`: modules 6 (attendance export date range)
and 8 (check-in progress fill animation) have no standalone patch — they
interleave with module 05's changes in the same files/functions, so they
ship bundled inside module 05 (see that section below).

## 01 — Security checklist

Files: `backend/src/index.js`, new `backend/src/middleware/cache.middleware.js`,
`backend/src/routes/employee.routes.js`, `backend/src/routes/payroll.routes.js`,
`backend/src/routes/attendance-site.routes.js`.

- Configure `helmet()` with explicit HSTS: `maxAge: 31536000`,
  `includeSubDomains: true`, `preload: true`.
- Add a `noStore` middleware (`Cache-Control: no-store`) and apply it to
  routes returning PII: `GET /employees/:id`, `GET /payroll/me`,
  `GET /payroll`, `GET /attendance-site/assigned`,
  `PUT /attendance-site/:id/employees`.

No DB/manual step.

## 02 — Refresh/logout 401 fix

File: `frontend/src/api/client.js`.

The global 401 interceptor currently wipes the session (`assetflow_token`,
`assetflow_user_cache`, `assetflow_active_organization`) on **any** 401
response. Restrict that to only the session-check call
(`GET /auth/me`, used by `AuthContext.refreshUser()`) — a 401 from any
other endpoint (e.g. a permission check on one resource) must reject
without logging the user out from under them.

No manual step.

## 03 — CEO limit 2 → 3

Files: `backend/src/utils/roles.js`, `frontend/src/pages/EmployeeProfile.jsx`,
`frontend/src/pages/Employees.jsx`.

Raise `MAX_CEO_COUNT` from 2 to 3 and update the two frontend role-select
filters (`< 2` → `< 3`) that gate offering the CEO role in the dropdown.

No manual step.

## 04 — Timezone list: GCC + region grouping

File: `frontend/src/pages/Settings.jsx`.

- All six GCC zones get friendly labels with country names
  (`Asia/Dubai`, `Asia/Muscat`, `Asia/Qatar`, `Asia/Bahrain`,
  `Asia/Kuwait`, `Asia/Riyadh`), plus `Asia/Karachi`, `Asia/Kolkata` /
  `Asia/Calcutta`.
- For the remaining ~400 IANA zones with no hardcoded label, compute a
  live "City (UTC offset)" label via `Intl.DateTimeFormat`.
- Group the `<select>` into `<optgroup>`s by region (Asia, Africa, Europe,
  Americas, Indian Ocean, Oceania, Atlantic Islands, Antarctica, Arctic,
  Other), ordered with the org's most-used regions first.

No manual step.

## 05 — Leaflet geofence rewrite (the big one)

Covers §5 (replace Google Maps site map with Leaflet/OpenStreetMap, remove
continuous/interval location tracking, keep only the one-shot
check-in/check-out geofence check) **and** bundles §6, §7, §8 into the same
files because their changes interleave in the same functions.

**Manual step:** `cd frontend && npm install leaflet react-leaflet@4`
(not `@react-leaflet@5` — that needs React 19; this app is on React 18).
Run before applying the patch, or immediately after.

Files touched:
- `frontend/package.json` — adds `leaflet`, `react-leaflet@4`
- `frontend/src/components/AttendanceSiteMap.jsx` — full rewrite:
  Google Maps (paid API key) → Leaflet + OpenStreetMap tiles, click-to-place
  marker (RADIUS mode) or click-to-add-vertex boundary (POLYGON mode)
- `frontend/src/pages/AttendanceSites.jsx` — default `geofenceType` is now
  `RADIUS` instead of `POLYGON`; passes `radiusMeters` into the map
- `frontend/src/utils/siteGeofence.js` — adds `polygonAreaMeters` /
  `polygonPerimeterMeters` (equirectangular shoelace formula, replaces
  Google's geometry lib)
- `frontend/src/main.jsx` — global `leaflet/dist/leaflet.css` import
- `frontend/.env.example` — drops the now-unused `VITE_GOOGLE_MAPS_API_KEY`
- `backend/src/controllers/attendance-presence.controller.js` — **deleted**
  (confirmed unreachable: never wired to any route, so
  `POST /attendance-presence/event` was already 404ing)
- `backend/src/controllers/attendance.controller.js`:
  - removes `computeFinalAttendance` (§5c outside-minutes auto-ABSENT
    logic — it also referenced an undefined `org` variable, so it already
    crashed whenever it ran)
  - §6: `exportAttendanceSheet` rewritten to accept a `startDate`/`endDate`
    range (`from`/`to` and a bare `date` still work for back-compat),
    drops the presence-timeline/site-summary sheets since presence events
    are gone
  - §7: `markSelfAttendance` and `syncOfflineAttendance` accept a
    `locationMode` (`OFFICE`/`FIELD`/`WFH`); `WFH` skips the geofence
    check and coordinates entirely
- `frontend/src/pages/MyAttendance.jsx`:
  - removes the `samplePresence` 60s-interval effect and the mid-day
    inside/outside banner (§5b/§5c)
  - §7: adds a WFH mode selector (shown before check-in) that suppresses
    the location prompt and assigned-site card when selected
  - §8: adds a check-in progress fill animation (`checkInFill`,
    `checkInFillDuration`, `startCheckInFill`/`finishCheckInFill`/
    `resetCheckInFill`) on the Check In button
- `frontend/src/pages/Attendance.jsx`:
  - §6: date-range picker (`exportRange.startDate`/`endDate`) replacing
    the single-date export
  - §7: "Working from home" badge in `LocationFlag` when
    `row.locationMode === "WFH"` and no coordinates were recorded

### §9 (offline queue) — no code change needed

`frontend/src/utils/offlineAttendance.js` needs no edits: it's already
type-agnostic (stores whatever event object it's given), so it
"simplifies" automatically once `MyAttendance.jsx` stops producing
`GEOFENCE`-typed events from the removed presence-sampling effect.
Confirm this by re-reading the file after module 05 lands — don't
edit it.

## 07 — WFH schema migration

Files: `backend/prisma/schema.prisma`, new migration at
`backend/prisma/migrations/20260916120000_attendance_location_mode/migration.sql`.

- New `AttendanceLocationMode` enum: `OFFICE`, `FIELD`, `WFH`.
- New `AttendanceRecord.locationMode` column,
  `AttendanceLocationMode @default(OFFICE)`, `NOT NULL`.

**Manual step, required:** after applying, run in an environment with
normal network access to Prisma's binary CDN:

```bash
cd backend
npx prisma migrate deploy   # applies the hand-written migration
npx prisma generate         # regenerates the client with the new field
```

Module 05's `attendance.controller.js` changes already read/write
`locationMode` assuming this migration is applied — so 05 will be
functionally broken (500s on attendance mark/sync) until 07's migration
+ generate step actually runs.

## Post-module addition: basemap + location search

Not part of the original patch set — added afterward directly to
`frontend/src/components/AttendanceSiteMap.jsx`:

- Tried switching the tile layer to CARTO Voyager tiles for consistent
  Latin-script labels worldwide — **reverted**: CARTO now requires a
  registered API key for their basemap tiles, so without one every tile
  rendered as an "API KEY REQUIRED" watermark placeholder instead of the
  map. Back to plain OpenStreetMap raster tiles
  (`{s}.tile.openstreetmap.org`), which are genuinely free with no key.
  Labels follow whatever `name` tag the underlying OSM data has for that
  area — for many Pakistani/Gulf roads that's already English. If fully
  guaranteed English-everywhere labels are needed later, that requires a
  paid/keyed provider (MapTiler, Stadia, Mapbox, etc.) — there's no free
  keyless option that guarantees it globally.
- Added a `LocationSearch` overlay (top-left, styled with Leaflet's own
  `leaflet-top`/`leaflet-control` positioning classes) that geocodes via
  OpenStreetMap's free Nominatim API (`nominatim.openstreetmap.org/search`,
  `accept-language=en`), debounced as you type or triggered on Enter.
  Picking a result flies the map there and, in RADIUS mode, places the site
  marker at that point; in POLYGON mode it only recenters — the user still
  clicks to place boundary vertices.

## Post-module addition: polygon minimum raised to 4 points, shared timezone list

- `AttendanceSites.jsx` and `AttendanceSiteMap.jsx`: minimum boundary
  points to complete a polygon site raised from 3 to 4
  (`MIN_POLYGON_POINTS` in `AttendanceSiteMap.jsx`). A triangle was
  technically valid but too rough an approximation of a real property
  line. Backend/geometry code (`siteGeofence.js`, `site-geofence.js`,
  `attendance-site.controller.js`) still accepts >=3 for point-in-polygon
  math and legacy data — only the site-creation UI enforces 4.
- Extracted the Gulf-labeled, full-world timezone list (all six GCC zones
  incl. Oman, `<optgroup>` region grouping, ~400 zones total) out of
  `Settings.jsx` into a shared `frontend/src/utils/timezones.js`. Both
  `Settings.jsx` and `AttendanceSites.jsx` now import
  `TIMEZONE_GROUPS`/`timezoneLabel` from there — previously
  `AttendanceSites.jsx` had its own plain, unlabeled dropdown with a
  hardcoded fallback list that lacked Oman/Gulf zones entirely.

## Post-module addition: working-time progress bar

New shared component `frontend/src/components/ui/WorkingTimeProgress.jsx`:

- Renders a filled progress bar (worked minutes vs. the organization's
  `workingHoursPerDay` setting) plus a text readout like "4h 12m / 8h 00m".
  Fill color is the Tailwind `accent` token (`var(--accent)`), which
  `App.jsx` already keeps in sync with `organization.primaryColor` — no
  extra wiring needed for it to follow whatever brand color an admin/CEO
  picks on the Settings page.
- Exports `effectiveWorkingMinutes()`: falls back to a live
  checkIn→checkOut (or checkIn→now) span whenever a record's
  `workingMinutes` is null, since that field is only ever populated by the
  biometric-device sync path — self-service check-in/out never sets it.
  Without this fallback the bar would stay empty for the vast majority of
  attendance records.
- Wired into `Attendance.jsx` (admin daily table — replaces the old
  "Working time" text cell in both the desktop table and mobile cards) and
  `EmployeeProfile.jsx` (under the existing "Today's shift" timeline bar).
- Removed `Attendance.jsx`'s "Work timeline" column entirely (desktop
  header/cell, mobile card, and the `AttendanceTimeline` component) — it
  rendered from a `row.timeline` field the backend's `getDailyAttendance`
  never actually populates, so it always silently showed nothing. That's
  what caused the "two columns, one blank" look next to the new progress
  bar.
- Added a day-end cap: for a still-open shift (no `checkOutAt`), the live
  running total stops advancing at 23:59:59 UTC of the record's own
  `date` instead of the raw current time, so a forgotten check-out doesn't
  silently accumulate hours into the next calendar day every time the page
  re-renders. Passed via a new `date` prop on `WorkingTimeProgress` from
  both `Attendance.jsx` (`data.date`) and `EmployeeProfile.jsx`
  (`todayRecord.date`).

## Known gaps flagged by whoever prepared these patches

1. **`.env` git-history check** (brief §1): run
   `git log --all --full-history -- backend/.env frontend/.env` against
   this repo to confirm no secret was ever committed. Not yet done.
2. **JWT payload** (brief §1) carries `companyId` alongside
   `userId`/`organizationId`/`role` — kept intentionally because
   `auth.middleware.js` and `attendance-site.controller.js` fall back to
   it. Flagged in case that's not acceptable long-term.
