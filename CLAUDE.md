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

> **Migration status (checked 2026-09-28)**: `npx prisma migrate status`
> reports all 36 migrations applied — "Database schema is up to date!" —
> including the three 2026-09-24 ones that notes further down still call
> "pending" (`20260924120000_employee_form_submission_optional_fields`,
> `20260924130000_remove_manager_role`, `20260924140000_task_project_optional`).
> `npx prisma generate` had never completed after them, so the stale
> client made `GET /api/tasks` 500 for ADMIN/CEO/MANAGEMENT once a
> project-less task existed ("Error converting field \"projectId\" …
> found incompatible value of \"null\""). **Resolved 2026-09-28**: the user
> re-ran `npx prisma generate`; the generated JS client
> (`node_modules/.prisma/client/index.js`) now matches the schema and a
> re-run of the RBAC suite confirmed Tasks loads for every role. (The
> engine `.dll.node` and the `schema.prisma` copy in that folder still
> carry older timestamps — the EPERM lock blocked only that final rename,
> which is harmless; the runtime uses the schema inlined in `index.js`.)
> Any backend process started before the regenerate still has the old
> client in memory and must be restarted.

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
  the same 500. **Update 2026-09-28**: migration confirmed deployed
  (`prisma migrate status` up to date); only `prisma generate` still
  outstanding — see the migration-status note at the top of this file.
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
    **Update 2026-09-28**: both confirmed deployed; only `prisma generate`
    still outstanding (see the note at the top of this file).
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
  **Update 2026-09-28**: the migration *is* deployed (project-less tasks now
  exist in the DB), but `prisma generate` never completed — so the stale
  client now makes `GET /api/tasks` 500 for management roles as soon as it
  reads one of those rows. See the note at the top of this file.
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

## Post-module addition: sidebar scroll indicator, 12-hour time, full timezone list

- `frontend/src/components/Sidebar.jsx`: the nav list hides its native
  scrollbar, so a thin custom scroll line (track + thumb mirroring scroll
  position/size) now renders along the rail's right edge — only when the
  list actually overflows (`useScrollIndicator` hook, `ResizeObserver`).
  Desktop sidebar only; MobileNav unchanged.
- New `frontend/src/utils/time.js` (`formatTime`, `formatDateTime`,
  `formatClock`) — every time display now passes `hour12: true`
  explicitly (browser default follows the OS locale, which gave a 24-hour
  clock on many machines): Dashboard, Attendance, MyAttendance,
  EmployeeAttendanceHistory, EmployeeProfile (check-in/out + "Shift"
  field, e.g. "9:00 AM - 6:00 PM"), AuditLog, Announcements,
  AttendanceDevices, OfflineAttendanceVerification. Native
  `<input type="time">` pickers can't be forced to 12-hour (they follow
  the OS), so each one (Settings shift/break, EmployeeProfile shift) shows
  a 12-hour readout as its `hint`.
- `frontend/src/utils/timezones.js`: added the missing `Europe` region
  (Europe zones were all falling into "Other"), a `UTC` group, and a
  merged base list so `UTC` and legacy aliases like `Asia/Calcutta` (which
  Chrome's `Intl.supportedValuesOf` omits) are always present — 425 zones
  total. Labels are now a consistent "City, Region (UTC±HH:MM)" computed
  live (DST-aware), and zones within each group are sorted by offset.

## Post-module fix: notifications opened the wrong page for some roles

Reported: in a management profile, clicking a notification "didn't open
and leads to somewhere else." Root cause: `notifyManagement` sent "New
asset request" / "New leave request" to every `MANAGEMENT_ROLES` user, but
HR/MANAGEMENT can't open `/asset-requests` and MANAGEMENT can't open
`/leave-requests` — the route guards silently redirected them to their own
profile. Employee-facing decision notifications had the same problem
(linked to management-only pages).

- `backend/src/utils/notifications.js`: `notifyManagement` takes an
  optional `moduleKey` and then only notifies roles with that module.
  Asset requests → `assetRequests` (ADMIN, CEO, IT_MANAGER — IT now gets
  these; it didn't before); leave requests → `leave` (ADMIN, CEO, HR,
  DEPARTMENT_HEAD). Tickets unchanged (still all management roles, IT
  still not included — flagged to the user, not changed).
- `leave.controller.js`: employee's leave-decision link → `/attendance/me`.
  `asset-request.controller.js`: decision/fulfilled links →
  `/employees/<employeeId>` (the profile lists their asset requests).
- `frontend/src/pages/Notifications.jsx`: whole row is clickable (was only
  the small icon), and `resolveNotificationLink` remaps already-stored
  links the viewer can't open (`/asset-requests` without the module → own
  profile; `/leave-requests` without the module → `/attendance/me`). At
  the time of the fix, 4 of 11 stored rows with those links were
  unreachable for their recipient.

## Post-module fix: deletes fully remove the row; same email can be re-added

Request: deleting something in the frontend must remove it from the DB,
and a deleted user's email must be reusable. Audit of every delete path
against the live DB's actual FK rules (`pg_constraint`):

- Employee and asset deletes were already hard deletes, and almost every
  FK to `User` is CASCADE (their attendance/leave/payroll/notifications/
  certifications/etc.) or SET NULL (records they only touched — tickets,
  audit log, reviewed-by fields, etc.). **Two RESTRICT FKs blocked it**:
  `Announcement.createdById` (anyone who had ever posted an announcement
  could never be deleted — the delete 500'd, the row and its email stayed)
  and `EmployeeFormInvitation.createdById` (dead feature). Latent at the
  time — 0 announcements existed — but would bite the first poster.
  - New migration `20260928120000_announcement_creator_set_null`:
    `createdById` nullable + `ON DELETE SET NULL` (announcement is kept,
    author cleared — the UI already shows "Management" for a null
    author). Schema: `createdById String?`, `createdBy User? … onDelete:
    SetNull`. **Deployed** (`prisma migrate deploy`) and client
    regenerated (engine-DLL rename hit the usual EPERM; JS client updated
    fine, verified via `Prisma.dmmf`).
  - `deleteEmployee` also `deleteMany`s the user's `EmployeeFormInvitation`
    rows in the same transaction.
- `cancelLeave` (`DELETE /leaves/:id`) now deletes the pending leave
  instead of setting `status: "CANCELLED"` (matches `cancelRequest` for
  asset requests, which already deleted). Returns 204.
- Re-adding the same email/serial number needs no code change once the row
  is truly gone — the `email`/`serialNumber` uniqueness is only against
  existing rows.
- Verified end-to-end inside a rolled-back transaction (nothing persisted):
  delete a user who posted an announcement → user gone, announcement kept
  with null author, notifications/leave cascaded, same email re-created
  OK; delete an asset with lifecycle history → gone, same serial re-created
  OK.
- **Deliberately left as-is** (not deletes, or too destructive to change
  without an explicit decision): marking an employee "Left Company" is a
  status change — that user still exists and still holds their email;
  removing a **sub-company** archives it (`archivedAt`) rather than hard-
  deleting, since a hard delete would wipe every user/asset/department/
  ticket/holiday/audit row in that org.

## Post-module addition: HR Reports — "Generate HR Report" module

The HR Reports page kept all its existing cards and gained a report
generator (`frontend/src/components/HrReportGenerator.jsx`, placed under
the metric cards in `HrReports.jsx`).

- **Backend**: new `backend/src/controllers/hr-report.controller.js` +
  `routes/hr-report.routes.js`, mounted at `/api/reports/hr` behind
  `requireAuth` + `requireModule("hrReports")` (ADMIN, CEO, HR) + `noStore`.
  - `GET /api/reports/hr/options` — organizations/departments/employees/
    sites for the filters, already limited to what the caller may see.
  - `GET /api/reports/hr?type=…&from&to&organizationId&departmentId&employeeId&…&format=json|csv|xlsx`
    — types `attendance`, `employees`, `leave`, `late-absence`,
    `anomalies`, `headcount`. JSON returns `{columns, rows (first 500),
    total, truncated, summary, meta}`; CSV/XLSX stream **all** rows built
    by the exact same code path, so exports always match the preview.
    Dates required for attendance/leave/late-absence/anomalies; max 366
    days.
- **Org scoping** (`authorizedOrganizations`): same rule as
  `applyOrganizationScope` — CEO, or an ADMIN whose *home* org is the main
  company, may pick any active org in the company or "all"; everyone else
  (incl. main-company HR) gets their home org only. A foreign
  `organizationId` → 403; employee/department filters are always ANDed
  with the authorized org set, so another org's ids return 0 rows.
- Reuses existing rules rather than new ones: worked time =
  `workingMinutes ?? calculateWorkingMinutes()`; late = `status LATE` or
  check-in after `shiftStart`/`shiftStartDefault` + `lateThresholdMinutes`
  (org timezone); break = overlap of the attended span with the org's
  `breakStart`–`breakEnd`; Late & Absence adds scheduled workdays with no
  record (skipping holidays, approved leave, pre-joining days — same
  "no record = absent" idea as the attendance sheet export). Times are
  12-hour in the org timezone. **No "Employee ID" column** — it was
  removed at the user's request: the app has no human-readable employee
  code (only the internal cuid, plus attendance-device user IDs that just
  13 of 32 employees have). If a real employee number is wanted later,
  it needs a new `User` field + migration.
- Print/PDF: `pdfkit` is a dependency but was never used anywhere, so
  Print/PDF opens a print-formatted copy of the preview for the browser's
  "Save as PDF" rather than adding a server-side PDF pipeline.
- Existing exports (`/api/export/*`, `/api/attendance/export`) untouched.
  No schema change, no migration.
- Verified: 45/45 API checks (HR/sub-org ADMIN org-locked, CEO
  company-wide, EMPLOYEE/MANAGEMENT 403, forged org 403, foreign employee
  0 rows, validation, every type JSON+CSV+XLSX row counts equal, filters,
  empty ranges, no-store, existing card endpoints) + company-wide totals
  vs DB (attendance 225/225, employees 30/30, leave 1/1; 0 anomaly rows
  exist in the DB yet) + 24/24 Playwright UI checks as a real HR user.

### Follow-up: date-by-date reports, late/absent colours, 5-row anomalies card

- `HrReports.jsx`: "Today's Attendance Anomalies" list is capped at 5 rows
  (`max-h-[232px]` = 5 × 36.5px rows + 4 × 12px gaps) with its own
  scrollbar; the header shows the total when there are more than 5.
- Attendance, Late & Absence and Anomalies reports are **date-grouped**
  (`DATE_GROUPED` in `hr-report.controller.js`): JSON returns
  `groupBy: "date"` and up to 5000 preview rows; the preview pages one
  date at a time (Prev/Next + date dropdown); Excel writes one sheet per
  date; Print/PDF prints one section per date on its own page. CSV stays
  flat.
- Row colours (`rowTone()` backend / `_tone` in JSON): ABSENT → red,
  LATE or "Late by N min" → yellow — in the preview, as Excel cell fills
  (`FDE2E2` / `FFF4CC`, legend on "Report info"), and in print.

## Post-module addition: failed-login alerts + self-service password reset

- **Failed-login tracking** (`auth.controller.js` `login`): new `User`
  columns `failedLoginAttempts`, `lastFailedLoginAt`, `securityAlertSentAt`.
  4 wrong passwords within 30 min → the account owner gets an email
  ("Someone is trying to access your AssetFlow account", with time, IP,
  device, and a reset link) plus an in-app `SECURITY` notification and an
  `auth.failed_login_alert` audit row — at most once per hour. A correct
  login resets the counter. The 401 body is identical for wrong password
  vs. unknown email (no account enumeration).
- **Login page** (`Login.jsx`): always shows a "Forgot password?" link;
  after 4 failed attempts (counted client-side per typed email, or
  immediately on a 429 from the rate limiter) shows a "Too many failed
  attempts" banner with a "Reset my password" button.
- **Forgot / reset password**: public `POST /auth/forgot-password`
  (always the same generic response) emails a one-time link to
  `/reset-password?token=…`, valid 1 hour; only a SHA-256 hash is stored
  in the new `PasswordResetToken` table (cascade-deleted with the user).
  `POST /auth/reset-password` sets the new password (≥8 chars), marks the
  token used, clears other pending tokens and the failed-login counter.
  Both behind the existing `authLimiter`. New public pages
  `ForgotPassword.jsx` / `ResetPassword.jsx` (shared `components/AuthCard.jsx`).
- New `backend/src/utils/mailer.js` (`sendEmail`, `appUrl`) — same SMTP_*
  vars as the project-deadline job; new optional `APP_URL` env var.
- Migration `20260928130000_failed_login_tracking_password_reset` —
  **deployed** to the DB `backend/.env` points at (38/38 applied).
- **SMTP is NOT configured in `backend/.env`** — until it is, the alert is
  in-app only (logged as "SMTP not configured") and reset links can't
  reach anyone; in development the reset link is printed to the backend
  console instead.
- Verified: 18/18 API checks (counter, alert once per cooldown, generic
  responses, token hashing/expiry/single-use, reset + re-login) using a
  temporary user that was deleted afterwards, plus 8/8 Playwright UI
  checks (link, banner after 4th failure not 3rd, email prefill, generic
  confirmation, bad/missing token handling).

## Post-module addition: site-bound attendance (project members, no WFH, outside = ABSENT)

Per a live chat request (2026-09-29):

- **Site card lists its employees**: `listSites` (`attendance-site.controller.js`)
  now returns `employees` (`{id,name,viaProject,direct}`) — direct
  `AttendanceSiteEmployee` rows **plus** members of the linked project —
  and `employeeCount` is that list's length (it previously counted direct
  assignments only, so a project-linked site showed 0). Shown as chips on
  each card in `AttendanceSites.jsx` (with a "Project" tag).
