# AssetFlow — QA Test Plan

Summary checklist covering every page, dashboard widget, and backend API in
the app, plus who (which role) can reach each one. Compiled by reading the
actual routing/guard code (`frontend/src/App.jsx`, `Sidebar.jsx`,
`MobileNav.jsx`, `DashboardLayout.jsx`, `Dashboard.jsx`, every
`backend/src/routes/*.js`, `utils/roles.js`, `utils/permissions.js`) — not
assumed from feature names. Each row is "verify this works / is
blocked as stated," not a full step-by-step script.

For every endpoint below, also run the implicit negative case: an
unauthenticated request (no/expired token) → `401`, and a request from a
role **not** listed in "Roles with access" → `403`/redirect, not a silent
200.

## 0. Roles in the system

| Role | Notes |
|---|---|
| `ADMIN` | "Owner / Admin" label in UI. Full access almost everywhere. |
| `CEO` | Full access; sole role for payroll approve/reject/mark-paid/bulk-delete and `set-main` company. Max 3 users per org (`MAX_CEO_COUNT = 3`). |
| `MANAGER` | Same "owner" tier as ADMIN/CEO for most gates (`isOwner` = ADMIN/CEO/MANAGER). |
| `SALES_HEAD` | Management-tier for nav/attendance-directory purposes, but **not** payroll, inventory, or owner-only pages. |
| `HR` | Management-tier; payroll access; attendance read-only by default (configurable). |
| `MANAGEMENT` | Generic "management" role — same tier as SALES_HEAD for most checks. |
| `DEPARTMENT_HEAD` | Management-tier for directory/nav; not payroll/inventory owner-only pages. |
| `IT_MANAGER` | Separate track: inventory-focused nav, no payroll/attendance-grid/settings; can switch orgs only if based in the main company. |
| `EMPLOYEE` | Baseline self-service role: own profile, own attendance, own payroll link (see gap #2 below), tickets, announcements, calendar. |

Role groups referenced repeatedly below:
- **Owner** = `ADMIN, CEO, MANAGER`
- **Management (7)** = `ADMIN, CEO, MANAGER, SALES_HEAD, HR, MANAGEMENT, DEPARTMENT_HEAD`
- **Payroll-access** = `ADMIN, CEO, MANAGER, HR, MANAGEMENT`
- **Inventory-access** = `ADMIN, CEO, MANAGER, IT_MANAGER`
- **Directory-access** = Management (7) + `IT_MANAGER`

---

## 1. Authentication & Session

| ID | Feature / Endpoint | What to verify | Roles with access |
|---|---|---|---|
| AUTH-01 | `POST /api/auth/register` | Creates first org/user; rate-limited to 20 req/15min per IP | Public (no auth) |
| AUTH-02 | `POST /api/auth/login` | Valid creds → token + user; wrong creds → 401; rate-limited 20/15min | Public |
| AUTH-03 | `GET /api/auth/me` | Returns current user/org; this is the **only** call that logs the user out on 401 (per module-02 fix) — confirm a 401 from any *other* endpoint does NOT clear localStorage/redirect to login | Any authenticated |
| AUTH-04 | `POST /api/auth/invite` | Invite a new employee by email | Management (7) |
| AUTH-05 | `PATCH /api/auth/password` | Self password change; verifies `currentPassword` server-side; wrong current password rejected | Self (any authenticated) |
| AUTH-06 | Logout | Purely client-side — clears `assetflow_token`, `assetflow_user_cache`, `assetflow_active_organization`; confirm no server call is needed/made | Any authenticated |
| AUTH-07 | Session bootstrap from cache | On reload with a cached token, UI shows cached user instantly while `GET /me` runs in background | Any authenticated |
| AUTH-08 | Stale-token resilience | If `GET /me` fails with a network error/5xx/timeout (backend down), the session is **kept**, not cleared — only a real `401` clears it | Any authenticated |
| AUTH-09 | Inactivity auto-logout | No pointer/key/scroll/touch activity for 60 minutes → auto logout (checked every 15s) | Any authenticated |
| AUTH-10 | Org switch — authorized | `CEO` (any org), or `ADMIN`/`IT_MANAGER` **whose home org is the main company** can switch org via `X-Organization-Id` | `CEO`, main-company `ADMIN`/`IT_MANAGER` |
| AUTH-11 | Org switch — blocked | A sub-org `ADMIN`/`IT_MANAGER`, or any other role, forging `X-Organization-Id` to a different org must be rejected server-side, not just hidden in UI | Negative test — all other roles |
| AUTH-12 | Public employee form | `GET /api/public/employee-forms/:token` and `POST .../submit` work with no auth; submit rate-limited 30/15min | Public |
| AUTH-13 | Registration cap / CEO limit | Assigning a 4th `CEO` in one org is rejected (`MAX_CEO_COUNT = 3`) | Owner (role-assignment UI) |

---

## 2. Global chrome: Sidebar, Mobile Nav, Topbar, Org Switcher

No dedicated Footer component exists in the app — do not test for one; the
"footer" the user described (company name banner) is the decorative
particle-text banner **on the Dashboard page itself**, not a persistent
app footer.

| ID | Feature | What to verify | Roles with access |
|---|---|---|---|
| NAV-01 | Sidebar — Management nav set | Shows: Dashboard, Inventory, Employees, My Attendance, Company Calendar, Projects, Tasks, Performance, Announcements, Departments, Asset Requests, Assignments, Tickets, Leave Requests, Reports, Export, Audit Log, Notifications | Management (7) |
| NAV-02 | Sidebar — Attendance links | "Attendance" + "Attendance Sites" only appear if role ∈ `{ADMIN,CEO,HR}` **or** the user's `canManageAttendance` flag is set | Conditional (see permission matrix §6) |
| NAV-03 | Sidebar — Organization Comparison link | Only visible to Owner | Owner |
| NAV-04 | Sidebar — Employee Forms / Settings links | Only visible to Owner | Owner |
| NAV-05 | Sidebar — Payroll link | Only visible if `canAccessPayroll` | Payroll-access |
| NAV-06 | Sidebar — IT nav set | Shows: Dashboard, Inventory, "Employees & Assets", "Asset Assignments", Asset Requests, "Requests / Tickets", Company Calendar, My Attendance, Notifications only — confirm Payroll/Settings/Departments/Reports/Audit are absent | `IT_MANAGER` |
| NAV-07 | Sidebar — Employee nav set | Shows: My Profile, My Projects, My Attendance, Company Calendar, My Employee 360°, My Tasks, My Performance, Announcements, My Payslips, Tickets, Notifications | `EMPLOYEE` |
| NAV-08 | Sidebar — "My Payslips" link for EMPLOYEE | **Known contradiction (gap #2)**: link is shown, but the `/payroll/me` route guard (`RequirePayrollAccess`) does not include plain `EMPLOYEE` — clicking it should redirect away; confirm actual behavior | `EMPLOYEE` (expect redirect, not payslip data) |
| NAV-09 | Unread notifications badge | Sidebar polls `GET /notifications/unread-count` every 15s; badge count matches | Any authenticated |
| NAV-10 | Theme toggle / Logout / My Account | Present for every role at bottom of sidebar | All roles |
| NAV-11 | MobileNav parity | Same 3 role-based nav sets as desktop Sidebar; also shows Holidays + explicit Profile link for management, and an `OrganizationSwitcher` panel for `{ADMIN,CEO,IT_MANAGER}` | All roles (mobile viewport) |
| NAV-12 | Desktop Org Switcher | Appears inline in `DashboardLayout` only for `{ADMIN,CEO,IT_MANAGER}`; switching updates all page data without full reload | `ADMIN`, `CEO`, `IT_MANAGER` (and only if authorized per AUTH-10) |
| NAV-13 | Global Search bar | **FIXED 2026-09-22**: `search.routes.js` was fully implemented but never mounted in `backend/src/index.js` — every query 404'd, always showing "No results found" regardless of input. Now mounted at `/api/search`. Re-test: results appear for a ≥2-char query; employee/asset/project/ticket search is self-scoped for non-management/IT, org-wide for management/IT (per `search.controller.js`); each result type links correctly (employee→`/employees/:id`, asset→`/inventory/:id`, project/ticket/announcement→their list pages) | All roles (self-scoped); Management (7) + `IT_MANAGER` see org-wide results |
| NAV-14 | Notification bell (mobile Topbar) | Bell + unread badge + dropdown works; desktop has no separate header, only the search bar + org switcher | All roles |

---

## 3. Dashboard (`/` and `/dashboard`)

Route guard: only reachable by `isManager` (Management-7 union check used
in `App.jsx`) or `IT_MANAGER`; a plain `EMPLOYEE` hitting `/` or
`/dashboard` is redirected to their own `/employees/:id` profile.

### 3a. IT_MANAGER dashboard

| ID | Widget | What to verify | Source |
|---|---|---|---|
| DASH-IT-01 | Header banner "IT operations" | Renders for IT only | — |
| DASH-IT-02 | 4 stat cards (Total / Assigned / Available / Under Repair) | Under-Repair card sublabel shows open ticket count | `GET /dashboard/stats`, `GET /tickets` |
| DASH-IT-03 | Recent Asset Activity (6 items) | List matches latest inventory events | `GET /dashboard/activity` |
| DASH-IT-04 | Latest Assets (3 items) | Each links to `/inventory/:id` | `GET /dashboard/latest-assets` |

### 3b. Management dashboard

| ID | Widget | What to verify | Roles / Source |
|---|---|---|---|
| DASH-01 | Header banner + org-scope selector | "Current organization / All organizations" toggle appears only when `isManagement` (Dashboard's **own** narrower check = `ADMIN,CEO,MANAGER` only — not the full Management-7) | `ADMIN,CEO,MANAGER` |
| DASH-02 | 3 stat cards (Total Assets / Assigned Assets+utilization% / Warranty Alerts ≤30d) | Numbers match inventory data | `GET /dashboard/stats` — Management-7 + IT reach this call, but this section only *renders* for `isManager` roles |
| DASH-03 | Executive Snapshot section | Only visible to `ADMIN,CEO,MANAGER` (Dashboard's local `isManagement`) — **confirm HR, SALES_HEAD, MANAGEMENT, DEPARTMENT_HEAD reach the Dashboard route but do NOT see this section** (known discrepancy vs. the shared `isManagement()` util — gap #5) | `ADMIN,CEO,MANAGER` only |
| DASH-04 | Executive tiles: Employees / Present today / Projects / Total assets | Values correct for selected scope (`organization` vs `company`) | `GET /dashboard/executive?scope=` — `requireManagement` |
| DASH-05 | Project status breakdown | Not started / In progress / Completed counts correct | same endpoint |
| DASH-06 | "Attendance watch" (late today / missing checkout) | Counts correct; links through to `/attendance` | same endpoint |
| DASH-07 | Latest announcements (4 items) | Matches `GET /dashboard/announcements` | Management (7) can also POST/DELETE announcements from Dashboard section |
| DASH-08 | Inventory Activity line chart | Date range filter updates chart; disabled/absent for IT (moot — IT never reaches this branch) | `GET /dashboard/inventory-activity?start&end` — `requireInventoryAccess` |
| DASH-09 | Utilization radial gauge | Percentage matches assigned/total from `stats` (computed client-side, no separate call) | Management (7) |
| DASH-10 | Upcoming events / mini calendar | Week/month range toggle; leave events filtered into a separate list | `GET /dashboard/events?range=` — `requireAuth` |
| DASH-11 | "Add event" | Only `ADMIN,CEO,MANAGER,HR` can add an event from the dashboard widget | `GET /dashboard/events` POST — `requireManagement` (route-level), but UI button only shown to `ADMIN,CEO,MANAGER,HR` |
| DASH-12 | Recent Activities (4 items) | Matches `GET /dashboard/activity` | Management (7) |
| DASH-13 | Top Assigned Assets (3 items) | Matches `GET /dashboard/latest-assets` | Management (7) |
| DASH-14 | Alerts & Notifications widget | **`GET /api/alerts` is not mounted on the backend (404)** — confirm widget shows "All clear"/empty state rather than crashing; this is a broken feature, not a config issue (gap #1) | Management (7) — polled every 30s |
| DASH-15 | Decorative company-name banner | Renders the current organization's name; no API dependency; purely cosmetic — confirm it does not break layout with very long org names | All roles that reach the dashboard |

---

## 4. Employees module

| ID | Feature / Endpoint | What to verify | Roles with access |
|---|---|---|---|
| EMP-01 | `/employees` list page | Full directory with filters | Directory-access (Management-7 + `IT_MANAGER`) |
| EMP-02 | `GET /api/employees` | Same gate as above | Management (7) — note: route guard is `requireManagement`, narrower than the page's nav visibility; confirm `IT_MANAGER` hitting the API directly is rejected even though `IT_MANAGER` can see an "Employees & Assets" nav link |
| EMP-03 | `GET /api/employees/import/template`, `POST /api/employees/import` | CSV template download + bulk import | Management (7) |
| EMP-04 | `GET /api/employees/:id` (noStore) | Any authenticated user can view a profile by ID (not restricted to self) — confirm `Cache-Control: no-store` header present (module-01 security fix) | Any authenticated |
| EMP-05 | `/employees/:id` profile page | Self can edit own phone/email only; management can edit everything | Self (limited fields) + Management (7, full) |
| EMP-06 | `PATCH /api/employees/:id` | Enforce field-level restriction server-side, not just hidden in UI, for self-edits | Self (own record, limited) / Management (7, any record) |
| EMP-07 | `POST /api/employees/:id/reset-password` | Admin-triggered password reset | Management (7) |
| EMP-08 | `DELETE /api/employees/:id` | Deletes/deactivates an employee | `ADMIN, CEO, MANAGER` only (narrower than general Management-7 — HR/SALES_HEAD/MANAGEMENT/DEPARTMENT_HEAD cannot delete) |
| EMP-09 | Certifications: add/edit/delete (`POST/PATCH/DELETE /api/employees/:id/certifications...`) | CRUD on an employee's certifications | `ADMIN, CEO, MANAGER` only |
| EMP-10 | `/employees/:id/attendance` history page | Per-employee attendance history view | No explicit route guard — verify who can actually reach a *different* employee's history vs. their own (likely should be self or Management) |
| EMP-11 | `/employee-360/:id` (Employee 360°) | Aggregated profile+assets+attendance+performance view; `GET /api/employee-360/:id` is `requireAuth` only | Any authenticated (confirm whether it should be self-or-management scoped) |
| EMP-12 | `/employee-forms` builder | Create/toggle custom onboarding forms, view submissions | Owner only |
| EMP-13 | Public form fill (`/employee-form/:token`) | Prospective employee fills form with no login | Public |
| EMP-14 | CEO role assignment cap | Role dropdown blocks assigning a 4th CEO (module-03: `MAX_CEO_COUNT=3`) in both `EmployeeProfile.jsx` and `Employees.jsx` role selects | Owner (only they can reassign roles) |
| EMP-15 | MANAGER role actually grants access | Regression test for the MANAGER-role fix: create a user with role `MANAGER`, confirm they get Owner-tier nav/access everywhere `isOwner`/Management is checked (not the old broken `"MANAGEMENT"` string) | `MANAGER` |

---

## 5. Inventory / Assets module

| ID | Feature / Endpoint | What to verify | Roles with access |
|---|---|---|---|
| INV-01 | `/inventory` list | Browse/filter assets | Inventory-access (`ADMIN,CEO,MANAGER,IT_MANAGER`) |
| INV-02 | `GET /api/assets` (list), `GET /api/assets/categories` | Both are `requireAuth` only at the route layer — confirm any authenticated role (not just inventory-access) can read these, and check whether that's intended | Any authenticated (read) |
| INV-03 | `GET /api/assets/:id` | Same — `requireAuth` only | Any authenticated |
| INV-04 | `/inventory/:id` (AssetProfile page) | Full asset detail | Inventory-access |
| INV-05 | `POST /api/assets` (create) | New asset creation | Inventory-access |
| INV-06 | `POST /api/assets/:id/assign`, `.../unassign` | Assign/unassign to an employee | Inventory-access |
| INV-07 | `POST /api/assets/:id/status`, `.../lifecycle` | Status change (repair/lost/etc.), lifecycle event log | Inventory-access |
| INV-08 | `DELETE /api/assets/:id`, `DELETE /api/assets/categories/:name` | Delete asset / delete a category | Inventory-access |
| INV-09 | `GET /api/assets/import/template`, `POST /api/assets/import` | CSV bulk import | Inventory-access |
| INV-10 | `/assignments` page | Cross-employee assignment overview | Inventory-access |
| INV-11 | `/asset-requests` page + `POST/GET /api/asset-requests` | Any authenticated user can **request** an asset and see their own requests | Any authenticated (self-scoped for non-management) |
| INV-12 | `PATCH /api/asset-requests/:id/review`, `POST .../fulfill` | Approve/reject/fulfill a request | Management (7) |
| INV-13 | `DELETE /api/asset-requests/:id` | Cancel own pending request | Self (owner of the request) |

---

## 6. Attendance module

### 6a. Self-service attendance

| ID | Feature / Endpoint | What to verify | Roles with access |
|---|---|---|---|
| ATT-01 | `/attendance/me` (MyAttendance) | Loaded eagerly (not lazy) so it works offline on first load (post-module fix) | All roles |
| ATT-02 | `POST /api/attendance/self/mark` | Check-in/out with geofence validation for OFFICE/FIELD modes; `locationMode=WFH` skips geofence+coordinates entirely | Self |
| ATT-03 | WFH mode selector | Selecting WFH before check-in suppresses location prompt + assigned-site card | Self |
| ATT-04 | Check-in progress fill animation | Visual fill animates on the Check In button; does not block actual submission | Self |
| ATT-05 | `POST /api/attendance/self/offline-sync` | Queued offline check-ins/outs sync once back online; `locationMode` respected | Self |
| ATT-06 | `POST /api/attendance/self/corrections` | Employee requests a correction to a past record | Self |
| ATT-07 | `GET /api/attendance/self` | Own attendance history | Self |
| ATT-08 | Org-switch scoping regression | Mark attendance while an `ADMIN`/`CEO`/`IT_MANAGER` has switched to a *different* org via the header — confirm it still records against the user's **real** employer org, not the switched-to org | `ADMIN`, `CEO`, main-company `IT_MANAGER` (the only roles that can switch orgs) |
| ATT-09 | Geofence check (RADIUS site) | Click-to-place marker on Leaflet map; check-in inside radius passes, outside fails | Self (map is in AttendanceSiteMap, used by admins to configure; the geofence check itself runs for self) |
| ATT-10 | Geofence check (POLYGON site) | Boundary must have ≥4 vertices to save (raised from 3); point-in-polygon math accepts ≥3 for legacy data | Self (check), Management (site setup) |
| ATT-11 | Offline queue (`offlineAttendance.js`) | Confirm it still stores/replays events correctly now that `GEOFENCE`-typed presence events no longer exist (module-05 simplification) — regression test | Self |

### 6b. Admin/management attendance

| ID | Feature / Endpoint | What to verify | Roles with access |
|---|---|---|---|
| ATT-12 | `/attendance` grid page | Route guard is `RequireManagement`, but actual data visibility is gated by the **Attendance permission matrix**, not a fixed role list — fetch own effective permission via `/organization/attendance-permissions/me` and hide Mark/Save/Resolve for read-only viewers | Management (7) reach the page; matrix decides what they can do |
| ATT-13 | `GET /api/attendance` (daily grid data) | Requires `canRead` | Per matrix (§6c) |
| ATT-14 | `POST /api/attendance/mark`, `POST /api/attendance/save` | Requires `canCreate` **or** `canUpdate` | Per matrix |
| ATT-15 | `GET /api/attendance/export` | Date-range export (`startDate`/`endDate`, `from`/`to`, or single `date` for back-compat) — spreadsheet no longer includes presence-timeline/site-summary sheets | Per matrix (`canRead`) |
| ATT-16 | `GET /api/attendance/anomalies`, `PATCH /api/attendance/anomalies/:id/resolve` | List + resolve anomalies (late/missing checkout) | `canRead` / `canUpdate` |
| ATT-17 | `GET /api/attendance/corrections` | Review submitted correction requests | `canRead` |
| ATT-18 | "Working from home" badge | `LocationFlag` shows WFH badge when `row.locationMode === "WFH"` and no coordinates recorded | Viewers with `canRead` |
| ATT-19 | Working Time progress bar (grid + EmployeeProfile) | Bar fills correctly against org's `workingHoursPerDay`; falls back to live checkIn→now span when `workingMinutes` is null; caps a still-open shift's running total at 23:59:59 UTC of the record's date (doesn't bleed into next day) | Viewers with `canRead` |
| ATT-20 | `/attendance/sites` page | Configure geofenced sites (Leaflet map, radius or polygon) | `RequireManagement` at route level |
| ATT-21 | `GET/POST/PATCH/DELETE /api/attendance-sites*` | **Router-level gate is `requireAuth` only — no role check** — explicitly test whether a plain `EMPLOYEE` or `IT_MANAGER` can hit `POST /api/attendance-sites` directly (bypassing the UI) and confirm whether the controller enforces roles (gap #3 — verify, don't assume it's safe) | Should be Management only; **verify this is actually enforced** |
| ATT-22 | `PUT /api/attendance-sites/:id/employees` (noStore) | Assign employees to a site | Same gap as ATT-21 — verify enforcement |
| ATT-23 | `POST /api/attendance-sites/verify` | Ad-hoc geofence check against a site | `requireAuth` only |
| ATT-24 | LocationSearch (Nominatim) | Typing a place debounced-searches OpenStreetMap Nominatim; picking a result flies map + places marker (RADIUS) or just recenters (POLYGON) | Whoever can reach `/attendance/sites` |
| ATT-25 | Basemap tiles | Confirm plain OSM raster tiles load (not a CARTO "API KEY REQUIRED" placeholder — this was reverted intentionally) | Same |

### 6c. Attendance permission matrix (Settings)

| ID | Feature / Endpoint | What to verify | Roles with access |
|---|---|---|---|
| PERM-01 | `GET /organization/attendance-permissions/me` | Any user can check their own resolved effective permission | Any authenticated |
| PERM-02 | `GET /organization/attendance-permissions` | Returns full matrix for the 6 configurable roles (`HR, SALES_HEAD, MANAGEMENT, DEPARTMENT_HEAD, IT_MANAGER, EMPLOYEE`), computing defaults for rows not yet set | `ADMIN, CEO, MANAGER` only |
| PERM-03 | `PUT /organization/attendance-permissions` | Save edited matrix; server silently strips any submitted row for `ADMIN/CEO/MANAGER` (can't be reconfigured) or an invalid role | `ADMIN, CEO, MANAGER` only |
| PERM-04 | Default: HR with no configured row | Read-only (`canRead: true` only) even before any row is saved | `HR` |
| PERM-05 | Default: legacy `canManageAttendance` flag | A user (any of the 6 configurable roles) with the legacy per-user flag set gets full CRUD if no explicit matrix row exists yet | Configurable roles w/ flag |
| PERM-06 | Default: no flag, no row | Zero access (all 4 actions false) | Configurable roles w/o flag |
| PERM-07 | `ADMIN/CEO/MANAGER` always full | Confirm these 3 never appear in the editable matrix UI and always resolve to full CRUD regardless of DB state | `ADMIN, CEO, MANAGER` |
| PERM-08 | Settings UI | Matrix is editable from Settings by `ADMIN/CEO/MANAGER` (replaces the old static placeholder table) | `ADMIN, CEO, MANAGER` |

### 6d. Leave, Holidays, Biometric

| ID | Feature / Endpoint | What to verify | Roles with access |
|---|---|---|---|
| LV-01 | `/leave-requests` page + `POST /api/leaves` | Submit a leave request | Any authenticated (self) |
| LV-02 | `GET /api/leaves` | Non-management sees only own requests; management sees all | Self-scoped / Management (7) |
| LV-03 | `GET /api/leaves/balance` | `employeeId` query param usable only by management (per controller comment) — verify a non-management user passing another employee's ID is rejected | Self (own) / Management (any) |
| LV-04 | `GET /api/leaves/calendar` | Leave calendar view | Management (7) |
| LV-05 | `PATCH /api/leaves/:id/review` | Approve/reject | Management (7) |
| LV-06 | `DELETE /api/leaves/:id` | Cancel own pending leave | Self |
| LV-07 | `/leave-calendar` route | Confirm it redirects to `/calendar` (folded into the main calendar) | All roles |
| HOL-01 | `/holidays` page + `GET /api/holidays` | View org holiday list | Any authenticated (view) |
| HOL-02 | `POST/DELETE /api/holidays` | Add/remove holidays | Management (7) |
| BIO-01 | `/settings/attendance-devices` | Configure biometric devices | Owner |
| BIO-02 | `GET/POST/PATCH/DELETE /api/biometric/devices*`, `.../rotate-token`, `.../mappings` | **Router-level gate is `requireAuth` only — no explicit role check at the route** — verify controller-level enforcement actually restricts this to Owner (gap #4 — don't assume it's safe) | Should be Owner; **verify enforcement** |
| BIO-03 | `GET /api/biometric/connector/config`, `POST .../heartbeat`, `POST .../punches` | Device-token auth (`connectorAuth`), not user JWT — confirm a user JWT is rejected here and vice versa | Device token only |
| BIO-04 | ADMS protocol (`/assetflow/:orgSlug/iclock/*`) | Raw handshake endpoints for physical device push (`cdata`, `getrequest`, `devicecmd`); no `requireAuth` — confirm this is intentionally device-protocol-authenticated, not open to arbitrary callers | Device protocol only |
| BIO-05 | Connector instances (`connector-org-a`, `connector-org-b`) | Two connector instances share one physical device but push to two orgs — verify punches route to the correct org and neither connector can see/affect the other's sync state | N/A (service-level, not a user role) |

---

## 7. Payroll module

Most granular per-action role-gating in the app — test each action with
exactly the role listed, and confirm every *other* role gets a 403.

| ID | Feature / Endpoint | What to verify | Roles with access |
|---|---|---|---|
| PAY-01 | `/payroll` page | Payroll dashboard/list | Payroll-access (`ADMIN,CEO,MANAGER,HR,MANAGEMENT`) |
| PAY-02 | `GET /api/payroll` (noStore) | List all payslips | Management only (`requireManagement`) — confirm HR/MANAGEMENT (which pass `canAccessPayroll` for the page) can also hit this list endpoint since `requireManagement` = Management-7, which includes them |
| PAY-03 | `GET /api/payroll/me` (noStore) | Own payslips only | Any authenticated (self) — but see PAY-09 re: route guard |
| PAY-04 | `POST /api/payroll/generate` | Generate a payroll run | `ADMIN` only |
| PAY-05 | `POST /api/payroll/submit` | Submit for approval | `ADMIN` only |
| PAY-06 | `POST /api/payroll/approve`, `POST /api/payroll/reject` | Approve/reject a run | `CEO` only |
| PAY-07 | `POST /api/payroll/:id/mark-paid` | Mark an individual payslip paid | `CEO` only |
| PAY-08 | `DELETE /api/payroll/bulk` | Bulk-delete payroll records | `CEO` only |
| PAY-09 | `PATCH /api/payroll/:id` | Edit a payslip | `ADMIN` only |
| PAY-10 | `DELETE /api/payroll/:id` | Delete a single payslip | `ADMIN, CEO` |
| PAY-11 | `/payroll/me` route guard vs. Sidebar | Route guard is `RequirePayrollAccess` (excludes plain `EMPLOYEE`), but Sidebar shows "My Payslips" to `EMPLOYEE` — confirm actual redirect behavior when an `EMPLOYEE` clicks it (gap #2) | `EMPLOYEE` (expect blocked, contradicting the visible nav link) |

---

## 8. Organization module

| ID | Feature / Endpoint | What to verify | Roles with access |
|---|---|---|---|
| ORG-01 | `GET /api/organization`, `GET /api/organization/company` | Basic org info | Any authenticated |
| ORG-02 | `/organization-comparison` page + `GET /api/organization/comparison` | Cross-org comparison view | Owner |
| ORG-03 | `POST /api/organization/suborganizations`, `DELETE .../suborganizations/:id` | Create/delete a sub-org | Owner |
| ORG-04 | `PATCH /api/organization` | Edit org settings (name, primary color, working hours/day, timezone) | Owner |
| ORG-05 | `PATCH /api/organization/company/set-main` | Designate the main company org | `CEO` only |
| ORG-06 | `/departments` page + CRUD | List/create/edit/delete departments | View: Management (7, `requireAuth` for GET is actually broader — verify); Write: Management (7) |
| ORG-07 | Timezone picker (Settings) | All 6 GCC zones labeled with country names, plus Karachi/Kolkata; ~400 remaining IANA zones show a live "City (UTC offset)" label; grouped into `<optgroup>`s by region, org's most-used regions first | Owner (Settings access) |
| ORG-08 | Shared `timezones.js` | `AttendanceSites.jsx` timezone dropdown now matches `Settings.jsx` (previously had its own unlabeled list missing Oman/Gulf zones) — regression test both pages show identical labels for the same zone | Management (7) on AttendanceSites, Owner on Settings |
| ORG-09 | `primaryColor` → accent token | Changing the org's brand color in Settings updates `--accent` app-wide, including the Working Time progress bar fill | Owner |

---

## 9. Projects, Tasks, Performance

| ID | Feature / Endpoint | What to verify | Roles with access |
|---|---|---|---|
| PRJ-01 | `/projects` page | For `IT_MANAGER`, App.jsx redirects this route to `/inventory` — confirm IT never actually sees a Projects page | `IT_MANAGER` → redirected |
| PRJ-02 | `/projects` for everyone else | Open to all other roles (self-scoped "My Projects" for employees) | All roles except IT |
| PRJ-03 | `GET /api/projects`, `GET /api/projects/:id` | Read access | Any authenticated |
| PRJ-04 | `POST/PATCH/DELETE /api/projects`, `.../members`, `.../members/:memberId` | Create/edit/delete project + manage members | Management (7) |
| PRJ-05 | `GET /api/projects/work-categories` | Read | Any authenticated |
| PRJ-06 | `POST/PATCH/DELETE /api/projects/work-categories(/:id)` | Manage categories | Management (7) |
| TASK-01 | `/tasks` page ("Tasks" / "My Tasks") | **`/api/tasks` is never mounted on the backend — every call 404s.** This is a fully broken feature end-to-end, not a permissions issue. Confirm the UI degrades gracefully (empty state/error toast) rather than crashing (gap #1) | All roles reach the page; API is broken for everyone |
| PERF-01 | `/performance` page ("Performance" / "My Performance") | **`/api/performance/:employeeId` is never mounted — 404s for everyone.** Same as TASK-01: confirm graceful degradation (gap #1) | All roles reach the page; API is broken for everyone |

---

## 10. Tickets

| ID | Feature / Endpoint | What to verify | Roles with access |
|---|---|---|---|
| TKT-01 | `/tickets` page | File and view tickets | All roles |
| TKT-02 | `GET /api/tickets`, `POST /api/tickets` | Any authenticated user can file a ticket and see the list | Any authenticated |
| TKT-03 | `PATCH /api/tickets/:id/status`, `DELETE /api/tickets/:id` | Update status / delete | Management (7) |
| TKT-04 | Open-ticket count on Dashboard | IT dashboard's stat-card sublabel and the management dashboard's underlying fetch both consume `GET /tickets` — confirm counts match the Tickets page | Roles that reach a dashboard |

---

## 11. Reports, Export, Audit Log

| ID | Feature / Endpoint | What to verify | Roles with access |
|---|---|---|---|
| RPT-01 | `/reports` page | Reporting views | Management (7) |
| RPT-02 | `GET /dashboard/repair-spend`, `.../attendance-anomalies` | Reporting data endpoints | Management (7) |
| EXP-01 | `/export` page | Trigger data exports | Management (7) |
| EXP-02 | `GET /api/export/employees`, `/inventory`, `/departments`, `/tickets` | Each downloads correctly-scoped data | Management (7) |
| AUD-01 | `/audit-log` page + `GET /api/audit-log` | View system audit trail | Management (7) |

---

## 12. Notifications, Announcements, Alerts

| ID | Feature / Endpoint | What to verify | Roles with access |
|---|---|---|---|
| NOT-01 | `/notifications` page | List own notifications | Any authenticated |
| NOT-02 | `GET /api/notifications`, `GET .../unread-count` | Data + badge count | Any authenticated |
| NOT-03 | `POST /api/notifications/read-all`, `.../read-by-type`, `.../:id/read` | Mark-as-read actions | Any authenticated (own notifications) |
| ANN-01 | `/announcements` page | View org announcements | Any authenticated |
| ANN-02 | `GET /dashboard/announcements` | Read | Any authenticated |
| ANN-03 | `POST /dashboard/announcements`, `DELETE .../:id` | Create/delete an announcement | Management (7) |
| ALR-01 | Dashboard "Alerts & Notifications" widget | **`GET /api/alerts` is never mounted — always 404s**, so this widget can only ever show its empty/fallback state ("All clear"), never real smart alerts. Confirm this is understood as broken, not just quiet (gap #1) | Management (7) — widget polls every 30s regardless |

---

## 13. Calendar

| ID | Feature / Endpoint | What to verify | Roles with access |
|---|---|---|---|
| CAL-01 | `/calendar` (AdvancedCalendar) | Full calendar view, merges events + leave + holidays | All roles |
| CAL-02 | `/leave-calendar` redirect | Confirm it lands on `/calendar`, doesn't 404 or show a stale page | All roles |

---

## 14. Settings

| ID | Feature / Endpoint | What to verify | Roles with access |
|---|---|---|---|
| SET-01 | `/settings` page | Org profile, branding color, working hours, timezone, attendance permission matrix | Owner only |
| SET-02 | `/settings/attendance-devices` | Biometric device management UI | Owner only |
| SET-03 | Attendance permission matrix editor | See §6c (PERM-01…08) | `ADMIN, CEO, MANAGER` |
| SET-04 | Non-owner access attempt | `HR`, `SALES_HEAD`, `MANAGEMENT`, `DEPARTMENT_HEAD`, `IT_MANAGER`, `EMPLOYEE` hitting `/settings` directly by URL → redirected to `/` (`RequireOwner`'s failure path, distinct from other guards which redirect to the profile page) | All non-owner roles (negative test) |

---

## 15. Profile / Account & Misc

| ID | Feature / Endpoint | What to verify | Roles with access |
|---|---|---|---|
| PROF-01 | `/profile` page | Self account settings (password change, etc.) | Any authenticated |
| BILL-01 | `/billing` route | Confirm it redirects to `/` and no UI links to it — `Billing.jsx` exists as a file but is intentionally unrouted; if any leftover nav/link points here, that's a bug | N/A (should be unreachable) |
| WELC-01 | `/`, `/login`, `/register` (logged out) | Public marketing/auth pages render without a session | Public |

---

## 16. Cross-cutting security / RBAC test batch

Run these as a dedicated pass after the module-by-module tests above:

1. **Header hardening (module 01)**: confirm `helmet()` HSTS header
   (`max-age=31536000; includeSubDomains; preload`) is present on responses.
2. **no-store PII routes (module 01)**: `GET /employees/:id`,
   `GET /payroll/me`, `GET /payroll`, `GET /attendance-site/assigned`,
   `PUT /attendance-site/:id/employees` all return
   `Cache-Control: no-store`.
3. **401 handling (module 02)**: confirm only `GET /auth/me` failures log
   the user out; a 401 from e.g. `GET /api/payroll` (wrong role) does not
   wipe the session.
4. **Broken/unmounted endpoints (gap #1)**: `/api/tasks` and
   `/api/performance/:employeeId` and `/api/alerts` still 404 — confirm
   in the Network tab and document actual (not assumed) frontend behavior
   for each of the 3 remaining affected features (Tasks, Performance,
   Dashboard Alerts widget). `/api/search` was fixed 2026-09-22 (route
   mounted in `backend/src/index.js`) — re-verify it now returns real
   results instead of re-filing it as broken.
5. **Payroll self-link contradiction (gap #2)**: `EMPLOYEE` sees "My
   Payslips" in nav but is blocked by the route guard — confirm and file
   as a bug if unintended.
6. **Attendance-site route gate (gap #3)**: attempt
   `POST /api/attendance-sites` and `PUT /api/attendance-sites/:id/employees`
   as a plain `EMPLOYEE` directly against the API (bypassing the UI) —
   confirm the controller rejects it even though the router itself doesn't.
7. **Biometric device route gate (gap #4)**: same test against
   `POST /api/biometric/devices` as a non-owner role.
8. **Dashboard `isManagement` mismatch (gap #5)**: log in as `HR`,
   `SALES_HEAD`, `MANAGEMENT`, and `DEPARTMENT_HEAD` individually and
   confirm each reaches `/dashboard` but does **not** see the Executive
   Snapshot section, while still seeing the 3 top stat cards.
9. **Org-switch forgery**: a sub-org `ADMIN` or any role other than
   `CEO`/main-company `ADMIN`/main-company `IT_MANAGER` sends a raw API
   request with a forged `X-Organization-Id` header pointing at another
   org — confirm the backend rejects it (`auth.middleware.js`), not just
   the UI hiding the switcher.
10. **`.env` git-history check** (still open per CLAUDE.md): run
    `git log --all --full-history -- backend/.env frontend/.env` to
    confirm no secret was ever committed.
11. **CEO count enforcement**: attempt to promote a 4th user to `CEO` in
    one org both via UI and directly via the role-update API; both must be
    blocked.
12. **MANAGER role regression**: since this role was previously silently
    broken (used `"MANAGEMENT"` string instead), explicitly re-test every
    Owner-tier gate (`isOwner`) with a `MANAGER` user, not just `ADMIN`/`CEO`,
    across Inventory, Employees delete, Certifications, Payroll page access,
    Organization Comparison, Settings, and the Attendance permission matrix
    editor.

---

## Appendix: known pre-existing gaps to track separately (not new bugs to file blind)

These are documented in `CLAUDE.md` as already-known, deliberate, or
tracked items — confirm current status rather than re-reporting them as
new findings:

- Only `MyAttendance` was pulled out of lazy-loading for offline support;
  every other route (Dashboard, Employees, Settings, etc.) can still fail
  with "Failed to fetch dynamically imported module" if opened for the
  first time while offline. Deliberately out of scope per prior user
  request.
- JWT payload still carries a legacy `companyId` claim alongside
  `userId`/`organizationId`/`role` — flagged as possibly unnecessary
  long-term, kept because `auth.middleware.js` and
  `attendance-site.controller.js` still read it.
