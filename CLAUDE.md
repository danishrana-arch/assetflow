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
| 07 | WFH schema migration (`AttendanceLocationMode`) | ✅ applied — migration was already deployed to the live Neon DB (`prisma migrate status` reported schema up to date); `npx prisma generate` run 2026-09-17 after stopping the dev backend to clear the Windows EPERM file lock. Verified `prisma.attendancePermission.findMany` resolves on the generated client. |

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

## Post-module addition: deployment env flags

- `frontend/.env.example`: documented `VITE_API_URL` (already used in
  `src/api/client.js`, was previously undocumented — a production deploy
  that forgets to set it silently falls back to `http://localhost:4000/api`
  and every API call fails) and added `VITE_APP_ENV` (development/
  production — a general-purpose flag, not wired to any behavior yet).
- `backend/.env.example`: clarified the existing `NODE_ENV` flag's comment
  — it's already used by `error.middleware.js`, `attendance-site.controller.js`
  (hide error detail in prod) and `lib/prisma.js` (quiet query logging).
  No new variable added here, since one already existed.
- Frontend deploys to Vercel; backend deploys elsewhere (Railway/Render/
  Fly/VPS) — see chat for the full Vercel env-var setup walkthrough.

## Post-module fix: offline chunk-load crash on MyAttendance

Reported symptom: opening the app while offline (or losing connectivity
mid-session, then navigating client-side) sometimes crashed with the
ErrorBoundary's generic "Something went wrong" screen, showing "Failed to
fetch dynamically imported module" in the error detail.

Root cause: every page in `App.jsx`, including `MyAttendance` (the
offline-first check-in/check-out page), was loaded via `lazy(() =>
import(...))`. A lazy chunk is a separate network request the browser only
issues — and the service worker only caches — the first time that specific
route is opened on that device. If a field employee opens the app with a
signal, then loses it before ever opening "My Attendance" in that
session/device, the chunk fetch has nothing to fall back to and fails. On
top of that, `service-worker.js`'s fetch handler made it worse: on a cache
miss it fell back to the cached `index.html` for *any* same-origin request,
including JS/CSS assets — so a missing chunk request got back an HTML
document instead of a network error, and the browser's attempt to parse
HTML as a JS module is what actually produced the "Failed to fetch
dynamically imported module" message.

Fixes:
- `App.jsx`: `MyAttendance` is now a regular top-level `import`, not
  `lazy()` — its code (and its offline-queue utilities) ships inside the
  main bundle, so it's available the moment the app shell loads, with no
  separate fetch ever required. Confirmed via build output: no more
  `MyAttendance-*.js` chunk; main `index-*.js` grew to absorb it.
