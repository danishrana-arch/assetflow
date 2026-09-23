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
  - `MANAGER` ("Finance Manager"): `payroll`, `payrollReports`,
    `financialReports`.
  - `HR`: `employees`, `employeeForms`, `certifications`, `attendance`,
    `leave`, `hrReports`.
  - `SALES_HEAD`: `sales`, `salesTeam`, `projects`, `tasks`,
    `salesReports`.
  - `MANAGEMENT`: `employees`, `projects`, `tasks`, `attendance`,
    `performance`, `reports`.
  - `DEPARTMENT_HEAD`: `departments`, `employees`, `attendance`,
    `projects`, `tasks`, `leave` — **and** these are the first roles with
    real own-department data scoping (see below), not just nav-level
    gating.
  - `IT_MANAGER`: `inventory`, `assets`, `assetAssignments`,
    `assetRequests`, `tickets` — deliberately nothing else. Confirmed and
    tightened: `EMPLOYEE_DIRECTORY_ROLES` no longer includes it for the
    *directory page*, though the backend still lets it call `GET
    /employees` for the redacted asset-assignment picker Assignments.jsx
    depends on (`stripForIT` in `employee.controller.js`) — two different
    things that were previously conflated.
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
- **New placeholder pages/nav entries** for modules with no underlying
  feature yet: `Sales.jsx`, `SalesTeam.jsx`, `SalesReports.jsx`,
  `HrReports.jsx`, `FinancialReports.jsx`, `PayrollReports.jsx` — all thin
  wrappers around a shared `components/ui/ComingSoonPage.jsx`, routed and
  nav-gated by their module key like everything else. No backend routes
  behind them; swap in a real page + API when each one gets built.
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

## Known gaps flagged by whoever prepared these patches

1. **`.env` git-history check** (brief §1): run
   `git log --all --full-history -- backend/.env frontend/.env` against
   this repo to confirm no secret was ever committed. Not yet done.
2. **JWT payload** (brief §1) carries `companyId` alongside
   `userId`/`organizationId`/`role` — kept intentionally because
   `auth.middleware.js` and `attendance-site.controller.js` fall back to
   it. Flagged in case that's not acceptable long-term.