- **Site-bound employees** (assigned directly or via the site's
  non-completed project — shared `findAssignedSites()` in
  `attendance.controller.js`, now also excluding completed-project sites,
  matching `listAssignedSites`), in both `markSelfAttendance` and
  `syncOfflineAttendance`:
  - WFH check-in → 403 / rejected. `MyAttendance.jsx` hides the WFH
    selector for them and shows a notice instead.
  - Location is required (even on desktop).
  - Check-in from outside every assigned site (unless a site's geofence
    is `DISABLED`) → recorded as **ABSENT**, `autoFlagged`, with
    lat/lng/distance/site saved and an `OUTSIDE_SITE` anomaly — but
    `checkInAt` stays null, so they can check in again once inside
    (upgrading the day to PRESENT/LATE). Never downgrades an
    already-accepted check-in. This replaces the old "STRICT blocks the
    check-in outright, never marks ABSENT" behavior; STRICT vs WARNING now
    only differ for check-out (STRICT still blocks an outside check-out).
  - Applies regardless of `workLocationType` (the old `FIELD` exemption
    no longer applies to site-bound employees).
- Admin daily view already shows the recorded location for auto-flagged
  rows (`LocationFlag` in `Attendance.jsx`, "Xm away · View exact location").
- No schema change. Verified: build passes; `listSites` against the live DB
  returns the project member; WFH (403) and no-location (400) rejections
  for a real project member. The outside-site ABSENT write path was not
  executed against the live DB.

## Post-module addition: one late rule for every source, 12-hour export times

Per a live chat request (2026-09-29):

- New `backend/src/utils/attendance-rules.js`: `isLateCheckIn` /
  `resolveArrivalStatus` (late when the check-in's local minute is past
  shift start + `lateThresholdMinutes` — employee `shiftStart` wins over
  `shiftStartDefault`; 10:00 + 15 → 10:15:59 on time, 10:16 LATE; a
  threshold of 0 is honored now, the old `|| 15` turned it into 15), plus
  `formatTime12` / `formatDateTime12` for sheets.