- `public/service-worker.js`: the fetch handler's cache-miss fallback to
  `index.html` now only applies to actual page navigations
  (`request.mode === "navigate"`); a missing JS/CSS asset now fails as a
  normal network error instead of getting a corrupted HTML-as-JS response.
  Bumped `CACHE_NAME` to `v2` so the new logic actually takes over (the
  `activate` handler already purges any cache key that isn't current).
- `ErrorBoundary.jsx`: detects a chunk-load-failure message and shows a
  tailored explanation — "You're offline" (page never opened on this
  device before, needs one successful online load) vs "A new version is
  available" (stale tab after a redeploy) — instead of the generic
  "Something went wrong" copy. The raw error is still shown below for
  support purposes.

**Deliberately out of scope for now** (per user request — "we can see it
later"): the same lazy-chunk-on-first-visit gap still exists for every
*other* route (Dashboard, Employees, Settings, etc.) — only `MyAttendance`
was pulled out of lazy-loading, since it's the one page explicitly meant to
work offline. A full fix for all routes would mean precaching the actual
built JS/CSS asset list in the service worker (e.g. via a proper
Workbox/`vite-plugin-pwa` precache manifest), which is a bigger, separate
piece of work.

## Post-module addition: Attendance permission matrix, MANAGER role, IT Manager cross-org access

Not part of the original patch set — added afterward directly, per a live
chat request (not a prepared `NN-*.patch`).

- **New `AttendancePermission` model** (`backend/prisma/schema.prisma`) +
  hand-written migration at
  `backend/prisma/migrations/20260917120000_attendance_permission_matrix/migration.sql`.
  **Done** — the migration was already applied to the live Neon DB; only
  `npx prisma generate` was still outstanding (blocked earlier by a Windows
  EPERM lock from the running dev backend), run 2026-09-17 after stopping
  the dev server. Confirmed `prisma.attendancePermission.findMany` resolves
  on the regenerated client, fixing the `Cannot read properties of
  undefined (reading 'findMany')` crash in `getAttendancePermissions`.
- Role-based, full-CRUD Attendance permission matrix, editable by
  ADMIN/CEO/MANAGER from Settings → "Attendance permission matrix" (replaces
  what used to be a static, non-functional placeholder table in the same
  spot). Backend: `backend/src/utils/permissions.js` (`getAttendancePermission`,
  `requireAttendancePermission`), `backend/src/controllers/permissions.controller.js`,
  wired into `backend/src/routes/organization.routes.js`
  (`/organization/attendance-permissions*`) and
  `backend/src/routes/attendance.routes.js` (replaces the old binary
  `requireAttendanceAccess` middleware, which is now deleted). Roles with no
  explicit row default to: HR → read-only; everyone else → the legacy
  per-user `canManageAttendance` flag if set, else no access. Frontend:
  `frontend/src/pages/Attendance.jsx` now fetches its own effective
  permission (`/organization/attendance-permissions/me`) instead of a
  hardcoded role check, and hides the Mark/Save/Resolve controls for
  read-only viewers.
- **`MANAGER` role fix**: the Prisma `UserRole` enum has always included
  `MANAGER`, but no role-list constant anywhere in the app (frontend or
  backend `utils/roles.js`) included it — they used the string
  `"MANAGEMENT"` instead, which isn't a valid enum value. A user assigned
  `MANAGER` therefore had no elevated access anywhere. Added `"MANAGER"`
  alongside `"ADMIN"`/`"CEO"` everywhere a hardcoded full-access role list
  existed (both `utils/roles.js` files, `RequireOwner`/`isOwner`-style route
  and nav gates, `requireRole(...)` calls, inventory/project/task/
  certification/biometric/announcement access checks, etc.) — deliberately
  left the pre-existing `"MANAGEMENT"` entries alone rather than renaming
  them, so no other role's behavior changed. Did **not** extend role-
  reassignment privileges (who can change another user's role) to `MANAGER`
  — that stays ADMIN/CEO-only as a deliberate scope decision, since it's a
  privilege-escalation-sensitive action distinct from general CRUD.
- **IT Manager cross-org access**: an `IT_MANAGER` whose home organization
  *is* the main company (same `isMainCompany` check already used for a
  main-company `ADMIN`) can now switch organizations via the same
  `X-Organization-Id` mechanism, in `backend/src/middleware/auth.middleware.js`
  (`applyOrganizationScope`) and `backend/src/controllers/auth.controller.js`
  (`canSeeCompanyOrganizations`). Their nav/lens stays inventory-scoped
  regardless of which org is selected (unchanged — `isIT` branches in
  `Sidebar.jsx`/`MobileNav.jsx` are role-based, not org-based). Also added a
  "My Attendance" nav link to those `isIT` branches (the route already
  worked for any authenticated role, it just had no nav entry before).
  **Fixed an edge case this surfaced**: the four self-service attendance
  endpoints in `backend/src/controllers/attendance.controller.js`
  (`markSelfAttendance`, `getSelfAttendance`, `syncOfflineAttendance`,
  `createAttendanceCorrection`) used to trust `req.user.organizationId`
  directly, which `applyOrganizationScope` can reassign for the duration of
  a request — so marking your own attendance while viewing a switched org
  would have recorded it against that org instead of your real employer.
  All four now re-resolve the employee's actual `organizationId` from their
  `User` row first.

## Post-module addition: role → module permission matrix (strict lockdown)

Not part of the original patch set — added afterward directly, per a live
chat request. Replaces the old flat `MANAGEMENT_ROLES` bucket (ADMIN, CEO,
MANAGER, SALES_HEAD, HR, MANAGEMENT, DEPARTMENT_HEAD all treated as
functionally identical almost everywhere) with a real per-role module map.

- **New single source of truth**: `ROLE_MODULES` + `hasModuleAccess(role,
  moduleKey)`, defined in both `backend/src/utils/roles.js` and
  `frontend/src/utils/roles.js` (hand-mirrored — no shared package between
  the two apps, so the two must be kept in sync by hand going forward).
  `"*"` means unrestricted. CEO and ADMIN both get `"*"`. Everyone else gets
  a fixed list:
  - `MANAGER` ("Finance Manager"): `payroll`, `payrollReports`.
  - `HR`: `employees`, `employeeForms`, `certifications`, `attendance`,
    `leave`, `hrReports`.
  - `MANAGEMENT`: `employees`, `projects`, `tasks`, `attendance`,
    `performance`, `reports`.
  - `DEPARTMENT_HEAD`: `departments`, `employees`, `attendance`,
    `projects`, `tasks`, `leave` — **and** these are the first roles with
    real own-department data scoping (see below), not just nav-level
    gating.
  - `IT_MANAGER`: `inventory`, `assets`, `assetAssignments`,
    `assetRequests`, `tickets` — deliberately nothing else. The backend
    lets it call `GET /employees` for the redacted asset-assignment picker
    Assignments.jsx depends on (`stripForIT` in `employee.controller.js`),
    server-side field redaction doing the real work either way.
    **Correction (2026-09-23)**: the first pass of this rewrite also
    dropped `IT_MANAGER` from the *frontend's* `canViewEmployeeDirectory`
    (gating the `/employees` page/nav link itself), reasoning it was only
    an API-level exception for the picker — but IT's own Sidebar/MobileNav
    has always had an "Employees & Assets" link pointing at that exact
    page, and it broke: clicking it redirected IT away. Restored the
    `role === "IT_MANAGER"` exception in `frontend/src/utils/roles.js`,
    matching the backend's `EMPLOYEE_DIRECTORY_ROLES`. This page *is* IT's
    asset-assignment view, not an HR directory — the redaction already
    keeps it to name/email/phone/role/status/photo/department/
    assignedAssets, same fields Assignments.jsx's picker gets.
- **Backend enforcement**: new `requireModule(moduleKey)` /
  `requireModuleOrSelf(moduleKey)` middleware in `auth.middleware.js`,
  replacing `requireManagement`/ad hoc role arrays on: payroll list,
  employee list/import/reset-password/edit, certifications, employee
  forms, departments CRUD, project/task management actions, leave
  review/calendar, holidays, exports (each of the 4 export types gated by
  its own module now, not one blanket check). Also fixed two real gaps
  this surfaced: `IT_MANAGER` could see "Asset Requests" and
  "Support/Tickets" in its own nav but got 403 reviewing/fulfilling a
  request or updating/deleting a ticket, because those actions were
  gated by `requireManagement`, which never included `IT_MANAGER`
  (`asset-request.routes.js`, `ticket.routes.js`,
  `ticket.controller.js`'s self-scoping check).
- **Attendance permission matrix** (`backend/src/utils/permissions.js`):
  `MANAGER` removed from `ALWAYS_FULL_ATTENDANCE_ROLES` (Finance Manager
  has no Attendance module at all now, not even a configurable row).
  `MANAGEMENT` and `DEPARTMENT_HEAD` now default to full access (previously
  fell through to the generic no-access-unless-`canManageAttendance`
  fallback) since Attendance is one of their tree modules.
- **DEPARTMENT_HEAD real data scoping** (not just nav-level — approved
  explicitly over "nav-only" during the design pass): own department's
  roster only, in `employee.controller.js` (`listEmployees`, `getEmployee`)
  and `attendance.controller.js` (`getDailyAttendance`,
  `exportAttendanceSheet`); own department's `Department` row only, in
  `department.controller.js`; projects/tasks scoped to "has a member from
  my department" via a new `isProjectInDepartmentScope`/
  `isTaskProjectInDepartmentScope` check in `project.controller.js` /
  `task.controller.js` (blocks reaching an out-of-scope project/task by
  guessing its id, not just hiding it from lists); leave scoped the same
  way in `leave.controller.js` (`listLeaves`, `getLeave`, `getLeaveCalendar`,
  `reviewLeave`). `Departments.jsx` also gates create/rename/reassign-manager
  UI to ADMIN/CEO only now — a DEPARTMENT_HEAD only ever gets their own
  department back from the API, so they get a read-only view of it.
- **`RequireOwner` narrowed** from `["ADMIN","CEO","MANAGER"]` to
  `["ADMIN","CEO"]` in `App.jsx` (Settings, Attendance Devices, Org
  Comparison, Audit Log) — Finance Manager's module list never included
  any of these; audit log in particular isn't a per-role tree module at
  all, so it's kept ADMIN/CEO-only rather than reopened to every
  management role the way `requireManagement` used to allow.
- **Mounted two previously-dead route files**: `task.routes.js` and
  `performance.routes.js` existed with working controllers but were never
  `require`d in `backend/src/index.js`, so `/api/tasks` and
  `/api/performance/:employeeId` 404'd for every role regardless of
  permissions. Both are now mounted and gated by the module map above.
- **New placeholder page/nav entry** for the one module with no underlying
  feature yet: `PayrollReports.jsx` — a thin wrapper around
  `components/ui/ComingSoonPage.jsx`, routed and nav-gated by the
  `payrollReports` module. No backend route behind it; swap in a real page
  + API when it gets built. (`Sales.jsx`/`SalesTeam.jsx`/`SalesReports.jsx`/
  `HrReports.jsx`/`FinancialReports.jsx` were also added this way
  initially, then deleted the same day — see "Post-module removal" below.)
- **Fixed pre-existing drift** between several independently-maintained
  "management role list" copies that had already diverged from each other
  (`Projects.jsx`, `AdvancedCalendar.jsx`, `AttendanceSites.jsx`,
  `attendance-site.controller.js` each had their own slightly-different
  array — one missing `MANAGER`, another missing `SALES_HEAD`) — all now
  call `hasModuleAccess`/`isManagement` instead of hardcoding their own
  list.
- **Also fixed while in `auth.controller.js`**: `canSeeCompanyOrganizations`
  let *any* ADMIN see every organization in the org-switcher, not just a
  main-company ADMIN, contradicting its own comment and the actual
  enforcement in `applyOrganizationScope` — a sub-org ADMIN would see other
  subcompanies in the switcher and get a 403 after picking one. Now
  requires `organization.id === organization.companyId` for ADMIN and
  IT_MANAGER alike, matching CEO (always full company-wide) and the
  existing enforcement point.
- **Role label**: `MANAGER` now displays as "Finance Manager" everywhere
  (`ROLE_LABELS` in `frontend/src/utils/roles.js`); `ADMIN` displays as
  plain "Admin" (was "Owner / Admin"). Also gave `MANAGER` payroll
  generate/submit/edit/delete capability in `payroll.routes.js` — Payroll
  was previously ADMIN-only despite `MANAGER` being renamed to Finance
  Manager for exactly this purpose.

## Post-module addition: TESTPLAN.md rewrite + fixes found while updating it

While rewriting `TESTPLAN.md` to match the module permission map above,
found and fixed several real inconsistencies the original rewrite missed
(not just doc updates):

- **`certification.controller.js`**: the router-level gate was updated to
  `requireModule("certifications")` (adds HR), but each of the three
  handlers (`addCertification`/`updateCertification`/`deleteCertification`)
  had its own internal `isManagement = ["ADMIN","CEO","MANAGER"]` check
  left over from before — HR would pass the router and then still get a
  403 from the handler. Now all three use `hasModuleAccess(role,
  "certifications")`.
- **`employee.controller.js`**: `getEmployee`'s certifications-field
  redaction check had the same stale hardcoded array — now
  `hasModuleAccess(role,"certifications")`.
- **`EmployeeForms.jsx`**: same pattern on the frontend — the page had its
  own `if (!["ADMIN","CEO","MANAGER"].includes(role)) return null` gate
  that would render blank for HR even after the route let them in. Now
  `hasModuleAccess(role,"employeeForms")`.
- **`biometric.controller.js`**: `management()` helper (gates
  `/settings/attendance-devices`'s API) still included `MANAGER`; Settings
  is Owner-only now, so narrowed to `["ADMIN","CEO"]` (+ legacy
  `canManageAttendance` flag, left alone).
- **`organization.routes.js`**: org comparison, sub-org create/delete, org
  settings update, and the attendance-permissions matrix (get + put) were
  all still `requireRole("ADMIN","CEO","MANAGER")` — narrowed to
  `ADMIN,CEO` to match the frontend's `RequireOwner`, which no longer
  includes `MANAGER`. The attendance-matrix narrowing also matches Finance
  Manager losing Attendance entirely — it wouldn't make sense for it to
  still configure everyone else's attendance permissions.
- **`organization.controller.js`**: `createSubOrganization`/
  `archiveSubOrganization` had their own internal `["ADMIN","CEO",
  "MANAGER"]` check + a matching error message mentioning MANAGER — now
  unreachable-for-MANAGER given the route already blocks it, but the stale
  message would have been misleading; updated to `["ADMIN","CEO"]` and the
  message text.
- **Frontend drift, not caused by this rewrite but found while auditing**:
  `Announcements.jsx`'s "create/delete" gate was hardcoded to
  `["ADMIN","CEO","MANAGER"]`, missing `SALES_HEAD/HR/MANAGEMENT/
  DEPARTMENT_HEAD` — those roles could always create/delete via the API
  (`requireManagement`, unchanged) but never saw the button. Fixed to use
  the shared `isManagement()` util. Similarly `AdvancedCalendar.jsx`'s
  "Add event" gate was missing `MANAGER` from its hardcoded list; also
  fixed to use `isManagement()`.
- `TESTPLAN.md` rewritten end-to-end against the new module map — every
  row re-verified against actual current route guards/controller checks,
  not carried over from the pre-rewrite version. New rows added for
  department-head data scoping, the two newly-mounted routes
  (tasks/performance), the 6 placeholder pages, and the IT_MANAGER
  asset-request/ticket fixes. One new **open** gap flagged rather than
  silently fixed: `PATCH /api/employees/:id` doesn't re-check a
  `DEPARTMENT_HEAD`'s own department against the target employee (unlike
  the read side, which does) — left open since fixing write-side scoping
  wasn't part of the original ask and deserves its own confirmation pass.

## Post-module fix: IT_MANAGER profile view showed "ASSETFLOW" instead of the real org name

Found while investigating a report that the decorative particle-text
banner on `/employees/:id` showed the "ASSETFLOW" placeholder instead of
the real company name — but only when opened from an `IT_MANAGER`
account (every other role saw the correct name). Root cause:
`getEmployee`'s `IT_MANAGER` branch in `employee.controller.js` redacts
the response down to an explicit allowlist of fields, and `organization`
was simply missing from that list — so `employee.organization` came back
`undefined` for every profile IT opened, and the frontend's fallback
(`employee?.organization?.name || "ASSETFLOW"`, which is correct,
working-as-designed logic) kicked in every time. Fixed by adding
`organization: { name }` (name only, nothing else) to the redacted
response.

## Post-module removal: Sales/HR/Financial Reports placeholder pages deleted

Per user direction — this deployment is HR-only, no sales-pipeline feature
was ever going to be built, so the 5 non-payroll placeholder pages added
during the permission-matrix rewrite were removed entirely rather than
left as permanent "Coming soon" stubs:

- Deleted `frontend/src/pages/Sales.jsx`, `SalesTeam.jsx`,
  `SalesReports.jsx`, `HrReports.jsx`, `FinancialReports.jsx`.
- Removed their imports/routes from `App.jsx` (`/sales`, `/sales-team`,
  `/reports/sales`, `/reports/hr`, `/reports/financial`) and their nav
  entries from `Sidebar.jsx`/`MobileNav.jsx` (including the now-unused
  `TrendingUp`/`Handshake`/`PieChart`/`FileBarChart`/`Receipt` icon
  imports).
- Removed the `sales`, `salesTeam`, `salesReports`, `hrReports`, and
  `financialReports` keys from `ROLE_MODULES` in both
  `backend/src/utils/roles.js` and `frontend/src/utils/roles.js`.
  `SALES_HEAD` is now `["projects", "tasks"]` only; `HR` lost `hrReports`;
  `MANAGER` (Finance Manager) lost `financialReports` (keeps `payroll` +
  `payrollReports`).
- **`PayrollReports.jsx` was kept** — still a "Coming soon" placeholder,
  no backend behind it, but explicitly asked to remain and eventually get
  built out for real.
- `TESTPLAN.md` and this file updated to match — the removed pages are
  documented as "REMOVED 2026-09-23" rather than deleted from the test
  plan outright, so a future run doesn't have to rediscover they're gone
  on its own.

## Post-module follow-up: HR Reports restored, SALES_HEAD role removed entirely

Same-day follow-up to the removal above, per a further user request: "HR
Reports is a real part of the app, keep it — and remove the Sales Head
role, not just its pages."

- **HR Reports restored**: recreated `frontend/src/pages/HrReports.jsx`
  (same placeholder content as before), re-added the `/reports/hr` route
  in `App.jsx` (`RequireModule moduleKey="hrReports"`), re-added the nav
  link in `Sidebar.jsx`/`MobileNav.jsx` (`FileBarChart` icon), and put
  `hrReports` back on `HR`'s module list in both `backend/src/utils/roles.js`
  and `frontend/src/utils/roles.js`. Still a "Coming soon" placeholder — no
  backend behind it.
- **`SALES_HEAD` removed as a role, not just a module list**: before
  touching the schema, checked the live Neon DB for anyone still holding
  this role — found exactly one active user (Ali Sher Farooqi,
  `alex@costbidding.com`, CostBidding org). Asked the user how to handle
  it (soft-remove and leave the enum alone, vs. reassign-then-remove); the
  user reassigned that account's role themselves and confirmed removal.
  Re-checked: 0 `User` rows on `SALES_HEAD` before proceeding.
  - Also found 7 stale `AttendancePermission` rows with `role=SALES_HEAD`
    (leftover config rows from before `SALES_HEAD` was dropped from
    `CONFIGURABLE_ATTENDANCE_ROLES` in the original permission rewrite —
    never read by the app since, but still present in the table).
  - New migration `backend/prisma/migrations/20260923190000_remove_sales_head_role/migration.sql`:
    deletes those 7 stale rows, then rebuilds the `UserRole` Postgres enum
    without `SALES_HEAD` (Postgres can't drop a single enum value directly
    — standard Prisma pattern: create `UserRole_new`, repoint both
    `User.role` and `AttendancePermission.role` to it via a `USING`
    cast, rename types, drop the old one). Applied via
    `npx prisma migrate deploy` against the live Neon DB — succeeded.
  - `npx prisma generate` afterward hit the same Windows EPERM file-lock
    issue as the earlier WFH migration (module 07) — several backend dev
    processes were running and holding the query-engine `.dll.node` open.
    Auto-mode's workload-protection classifier correctly refused to let
    those be force-stopped automatically (they're the user's live dev
    servers, not stray processes) — unlike the unrelated stuck
    `git repack` process from earlier the same day, which *was* safe to
    kill since it was a detached, already-orphaned background job with no
    live owner. **Still outstanding**: run `npx prisma generate` after
    stopping the backend dev server, same as module 07's note. Verified in
    the meantime that the DB enum itself is correctly updated (raw
    `enum_range` query) and that the generated JS/TS client already
    rejects `"SALES_HEAD"` as an invalid `UserRole` value (Prisma writes
    those files before the final engine-binary rename, so this part
    completed even though the command exited non-zero) — low risk either
    way, but the binary should still be regenerated cleanly when
    convenient.
  - Removed `SALES_HEAD` from `MANAGEMENT_ROLES`/`ASSIGNABLE_ROLES` in
    both `utils/roles.js` files, from the role-select filter in
    `EmployeeProfile.jsx`, and from a hardcoded local role array gating
    "Add performance review" in `Employee360.jsx` (replaced with
    `hasModuleAccess(role,"performance")`, consistent with the rest of the
    module rewrite). Changed the `prisma/seed.js` fixture that used this
    role to `MANAGEMENT` instead (seed data, never applied to the live DB
    automatically).
  - `TESTPLAN.md` updated throughout: role table now lists 6 roles, not 7;
    the several places that said "Management (7)" now say "Management
    (6)"; rows describing SALES_HEAD-specific behavior are marked REMOVED
    with a pointer back to §0 rather than left as testable-but-wrong.

## Post-module addition: HR Reports / Payroll Reports built out for real, Payroll Reports nav-gating bug fixed, Employee Forms "Send" fixed

Per a live chat request — "don't add coming soon, make them proper."
`HrReports.jsx` and `PayrollReports.jsx` were `ComingSoonPage` placeholders
(added during the module-permission-matrix rewrite); both are now real
pages built from existing backend data:

- **HR Reports** (`frontend/src/pages/HrReports.jsx`): wires up
  `GET /dashboard/executive` (headcount, present/late today, attendance
  rate, project status breakdown — already existed, `requireManagement`,
  but wasn't consumed by any page before this) and
  `GET /dashboard/attendance-anomalies` (today's location-mismatch/
  missing-checkout/long-day flags — same, previously unused) plus
  `GET /leave/calendar` for the current month's approved leave. ADMIN/CEO
  get an "This org / Whole company" scope toggle, matching the `?scope=`
  param `getExecutiveOverview` already supported. No new backend work was
  needed for this page.
- **Payroll Reports** (`frontend/src/pages/PayrollReports.jsx`): needed a
  new backend endpoint since none existed — `GET /payroll/summary?year=`
  (`backend/src/controllers/payroll.controller.js` `getPayrollSummary`,
  routed in `payroll.routes.js` behind `requireModule("payrollReports")` +
  `noStore`). Aggregates a year's `PayrollRecord`s by month (net pay trend
  bar chart), by department, and by status (draft/pending/paid), with a
  year picker (last 5 years). Bank account numbers are never included, so
  no CEO-only masking rule is needed here (unlike `listPayroll`).
- **Payroll Reports nav-gating bug** (found while confirming both pages'
  wiring): `Sidebar.jsx` and `MobileNav.jsx` gated the "Payroll Reports"
  nav link on the `"payroll"` module key instead of `"payrollReports"` —
  harmless today only because MANAGER (the one role with `payroll`) also
  has `payrollReports`, but inconsistent with how HR Reports was wired and
  a latent trap if that ever changes. Both files now gate the link on its
  own `"payrollReports"` key, independent of the `"payroll"` link above it.
- Confirmed CEO/ADMIN access is **not** broken anywhere — both already
  resolve to `"*"` in `ROLE_MODULES` on both frontend/backend, every route
  guard in `App.jsx` (`RequireModule`/`RequireOwner`/etc.) and every nav
  gate in `Sidebar.jsx`/`MobileNav.jsx` honors that wildcard with no
  exceptions found. Nothing to fix there.

**Employee Forms "Send" was fake — actually just a `mailto:` link**: found
while investigating a report that clicking Send after creating a form
"didn't show any operation" and the employee never received anything.
Root cause: the Send button in `EmployeeForms.jsx` was a plain `<a
href="mailto:...">`, not a real API call — nothing ever happened
server-side, so if the browser had no default mail client configured the
click was a silent no-op, and even when a mail client did open it only
pre-filled a draft the HR user still had to send manually themselves.
Fixed:
- New endpoint `POST /employee-forms/:id/send` (`employee-form.controller.js`
  `sendEmployeeFormNotifications`, routed in `employee-form.routes.js`)
  validates the selected employees belong to the org, then creates real
  in-app notifications via the existing `notifyUsers` utility (same
  mechanism already used for tickets/tasks/leave/asset requests) linking
  to the public fill-out form.
  Recipients still aren't persisted on the `EmployeeForm` row itself (no
  schema change made) — the dead `EmployeeFormInvitation` model noticed
  during this pass is a candidate for that if per-recipient
  sent/opened/submitted tracking is wanted later, but that's out of scope
  for this fix.
- `EmployeeForms.jsx`: the mailto anchor is now a real button wired to a
  `useMutation` against that endpoint, with a disabled/"Sending…" state
  while in flight and an inline success/error message shown after —
  actual visible feedback either way, unlike the mailto version.
- Still only reachable from the create-form success banner in the same
  page session (pre-existing limitation, not touched by this fix) — there
  is still no "(re)send" action on an already-created form once that
  banner is gone (e.g. after a page refresh).

## Post-module addition: full CRUD on the Employee Forms page

The "Employee Forms" page previously only had Create (a form + optional
recipients), Read (list forms, view submissions), and a binary
active/inactive toggle — no way to edit a form's title/expiry, delete a
form, or remove an individual submission. Added the missing Update/Delete
operations, both for forms and for their submissions ("responses"):

- Backend (`backend/src/controllers/employee-form.controller.js`,
  `backend/src/routes/employee-form.routes.js`, both still behind
  `requireModule("employeeForms")`):
  - `PATCH /employee-forms/:id` (`updateEmployeeForm`) — edits `title`
    and/or extends `expiresAt` (via the same `expiresInDays` days-from-now
    convention `createEmployeeForm` uses). Separate from the existing
    `PATCH /employee-forms/:id/toggle`, which still only flips
    `active`.
  - `DELETE /employee-forms/:id` (`deleteEmployeeForm`) — deletes the form;
    `EmployeeFormSubmission.form` is `onDelete: Cascade` in the schema, so
    its responses go with it (surfaced in the frontend's confirm dialog).
  - `DELETE /employee-forms/:id/submissions/:submissionId`
    (`deleteEmployeeFormSubmission`) — deletes one response.
  - All three log through the existing `logAudit` helper, same as
    `createEmployeeForm`.
- Frontend (`frontend/src/pages/EmployeeForms.jsx`): each form card gets
  Edit (inline title + "extend expiry by" form, replacing the card content
  in place) and Delete buttons alongside the existing Deactivate/Copy
  link; each response in the "Form responses" panel gets a Delete button
  next to its status chip. Both deletes use `window.confirm`, matching the
  destructive-action pattern already used elsewhere (`Departments.jsx`,
  `Employees.jsx`, etc.). Added a page-level error banner (`{error &&
  !showCreate && ...}`) since delete failures need to surface even when
  the create-form panel (the previous only place `error` rendered) is
  closed.

## Post-module fix: password reset locked to ADMIN/CEO, form-submission 500, notification bell moved off the sidebar

Three fixes from a live chat request:

- **Password reset restricted to ADMIN/CEO only**: `POST /employees/:id/reset-password`
  was gated by `requireModule("employees")`, which HR/MANAGEMENT/
  DEPARTMENT_HEAD also hold (for directory access) — so any of those roles
  could reset another employee's password. Changed to
  `requireRole("ADMIN", "CEO")` in `backend/src/routes/employee.routes.js`.
  Matching frontend gate in `EmployeeProfile.jsx` (`canResetPassword`)
  changed from `hasModuleAccess(user?.role, "employees")` to an explicit
  `["ADMIN","CEO"].includes(user?.role)` check, so the button itself no
  longer renders for HR/MANAGEMENT/DEPARTMENT_HEAD either.
  **Follow-up same day**: HR asked back in, but scoped — HR can reset any
  employee's password except an ADMIN's or CEO's (that stays ADMIN/CEO
  resetting each other only). Route now allows `requireRole("ADMIN",
  "CEO", "HR")`; the actual HR-vs-target-role check lives in
  `resetPassword` (`auth.controller.js`) since it needs the *target*
  user's role, which route-level `requireRole` can't see — returns 403
  ("HR cannot reset an Admin or CEO's password") if an HR caller's target
  is ADMIN/CEO. `EmployeeProfile.jsx`'s `canResetPassword` was moved to
  after the `employee` query resolves (it previously only depended on the
  viewer's own role) and mirrors the same rule: ADMIN/CEO always sees the
  button; HR sees it only when the profile being viewed isn't ADMIN/CEO.
- **Employee-form public submission was 500ing** ("Internal server error"
  on the public fill-out form's submit button): `EmployeeFormSubmission`
  still had three required columns left over from an older,
  never-actually-wired invitation-based form flow —
  `invitationId` (unique, mandatory relation to the dead
  `EmployeeFormInvitation` model — see the "Employee Forms 'Send'"
  section above, which already flagged that model as dead but didn't
  realize it was still enforced as required here), `data` (`Json`, no
  default), and `updatedAt` (no default, no `@updatedAt`). The current
  token-based `submitPublicEmployeeForm` controller
  (`employee-form.controller.js`) never sets any of the three, so every
  `prisma.employeeFormSubmission.create()` call failed validation before
  it ever reached the DB. Fixed in `backend/prisma/schema.prisma`:
  `invitationId`/`data` made optional, `updatedAt` given `@updatedAt` (so
  Prisma Client supplies it automatically on create, same pattern already
  used on `EmployeeForm`/`Certification`). New migration at
  `backend/prisma/migrations/20260924120000_employee_form_submission_optional_fields/migration.sql`
  drops the `NOT NULL` constraints on `invitationId`/`data`.
  **Manual step, required** (same pattern as modules 07 and the
  SALES_HEAD-removal migration): run in an environment with normal network
  access —
  ```bash
  cd backend
  npx prisma migrate deploy
  npx prisma generate
  ```
  Until this runs, the public form's submit button will keep failing with
  the same 500.
- **Notification bell moved out of the sidebar**: every role's nav rail in
  `Sidebar.jsx` had a "Notifications"/"Activity" entry buried among 10-20+
  other icons — easy to miss, and on desktop that sidebar entry was the
  *only* way to see there were unread notifications (the existing
  `NotificationBell` component was already wired up, but only rendered
  inside `Topbar.jsx`, which is `lg:hidden` — mobile-only). Removed the
  three sidebar `RailItem`s (management/IT/employee branches) and their
  now-unused unread-count query in `Sidebar.jsx`. Added `<NotificationBell
  />` to the desktop header row in `frontend/src/layouts/DashboardLayout.jsx`
  (next to the global search bar / organization switcher, `lg:flex`,
  hidden on mobile where the Topbar's own bell already covers it) — that
  layout wraps every route, so the bell is now visible up top for every
  role, CEO through employee, not just on mobile.

## Post-module addition: role badge on Employee Profile, MANAGER role removed entirely

Two more fixes from the same live chat thread:

- **Role badge on `/employees/:id`**: the profile header card (avatar, name,
  department, status/level/work-location chips) had no indication of the
  viewed employee's role anywhere. Added a small badge — reusing
  `ROLE_LABELS` from `utils/roles.js` (already imported for the role-edit
  dropdown, just not used for display) — as the first chip in that row, so
  every profile now visibly shows CEO/Admin/HR/etc. at a glance, for
  whoever's viewing it (any role, on anyone's profile they're allowed to
  open).
- **`MANAGER` ("Finance Manager") role removed entirely**, same pattern as
  the `SALES_HEAD` removal on 2026-09-23: checked the live Neon DB first —
  **0 `User` rows and 0 `AttendancePermission` rows** referenced `MANAGER`,
  so unlike `SALES_HEAD` (one live user needing reassignment), this was a
  straight removal with no data migration step beyond the enum rebuild.
  - New migration `backend/prisma/migrations/20260924130000_remove_manager_role/migration.sql`
    (same enum-rebuild pattern as the `SALES_HEAD` migration — Postgres
    can't drop a single enum value directly). **Manual step, required**,
    same as always: `cd backend && npx prisma migrate deploy && npx prisma
    generate` (this can run in the same pass as the still-outstanding
    `20260924120000_employee_form_submission_optional_fields` migration
    from earlier the same day — both are pending on the live DB).
  - Removed `MANAGER` from `UserRole` in `schema.prisma`, from
    `MANAGEMENT_ROLES`/`ASSIGNABLE_ROLES`/`ROLE_MODULES` in both
    `utils/roles.js` files, and from `ROLE_LABELS` (frontend) — "Finance
    Manager" no longer exists as a label or a role.
  - Since `MANAGER` held `payroll`+`payrollReports` only, and ADMIN/CEO
    already cover every module via the `"*"` wildcard, nothing lost access
    to Payroll/Payroll Reports as a result — those pages simply have one
    fewer role that could reach them.
  - Backend cleanup: `payroll.routes.js` narrowed `generate`/`submit`/
    `PATCH :id` from `ADMIN,MANAGER` to `ADMIN` only, and `DELETE :id` from
    `ADMIN,CEO,MANAGER` to `ADMIN,CEO`; `search.controller.js` dropped a
    redundant `|| role === "MANAGER"` (already covered by
    `MANAGEMENT_ROLES.includes(role)` before `MANAGER` was in that list, so
    this was dead weight even before removal). Stale explanatory comments
    referencing "MANAGER (Finance Manager) is deliberately excluded" were
    cleaned up in `auth.middleware.js`, `attendance-site.controller.js`,
    `organization.routes.js`, `biometric.controller.js`, and
    `utils/permissions.js` — none of these needed functional changes, since
    `MANAGER` was already excluded from all of their role arrays before
    today (Attendance/Inventory/Settings/Org-settings were never part of
    its module list to begin with).
  - Frontend cleanup: every remaining hardcoded role array that still
    listed `"MANAGER"` alongside the shared-util-driven ones —
    `EmployeeProfile.jsx`'s inline role-select filter, `Payroll.jsx`'s
    `canManagePayroll`, `Dashboard.jsx`'s locally-defined `isManagement`/
    `isManager` (these duplicate-list-drift variables were flagged as a
    known pattern during the earlier module-permission-matrix rewrite —
    this is another instance of the same drift, fixed the same way: just
    dropped `MANAGER` rather than rewiring to the shared `isManagement()`
    util, to keep this change minimal), and `Settings.jsx`'s
    `canEditSchedule`/`isOwnerTier`.
  - `TESTPLAN.md`: added a removal banner in §0 (same treatment as the
    `SALES_HEAD` banner), updated the role table (6 roles now, not 7) and
    the "Owner"/"Management (N)"/"Payroll module"/"Inventory module" group
    definitions. Unlike the `SALES_HEAD` removal, did **not** do a full
    end-to-end rewrite of every individual test row still mentioning
    `MANAGER`/"Finance Manager" (~50 rows) — those are flagged as
    historical via the banner instead, since a full rewrite wasn't part of
    this request. A future pass revisiting `TESTPLAN.md` in full should
    fold those in properly.

## Post-module fix: Performance page 404, Tasks page silent no-op

Reported as "Task page, Performance page are not working properly," with a
screenshot of `Performance` showing "Route not found: POST
/api/performance" on submit.

- **Performance page — real route-shape bug**: `performance.routes.js`
  only ever defined `GET/POST /performance/:employeeId` (built for
  `Employee360.jsx`, which correctly posts to `/performance/${id}`). The
  separate standalone `Performance.jsx` page (linked from the sidebar as
  "Performance"/"My Performance", with its own employee picker + org-wide
  list) was written against a completely different, flat-collection API
  shape — `GET /performance` to list, `POST /performance` with
  `employeeId` in the body to create — that never actually existed
  server-side. The list call 404'd silently (React Query just left
  `reviews` as its `[]` default, so the page looked merely empty rather
  than broken); the create call surfaced the "Route not found" error
  visibly, which is what the screenshot caught.
  Fixed by adding the missing shape rather than changing the page:
  `performance.controller.js` gained `listAllPerformanceReviews` (org-wide
  for management, self-only otherwise — same visibility rule as the
  per-employee route, just without requiring an `employeeId` in the URL)
  and `createPerformanceReviewForEmployee` (same validation/creation logic
  as the existing per-employee create, refactored into a shared
  `createReview()` helper, just reading `employeeId` from the body).
  `performance.routes.js` now has both `GET/POST /` (new, backs
  `Performance.jsx`) and `GET/POST /:employeeId` (unchanged, backs
  `Employee360.jsx`) on the same router — no path conflict, since Express
  only matches `/:employeeId` when there's an actual segment. Verified
  both the management and self-view cases directly against the live DB
  before considering it fixed.
- **Tasks page — not a bug, but looked like one**: the entire database has
  **zero `Project` rows** (checked directly). `createTask` requires a
  `projectId` (a task belongs to a project), and `Tasks.jsx`'s submit
  handler silently no-op'd (`if (form.projectId && form.title.trim())
  create.mutate()`) whenever nothing was selected — with an always-empty
  "Select project" dropdown (no projects exist to populate it), clicking
  "Create task" did visibly nothing, no error, which reads exactly like "a
  broken page" even though the API layer itself was verified correct end
  to end (`listTasks`/`createTask`/`updateTask`/`deleteTask` all match
  their routes exactly — tested `listTasks` directly against the live DB
  with no error). Fixed the UX gap rather than inventing a missing
  feature: the submit handler now sets a visible inline error ("Select a
  project first." / "Task title is required.") instead of silently doing
  nothing, and the Project field shows a hint + link to the Projects page
  when there are no projects yet to pick from. The actual fix for Tasks
  being usable is creating at least one project from `/projects` — that's
  expected behavior, not something code can route around.

## Post-module addition: full CRUD on Tasks and Performance pages

Follow-up to the Task/Performance fixes above — both pages could Create,
Read, and (Tasks only) partially Update, but neither had a real Update UI
for anything but status, and neither had Delete on the review side
(Tasks already had task deletion).

- **Performance** (`backend/src/controllers/performance.controller.js`,
  `backend/src/routes/performance.routes.js`): added
  `updatePerformanceReview` (`PATCH /performance/:id`) and
  `deletePerformanceReview` (`DELETE /performance/:id`), both gated the
  same way as create (`hasModuleAccess(role,"performance")` — management
  only). Sits on the same router as the existing `GET/POST /:employeeId`
  per-employee routes with no path conflict — different HTTP methods on a
  single-segment path pattern don't collide in Express, so `Employee360.jsx`
  (which uses `/:employeeId`) is untouched. `frontend/src/pages/Performance.jsx`
  now has an Edit (pencil) and Delete (trash) button per review card,
  visible to management only; Edit swaps the card into an inline form
  (period/rating/goals/achievements/feedback — matches the create form's
  fields, employee can't be reassigned after the fact) instead of a modal,
  consistent with the Employee Forms page's edit-in-place pattern added
  earlier. Verified `updatePerformanceReview`'s validation (rejects an
  out-of-range rating) and mutation directly against the live DB, then
  reverted the test edit.
- **Tasks** (`frontend/src/pages/Tasks.jsx`): backend `updateTask` already
  supported editing every field (title/description/priority/assignee/due
  date/estimated+actual hours) — the UI only ever exposed the status
  dropdown. Added an Edit (pencil) button next to the existing Delete
  button (both management-only), which swaps a task card into an inline
  form covering all of those fields, reusing the same `PATCH /tasks/:id`
  endpoint. Status stays as its own always-visible dropdown outside edit
  mode, since a plain assignee (not just management) is allowed to update
  status per the backend's `existing.assignedToId === userId` check, and
  folding it into the management-only edit form would have taken that away
  from them.

## Post-module addition: Task no longer requires a Project

Per a live chat request — a task should be assignable directly to
someone without first creating a project.

- `backend/prisma/schema.prisma`: `Task.projectId` changed from `String`
  to `String?`, and its `project` relation from `Project` to `Project?`.
  New migration
  `backend/prisma/migrations/20260924140000_task_project_optional/migration.sql`
  (`ALTER TABLE "Task" ALTER COLUMN "projectId" DROP NOT NULL` — the
  existing `onDelete: Cascade` on the FK is unaffected by nullability, it
  only fires when a non-null `projectId`'s project row is deleted).
  **Manual step, required** — this is now the *third* pending migration
  from this session; deploy and regenerate together:
  ```bash
  cd backend
  npx prisma migrate deploy
  npx prisma generate
  ```
  Until that runs, `createTask`/`updateTask` will still hit the live DB's
  `NOT NULL` constraint on `projectId` whenever one isn't given.
- `backend/src/controllers/task.controller.js`:
  - `createTask` no longer requires `projectId` — only `title` is
    mandatory now. The project-lookup/DEPARTMENT_HEAD-scope check only
    runs when a `projectId` is actually given.
  - **Found and fixed a real crash this change would otherwise have
    introduced**: `updateTask`'s status-change notification did
    `` `${task.project.name}: ...` `` unconditionally — would throw
    "Cannot read properties of null (reading 'name')" on any project-less
    task the moment its status changed. Now falls back to just the task
    title when there's no project. Same fix applied to `createTask`'s
    "New task assigned" notification.
  - **Found and fixed the DEPARTMENT_HEAD scoping gap this change opened
    up**: `updateTask`/`deleteTask` both scoped a DEPARTMENT_HEAD strictly
    via `isTaskProjectInDepartmentScope(task.projectId, ...)` — called
    with `projectId: null` this always returned `false` (no
    `ProjectMember` row has a null `projectId`), meaning a DEPARTMENT_HEAD
    would get a 404 "Task not found" trying to edit or delete *any*
    project-less task, even ones assigned to their own department's
    member. Replaced with a new `isTaskInDepartmentScope(task, ...)`
    helper that scopes on whichever signal the task actually has: project
    membership (unchanged), the assignee's own department (new, for a
    project-less-but-assigned task), or — for a task with neither project
    nor assignee — whether this department head created it themselves (so
    their own fully-unscoped tasks don't 404 out from under them either).
    `listTasks`'s DEPARTMENT_HEAD `OR` filter got the same third clause
    added, for the same reason (a self-created, project-less, unassigned
    task would otherwise vanish from their own list the instant they made
    it).
  - `updateTask` also gained a `projectId` field (management-only, same
    validation as create) — a task can now have a project attached or
    removed after creation, not just at creation time.
- `frontend/src/pages/Tasks.jsx`: the create form's Project field is now
  labeled "(optional)" with a "No project — assign directly" default
  option, and no longer blocks submission when empty (only a missing
  title does, with a visible inline error — see the earlier Tasks fix
  above for why silent-no-op mattered here). The "no projects exist yet"
  hint was reworded since it's no longer a blocker. The Edit form (added
  in the CRUD pass above) gained a matching Project field. The task card
  header falls back to "No project" instead of rendering blank when
  `task.project` is null.

## Post-module addition: ADMIN/CEO profile protection

Per a live chat request: an ADMIN can't delete or remove a CEO, and only
ADMIN/CEO can make changes to an ADMIN or CEO profile.

- `employee.controller.js` `updateEmployee`: 403 if the target is ADMIN/CEO
  and the requester isn't ADMIN/CEO (blocks HR/MANAGEMENT/DEPARTMENT_HEAD,
  who hold the `employees` module). Also 403 if a non-CEO tries to change a
  CEO's `role` or `status` — demoting or marking a CEO "Left Company" is
  effectively removal, which `deleteEmployee` already restricted to CEOs
  (that delete check was already in place; unchanged).
- **Fixed a pre-existing bug along the way**: the role-change guard fired on
  *any* `role` in the request body, and `EmployeeProfile.jsx`'s edit form
  always sends the current role back unchanged — so HR/MANAGEMENT/
  DEPARTMENT_HEAD saving *any* profile edit got a 403 "Only the
  organization owner or a CEO can change roles". Now only fires when the
  role actually changes.
- `certification.controller.js`: same ADMIN/CEO-profile protection on
  add/update/delete (HR has the `certifications` module and could
  otherwise edit an ADMIN/CEO's certifications). Self is always allowed.
- `EmployeeProfile.jsx`: `canEditFully`/`canManageCertifications` now also
  require the viewer to be ADMIN/CEO (or self) when the profile is
  ADMIN/CEO; the Remove button is hidden on CEO profiles; Role select is
  disabled for non-ADMIN/CEO viewers and for an ADMIN on a CEO profile;
  Status select is disabled for a non-CEO on a CEO profile. These gates
  moved below the `employee` query since they need the target's role.
- Verified against the live DB (non-mutating — all return before any
  write): HR edit CEO, MANAGEMENT edit CEO, ADMIN deactivate CEO, ADMIN
  demote CEO, ADMIN delete CEO → all 403.

## Known gaps flagged by whoever prepared these patches

1. **`.env` git-history check** (brief §1): run
   `git log --all --full-history -- backend/.env frontend/.env` against
   this repo to confirm no secret was ever committed. Not yet done.
2. **JWT payload** (brief §1) carries `companyId` alongside
   `userId`/`organizationId`/`role` — kept intentionally because
   `auth.middleware.js` and `attendance-site.controller.js` fall back to
   it. Flagged in case that's not acceptable long-term.