- Used by: `markSelfAttendance`, `syncOfflineAttendance` (previously used a
  client-supplied `event.shiftStart` instead of the employee's own shift),
  **biometric** `syncAttendanceFromPunches` (covers PULL and ADMS — it
  always wrote `PRESENT` before, never LATE), and admin
  `markAttendance`/`saveDayAttendance` (marking Present on a day with a
  recorded check-in resolves to LATE if that check-in was late).
- **Bug fixed**: `saveDayAttendance` rejected `LATE`, but `Attendance.jsx`
  sends each row's current status back on Save — so any day with a late
  arrival couldn't be saved (400). `LATE` is now accepted. `Attendance.jsx`
  shows a yellow "Late" pill (display-only, no new button) and counts LATE
  as present in the header.
- Exports: attendance sheet (xlsx + csv) Check In/Out are now 12-hour in
  the org timezone (were raw ISO/UTC); Export page Tickets "Created" is
  date + 12-hour time; Inventory gained an "Added On" date + 12-hour
  column. Also fixed `export.controller.js`'s `Content-Disposition` missing
  `;` (downloads got the wrong filename). HR report exports were already
  12-hour.
- Existing records are not recalculated — only new check-ins/punches/
  admin saves apply the rule.

## Post-module fix: Employee Profile "Detailed Information" (save + no duplicates)

Per a live chat request (2026-09-29), `EmployeeProfile.jsx` + backend:

- **Edit form**: Personal Email, Father Name, Education, University,
  LinkedIn and Shift Start/End were each rendered twice (two blocks).
  Now every field appears once, grouped (Contact / Employment / Personal /
  Education / Payroll & bank) via a local `FormGroup`. **University never
  saved** — its input was bound to `editForm.University` while the form
  state and backend field are `currentUniversity`; fixed.
- **Read-only view** showed only 6 fields, so most saved data was invisible
  (and "Designation" fell back to `skill`, showing skill twice). Now shows
  every saved field once, in the same groups (`DetailGroup`); department/
  role/status/level/employee type are left to the chips above rather than
  repeated. Personal/Education gated by `showPersonalDetails`, bank/salary
  by `showFinancial` (existing lens, previously unused here).
- **`updateEmployee`**: free-text fields trimmed, blank → `null` (blank
  CNIC/bank account used to be stored as `""` via `encryptField("")`);
  name/company email required + email format checked; the duplicate-email
  check is now global and case-insensitive (`User.email` is globally
  unique, so the old org-only check let a cross-org collision through to a
  500). Removed the duplicate `personalEmail` in `MANAGEMENT_EDITABLE_FIELDS`.
- **`getEmployee`** now loads `projectMemberships` (+ project), approved
  `leaveApplications`, and the last 5 `payrollRecords` — the profile's
  Projects / Leave remaining / Recent payroll cards read these but they
  were never included, so those cards were always empty. Payroll is only
  sent to the employee themselves or `payroll`-module roles (ADMIN/CEO);
  the card is hidden when absent.
- **Certifications**: `addCertification`/`updateCertification` reject a
  duplicate (same name + institute, case-insensitive, same employee) with
  409. Frontend assigns the new id to the draft on save (a second click
  can't create a copy), keeps unsaved drafts across refetches, and shows
  save errors.
- Verified 35/35 against the live DB: every field saved and read back
  identically, blanks → null, blank name 400, cross-org email 409,
  duplicate cert 409, HR gets no payroll. The test employee was restored
  to its exact original stored values afterward (and the test cert
  deleted). No schema change.

## Post-module addition: full CRUD on the Departments page

Per a live chat request (2026-09-29). `Departments.jsx` rewritten (same
look): Create (unchanged), Read (cards + a per-card "View employees" list
via `GET /employees?department=`, gated by the `employees` module), Update
(pencil → inline rename + manager editor), Delete (confirm now states how
many employees/assets will be left without a department — FKs are
`ON DELETE SET NULL`, so they're unassigned, not deleted), plus a name
search when there are more than 3 departments. Edit/delete stay ADMIN/CEO
only (route guards unchanged).
- **Bug fixed**: the manager-option employee list only loaded while the
  "Add Department" form was open, so every card's manager dropdown was
  empty otherwise. Now loads whenever the viewer can edit.
- `department.controller.js`: a duplicate name (`@@unique([organizationId,
  name])`) on create/rename now returns 409 "A department with this name
  already exists" instead of a raw 500.
- Verified against the live DB with a temporary department (deleted
  afterward): create, duplicate 409, rename + clear manager, blank 400,
  delete 204.

## Post-module fix: Company Calendar leave visibility

Per a live chat request (2026-09-29): `getCalendarEvents`
(`dashboard.controller.js`, `GET /dashboard/events` — feeds both
`AdvancedCalendar.jsx` and the Dashboard events widget) returned every
approved leave, including the reason, to every role. Now ADMIN/CEO/HR see
all leave; every other role (incl. MANAGEMENT/DEPARTMENT_HEAD/IT_MANAGER/
EMPLOYEE) sees only their own. Birthdays/holidays/deadlines/company events
unchanged. The separate leave calendar (`GET /leave/calendar`, `leave`
module) is untouched. Verified 5/5 against a real approved leave.

## Post-module addition: dashboard greeting + org-timezone clock

Per a live chat request (2026-09-29), `Dashboard.jsx` header:
- Greeting follows the org's local time (`organization.timezone`): 05–12
  "Good Morning", 12–17 "Good Afternoon", 17–21 "Good Evening", 21–05
  "Good Night". Greeting and sun/moon re-render once a minute
  (`useOrgClock(tz, 60000)`); the timezone comes from `/auth/me`'s
  `organization.timezone` (defaults to Asia/Karachi).
- Removed the "Current organization / All organizations" scope select
  (dashboard is always `scope=organization` now); in its place,
  `components/DashboardClock.jsx` — flip-clock: four split-flap digit
  cards `[0][7] [5][6]` (12-hour, zero-padded, no seconds; a digit animates
  a real top/bottom flap flip when it changes), coloured from the theme
  tokens (`--surface-2` card, `--ink` digits — cream/dark in light mode,
  dark/light in dark mode). Small AM/PM at the top-right of the digits; the
  full weekday (`Tuesday`) and date (`29 Sep, 2026`) centred underneath —
  all computed from the org timezone. `DashboardSky` (same file)
  is a static, realistic SVG sun (limb-darkened gradient disk, corona glow,
  turbulence granulation; colour warms at dawn/dusk) or full moon (maria,
  craters, surface grain, edge shading) from 18:30–06:00, centred on the
  header card's **bottom-right corner** (460px box on desktop, 224px on
  mobile) so only its upper-left quarter rises out of the corner. Hovering
  the disk shows a small "Sun"/"Moon" label to its left (hover target
  covers only the disk; the glow stays click-through). Everything ticks
  once a minute.
- The header card is a realistic glass pane (`styles/index.css`):
  `.glass-scene` wraps `.glass-backdrop` (four blurred blobs slowly
  drifting — **neutral white/grey only since 2026-10-05**, no colour, and
  `saturate(100%)`, so it reads as clear frosted glass; the sun/moon is the
  only colour) and `.glass-panel` on
  top (low-opacity tinted fill + `backdrop-filter: blur saturate
  brightness`, bevelled edge from inset highlights/shadows, `::before`
  frosted SVG-noise grain, `::after` curved top reflection + diagonal
  streak, `.glass-rim` — a masked 1.5px gradient border, brightest
  top-left). The pane stays still (no tilt/lift — removed at the user's
  request); the only pointer reaction is light passing through it, faded
  in while the cursor is over the pane: `.glass-glow` (soft-light hot-spot
  + a diagonal streak that slides with the cursor's x, `--gxp`),
  `.glass-hotspot` (normal-blend brightening, a separate element because a
  child would inherit the soft-light group blend) and `.glass-rim-light`
  (the edge nearest the cursor lights up). `--gx`/`--gy`/`--gxp` are set
  in the section's `onMouseMove`. Text layer is `z-[2]` (above the reflection),
  the sun `z-[3]` (so its hover label still works). Dark-mode variant
  included; backdrop drift and the shine fade are off under
  `prefers-reduced-motion`.

## Post-module addition: clickable dashboard asset stat cards

Per a live chat request (2026-09-29): `StatCard` takes an optional `to`
prop (whole card becomes a `Link`). On the dashboard, only for roles with
the `inventory` module (same check as `RequireInventoryAccess`):
Total Assets → `/inventory?view=all`, Assigned Assets → `/assignments`,
Warranty Alerts → `/inventory?warranty=expiring`.
- `Inventory.jsx` reads those params: new "All" tab (lists every asset
  without picking a category — previously a category was mandatory) and a
  dismissible "Warranty expiring in 30 days" chip.
- `GET /assets` (`asset.controller.js` `listAssets`) accepts
  `warranty=expiring` — same `warrantyEnd` window as `getStats`'
  `expiringWarranties`, so the list matches the card's count (0 in the live
  DB at the time). Backend dev server needs a restart to pick it up.

## Post-module addition: dashboard Attendance Snapshot

Per a live chat request (2026-09-29): the ADMIN/CEO dashboard's "Company
snapshot" header + 4-tile metrics row (Employees / Present today /
Projects / Total assets) is replaced by
`frontend/src/components/AttendanceSnapshot.jsx`:
- "Attendance Snapshot" heading with a 7-day date strip on the right
  (opens starting at today, today selected; `<`/`>` shift the window one
  day; clicking a day selects it). Dates are `YYYY-MM-DD` keys in the org
  timezone, stepped in UTC.
- Four tinted tiles (Total Employees / Present / Late / Absent — "… Today"
  labels only when today is selected) in one row (icon on top, number at
  the bottom) in the left 60%; 2×2 below `md`.
- Right 40% (redesign to the user's mockup, same day): "Today Attendance"
  list for the selected date — everyone PRESENT/LATE, most recent check-in
  first (manual marks with no check-in time last), name (links to their profile), `+Nm`/`+Nh MMm` late badge, 12-hour
  check-in time in the org timezone, status pill. Pinned to the tiles'
  height on desktop and scrolls inside. `getDailyAttendance` rows gained
  `lateMinutes` (check-in local minute − `shiftStartMinutes`, LATE rows
  only) for this — additive, no other consumer affected.
- The "Project status" + "Attendance watch" row that used to sit inside
  this card was removed to match the mockup (announcements now follow the
  snapshot directly).
- Data: reuses `GET /attendance?date=` (`getDailyAttendance`, same roster
  as the Attendance page) — no new API. Present = PRESENT+LATE (matches
  `Attendance.jsx`), Absent = ABSENT rows (no record counts as absent) on
  scheduled workdays, only explicitly-marked ABSENT on non-workdays, 0 for
  future dates; LEAVE is never absent. Holidays aren't subtracted (the
  daily endpoint doesn't know them — same as the Attendance page).
- The four tiles are links: Total Employees → `/employees`; Present /
  Late / Absent → `/attendance?date=<selected>&status=present|late|absent`.
  `Attendance.jsx` now reads `?date=` (falls back to today; the date is
  derived from the URL, not frozen in state, so the sidebar link resets it)
  and `?status=` — a display-only filter with a dismissible "Showing: X (n)"
  chip; Save still posts every row. "absent" uses the snapshot's rule (no
  one on a future day, only explicit ABSENT on non-workdays) so the list
  matches the tile. Export range defaults to the linked date. Verified
  end-to-end against the running dev servers as a real ADMIN: 14/6/1/7
  today and 8 absent yesterday all matched their filtered lists.
- Pre-existing, unrelated: `Dashboard.jsx` calls `GET /api/alerts`, which
  has no backend route (404 on every dashboard load since commit 1dee5d7).
- Latest announcements (content/query unchanged) is passed in as
  `children` and renders under the stat tiles in the left 60% column; the
  right "Today Attendance" list is pinned to that column's full height
  (tiles + announcements) and scrolls inside.
- Verified against the live DB for 6 dates (today, past workdays, weekend,
  tomorrow) via a temporary local backend + read-only GETs, plus a
  Playwright pass for date clicks, arrows, light/dark, and no horizontal
  overflow at 820px/390px.

## Post-module addition: dashboard Project Tracker + Utilization note

Per a live chat request (2026-09-29):
- The main dashboard's bottom-row "Top Assigned Assets" card is replaced by
  `frontend/src/components/ProjectTracker.jsx` (the IT dashboard's "Latest
  Assets" card is untouched). Lists up to 4 projects (in progress → not
  started → completed, then by deadline) with status pill, client ·
  member count, and "Due …"/red "Overdue …"; below it one row of
  Completed / In progress / Not started totals. Reuses `GET /projects`
  (no new API) — same role scoping as the Projects page, and the totals
  are computed from that same list so they always match it. "View all"
  and each row link to `/projects` (there's no per-project route).
  The live DB had 0 projects at the time (empty state verified live;
  populated layout verified with sample data in a preview).
- Utilization card: a small info line under Assigned/Available explains
  it's the share of assets assigned to employees ("N assigned out of M
  total", live values).

## Post-module redesign: Attendance page (2026-09-30)

`frontend/src/pages/Attendance.jsx` rewritten to the user's mockup; every
pre-existing feature kept (permission gating, per-row Present/Absent/Leave
marking + Save, export, anomalies + Resolve, location links, working-time
bar, dashboard deep links).
- Header: title + day navigator (`<`/`>`, click the date to open a picker,
  "Today" shortcut); state lives in `?date=` (defaults to today in the
  **org** timezone — the old page used the UTC date). Leaving a day with
  unsaved marks asks to discard. "Attendance Report" = export popover
  (date range → .xlsx via the existing `/attendance/export`). "Add
  Attendance" = modal that marks one employee via the existing
  `POST /attendance/mark` (canCreate/canUpdate only).
- Three summary cards — Present (On time / Late clock-in / Early clock-in),
  Not Present (Absent / No clock-in / No clock-out / Invalid), Away (Day off
  / Time off) — each with a delta vs the previous day (second query for
  date−1). Every number is a filter (`FILTERS` map) and clicking it sets
  `?status=`, so the table always shows exactly that many rows. Absent uses
  the dashboard snapshot's rule; No clock-in = absent with no record at all;
  No clock-out = checked in, never out, past days only; Invalid =
  `autoFlagged`; Day off = no record on a non-workday; Time off = LEAVE.
  `present` (PRESENT+LATE) is kept only for the dashboard deep link.
- Toolbar: employee search, "Advance Filter" (status + department →
  `?status=`/`?dept=`), grid/list toggle (remembered in localStorage;
  phones always get cards). Table: sortable Employee / Clock-in & Out /
  Overtime / Working time / Status; Location; Note. The mockup's Picture
  column was dropped (no photo field on attendance records); Note is built
  from real data (late by, WFH, offline, biometric, self check-in, marked by).
- `getDailyAttendance` rows gained `arrivalOffsetMinutes` (signed minutes
  from shift start; negative = early), `markedById`, `offlineRecorded` —
  additive.
- Verified read-only against the running dev servers as a real ADMIN (27
  checks: every summary filter's row count = its number, search, sort,
  department filter, grid/list + persistence, day nav + discard prompt,
  future day, dashboard deep links 7/6/1 for Sep 29, .xlsx download, Add
  modal open/cancel, no mobile overflow, no page errors) + dark-mode
  screenshot. Save / Add submit were not exercised (they write).
- Pre-existing, unchanged: a check-in with no check-out shows working time
  capped at 23:59 UTC of that day (`WorkingTimeProgress`), e.g. 16h 20m.

### Follow-up (same day): simplified controls + HR/ADMIN/CEO day notes

- Removed: "Add Attendance" button/modal, the "Invalid" summary tile
  (auto-flagged rows still show the red "outside site" location link),
  the Overtime column (late/overtime times are still amber in Clock-in &
  Out), and the three per-row tick/cross/leave icon buttons. The three
  summary cards now sit in one row from `md` up.
- Status: one pill per row (`StatusMenu`); writers click it for a
  Present/Absent/Leave menu (fixed-positioned so the table's scroll
  container doesn't clip it). Still a local change until Save. Unsaved
  edits are kept in `editsRef` and re-applied when the day refetches
  (window focus, a saved note), so they're no longer lost to a background
  refetch; cleared on Save or day change.
- Search bar rebuilt as a flex row (icon beside the input, max 260px) — the
  old absolutely-positioned icon could overlap the placeholder.
- **Day notes**: new `AttendanceNote` model (`employeeId`+`date` unique,
  `authorId` SET NULL, employee CASCADE) + migration
  `20260930120000_attendance_notes` — **deployed** to the live DB (additive
  table only; `migrate diff` also showed pre-existing drift on
  `AttendancePermission` — FK/`updatedAt` default — deliberately left out).
  `prisma generate` hit the usual EPERM on the engine DLL; JS client
  verified (`prisma.attendanceNote` works). Separate table on purpose:
  writing a note never creates an AttendanceRecord or changes a status.
  `PUT /attendance/notes` {employeeId, date, note} — `requireRole("ADMIN",
  "CEO","HR")` (+ `canRead`); empty note deletes; max 500 chars.
  `getDailyAttendance` rows gained `note`, `noteAuthorName`,
  `noteUpdatedAt`. The Note column/card shows it; HR/ADMIN/CEO get an
  inline editor (add / edit / remove, shows last editor), everyone else
  read-only. The earlier auto-generated note text was dropped.
- Verified against the running dev servers (26 checks, all pass): EMPLOYEE
  and IT_MANAGER get 403 on note writes, bad date 400; removed items gone;
  cards one row at 1280/1024px; search 240px, no icon overlap; status menu
  open/choose/Escape, change stays unsaved; note add → survives reload →
  edit shows author → remove → gone after reload (one real note was
  written and removed; 0 `AttendanceNote` rows afterwards); grid view has
  both controls; no page errors. Save itself still not exercised.

### Follow-up (same day): outside-premises = LATE + auto note, Location labels, menu fix

- **Status menu / note editor position**: both popovers now render via
  `createPortal(…, document.body)` — a transformed ancestor in the layout
  made `position: fixed` resolve against it, so the menu appeared far
  from its button. Opens below the button, or flush above it when there's
  no room below.
- **Outside-premises check-in — behavior change (supersedes the
  "site-bound attendance … outside = ABSENT" section above)**: a check-in
  outside every assigned site, *or* (non-site-bound, office geofence on)
  outside the office radius, is now **accepted** with its check-in time,
  recorded as **LATE** + `autoFlagged`, with an `OUTSIDE_SITE` anomaly and
  an automatic `AttendanceNote` ("Marked attendance outside the office
  premises (Nm from X) — recorded as Late automatically. HR can change it
  to Present.", `authorId` null, appended to any existing note) —
  `addOutsidePremisesNote()`. Previously site-bound → ABSENT without a
  check-in time, and office-geofence → 403 not marked. Applies to
  `markSelfAttendance` and the offline `CHECK_IN` sync. A second outside
  check-in after an accepted one is still a 403. `MyAttendance.jsx` copy
  updated to match (check-in fill completes, message explains Late + HR
  review).
- **HR approval**: choosing Present on a flagged Late row (the menu no
  longer treats flagged Late as "already Present") + Save → PRESENT via
  `resolveArrivalStatus` (stays LATE only if the check-in time itself was
  late). `markAttendance` / `saveDayAttendance` no longer clear
  `autoFlagged`: it's the fact of *where* they checked in, so the row keeps
  showing "Outside premises" after approval.
- **Save now sends only changed rows** (from `editsRef`), not every row —
  re-sending all rows stamped "marked by <admin>" on everyone.
- **Location column**: biometric → green "On site · <device name>";
  inside a site → "On site · <site name>"; inside office geofence → "On
  site · Office"; outside → red "Outside premises · Nm away" (links to the
  exact spot); plus WFH / no location / "—" when not checked in.
  `getDailyAttendance` rows gained `siteName`, `deviceName`.
- **Pre-existing bug fixed**: the check-in presence-event insert used
  `ON CONFLICT ("clientEventId")`, but that unique index is partial
  (`WHERE "clientEventId" IS NOT NULL`), so Postgres rejected it — every
  online check-in with coordinates returned 500 *after* the record was
  saved (the client then silently re-sent it via the offline queue, and
  the anomaly/note after the insert never ran). Both presence inserts now
  include the index predicate.
- Verified with two temporary employees in the real org (office geofence
  80m; created, tested, then fully deleted — 0 real employees' records
  touched): outside check-in 200 LATE flagged + note + anomaly; inside
  PRESENT "On site · Office"; repeat outside 403; biometric row shows
  "Cyber Earth Solution"; menu anchored (incl. after scroll); approve →
  Save sends 1 row → PRESENT, still "Outside premises"; no page errors.

## Post-module addition: payslip breakdown, office-expense claims, termination

Per a live chat request (2026-09-30):

- **Payslip breakdown**: `PayrollRecord` gained `tax`, `absentDeduction`,
  `lateDeduction`, `otherDeduction`, `expenseReimbursement`, and a
  termination section (`terminationDate`, `terminationSettlement`,
  `terminationDeduction`, `terminationNote`). `deductions` is still the
  **total** of all deduction lines, so Payroll Reports is unchanged. Math
  lives in `backend/src/utils/payroll.js` (`computePayrollTotals`): net =
  base + bonus + expenses + settlement − deductions (never below 0).
  Absent = the existing unpaid-leave rule (no policy change), late = the
  existing late rule. Admin edits bonus/tax/other/termination on a DRAFT
  payslip (`PATCH /payroll/:id`); absent/late/expenses are computed.
  Follow-up same day: bonus is 0 or **≥ PKR 500** (−/+ stepper, 500 per
  click; enforced server-side too). Tax is entered as a **percentage**
  (`taxPercent`, 0–100, ±1% stepper); the backend sets
  `tax = baseSalary × taxPercent / 100` — the tax amount itself is no
  longer directly editable. `taxPercent` was first folded into
  `20260930140000_payslip_breakdown_expense_claims`, but that migration had
  **already been deployed** by then, so the column never reached the DB and
  Generate/Tax 500'd ("column PayrollRecord.taxPercent does not exist").
  Reverted that file to its applied form and moved the column to
  `20260930170000_payroll_tax_percent` (`ADD COLUMN IF NOT EXISTS`).
  Lesson: never edit a migration folder once it may have been deployed —
  check `prisma migrate status` immediately before, and add a new one.
- **Payslip PDF**: `GET /payroll/:id/pdf` (`downloadPayslipPdf`, built by
  `backend/src/utils/payslip-pdf.js` with the previously-unused `pdfkit`).
  Own payslip for anyone; someone else's needs the `payroll` module + same
  org (404 otherwise). One A4 page: org name in a brand-color header,
  employee details (bank account masked to last 4), Earnings/Deductions
  tables, net pay, a red "not a cheque / cannot be deposited" banner +
  footer, and a large diagonal "NOT VALID FOR BANK DEPOSIT" watermark.
  Unpaid payslips also say "not final". Built-in Helvetica = WinAnsi only,
  so the PDF text is ASCII. "Download PDF" button on My Payslips.
- **Month-wide tax**: "Tax" header button on the Payroll page →
  `POST /payroll/tax { month, year, taxPercent }` (ADMIN) sets the same %
  on every DRAFT payslip of that month; per-payslip Edit can still
  override.
- **Termination**: the last header button on the Payroll page (the per-row
  icon was removed at the user's request). Picking an employee opens their
  DRAFT payslip with the termination section on, or — if they have none
  this month — creates it via `POST /payroll/employee` (ADMIN), whatever
  their status — bulk Generate skips non-ACTIVE, so this is how someone
  already marked "Left Company" gets a final payslip. Base pay is **not**
  auto-pro-rated; use the termination deduction.
- **Expense claims**: new `ExpenseClaim` model + `/api/expense-claims`.
  Any employee submits title + value (+date/note) from My Payslips;
  reviewers are the new `expenseClaims` module (HR, + ADMIN/CEO via `*`),
  on the new `/expense-claims` page — **no sidebar/mobile-nav entry** (per
  user request): ADMIN/CEO open it from an "Expense claims" button (with
  pending-count badge) on the Payroll page; HR opens it from the "New
  expense claim" notification. Self-review is blocked. Approving
  assigns the claim to the expense's month — or the next month whose
  payslip is still DRAFT/not generated if that one is submitted/paid — and
  updates that DRAFT payslip immediately; Generate also sums approved
  claims. Notifications both ways.
- **My Payslips**: single-month view with ‹ Month › navigation, green
  additions / red deductions, and a collapsible "Office expenses" list +
  add form. **Bug fixed**: `/payroll/me` was wrapped in
  `RequirePayrollAccess` (ADMIN/CEO only), so regular employees could never
  open their own payslips; now open to everyone (the API already was).
  Added "My Payslips" nav for management and IT too.
- Migration `20260930140000_payslip_breakdown_expense_claims` (additive;
  backfills the breakdown on existing payslips from their lump-sum
  `deductions`). **Not yet deployed** — `prisma migrate deploy` was blocked
  by the auto-mode classifier; run it manually. JS client regenerated
  (engine-DLL rename hit the usual EPERM).

## Post-module fix: auto-absent job gaps (2026-09-30)

`services/attendance-auto-absent.service.js` already marked an ACTIVE
employee with no record ABSENT (`autoFlagged`) once a workday was half
over. Per a request that "no check-in = absent for that day", closed its
gaps: skips company **holidays** (it didn't), days before the employee's
`joiningDate` (else `createdAt`), and — today only — approved **half-day**
leave; an approved full-day leave with no record becomes LEAVE, not
ABSENT; and it now also back-fills the last **7 past days** each run, so a
day the backend was down after the cutoff is still filled in. A later
check-in the same day still overwrites the ABSENT. `isScheduledWorkday`
now reads `getUTCDay()` (dates are UTC midnight; `getDay()` shifted a day
on servers west of UTC). Dry run against the live DB (writes stubbed): 0
rows would be created — the old job had already covered recent days; 0
holidays exist, so no wrong holiday ABSENTs to clean up.

**Follow-up same day — absent days now reduce pay**: `computeAttendanceLines`
in `payroll.controller.js` counts the month's `ABSENT` attendance records
(new `PayrollRecord.absentDays`) and deducts them at the unpaid-leave daily
rate, into `absentDeduction` with unpaid leave (unpaid-leave days are LEAVE
in attendance, so no double count). Re-running **Generate** now refreshes
existing DRAFT payslips' absent/late/unpaid-leave/expense lines (manual
bonus/tax/other/termination kept); submitted/paid ones are untouched.
Migration `20260930160000_payroll_absent_days` — **not yet deployed**; the
JS client was regenerated with the column, so payroll queries fail until
`prisma migrate deploy` runs.

## Post-module addition: performance bonus, Tasks inside Projects, calendar sync, checkout automation (2026-09-30)

- **Monthly reviews** (follow-up): a review is for one calendar month
  (`month: "YYYY-MM"` → periodStart/End = 1st/last day; one review per
  employee per month, 409 otherwise). The bonus goes on **that month's**
  payslip (next open month if it's already submitted/paid), and
  `ensurePayslip` (payroll.controller.js) creates the DRAFT payslip right away
  if it doesn't exist yet (not when the employee has no base salary).
- `DISABLE_BACKGROUND_JOBS=true` starts the API without the auto-absent,
  checkout and project-deadline jobs (for test instances against the live DB).
- Verified 2026-09-30: 54/54 end-to-end checks (bonus, tasks, calendar feed,
  employee note, checkout job incl. night shift) in a temporary org, deleted
  afterwards.
- **Performance bonus**: `PerformanceReview.bonusAmount` + `bonusPayrollMonth/Year`,
  `PayrollRecord.performanceBonus` (added to net pay in `computePayrollTotals`;
  `syncPerformanceBonus`/`performanceBonusTotal` in `utils/payroll.js`, same
  pattern as expense claims). Only `payroll`-module roles (ADMIN/CEO) can set
  it; 0 or ≥ PKR 500. Goes on the current month's payslip, or the next one still
  DRAFT. Locked once that payslip is submitted/paid. Amounts are hidden from
  other performance reviewers (shown to payroll roles + the employee). Shown on
  Payroll, My Payslips and the PDF.
- **Tasks moved into Projects**: `Projects.jsx` has Projects / Tasks tabs
  (`?tab=tasks`, renders `Tasks.jsx` with `embedded`); the project details
  modal lists that project's tasks. `/tasks` redirects there; task
  notifications link there. Tasks removed from Sidebar/MobileNav for every role
  (nav label is now "Projects & Tasks" / "My Projects & Tasks").
- **Company Calendar sync**: personal `.ics` feed at
  `GET /api/calendar/feed/<userId>.<hmac>.ics` (public; HMAC of
  `User.calendarFeedToken` nonce with `JWT_SECRET`, so a leaked user row can't
  build the URL). `GET /api/calendar/feed` returns Google / Outlook.com /
  Microsoft 365 subscribe links; `POST /api/calendar/feed/reset` rotates it.
  Events come from `collectCalendarEvents` (shared with `GET /dashboard/events`,
  same leave-visibility rule; also fixed annual events created in an earlier
  year not repeating). Google/Outlook need a public URL — set
  `API_PUBLIC_URL` in production.
- **Dashboard Project Tracker** restyled to match the Employee Profile Projects card.
- **Checkout reminder + auto checkout** (`services/attendance-checkout.service.js`,
  every 5 min): after an open shift's end time (employee `shiftEnd`, else org
  `shiftEndDefault`, else start + working hours) → one "Time to check out"
  notification. If still open when that day ends (local midnight; overnight
  shifts: end + 4h) → `checkOutAt` = shift end, `autoCheckedOut`, system day
  note, notification. Last 3 days are covered, so the first run closes any
  older open shifts (12 at the time of writing).
- **Employee note / extra hours**: `AttendanceRecord.employeeNote` +
  `extraMinutes`, `PUT /attendance/self/note` (own days with a check-in, last 7
  days). Editable on My Attendance; shown in the Attendance page Note column.
- Migrations `20260930180000_performance_bonus_calendar_feed` and
  `20260930190000_attendance_checkout_reminder_employee_note` — **deployed**;
  JS client regenerated (engine DLL rename hit the usual EPERM). Restart the
  backend.

## Post-module addition: full CRUD on Inventory (2026-09-30)

- `PATCH /assets/:id` (`updateAsset`, `requireInventoryAccess`): edits name,
  category, serial (409 on duplicate), CPU/RAM/storage, dates, department;
  logs a lifecycle note + audit row. Assignment/status keep their own actions.
- `deleteAsset`: an **assigned** asset can be deleted by ADMIN/CEO only — it's
  unassigned automatically and the employee gets an "Asset removed"
  notification. IT_MANAGER still has to unassign first (400). Also clears
  `AssetRequest.fulfilledAssetId` first — that FK has no cascade rule, so
  deleting an asset that fulfilled a request used to fail.
- `Inventory.jsx`: Edit button (reuses the Add form), role-aware delete
  confirmation, success/error banners.
- "Other" removed from the default asset categories (no asset used it).
- Verified 20/20 against a temporary org (deleted afterwards).

## Post-module addition: attendance → payroll workflow (2026-10-01)

Per a live chat request ("make it user friendly, don't change the design").
No schema change, no migration. Existing APIs unchanged except where noted.

- **Payroll review before generate**: new read-only `GET /payroll/preview?month=&year=`
  (`previewPayroll`, `requireModule("payroll")` + `noStore`). Per employee
  Generate would touch (+ anyone already holding a payslip): present / late /
  absent / leave counts, paid vs unpaid leave days, missing check-outs,
  past scheduled workdays with **no** record, and the amounts — computed with
  the same `computeAttendanceLines` + `computePayrollTotals` as Generate, so
  the preview equals the real run (submitted/paid rows show stored values).
  Issues list: active employees with no base salary (skipped), pending leave
  and pending attendance corrections in the month, open check-outs, unrecorded
  days (not deducted — only ABSENT records are). `Payroll.jsx`: "Generate" →
  "Review & Generate" opens the `PayrollReview` panel; its button calls the
  unchanged `POST /payroll/generate`. CEO gets a read-only "Attendance review".
- **Attendance corrections are now a real workflow** (the table and
  create/list endpoints existed, but nothing in the UI used them and nothing
  could approve one): `PATCH /attendance/corrections/:id {decision, note}`
  (`reviewAttendanceCorrection`, attendance `canUpdate`; DEPARTMENT_HEAD own
  department only; self-review 403). Approve writes the requested times onto
  that day's existing record (upsert on `employeeId_date` — never a second
  record), re-applies the late rule, recomputes `workingMinutes`, notifies the
  employee. `createAttendanceCorrection` now validates the `attendanceId` is
  the caller's own (previously any id was accepted), requires a time, blocks a
  second pending request for the same record, and notifies attendance-module
  roles. `GET /attendance/corrections` takes `?status=` and is department-
  scoped for DEPARTMENT_HEAD. New `GET /attendance/self/corrections`.
  UI: "Correction requests" panel on `Attendance.jsx` (same style as the
  anomalies panel, Approve/Reject); "Request time correction" per day on
  `MyAttendance.jsx` (times entered in the org timezone, online only).
- **Leave Requests**: Pending/Approved/Rejected counts (one list fetch,
  filtered client-side), search, link to the employee profile, remaining
  balance for paid types (existing `/leaves/balance?employeeId=`, flagged red
  when the request exceeds it), plain-language impact ("marks these days as
  Leave", "deducted from the <Month> payslip"), reviewer + note on decided
  ones, optional reason on Reject (existing `reviewNote` field).
- Verified read-only against the live DB: preview for Sep/Oct 2026 (e.g.
  80,000 base × 3.3% = 2,640 per absent day; the one stored submitted payslip
  matches exactly), bad month 400, correction list/self/DEPARTMENT_HEAD
  scoping, review 400/404, create 400/404 for a foreign record; payroll and
  attendance row counts unchanged. Approve/reject and Generate themselves
  were **not** exercised (they write). Restart the backend to pick up the
  new routes.

### Follow-up (same day): fines + employee-note actions on the Attendance page

- New `AttendanceFine` model (one row per employee/day: `waived`,
  `extraAmount`, `reason`, `updatedById`), `PayrollRecord.fineDeduction`,
  `AttendanceRecord.employeeNoteSeenAt/SeenById`. Migration
  `20261001120000_attendance_fines_note_review` (additive) — **deployed**;
  `prisma generate` hit the usual engine-DLL EPERM, JS client verified.
- `computeAttendanceLines` skips waived days when counting LATE/ABSENT and
  sums `extraAmount` into `fineDeduction` (in `computePayrollTotals`). The
  absent-day rate moved to `utils/payroll.js` (`unpaidLeaveDailyRate`,
  `absentDayFine`) so the Attendance page shows the same amount payroll uses.
- `getDailyAttendance` rows gain `fine` (autoType/autoAmount/waived/
  extraAmount/total/payslipStatus/locked) — **HR/ADMIN/CEO only** (salary-
  derived) — and `employeeNoteSeenAt/SeenByName`.
- `PUT /attendance/fines` and `PUT /attendance/employee-note`
  (`action: seen|unseen|delete`), both `requireRole("ADMIN","CEO","HR")`.
  Fines lock once that month's payslip is submitted/paid; a manual fine needs
  a reason and notifies the employee. An employee editing their note clears
  "seen". `refreshDraftPayslip` (payroll.controller) now runs after fine
  changes, status Save/mark and approved corrections, so a DRAFT payslip is
  current without re-running Generate.
- UI: Fine column (table) / Fine row (cards) with a popover (waive, extra
  fine, reason), "Fines this day" chip; Mark seen / Seen by X / Delete under
  employee notes. Fines also shown on Payroll, My Payslips and the PDF.
- Verified 18/18 against the live DB (waive a real late day → preview late
  deduction 1500 → 1000, net +500 → reset; locked month 400; MANAGEMENT gets
  no fine data; seen/unseen restored). Left behind: 2 `attendance.fine_set`
  audit rows from that test; no fines/payslips/notifications.

### Follow-up (same day): fines moved to one header panel

Per user request the per-row Fine column/card row was removed; instead a
**Fines** button (left of "Attendance Report", HR/ADMIN/CEO only) opens a
panel to set the org-wide **late fine / day** (`Organization.lateDeductionAmount`)
and **absent fine / day** (new `Organization.absentFineAmount`, null = the
salary-banded rate; migration `20261001130000_org_absent_fine_amount` —
**deployed**). `PUT /attendance/fine-settings` (`requireRole("ADMIN","CEO","HR")`)
saves them and refreshes every DRAFT payslip (`refreshAllDraftPayslips`);
`computeAttendanceLines` uses the flat absent fine for ABSENT days (unpaid
leave keeps the salary band). The panel also shows the day's late/absent
count and fine total. The per-day `PUT /attendance/fines` endpoint (waive /
extra fine) and `AttendanceFine` table remain and are still read by payroll,
but no longer have UI. Verified 12/12 live (set 700/1000 → preview and day
view match → restored 500/salary rate).

### Follow-up (same day): salary-banded absent rate removed

Per user request the salary-based per-day rate (2.7% / 3.3% / 3.8% / 4.5%
by monthly salary — `unpaidLeaveDailyRate`/`absentDayFine`) is **gone**.
The only per-day rate is now `Organization.absentFineAmount` (Attendance
page → Fines), used for ABSENT days **and** unpaid-leave days (half for a
half day). Not set = no absent/unpaid deduction. Already paid/submitted
payslips keep their issued amounts; drafts pick it up on the next refresh.

## Post-module fix: My Attendance showed the previous user's / stale data (2026-10-01)

- Cause: `utils/offlineAttendance.js` kept the offline snapshot and assigned
  sites under one key **per browser** (`…_v1`), and `MyAttendance.jsx` loaded
  them as react-query `initialData` (treated as current; sites had a 5-min
  `staleTime`, so not even refetched). Query keys weren't user-scoped and the
  query cache was never cleared on login/logout.
- Fix: caches are now `…_v2` `{userId, savedAt, data}` and only read back for
  the same logged-in user (old v1 keys are deleted); MyAttendance uses them as
  `placeholderData` with `staleTime: 0` + `refetchOnMount: "always"`; query
  keys include `user.id` (also EmployeeProfile's assigned-sites key);
  `AuthContext` calls `queryClient.clear()` on login and logout, and
  `clearAttendanceCaches()` on logout.
- **Offline queue ownership** (found along the way): queued events had no
  owner, so on a shared device the next user's session would have synced
  another person's check-in under their own login. Events now carry
  `ownerUserId` and `getOfflineAttendanceQueue()` returns only the current
  user's (plus legacy untagged ones). Offline check-in itself is unchanged.

## Post-module change: HR can assign roles; employees can't write day notes (2026-10-01)

- **HR role changes**: `updateEmployee` lets HR change a non-ADMIN/CEO
  employee's role to any non-owner role (never ADMIN/CEO, never their own);
  `inviteEmployee` lets HR create non-owner roles. ADMIN/CEO profiles stay
  ADMIN/CEO-only (unchanged). MANAGEMENT/DEPARTMENT_HEAD still can't change
  roles. Frontend: `EmployeeProfile.jsx` (`canChangeRole`) and
  `Employees.jsx` (`canPickRole`, ADMIN/CEO filtered out of HR's list; the
  reporting-manager list now also loads for HR). Verified 8/8 refusals live
  (no writes).
- **Employee day notes removed**: `PUT /attendance/self/note` now returns
  403 ("Notes are added by HR… send a correction request"); the `SelfNote`
  editor is gone from `MyAttendance.jsx`. Employees only send correction
  requests; notes are HR/ADMIN/CEO (`PUT /attendance/notes`). Already-saved
  employee notes still show on the Attendance page with Mark seen / Delete.
  `setSelfAttendanceNote` remains in the controller, unrouted.

## Post-module fix: multi-day leave shown once in event lists (2026-10-01)

`collectCalendarEvents` (dashboard.controller.js) still emits one
EMPLOYEE_LEAVE event per day (calendar grids mark each day), but each now
carries `leaveId`, `leaveStart`, `leaveEnd` (additive). New
`frontend/src/utils/calendarEvents.js` (`groupLeaveEvents`,
`eventDateLabel`) collapses a leave to one row with its range ("Thu, Oct 15
– Mon, Oct 19 (5 days)") in Dashboard "Upcoming events", the dashboard
calendar's leave lines + event popup, and the Company Calendar "Event feed".
Verified live: October 6 rows → 2.

## Post-module redesign: Employees + Inventory pages, Reports page removed (2026-10-01)

- **Employees** (`Employees.jsx`, mockup redesign): stat tiles (Total / Active /
  On Leave / Left Company — click to filter), search + Status / Department /
  Role filters, sortable table (Employee, Status, Department, Manager, Start
  Day), Type = `workLocationType`, row actions (profile, mailto, … menu with
  Copy email / Remove), checkbox selection → export / bulk remove, CSV
  "Export List" (current filters, no phone/CNIC). Template button removed
  (endpoint kept). `listEmployees` gained `role`/`workLocationType` filters,
  `sort`/`order`, `manager {id,name}`, paged `statusCounts`; invalid
  `status` is ignored instead of 500ing.
- **Inventory** (`Inventory.jsx`, mockup redesign): "All" is the default view
  (no category needed); category tabs with icons; 4 tiles (Total with +N this
  month and 6-month sparkline, In Use, Maintenance, Lost/Disposed — click to
  filter); toolbar search, Filter by (status / department / warranty
  expiring|expired), grid/list toggle (localStorage); sortable table; … menu
  (View / Edit / Delete); bulk delete (same assigned-asset rule); numbered
  pager + 10/25/50 page size; right column Inventory Summary donut + Recent
  Activity (lifecycle events, View all → 30). New `GET /assets/summary`
  (`requireInventoryAccess`). `listAssets`: `sort`/`order`, comma-list
  `status`, `warranty=expired`, and **`assignedTo` is now a safe select** —
  it used to return the holder's full `User` row incl. password hash.
  Status labels on this page only: ASSIGNED = "In Use", REPAIR = "Maintenance".
- **Reports page removed** (`Reports.jsx` deleted, nav entries gone,
  `/reports` → redirects to `/inventory`). Its status distribution now lives
  on Inventory; its repair-spend cards were dropped (`GET
  /dashboard/repair-spend` still exists, unused). The `reports` module key
  stays — it still gates `/export`.
- Follow-ups (same day): Inventory category tabs are one scrolling row with
  ‹ › buttons (`CategoryScroller`, `.no-scrollbar` in index.css); Template
  buttons removed from both pages (template endpoints kept). List sorting
  is case-insensitive in JS (`utils/sort.js`) — Postgres put "Zain" before
  "abc". `GET /tickets` and `GET /assets/:id` also stopped sending full
  `User` rows (password hash) for `raisedBy` / `assignedTo` / event `actor`.

### Permissions + sheet import + IT dashboard (2026-10-01)

- **Adding employees = ADMIN/CEO/HR only**: `POST /auth/invite` was
  `requireManagement` (MANAGEMENT/DEPARTMENT_HEAD/IT could add people);
  now `requireRole("ADMIN","CEO","HR")`. Employee import/template likewise
  (were `requireModule("employees")`). HR may import non-owner roles (same
  rule as single add). Employees page hides Add/Import for other roles.
- **HR runs payroll**: `HR` gained `payroll` + `payrollReports` in both
  `ROLE_MODULES` copies; `generate` / `employee` / `tax` / `submit` /
  `PATCH :id` are `ADMIN,HR`. Approve / reject / mark-paid / bulk delete stay
  CEO-only; bank accounts stay masked for non-CEO. `Payroll.jsx`
  `canManagePayroll` = ADMIN or HR.
- **Import from any sheet** (`backend/src/utils/sheet.js`, used by both
  imports): `.xlsx`/`.xlsm` via exceljs (first non-empty tab; dates →
  YYYY-MM-DD; formulas/links/rich text → text), CSV with comma, semicolon
  or tab auto-detected, `.tsv`, BOM stripped. `.xls`/`.ods` get a "Save As
  .xlsx" 400. Headers matched loosely (`mapHeaders` + alias lists: "Full
  Name", "Email Address", "Serial No.", "Purchased On", …). Buttons renamed
  "Import Sheet". Employee import's duplicate-email check is now global and
  case-insensitive (`User.email` is globally unique).
- **IT_MANAGER dashboard**: the separate plain IT layout is gone; IT gets the
  same dashboard (glass header, clock, stat cards + an Under Repair card,
  Inventory Activity chart, Utilization, Recent Activities) minus
  non-inventory parts (calendar/events, Project Tracker, alerts), with Latest
  Assets and Open Support Tickets cards instead.

## Post-module addition: equipment section on the employee form (2026-10-01)

- Public employee form (`PublicEmployeeForm.jsx`) gained "Company equipment
  you have": repeatable rows (type, brand/model, serial, condition
  GOOD/NEEDS_REPAIR/DAMAGED, received on, notes; max 20) or "I don't have
  any company equipment". Stored in the existing
  `EmployeeFormSubmission.data` JSON as `{ inventory: { none, items } }` —
  no migration. Validated in `parseInventory` (employee-form.controller.js;
  the endpoint is public). Old clients without `inventory` still submit.
- HR's "Form responses" panel shows the list (`EquipmentList` in
  EmployeeForms.jsx) and "Download as inventory sheet" — a CSV whose first
  columns are the Inventory import's (name, category, serialNumber).
- Note: the inventory import can't assign assets to employees (every
  imported asset is AVAILABLE).
- Verified 12/12 against the test backend (validation, blank rows dropped,
  "none", legacy submit, HR read-back); the temp form was deleted.

## Post-module change: flat company access, CEO all-companies dashboard, quick check-in (2026-10-05)

**Supersedes every hierarchy / office-type / call-center rule in the
2026-10-05 and 2026-10-01 sections below.**

- **Access** (`backend/src/utils/organization.js`, rewritten): all companies
  in a group are equal. CEO → every company of the group; ADMIN /
  IT_MANAGER → own company + `OrganizationAccessGrant` rows; everyone else
  → own company only (grants ignored). `hierarchyRole`,
  `parentOrganizationId`, `officeType`, `User.callCenterAccess` are kept in
  the DB but no longer read anywhere. Exports: `ORG_ACCESS_SELECT`,
  `GRANTABLE_ROLES`, `canAccessOrganization`, `hasCrossCompanyAccess`,
  `accessibleOrganizations(Ids)`, `loadAccess`, `canManageCompanies` (CEO).
- **CEO only**: add company (`POST /organization/suborganizations`, flat,
  no parent), remove company (`DELETE …/:id` — not your own; also deletes
  that company's grants), `GET /organization/access-users`,
  `POST/DELETE /organization/company/:id/access`. Removed endpoints:
  `company/hierarchy`, `company/set-main`, `company/:id/office-type`,
  `call-center-admins*`. `/auth/me` sends `canManageCompanies` (was
  `canManageHierarchy`).
- Migration `20261005150000_flat_company_access` turns any remaining
  `callCenterAccess` flag into per-company grants and clears it — **not yet
  deployed** (harmless: the flag is unread, and the one flagged admin
  already had grants for every company).
- `GET /organization/comparison` now returns, per company (own local day):
  `presentToday` (PRESENT+LATE), `lateToday`, `absentToday`,
  `onLeaveToday`, `notMarkedToday`, `openTickets`, `pendingLeave`,
  `isHome`, plus the old fields; attendance rate counts LATE as present.
- Frontend: Settings → "Companies & Access" (flat cards; CEO gets access
  chips + "+ Give access…" + Remove + "Add company"); selector and
  Organization Comparison show plain names ("(yours)" / "Your company").
  New `components/CompaniesOverview.jsx` (CEO dashboard, under the header:
  "Company overview" with a dropdown — "All companies" = totals, or one
  company = its own numbers + an "Open <company>" switch button; 10 compact
  tiles — one row on xl, no table) and
  `components/QuickAttendance.jsx` (CEO/ADMIN/HR, in the dashboard header:
  Check in → `POST /attendance/self/mark`, Check out →
  `/attendance/self/offline-sync`, same query key as My Attendance; online
  only, best-effort location, errors link to My Attendance).
- Verified 37/37 read-only API checks on a temp backend (:4099) with real
  users (every role's company list = own + grants / all for CEO, foreign
  switch 403, non-CEO add/grant/list 403, CEO can't remove own company,
  old endpoints 404) + Playwright screenshots (CEO dashboard/overview/
  Settings, HR quick check-in), no page errors. Check in/out themselves
  were not clicked (they write).

## Post-module change: one grouped nav, compact header, Export page removed (2026-10-05)

- New `frontend/src/utils/navItems.js` (`navGroups(user)`) is the single
  nav list, grouped (Overview / People / Attendance & Leave / Work /
  Assets / Payroll / Reports & Admin for management; shorter sets for IT
  and employees). Each item's gate mirrors its App.jsx route guard.
  `Sidebar.jsx` (dividers when collapsed, group titles when expanded) and
  `MobileNav.jsx` (group headings) both render it, so mobile now has every
  desktop page plus Holidays, Notifications, My Account, **Dark mode**
  and Logout. Add new pages there, not in either component.
- Desktop header (`DashboardLayout.jsx`): `GlobalSearch compact` (h-8,
  max 280px), smaller bell, and a Settings gear → `/settings` for
  ADMIN/CEO (same rule as `RequireOwner`).
- **Export page removed** (`pages/Export.jsx` deleted, nav entries gone;
  `/export` redirects to `/`). Backend `/api/export/*` is untouched and
  now has no frontend caller; the `reports` module key no longer gates
  any page.
- Verified with Playwright as the real CEO (read-only): desktop collapsed/
  expanded, mobile menu top/bottom, gear → /settings, /export → dashboard,
  no page errors. (A fresh browser profile's first load reloads once for
  the service worker — seed the session after that in scripted tests.)

## Post-module change: multiple Grand Parents, hierarchy as a real tree (2026-10-05)

**Supersedes the access rules in the 2026-10-01 hierarchy section below.**
- A company group may hold any number of GRAND_PARENTs (and Parents). The
  tree is `parentOrganizationId` = the company directly above: GP → null;
  Parent → a GP; Child → a GP or a Parent (max 3 levels, validated on save).
- Access (`utils/organization.js`): CEO of any company → every company of
  the group, all Grand Parents (the only role crossing GPs). ADMIN /
  IT_MANAGER of a GP → that GP + what's under it (parent or grandparent
  check via `HIERARCHY_SELECT.parentOrganization`); of a Parent → its own
  Children; of a Child → own. HR and all other roles → own org only.
- `PATCH /organization/company/hierarchy` now takes `{ organizations: [{id,
  hierarchyRole, parentOrganizationId}] }` for **every** active org of the
  group; still GP-CEO only; at least one GP must have an active CEO.
  `POST /organization/suborganizations` takes optional `parentOrganizationId`
  (an accessible GP/Parent; defaults to home). `set-main` no longer touches
  `parentOrganizationId`. Org lists come back in tree order with `depth`.
- Settings: per-company Level + "Under" editor; "Add child company" has an
  "Under" picker. Selector labels indent by `depth`.
- Migration `20261005120000_multiple_grand_parents` drops the two
  one-per-group unique indexes and backfills the tree so access is
  unchanged (Children → the group's Parent if any, else the GP; Parent →
  GP). **Not yet deployed** — `migrate deploy` was blocked by the auto-mode
  classifier. Until it runs, the new code reads the old pointers: the
  GlobalSead (Parent) ADMIN would lose the Children that point straight at
  DeltaGulfOverseas. Deploy it before restarting the backend. No
  `prisma generate` needed (schema change is a comment only).
- Verified read-only by simulating the migration in memory on live data:
  every user's accessible-org set unchanged; with CloudNext360 made a 2nd
  GP, the DeltaGulf ADMIN no longer reaches it, the CloudNext360 ADMIN/IT
  reach only it + CostBidding, and CEO reaches all.

### Follow-up (same day): office types + call-center admins

- `Organization.officeType` (`OrganizationOfficeType`: IT_OFFICE default /
  CALL_CENTER) and `User.callCenterAccess` (default false). Migration
  `20261005130000_office_type_call_center_access` (additive) — **not yet
  deployed** (same classifier block). JS client regenerated (engine DLL
  EPERM as usual) — so the backend **will fail to start correctly until
  both migrations are deployed** (it now selects these columns).
- Rule: an ADMIN with `callCenterAccess` opens their home org + every
  CALL_CENTER of the group, no IT office — replaces their hierarchy reach
  (switcher, attendance sites, reports, comparison). The flag is ignored
  for every other role. Never lets them create/archive companies
  (`createSubOrganization` passes `callCenterAccess: false`; archive uses
  the plain hierarchy check). CEO unchanged (everything).
- CEO-only endpoints: `PATCH /organization/company/:id/office-type`,
  `GET /organization/call-center-admins`,
  `PATCH /organization/call-center-admins/:userId {enabled}` (target must
  be an ADMIN in the CEO's group). Audit rows logged.
- UI: Settings company cards get an office-type select (CEO) / badge;
  "Call center admins" list with checkboxes (CEO); selector shows
  "· Call center".
- Verified: 7/7 rule unit checks; frontend build passes.
- Both 2026-10-05 migrations were then deployed by the user.

### Follow-up (same day): simpler editor, any CEO manages the hierarchy

- `canManageHierarchy` = **any CEO** (was: CEO whose home is a Grand
  Parent — CEOs of Child companies were locked out). The "a Grand Parent
  must have an active CEO" check was dropped with it.
- Settings: the big Level/Under editor is gone. Each company card has two
  small selects — **Under** (none = Grand Parent) and office type — that
  save immediately (confirm first). The level is derived from the
  position (top = GP, under a GP = PARENT, below that = CHILD; options are
  filtered so a branch never exceeds 3 levels or loops). Call-center admins
  are chips + an "+ Add admin…" dropdown.
- "Add company": a CEO can pick "Under: none" (`parentOrganizationId:
  "NONE"`) to create a new Grand Parent; otherwise level follows the
  chosen parent.
- Remove: allowed for any non-GP company with nothing under it (was: never
  for a Parent).
- `capslock` and `abc` are separate company groups (own `companyId`, 0
  users, from self-registration), so they never appear in the
  DeltaGulfOverseas group's lists. Not changed — asked the user.
- Verified 22/22 read-only API checks on a temp backend (port 4099) with
  real users: every role loads, HR own-company only, Child-company CEO can
  manage, bad hierarchy payload 400, HR 403 on call-center admins.

### Follow-up (same day): CEO company grants; call centers no longer automatic

- New `OrganizationAccessGrant` (userId+organizationId unique, grantedById
  SET NULL, both other FKs CASCADE). Migration
  `20261005140000_organization_access_grants` (additive) — **not yet
  deployed**; JS client regenerated (EPERM on engine DLL as usual), so the
  backend fails on every request (auth middleware selects `accessGrants`)
  until it's deployed.
- Rule change in `canAccessOrganization`: ADMIN/IT_MANAGER downward reach
  now covers **IT offices only**; a call center needs a CEO grant (or the
  ADMIN "all call centers" flag). Grants work for any company of the group,
  across Grand Parents; ignored for every other role. `access` =
  `{ callCenterAccess, grantedOrganizationIds }` (`loadAccess`); req.user
  carries `grantedOrganizationIds`.
- CEO-only: `POST /organization/company/:id/access {userId}`,
  `DELETE /organization/company/:id/access/:userId` (grantee must be an
  ADMIN/IT_MANAGER of the group, not already in that company);
  `GET /organization/call-center-admins` now returns ADMINs **and**
  IT_MANAGERs with `role` + `grantedOrganizationIds`.
- Settings: each company card (CEO) shows granted people as chips (×) and
  a "+ Give access…" dropdown.
- Live impact (preview, no grants yet): every GlobalSead-branch company is
  a call center, so Bilal Kashif (DeltaGulf ADMIN) and Zain kashif
  (GlobalSead ADMIN) drop to their own company until a CEO grants them;
  Hassan Hafeez (all call centers) unchanged.
- Verified 9/9 rule unit checks; frontend build passes.

## Post-module change: company hierarchy Grand Parent → Parent → Child (2026-10-01)

**Supersedes the "second main company" section below** (its `isCoMain`
column is kept but no longer read; the endpoint `PATCH
/organization/company/second-main` is gone).

- `Organization.hierarchyRole` (`OrganizationHierarchyRole`: GRAND_PARENT /
  PARENT / CHILD, default CHILD). Migration
  `20261001150000_organization_hierarchy` — **deployed**: each group root
  → GRAND_PARENT, old `isCoMain` → PARENT (there were none), plus partial
  unique indexes `Organization_one_grand_parent_per_company` /
  `…_one_parent_per_company` on `COALESCE(companyId, id)` (not expressible
  in schema.prisma — a future `migrate diff` will list them; leave them).
  JS client regenerated (engine DLL hit the usual EPERM).
- Rules, all in `backend/src/utils/organization.js` (`canAccessOrganization`,
  `accessibleOrganizations`, `canManageHierarchy`, `hierarchyFlags`):
  ADMIN / IT_MANAGER strictly downward (GP → GP+Parent+Children; Parent →
  Parent+Children, never GP; Child → own). **CEO of any company → every
  company of the group incl. the Grand Parent** (explicit user decision,
  overriding the spec's CEO = same-as-Admin rule). HR / EMPLOYEE /
  MANAGEMENT / DEPARTMENT_HEAD → own org only. Never crosses company
  groups. Hierarchy is two designations on a flat group, so no cycles.
- Enforcement: `applyOrganizationScope` checks the X-Organization-Id target
  against the user's **home** org (`req.user.homeOrganizationId`, new) and
  returns 403; selector list (`/auth/me` → `getSelectableOrganizations`),
  `/organization/company`, comparison, sub-org create/archive, attendance
  sites (`getOrganizationScope` — also guards body/query `organizationId`),
  HR-report org picker and dashboard `?scope=company` all use
  `accessibleOrganizations`. Several of these used to key off the
  *currently selected* org instead of the home org.
- `PATCH /organization/company/hierarchy {grandParentId, parentId|null}` —
  CEO whose home org is the Grand Parent only (`canManageHierarchy`,
  surfaced to the UI as `user.canManageHierarchy`). Validates same group,
  GP ≠ Parent, new GP has an active CEO (no lock-out). New orgs (sub-org
  create) are CHILD; a new registration's root is GRAND_PARENT. GP/Parent
  can't be archived. `set-main` (re-roots companyId only) is now GP-CEO only
  and has no UI.
- UI: company selector is a tree (`treeLabels` in OrganizationSwitcher);
  Settings → "Company hierarchy" (two selects + info, editable only for the
  GP CEO; Add/Remove company hidden for Child admins); Organization
  Comparison badges; AttendanceSites org picker.
- Verified: 81/81 API/rule checks (incl. Parent→GP 403, Child→sibling 403,
  forged body/query organizationId 403, DB index refuses a 2nd GP), 14/14
  Playwright, 108/108 regression GETs across 6 roles. Hierarchy restored to
  GP = DeltaGulfOverseas, no Parent. Left behind: `organization.hierarchy_changed`
  audit rows from the tests.

## Post-module addition: second main company (2026-10-01)

- A company group (orgs sharing `companyId`) can have **two main
  companies**: the root (id = companyId, "primary") plus one CEO-chosen
  `Organization.isCoMain` (e.g. one office abroad, one in-country).
  Migration `20261001140000_organization_co_main` (additive boolean) —
  **deployed**; JS client regenerated (engine DLL hit the usual EPERM).
- All main-company checks now go through `backend/src/utils/organization.js`
  (`isPrimaryMain`, `isMainOrganization`, `canSwitchCompanyWide`,
  `canReportCompanyWide`, `MAIN_COMPANY_SELECT`) — used by
  `applyOrganizationScope`, `canSeeCompanyOrganizations`, the organization
  controller (list / create / archive / compare / `isMain` flags),
  attendance sites, HR reports and the dashboard. Rule: CEO always
  company-wide; ADMIN and IT_MANAGER of **either** main company switch
  company-wide (IT stays inventory-only via its module list); HR and all
  other roles locked to their own org.
- `PATCH /organization/company/second-main` `{ organizationId | null }`,
  CEO-only, max one per group (setting a new one clears the old; the
  primary can't be chosen; another group's org → 404). Promoting the second
  main via `set-main` clears its flag. The second main can't be archived
  until it's unset. Org payloads carry `isMain`, `isPrimaryMain`, `isCoMain`.
- UI: Settings → Company & Organizations → "Second main company" select +
  info message (CEO edits; ADMIN read-only); labels "Main company
  (second)" in Settings and Organization Comparison. `AttendanceSites.jsx`
  uses `organization.isMain` instead of its own copy of the rule.
- **Fixed along the way**: `GET /dashboard/executive` and
  `/dashboard/attendance-anomalies` with `?scope=company` returned
  company-wide data to *any* ADMIN, including sub-company ADMINs; now
  `canReportCompanyWide` (CEO, or ADMIN whose home org is a main company).
- Verified 33/35 API (2 were test-side: `/leaves` is a self-list, and the
  only other sub-company ADMIN belongs to an archived org) + 11/11
  Playwright on Settings; the test set/cleared the flag and left **no second
  main company set** — the CEO picks it in Settings. Left behind: a few
  `organization.second_main_changed` audit rows from the test.

## Post-module addition: back button on every page (2026-10-01)

- `utils/pageHistory.js` keeps an in-app stack of visited **pages**
  (sessionStorage, one entry per pathname; search/filter changes update the
  current entry; returning to the previous pathname — via our button or the
  browser's — pops). Tracked in `DashboardLayout` (`usePageHistoryTracker`),
  cleared on logout (`AuthContext`).
- `components/ui/BackButton.jsx`: goes to the previous page *with its
  filters*; with no previous page (opened directly / fresh tab) goes to the
  fallback (default `/`). Hidden on `/` and `/dashboard`.
- `PageHeader` now always renders it (`backTo` = fallback only;
  `back={false}` hides). Added to the custom headers of Attendance,
  Employees and Inventory. Pages that had no back button (Announcements,
  Payroll, Performance, Tasks) get it through `PageHeader`.
- Verified 45/45 (Playwright, read-only): profile → Employees → dashboard,
  Inventory filter kept, Attendance date changes skipped, browser back in
  step, direct-open fallback, survives refresh, exactly one back button on
  32 routes, employee role.

## Post-module addition: employee details, documents, Permanent-only leave + HR → Admin/CEO workflow (2026-10-05)

- **Schema** (migration `20261005150000_employee_details_leave_workflow` —
  **deployed**; JS client regenerated, engine DLL hit the usual EPERM):
  `User.startDate` (separate from `joiningDate`), `employmentStatus`
  (`PROBATION` default / `PERMANENT`), `permanentDate`, `passportNumber`,
  `civilNumber`, `nationality`, `agentName`, `emergencyContact{Name,
  Relationship,Phone,AltPhone,Address,Notes}`; new `EmployeeDocument`
  (bytes in the DB, kind PASSPORT / CIVIL_ID / OTHER); `LeaveStatus`
  `PENDING` **renamed** to `PENDING_HR` + new `PENDING_FINAL_APPROVAL`;
  `LeaveApplication.hrReviewedById/At/Note`. The migration set **every
  existing user to PERMANENT** (from `joiningDate`, else `createdAt`) so no
  one lost leave access; new employees start on Probation.
- Passport / civil number / emergency phones+address are encrypted like
  CNIC. All field handling is shared in `utils/employee-fields.js` (manual
  add `inviteEmployee`, `updateEmployee`, sheet import). Lists and
  `/auth/me` never carry these fields. Employment status: ADMIN/CEO/HR
  only; PROBATION clears the permanent date, PERMANENT without one = today.
- **Import / template**: every profile field (incl. dates as YYYY-MM-DD or
  DD/MM/YYYY, "9:00 AM" shifts, reporting manager by email or name — also
  rows earlier in the same sheet, salary/bank). Only name + email required;
  unreadable values are left blank and returned as `warnings`. Template
  (`GET /employees/import/template`) lists every column; a small download
  icon next to "Import Sheet" was re-added for it.
- **Documents**: `GET/POST /employees/:id/documents`,
  `GET …/:docId/file`, `DELETE …/:docId`. View: self + ADMIN/CEO/HR;
  upload/delete: ADMIN/CEO/HR (ADMIN/CEO profiles only by ADMIN/CEO).
  Type sniffed from bytes (JPG/PNG/WEBP/GIF/PDF, 5MB). Profile →
  Detailed Information shows them grouped (`components/EmployeeDocuments.jsx`).
- **Leave** (`utils/leave-policy.js`, enforced in `createLeave`): Permanent
  only; cumulative per-year cap = 1 in the first eligible month (January,
  or the permanentDate's month that year), +1 each month, reset every
  January; pending + approved count (no bypass by splitting); separate
  annual sick/casual balance check; overlap/duplicate 409; dates only in
  the current or next year, not before the permanent date. `GET
  /leaves/balance` adds `schedule`. Workflow: PENDING_HR → HR approve →
  PENDING_FINAL_APPROVAL → ADMIN **or** CEO → APPROVED (only then marked
  LEAVE in attendance); either reject → REJECTED. No self-review. If the org
  has no active HR other than the applicant, ADMIN/CEO may do the HR step.
  DEPARTMENT_HEAD can still view but no longer approves. `GET /leaves`
  rows carry `canReview`; `?mine=1` = own only (My Attendance used to show
  HR the whole org's list); `?status=PENDING` = both stages.
- Verified: 49/49 rule unit checks + 80/80 end-to-end API checks on a
  temporary org (deleted afterwards — 0 rows left), frontend build passes.

## Automated RBAC test run (2026-09-28)

There's no automated test suite in either app (`npm test` isn't
configured). `TESTPLAN.md`'s API-checkable rows were run as a script
against a local backend instance on port 4099 and the live DB, using
locally-signed JWTs for real users of each role (DEPARTMENT_HEAD skipped:
no live user holds it). Non-mutating by design: only GETs, plus write
probes aimed at nonexistent ids (a guard that passes yields 404, never a
write). **489 checks, 479 passed** on the first pass; one real bug (the
stale-Prisma-client `GET /api/tasks` 500 above) was fixed by
regenerating the client (it accounted for 3 of the 10 first-pass
failures, one per management role), and the re-run gave **482
passed**. The remaining 7 failures are test-plan
expectations that don't match intentional code behavior — see the
"2026-09-28 run" notes in `TESTPLAN.md` (ATT-13/16/17, ORG-02/03, LV-03,
EMP-11). After aligning the script with those corrected expectations (and
adding TASK-04/TASK-02 scoping, LV-03 own-balance, main-company-ADMIN
ORG-02/03, PERM-06 checks), the final API run was **498/498 passed**. A
separate static/unit pass (no DB, no network) was **100/100**:
frontend↔backend `ROLE_MODULES`/`MANAGEMENT_ROLES`/`ASSIGNABLE_ROLES`
parity, `UserRole` enum = the 7 current roles, no code references to
`MANAGER`/`SALES_HEAD`, `App.jsx` route guards vs. TESTPLAN, removed
Sales/Financial routes absent, MyAttendance eager + service-worker
navigate-only fallback, Sidebar/MobileNav gating, `time.js` 12-hour
formatting, `timezones.js` (425 zones, Europe/UTC/aliases, GCC labels),
`resolveNotificationLink` cases, and every backend notification `link`
resolving to a real frontend route. The 8 hardcoded role arrays that
remain (e.g. org-switcher `["ADMIN","CEO","IT_MANAGER"]`, Dashboard's
local `["ADMIN","CEO","HR"]`) were reviewed and all match documented
intent. Not covered: DEPARTMENT_HEAD scoping, genuinely mutating actions
(payroll generate/approve, real password resets, HR-edits-CEO), and
UI-only rows.

## Known gaps flagged by whoever prepared these patches

1. **`.env` git-history check** (brief §1): **Done 2026-09-28 — clean.**
   `git log --all --full-history` shows no real `.env` (backend, frontend,
   `connector-org-a`, `connector-org-b`) was ever committed; only the two
   `.env.example` files are tracked. A content search of all history for
   `JWT_SECRET=`/`ENCRYPTION_KEY=`/credentialed `postgres://` URLs found
   matches only in `backend/.env.example` (initial commit), and all four
   values there are placeholders that differ from the live `backend/.env`.
2. **JWT payload** (brief §1) carries `companyId` alongside
   `userId`/`organizationId`/`role` — kept intentionally because
   `auth.middleware.js` and `attendance-site.controller.js` fall back to
   it. Flagged in case that's not acceptable long-term.
