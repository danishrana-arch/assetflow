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

**2026-09-23 rewrite**: the app moved from one flat `MANAGEMENT_ROLES`
bucket (originally ADMIN, CEO, MANAGER, SALES_HEAD, HR, MANAGEMENT,
DEPARTMENT_HEAD, all functionally identical almost everywhere — `SALES_HEAD`
was removed entirely later the same day, see §0, so it's 6 roles now) to
a real per-role **module map** — `ROLE_MODULES` + `hasModuleAccess(role,
moduleKey)` in both `backend/src/utils/roles.js` and
`frontend/src/utils/roles.js` (hand-mirrored, no shared package — check
both stay in sync on future changes). Every section below has been
re-verified against the new map; anything still gated by the old broad
bucket (a handful of things deliberately were not narrowed — see §0) is
called out explicitly per row.

## 0. Roles in the system

**`SALES_HEAD` was removed entirely on 2026-09-23** — not just its
placeholder pages, the *role itself*: dropped from `UserRole` in
`schema.prisma` (migration `20260923190000_remove_sales_head_role`, a
Postgres enum-type rebuild since Postgres can't drop a single enum value
directly), and from every role list in `backend/src/utils/roles.js` and
`frontend/src/utils/roles.js`. One real active user had this role (Ali
Sher Farooqi, CostBidding org) and was reassigned before the migration
ran; a `prisma/seed.js` test fixture using this role was changed to
`MANAGEMENT`.

**`MANAGER` ("Finance Manager") was removed entirely on 2026-09-24**, same
pattern: dropped from `UserRole` in `schema.prisma` (migration
`20260924130000_remove_manager_role` — **manual step pending as of this
writing**: `cd backend && npx prisma migrate deploy && npx prisma generate`
has not yet been run against the live DB, same as two other 2026-09-24
migrations — see the Appendix), and from every role list in both
`utils/roles.js` files, `payroll.routes.js`'s route guards (generate/
submit/patch narrowed to `ADMIN` only; delete to `ADMIN,CEO`),
`search.controller.js`, and every hardcoded frontend role-array
(`EmployeeProfile.jsx`'s role-select options, `Payroll.jsx`'s
`canManagePayroll`, `Dashboard.jsx`'s local `isManagement`/`isManager`,
`Settings.jsx`'s `canEditSchedule`/`isOwnerTier`). 0 live users held this
role on the Neon DB and 0 stale `AttendancePermission` rows referenced it
(checked before writing the migration — no reassignment step needed, unlike
`SALES_HEAD`). ADMIN/CEO already had `payroll`/`payrollReports` via the
`*` wildcard, so nothing lost access to Payroll/Payroll Reports as a
result. **Any row below that grants, restricts, or tests `MANAGER`/
"Finance Manager" access is describing pre-2026-09-24 history — that login
no longer exists, and this file's individual test rows below were not all
rewritten to remove those mentions (see the 2026-09-23 `SALES_HEAD` note
above for the same caveat).** Table below has 6 roles total, not 7.

| Role | Label in UI | Modules (`ROLE_MODULES`) |
|---|---|---|
| `ADMIN` | "Admin" (was "Owner / Admin") | `*` (everything) |
| `CEO` | "CEO" | `*` (everything); sole role for payroll approve/reject/mark-paid/bulk-delete and `set-main` company; max 3 users per org (`MAX_CEO_COUNT = 3`) |
| `HR` | "HR" | `employees`, `employeeForms`, `certifications`, `attendance`, `leave`, `hrReports` |
| `MANAGEMENT` | "Management" | `employees`, `projects`, `tasks`, `attendance`, `performance`, `reports` |
| `DEPARTMENT_HEAD` | "Department Head" | `departments`, `employees`, `attendance`, `projects`, `tasks`, `leave` — **and** these six are scoped to the department head's own department at the data layer, not just hidden in nav (see §4/§6/§9/§6d) |
| `IT_MANAGER` | "IT Manager" | `inventory`, `assets`, `assetAssignments`, `assetRequests`, `tickets` — **only**. No employee directory page (though the API still lets it call `GET /employees` for the redacted asset-assignment picker — see EMP-02), no payroll, no attendance grid, no settings. |
| `EMPLOYEE` | "Employee" | none — baseline self-service: own profile, own attendance, own payroll link (see gap #2), tickets, announcements, calendar |

**2026-09-23, same day, two rounds of changes**: first, `sales`,
`salesTeam`, `salesReports`, `hrReports`, and `financialReports` were all
removed (module keys, pages, routes, nav links) — this deployment is
HR-only, no sales-pipeline feature was ever going to be built. Then, per a
follow-up request, **HR Reports was restored** (it's a real part of the
app) and the `SALES_HEAD` role was removed outright rather than just its
placeholder pages (see banner above). Net state: `HR` has `hrReports`
back; `financialReports` and everything sales-related stay gone.
**Payroll Reports was the other placeholder kept** at the time of this
paragraph — since then it was built out for real (see PAY-13) with a
`GET /payroll/summary?year=` backend, and `MANAGER` was removed as a role
entirely 2026-09-24, so the module/page/nav entry now exist for
`ADMIN,CEO` only.

Role groups referenced repeatedly below:
- **Owner** = `ADMIN, CEO` **only** (was `ADMIN, CEO, MANAGER` back when
  `MANAGER` still existed as Finance Manager; `RequireOwner` in `App.jsx`
  and the org-settings/attendance-matrix routes in `organization.routes.js`
  both changed accordingly, and `MANAGER` itself is gone now — see banner
  above).
- **Management (5)** = `ADMIN, CEO, HR, MANAGEMENT, DEPARTMENT_HEAD` (was
  "Management (6)" including `MANAGER`, before its 2026-09-24 removal, and
  "Management (7)" including `SALES_HEAD` before that — see both banners
  above; rows below written before either removal may still say
  "Management (6)"/"Management (7)" or list `MANAGER`/`SALES_HEAD` in a
  "these roles lost X" sentence — read that as historical, the count is 5
  now). This is the **old, still-in-use-in-places** broad bucket
  (`isManagement()` / `MANAGEMENT_ROLES` / backend `requireManagement`
  middleware). Deliberately **not** narrowed everywhere — it's still the
  gate for announcements, calendar events, work-categories read/write
  visibility of dashboard widgets, and the leave/holiday/project-adjacent
  bits that aren't one of the specific tree modules. Don't assume every row
  using "Management (6)"/"Management (7)" got the module treatment — check
  the specific row.
- **Payroll module** = `ADMIN, CEO` only now (`MANAGER` — the only other
  role that ever had it — was removed 2026-09-24; before that it was
  `ADMIN,CEO,MANAGER`, and before that `ADMIN,CEO,MANAGER,HR,MANAGEMENT` —
  HR and MANAGEMENT lost payroll access entirely back on 2026-09-23).
- **Inventory module** = `ADMIN, CEO, IT_MANAGER` (was `ADMIN,CEO,MANAGER,
  IT_MANAGER` — MANAGER lost inventory entirely, including Assignments and
  Asset Requests review/fulfill, before being removed as a role outright).
- **Employees module** = `ADMIN, CEO, HR, MANAGEMENT, DEPARTMENT_HEAD`
  (was Management-6 + `IT_MANAGER`; `MANAGER` and `SALES_HEAD` lost the
  directory page/module entirely). `IT_MANAGER` is **not** in this module
  list either, but keeps its own separate exception for the `/employees`
  page and `GET /employees` API — it's IT's "Employees & Assets"
  asset-assignment view, redacted server-side, not the HR directory (see
  EMP-01/EMP-02; this exception was briefly and mistakenly removed on
  2026-09-23, then restored the same day).
- **Attendance module** = `ADMIN, CEO, HR, MANAGEMENT, DEPARTMENT_HEAD`
  (was `ADMIN,CEO,MANAGER` always-full + everyone else configurable via
  the matrix; `MANAGER` lost Attendance entirely — not even a configurable
  row — and `MANAGEMENT`/`DEPARTMENT_HEAD` now default to full access
  instead of falling through to no-access).
- **Leave module** = `ADMIN, CEO, HR, DEPARTMENT_HEAD` (was Management-6).

---

## 1. Authentication & Session

| ID | Feature / Endpoint | What to verify | Roles with access |
|---|---|---|---|
| AUTH-01 | `POST /api/auth/register` | Creates first org/user; rate-limited to 20 req/15min per IP | Public (no auth) |
| AUTH-02 | `POST /api/auth/login` | Valid creds → token + user; wrong creds → 401; rate-limited 20/15min | Public |
| AUTH-03 | `GET /api/auth/me` | Returns current user/org; this is the **only** call that logs the user out on 401 (per module-02 fix) — confirm a 401 from any *other* endpoint does NOT clear localStorage/redirect to login | Any authenticated |
| AUTH-04 | `POST /api/auth/invite` | Invite a new employee by email | Management (6) — **unchanged**, not narrowed to a specific module |
| AUTH-05 | `PATCH /api/auth/password` | Self password change; verifies `currentPassword` server-side; wrong current password rejected | Self (any authenticated) |
| AUTH-06 | Logout | Purely client-side — clears `assetflow_token`, `assetflow_user_cache`, `assetflow_active_organization`; confirm no server call is needed/made | Any authenticated |
| AUTH-07 | Session bootstrap from cache | On reload with a cached token, UI shows cached user instantly while `GET /me` runs in background | Any authenticated |
| AUTH-08 | Stale-token resilience | If `GET /me` fails with a network error/5xx/timeout (backend down), the session is **kept**, not cleared — only a real `401` clears it | Any authenticated |
| AUTH-09 | Inactivity auto-logout | No pointer/key/scroll/touch activity for 60 minutes → auto logout (checked every 15s) | Any authenticated |
| AUTH-10 | Org switch — authorized | `CEO` (any org), or `ADMIN`/`IT_MANAGER` **whose home org is the main company** can switch org via `X-Organization-Id` | `CEO`, main-company `ADMIN`/`IT_MANAGER` |
| AUTH-11 | Org switch — blocked | A sub-org `ADMIN`/`IT_MANAGER`, or any other role, forging `X-Organization-Id` to a different org must be rejected server-side, not just hidden in UI | Negative test — all other roles |
| AUTH-11b | **FIXED 2026-09-23**: org-switcher list vs. actual switch enforcement | `canSeeCompanyOrganizations()` in `auth.controller.js` used to return `true` for *any* `ADMIN` regardless of home org, contradicting `applyOrganizationScope`'s actual enforcement (main-company only) — a sub-org ADMIN would see every subcompany in the switcher and get a 403 after picking one. Now requires `organization.id === organization.companyId` for ADMIN, matching IT_MANAGER and the real enforcement point. Re-test: log in as a **sub-org** ADMIN and confirm the org switcher shows/offers only their own org, not siblings. | Sub-org `ADMIN` (negative — should see just their own org) |
| AUTH-12 | Public employee form | `GET /api/public/employee-forms/:token` and `POST .../submit` work with no auth; submit rate-limited 30/15min. **Fixed 2026-09-24**: submit used to 500 unconditionally — `EmployeeFormSubmission` had three stale required columns (`invitationId`, `data`, `updatedAt`) left over from a dead invitation flow that `submitPublicEmployeeForm` never populated. Schema now makes `invitationId`/`data` optional and gives `updatedAt` `@updatedAt`. **Manual step pending**: migration `20260924120000_employee_form_submission_optional_fields` is not yet deployed to the live DB as of this writing — re-test only after `cd backend && npx prisma migrate deploy && npx prisma generate` has actually been run; until then this will still 500 | Public |
| AUTH-13 | Registration cap / CEO limit | Assigning a 4th `CEO` in one org is rejected (`MAX_CEO_COUNT = 3`) | Owner (role-assignment UI) |

---

## 2. Global chrome: Sidebar, Mobile Nav, Topbar, Org Switcher

No dedicated Footer component exists in the app — do not test for one; the
"footer" the user described (company name banner) is the decorative
particle-text banner **on the Dashboard page itself**, not a persistent
app footer.

The Sidebar/MobileNav "management" branch (everyone except plain
`EMPLOYEE` and `IT_MANAGER`) is no longer one flat nav list — every link
is now individually gated by `hasModuleAccess(role, moduleKey)`, so **the
actual link set differs per role**. Test each role separately rather than
treating "Management (6)" as one nav profile.

| ID | Feature | What to verify | Roles with access |
|---|---|---|---|
| NAV-01a | Sidebar — ADMIN/CEO | Sees every link: Dashboard, Inventory, Employees, Attendance(+Sites), My Attendance, Company Calendar, Org Comparison, Projects, Tasks, Performance, Announcements, Departments, Asset Requests, Assignments, Tickets, Leave Requests, Reports, Export, Audit Log, Employee Forms, Settings, Payroll, Payroll Reports. **Notifications is no longer a sidebar link** (see NAV-14) — confirm it's absent here too, not missed from this list | `ADMIN`, `CEO` |
| NAV-01b | **REMOVED 2026-09-24** — Sidebar — Finance Manager (`MANAGER`) | The `MANAGER` role itself no longer exists (dropped from the `UserRole` enum, same pattern as `SALES_HEAD` — see §0) — there is nothing left to test here; a login with this role can't be created. Historical note only: it used to see just Dashboard, My Attendance, Company Calendar, Tickets (self-scoped), Payroll, Payroll Reports | N/A — role removed |
| NAV-01c | Sidebar — HR | Sees: Dashboard, Employees, Attendance(+Sites), My Attendance, Company Calendar, Announcements, Tickets, Leave Requests, Employee Forms. Confirm Inventory, Payroll, Projects, Tasks, Performance, Departments, Reports/Export, Audit Log, Settings are **absent** | `HR` |
| NAV-01d | **REMOVED 2026-09-23** — Sidebar — Sales Head | The `SALES_HEAD` role itself no longer exists (dropped from the `UserRole` enum, not just its module list) — there is nothing left to test here; a login with this role can't be created. Historical note only: it briefly had just `projects`/`tasks` after the Sales pages were deleted, before being removed outright | N/A — role removed |
| NAV-01e | Sidebar — Management | Sees: Dashboard, Employees, Attendance(+Sites), My Attendance, Company Calendar, Projects, Tasks, Performance, Announcements, Tickets, Reports, Export. Confirm Inventory, Payroll, Departments, Leave Requests, Sales-anything, Audit Log, Settings, Employee Forms are **absent** | `MANAGEMENT` |
| NAV-01f | Sidebar — Department Head | Sees: Dashboard, Employees, Attendance(+Sites), My Attendance, Company Calendar, Departments, Projects, Tasks, Announcements, Tickets, Leave Requests. **All of Employees/Attendance/Departments/Projects/Tasks/Leave are scoped to their own department's data** (see §4/§6/§9/§6d) — confirm this is a real data filter, not just the same org-wide data with a narrower nav. Confirm Inventory, Payroll, Reports/Export, Sales-anything, Audit Log, Settings are **absent** | `DEPARTMENT_HEAD` |
| NAV-02 | Sidebar — Attendance links (`ADMIN/CEO/HR/MANAGEMENT/DEPARTMENT_HEAD`) | "Attendance" + "Attendance Sites" appear if `hasModuleAccess(role,"attendance")` **or** the user's legacy `canManageAttendance` flag is set. `MANAGER`/`SALES_HEAD`/`IT_MANAGER` never see these regardless of the flag's underlying permission-matrix state (they're not in `CONFIGURABLE_ATTENDANCE_ROLES` either) | `ADMIN,CEO,HR,MANAGEMENT,DEPARTMENT_HEAD` (+ flag override for others) |
| NAV-03 | Sidebar — Organization Comparison link | Only visible to Owner (`ADMIN,CEO` — narrowed, was `ADMIN,CEO,MANAGER`) | Owner |
| NAV-04 | Sidebar — Employee Forms link | Now gated by the `employeeForms` module (`ADMIN,CEO,HR`) — **not** Owner anymore; HR gained this, `MANAGER` lost it | `ADMIN,CEO,HR` |
| NAV-04b | Sidebar — Settings link | Still Owner-only (`ADMIN,CEO` — narrowed from `ADMIN,CEO,MANAGER`) | Owner |
| NAV-05 | Sidebar — Payroll + Payroll Reports links | Payroll module. **Narrowed again 2026-09-24**: was `ADMIN,CEO,MANAGER`, now just `ADMIN,CEO` since `MANAGER` (Finance Manager) was removed as a role entirely — HR/MANAGEMENT already had no Payroll, and now nothing but ADMIN/CEO's own `*` wildcard reaches it. "Payroll Reports" link (placeholder page) appears alongside it for the same 2 roles | `ADMIN,CEO` |
| NAV-05b | **REMOVED 2026-09-23** — Sales / Sales Team / Sales Reports / Financial Reports links | These 4 nav links, pages, routes, and module keys were all deleted (HR-only deployment, no sales pipeline was ever going to be built). Confirm none of them appear in any role's nav anymore, and `/sales`, `/sales-team`, `/reports/sales`, `/reports/financial` all 404 via the SPA catch-all (redirect to `/`) rather than rendering anything | N/A — feature removed |
| NAV-05c | **RESTORED 2026-09-23** — HR Reports link | Briefly removed alongside the other 4, then restored the same day at the user's request — "it's a real part of the app," unlike Sales/Financial. **No longer a placeholder** (built out for real in a later same-week pass, before today's changes — this row was stale and is corrected here): wires up `GET /dashboard/executive` (headcount, present/late today, attendance rate, project status), `GET /dashboard/attendance-anomalies`, and `GET /leave/calendar` for the current month, with an ADMIN/CEO-only "This org / Whole company" scope toggle. Gated by the `hrReports` module | `ADMIN,CEO,HR` |
| NAV-06 | Sidebar — IT nav set | Shows: Dashboard, Inventory, "Employees & Assets", "Asset Assignments", Asset Requests, "Requests / Tickets", Company Calendar, My Attendance — confirm Payroll/Settings/Departments/Reports/Audit are absent. **No longer includes a "Notifications" link** (see NAV-14 — the sidebar's per-role Notifications entries were all removed, bell moved to the header) | `IT_MANAGER` |
| NAV-07 | Sidebar — Employee nav set | Shows: My Profile, My Projects, My Attendance, Company Calendar, My Employee 360°, My Tasks, My Performance, Announcements, My Payslips, Tickets. **No longer includes a "Notifications" link** (see NAV-14) | `EMPLOYEE` |
| NAV-08 | Sidebar — "My Payslips" link for EMPLOYEE | **Known contradiction, unchanged (gap #2)**: link is shown, but `/payroll/me`'s `RequirePayrollAccess` guard checks `hasModuleAccess(role,"payroll")`, which `EMPLOYEE` never has — clicking it should redirect away; confirm actual behavior | `EMPLOYEE` (expect redirect, not payslip data) |
| NAV-09 | Unread notifications badge | Sidebar polls `GET /notifications/unread-count` every 15s; badge count matches | Any authenticated |
| NAV-10 | Theme toggle / Logout / My Account | Present for every role at bottom of sidebar | All roles |
| NAV-11 | MobileNav parity | Confirm MobileNav's per-role link sets now **match** the desktop Sidebar's module-by-module gating from NAV-01a–f (previously MobileNav had its own drifted checks — e.g. it showed "Settings" unconditionally to every management role, and "Holidays" unconditionally; both are now gated the same as desktop: Settings → Owner only, Holidays → `leave` module) | All roles (mobile viewport) |
| NAV-12 | Desktop Org Switcher | Appears inline in `DashboardLayout` only for `{ADMIN,CEO,IT_MANAGER}`; switching updates all page data without full reload | `ADMIN`, `CEO`, `IT_MANAGER` (and only if authorized per AUTH-10/AUTH-11b) |
| NAV-13 | Global Search bar | Results appear for a ≥2-char query; employee/asset/project/ticket search is self-scoped for non-management/IT, org-wide for management/IT (per `search.controller.js`, unaffected by this rewrite); each result type links correctly | All roles (self-scoped); Management (6) + `IT_MANAGER` see org-wide results |
| NAV-14 | Notification bell | **Relocated 2026-09-24**: previously only in the mobile `Topbar` (`lg:hidden`) plus a buried "Notifications" link in each Sidebar role branch — both sidebar links (all three branches: management/IT/employee, and their unread-count query) were removed. `<NotificationBell />` now also renders in the desktop header row in `DashboardLayout.jsx` (`lg:flex`, next to the global search bar/org switcher — that layout wraps every route), so the bell + unread badge + dropdown is visible up top for **every** role on desktop now, not just on mobile via Topbar | All roles |

---

## 3. Dashboard (`/` and `/dashboard`)

Route guard: only reachable by `isManager` (Management-6 union check used
in `App.jsx`, **unchanged** by this rewrite) or `IT_MANAGER`; a plain
`EMPLOYEE` hitting `/` or `/dashboard` is redirected to their own
`/employees/:id` profile.

Dashboard.jsx's internal role checks were **not** part of this rewrite —
they still use their own local, narrower buckets, independent of
`ROLE_MODULES`. Document current behavior, don't assume it changed.

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
| DASH-01 | Header banner + org-scope selector | "Current organization / All organizations" toggle appears only when Dashboard's **own** local `isManagement`. **Updated 2026-09-24**: this local array dropped `MANAGER` along with its removal as a role — was `["ADMIN","CEO","MANAGER"]`, now `["ADMIN","CEO"]` (same drift-prone pattern flagged elsewhere — it's a separate hardcoded local variable, not the shared `isManagement()` util, it just happens to currently match `Owner`) | `ADMIN,CEO` |
| DASH-02 | 3 stat cards (Total Assets / Assigned Assets+utilization% / Warranty Alerts ≤30d) | Numbers match inventory data | `GET /dashboard/stats` — open to any authenticated role at the route layer, but this section only *renders* for `isManager` roles |
| DASH-03 | Executive Snapshot section | Only visible to `ADMIN,CEO` (Dashboard's local `isManagement` — narrowed 2026-09-24 when `MANAGER` dropped, was `ADMIN,CEO,MANAGER`) — confirm `HR, MANAGEMENT, DEPARTMENT_HEAD` reach the Dashboard route but do NOT see this section (known discrepancy vs. the shared `isManagement()` util — gap #5, unchanged by this rewrite) | `ADMIN,CEO` only |
| DASH-04 | Executive tiles: Employees / Present today / Projects / Total assets | Values correct for selected scope (`organization` vs `company`) | `GET /dashboard/executive?scope=` — `requireManagement` (still the broad 7-role bucket) |
| DASH-05 | Project status breakdown | Not started / In progress / Completed counts correct | same endpoint |
| DASH-06 | "Attendance watch" (late today / missing checkout) | Counts correct; links through to `/attendance` | same endpoint |
| DASH-07 | Latest announcements (4 items) | Matches `GET /dashboard/announcements` | Management (6) can also POST/DELETE announcements from Dashboard section |
| DASH-08 | Inventory Activity line chart | Date range filter updates chart; disabled/absent for IT (moot — IT never reaches this branch) | `GET /dashboard/inventory-activity?start&end` — `requireInventoryAccess`, now `ADMIN,CEO,IT_MANAGER` (narrowed — `MANAGER` dropped) |
| DASH-09 | Utilization radial gauge | Percentage matches assigned/total from `stats` (computed client-side, no separate call) | Management (6) |
| DASH-10 | Upcoming events / mini calendar | Week/month range toggle; leave events filtered into a separate list | `GET /dashboard/events?range=` — `requireAuth` |
| DASH-11 | "Add event" | Dashboard.jsx's own local `isManager` gates the button (distinct from both `isManagement` above and the shared module map). **Updated 2026-09-24**: was `["ADMIN","CEO","MANAGER","HR"]`, now `["ADMIN","CEO","HR"]` since `MANAGER` was dropped along with its removal as a role — confirm only these 3 roles see it, even though the backend route (`requireManagement`) would actually accept the call from `MANAGEMENT`/`DEPARTMENT_HEAD` too if they hit the API directly | UI: `ADMIN,CEO,HR`; API: Management (5) |
| DASH-12 | Recent Activities (4 items) | Matches `GET /dashboard/activity` | Management (6) |
| DASH-13 | Top Assigned Assets (3 items) | Matches `GET /dashboard/latest-assets` | Management (6) |
| DASH-14 | Alerts & Notifications widget | **`GET /api/alerts` is still not mounted on the backend (404)** — confirm widget shows "All clear"/empty state rather than crashing; this is a broken feature, not a config issue (gap #1, unchanged) | Management (6) — polled every 30s |
| DASH-15 | Decorative company-name banner | Renders the current organization's name; no API dependency; purely cosmetic | All roles that reach the dashboard |

---

## 4. Employees module

| ID | Feature / Endpoint | What to verify | Roles with access |
|---|---|---|---|
| EMP-01 | `/employees` list page | Full directory with filters — route guard `canViewEmployeeDirectory` = `hasModuleAccess(role,"employees")` **or** `role === "IT_MANAGER"`. **Bug found and fixed 2026-09-23**: the first version of this rewrite dropped the `IT_MANAGER` exception, breaking IT's own "Employees & Assets" nav link (redirected them away); restored, since the backend already redacts this response to name/email/phone/role/status/photo/department/assignedAssets for that role (`stripForIT`) — it's IT's asset-assignment view, not an HR directory | `ADMIN,CEO,HR,MANAGEMENT,DEPARTMENT_HEAD,IT_MANAGER` (IT redacted) |
| EMP-02 | `GET /api/employees` | Route guard is now `requireRole(...EMPLOYEE_DIRECTORY_ROLES)` = `ADMIN,CEO,HR,MANAGEMENT,DEPARTMENT_HEAD,IT_MANAGER` — **`IT_MANAGER` is deliberately included here** even though it has no "employees" module and can't open the `/employees` page: `stripForIT()` in `employee.controller.js` redacts the response to just name/email/phone/role/status/photo/designation/department/assignedAssets, and Assignments.jsx depends on this call for its asset-assignment employee picker. Confirm (a) IT_MANAGER's response is redacted, (b) `MANAGER`/`SALES_HEAD` are rejected | `ADMIN,CEO,HR,MANAGEMENT,DEPARTMENT_HEAD,IT_MANAGER` (IT redacted) |
| EMP-02b | `DEPARTMENT_HEAD` roster scoping | A `DEPARTMENT_HEAD` calling `GET /api/employees` (any `department` query param) only ever gets employees from **their own** department — the `department` filter is force-overridden server-side, not client-controlled; a department head with no `departmentId` set gets an empty list, not the whole org | `DEPARTMENT_HEAD` |
| EMP-03 | `GET /api/employees/import/template`, `POST /api/employees/import` | CSV template download + bulk import — `employees` module | `ADMIN,CEO,HR,MANAGEMENT,DEPARTMENT_HEAD` |
| EMP-04 | `GET /api/employees/:id` (noStore) | Any authenticated user can view their own profile; a `DEPARTMENT_HEAD` viewing **someone else's** profile is now scoped to their own department (404 for an out-of-department id) — confirm `Cache-Control: no-store` header present (module-01 security fix) | Self (any role) / directory roles (any org profile) / `DEPARTMENT_HEAD` (own dept only) |
| EMP-05 | `/employees/:id` profile page | Self can edit own phone/email only; a role with the `employees` module can edit everything | Self (limited fields) + `ADMIN,CEO,HR,MANAGEMENT,DEPARTMENT_HEAD` (full) |
| EMP-05b | **New 2026-09-24**: role badge on profile header | The header card (avatar, name, department, status/level/work-location chips) now also shows a small role badge — reusing `ROLE_LABELS` — as the first chip, so the viewed employee's role (CEO/Admin/HR/etc.) is visible at a glance. Confirm it renders for whoever's viewing (any role, on anyone's profile they're allowed to open), not just for management | Any authenticated (viewing any profile they can already open) |
| EMP-06 | `PATCH /api/employees/:id` | Enforce field-level restriction server-side, not just hidden in UI, for self-edits. **Known gap**: unlike the read side (EMP-04/EMP-02b), this write endpoint does **not** re-check a `DEPARTMENT_HEAD`'s own department against the target employee — a `DEPARTMENT_HEAD` who already knows/guesses another department's employee id can still `PATCH` them, since the gate is `requireModuleOrSelf("employees")` (role has the module, full stop) not a scoped check. File as a real gap, not a false positive, if reproduced. | Self (own record, limited) / `ADMIN,CEO,HR,MANAGEMENT,DEPARTMENT_HEAD` (any record — DEPARTMENT_HEAD **not** scoped here, see gap note) |
| EMP-07 | `POST /api/employees/:id/reset-password` | **Changed 2026-09-24, twice the same day**: first restricted from the `employees` module (which `HR/MANAGEMENT/DEPARTMENT_HEAD` also hold for directory access — any of them could reset another employee's password) to route-level `requireRole("ADMIN","CEO")` only. **Same-day follow-up**: HR asked back in, but scoped — route now `requireRole("ADMIN","CEO","HR")`, and the controller (`resetPassword` in `auth.controller.js`) 403s with "HR cannot reset an Admin or CEO's password" if an HR caller's target user's role is `ADMIN`/`CEO` (needs the *target*'s role, which route-level `requireRole` can't see). `EmployeeProfile.jsx`'s `canResetPassword` mirrors this exactly: ADMIN/CEO always see the button; HR sees it only when the profile being viewed isn't ADMIN/CEO. Confirm `MANAGEMENT`/`DEPARTMENT_HEAD` — despite having the `employees` module — get 403/no button here | `ADMIN,CEO` (any target); `HR` (any target except `ADMIN`/`CEO`) |
| EMP-06b | **New 2026-09-24**: ADMIN/CEO profile protection on `PATCH /api/employees/:id` | Editing an ADMIN or CEO profile returns 403 "Only an Admin or CEO can edit an Admin or CEO profile" unless the requester is ADMIN/CEO (self-edit also fine) — confirm HR/MANAGEMENT/DEPARTMENT_HEAD are blocked despite holding the `employees` module, and see no Edit button on those profiles. An ADMIN **can** edit a CEO's details but gets 403 changing the CEO's `role` ("Only a CEO can change a CEO's role") or `status` ("...status") — Role/Status selects are disabled in that case. Same protection on certification add/edit/delete (`certification.controller.js`). **Also fixed**: saving any profile edit as HR/MANAGEMENT/DEPARTMENT_HEAD used to 403 because the form always resent the unchanged `role`; the role guard now only fires when the role actually changes — confirm HR can save an ordinary employee's profile | ADMIN/CEO targets: `ADMIN`, `CEO` (+ self); CEO role/status: `CEO` only |
| EMP-08 | `DELETE /api/employees/:id` | Deletes/deactivates an employee. A CEO account can only be removed by another CEO — an ADMIN gets 403 "Only a CEO can remove a CEO account", and the Remove button is hidden on CEO profiles (**UI gate added 2026-09-24**; backend check pre-existing) | `ADMIN, CEO` only (narrowed — `MANAGER` dropped, since Finance Manager has no Employees module at all now); CEO targets: `CEO` only |
| EMP-09 | Certifications: add/edit/delete (`POST/PATCH/DELETE /api/employees/:id/certifications...`) | CRUD on an employee's certifications. **Router-level gate is now `requireModule("certifications")` = `ADMIN,CEO,HR`** (was `ADMIN,CEO,MANAGER` — this was the actual bug being fixed: HR previously had no access at all despite the tree giving it to them). **Also fixed a follow-on bug**: the controller's own internal `isManagement` check inside each of the three handlers still hardcoded `["ADMIN","CEO","MANAGER"]` after the route was updated, which would have 403'd HR anyway despite passing the router — now uses `hasModuleAccess(role,"certifications")` too. Confirm HR can actually add/edit/delete a certification end-to-end, not just reach the route. | `ADMIN,CEO,HR` (+ self can manage their own) |
| EMP-09b | Certification visibility on `GET /employees/:id` | The `certifications` field is stripped from the response unless the viewer has the `certifications` module or is viewing their own profile — was hardcoded `["ADMIN","CEO","MANAGER"]`, now `hasModuleAccess(role,"certifications")`; confirm HR now sees it, `MANAGER`/`SALES_HEAD`/`MANAGEMENT`/`DEPARTMENT_HEAD` do not (unless self) | `ADMIN,CEO,HR` (+ self) |
| EMP-10 | `/employees/:id/attendance` history page | Per-employee attendance history view | No explicit route guard — verify who can actually reach a *different* employee's history vs. their own (likely should be self or Management) — **unchanged by this rewrite** |
| EMP-11 | `/employee-360/:id` (Employee 360°) | Aggregated profile+assets+attendance+performance view; `GET /api/employee-360/:id` is `requireAuth` only | Any authenticated (confirm whether it should be self-or-management scoped) — **unchanged** |
| EMP-12 | `/employee-forms` builder | Create/toggle custom onboarding forms, view submissions. Route guard is the `employeeForms` module (`ADMIN,CEO,HR`), not Owner — HR gained this, `MANAGER` (since removed as a role entirely, see §0) lost it. **Also fixed**: the page component itself had its own hardcoded `if (!["ADMIN","CEO","MANAGER"].includes(role)) return null` gate that would have shown a blank page to HR even after the route let them in — now uses `hasModuleAccess(role,"employeeForms")` | `ADMIN,CEO,HR` |
| EMP-12b | **New 2026-09-24**: `PATCH /employee-forms/:id` | `updateEmployeeForm` — edits `title` and/or extends `expiresAt` (via the same `expiresInDays` days-from-now convention `createEmployeeForm` uses). Separate from the existing `PATCH /employee-forms/:id/toggle` (only flips `active`). Frontend: each form card gets an inline Edit (pencil) form (title + "extend expiry by") | `ADMIN,CEO,HR` (same `employeeForms` module gate) |
| EMP-12c | **New 2026-09-24**: `DELETE /employee-forms/:id` | `deleteEmployeeForm` — deletes the form; `EmployeeFormSubmission.form` is `onDelete: Cascade`, so its responses go with it (confirm the frontend's confirm dialog surfaces this). Frontend Delete button uses `window.confirm` | `ADMIN,CEO,HR` |
| EMP-12d | **New 2026-09-24**: `DELETE /employee-forms/:id/submissions/:submissionId` | `deleteEmployeeFormSubmission` — deletes one response only, form and other responses untouched. Frontend: Delete button next to each response's status chip in the "Form responses" panel, `window.confirm`-gated | `ADMIN,CEO,HR` |
| EMP-13 | Public form fill (`/employee-form/:token`) | Prospective employee fills form with no login. **See AUTH-12** for the 2026-09-24 submit-500 fix and its still-pending migration | Public |
| EMP-14 | CEO role assignment cap | Role dropdown blocks assigning a 4th CEO (`MAX_CEO_COUNT=3`) in both `EmployeeProfile.jsx` and `Employees.jsx` role selects | Owner (only they can reassign roles) |
| EMP-15 | **REMOVED 2026-09-24** — Finance Manager (`MANAGER`) role, re-scoped | The `MANAGER` role itself no longer exists (dropped from `UserRole` in `schema.prisma`, migration `20260924130000_remove_manager_role` — same enum-rebuild pattern as `SALES_HEAD`) — there is nothing left to test here; a login with this role can't be created. Historical note only: between 2026-09-23 and its removal the following day, it briefly had only narrow Payroll/Payroll Reports access after previously being treated as "Owner-tier" everywhere | N/A — role removed |

---

## 5. Inventory / Assets module

| ID | Feature / Endpoint | What to verify | Roles with access |
|---|---|---|---|
| INV-01 | `/inventory` list | Browse/filter assets — Inventory module narrowed: `ADMIN,CEO,IT_MANAGER` (was `+MANAGER`) | `ADMIN,CEO,IT_MANAGER` |
| INV-02 | `GET /api/assets` (list), `GET /api/assets/categories` | Both are `requireAuth` only at the route layer — confirm any authenticated role (not just inventory module) can read these — **unchanged** | Any authenticated (read) |
| INV-03 | `GET /api/assets/:id` | Same — `requireAuth` only | Any authenticated |
| INV-04 | `/inventory/:id` (AssetProfile page) | Full asset detail; page's own `canManage` gate now uses `hasModuleAccess(role,"inventory")` instead of the old broad `isManagement` (which would have wrongly included HR/SALES_HEAD/MANAGEMENT/DEPARTMENT_HEAD, none of whom can even reach the route) | `ADMIN,CEO,IT_MANAGER` |
| INV-05 | `POST /api/assets` (create) | New asset creation | `ADMIN,CEO,IT_MANAGER` |
| INV-06 | `POST /api/assets/:id/assign`, `.../unassign` | Assign/unassign to an employee | `ADMIN,CEO,IT_MANAGER` |
| INV-07 | `POST /api/assets/:id/status`, `.../lifecycle` | Status change (repair/lost/etc.), lifecycle event log | `ADMIN,CEO,IT_MANAGER` |
| INV-08 | `DELETE /api/assets/:id`, `DELETE /api/assets/categories/:name` | Delete asset / delete a category | `ADMIN,CEO,IT_MANAGER` |
| INV-09 | `GET /api/assets/import/template`, `POST /api/assets/import` | CSV bulk import | `ADMIN,CEO,IT_MANAGER` |
| INV-10 | `/assignments` page | Cross-employee assignment overview | `ADMIN,CEO,IT_MANAGER` |
| INV-11 | `/asset-requests` page + `POST/GET /api/asset-requests` | Any authenticated user can **request** an asset and see their own requests | Any authenticated (self-scoped for non-review roles) |
| INV-12 | `PATCH /api/asset-requests/:id/review`, `POST .../fulfill` | Approve/reject/fulfill a request. **Fixed a real gap**: this used to be `requireManagement` (Management-6), which never included `IT_MANAGER` — so IT could see "Asset Requests" prominently in its own nav but got a 403 actually reviewing/fulfilling one. Now gated by the `assetRequests` module (`ADMIN,CEO,IT_MANAGER`); `HR/SALES_HEAD/MANAGEMENT/DEPARTMENT_HEAD/MANAGER` **lost** this action entirely (it's not in their tree modules) | `ADMIN,CEO,IT_MANAGER` (changed from Management-6) |
| INV-13 | `DELETE /api/asset-requests/:id` | Cancel own pending request | Self (owner of the request) |

---

## 6. Attendance module

### 6a. Self-service attendance

Unchanged by this rewrite — included for completeness.

| ID | Feature / Endpoint | What to verify | Roles with access |
|---|---|---|---|
| ATT-01 | `/attendance/me` (MyAttendance) | Loaded eagerly (not lazy) so it works offline on first load | All roles |
| ATT-02 | `POST /api/attendance/self/mark` | Check-in/out with geofence validation for OFFICE/FIELD modes; `locationMode=WFH` skips geofence+coordinates entirely | Self |
| ATT-03 | WFH mode selector | Selecting WFH before check-in suppresses location prompt + assigned-site card | Self |
| ATT-04 | Check-in progress fill animation | Visual fill animates on the Check In button; does not block actual submission | Self |
| ATT-05 | `POST /api/attendance/self/offline-sync` | Queued offline check-ins/outs sync once back online; `locationMode` respected | Self |
| ATT-06 | `POST /api/attendance/self/corrections` | Employee requests a correction to a past record | Self |
| ATT-07 | `GET /api/attendance/self` | Own attendance history | Self |
| ATT-08 | Org-switch scoping regression | Mark attendance while an `ADMIN`/`CEO`/`IT_MANAGER` has switched to a *different* org via the header — confirm it still records against the user's **real** employer org | `ADMIN`, `CEO`, main-company `IT_MANAGER` |
| ATT-09 | Geofence check (RADIUS site) | Click-to-place marker on Leaflet map; check-in inside radius passes, outside fails | Self |
| ATT-10 | Geofence check (POLYGON site) | Boundary must have ≥4 vertices to save; point-in-polygon math accepts ≥3 for legacy data | Self / Management |
| ATT-11 | Offline queue (`offlineAttendance.js`) | Confirm it still stores/replays events correctly | Self |

### 6b. Admin/management attendance

| ID | Feature / Endpoint | What to verify | Roles with access |
|---|---|---|---|
| ATT-12 | `/attendance` grid page | Route guard changed from `RequireManagement` (Management-6) to the `attendance` module (`ADMIN,CEO,HR,MANAGEMENT,DEPARTMENT_HEAD`) — **`SALES_HEAD` and `MANAGER` (Finance Manager) can no longer reach this page at all**, confirm redirect. Actual data-action visibility (Mark/Save/Resolve) is still gated by the **Attendance permission matrix**, not just the route | `ADMIN,CEO,HR,MANAGEMENT,DEPARTMENT_HEAD` reach the page; matrix decides what they can do |
| ATT-12b | `DEPARTMENT_HEAD` grid scoping | The daily attendance grid (`GET /api/attendance`) for a `DEPARTMENT_HEAD` only lists employees from **their own department** — confirm a department head cannot see other departments' rows even by paging/searching | `DEPARTMENT_HEAD` |
| ATT-13 | `GET /api/attendance` (daily grid data) | Requires `canRead` per the matrix | Per matrix (§6c) |
| ATT-14 | `POST /api/attendance/mark`, `POST /api/attendance/save` | Requires `canCreate` **or** `canUpdate` | Per matrix |
| ATT-15 | `GET /api/attendance/export` | Date-range export; for a `DEPARTMENT_HEAD` the exported sheet only includes their own department's employees (same scoping as the grid) | Per matrix (`canRead`); `DEPARTMENT_HEAD` scoped to own dept |
| ATT-16 | `GET /api/attendance/anomalies`, `PATCH /api/attendance/anomalies/:id/resolve` | List + resolve anomalies (late/missing checkout) | `canRead` / `canUpdate` |
| ATT-17 | `GET /api/attendance/corrections` | Review submitted correction requests | `canRead` |
| ATT-18 | "Working from home" badge | `LocationFlag` shows WFH badge when `row.locationMode === "WFH"` and no coordinates recorded | Viewers with `canRead` |
| ATT-19 | Working Time progress bar (grid + EmployeeProfile) | Bar fills correctly; falls back to live checkIn→now span; caps a still-open shift's running total at 23:59:59 UTC | Viewers with `canRead` |
| ATT-20 | `/attendance/sites` page | Configure geofenced sites (Leaflet map, radius or polygon). Route guard now the `attendance` module, same narrowing as ATT-12 | `ADMIN,CEO,HR,MANAGEMENT,DEPARTMENT_HEAD` |
| ATT-21 | `GET/POST/PATCH/DELETE /api/attendance-sites*` | Router-level gate is still `requireAuth` only — no role check at that layer (unchanged, still gap #3). The controller's own internal `MANAGEMENT` array was updated to drop `MANAGER` (`["ADMIN","CEO","HR","MANAGEMENT","DEPARTMENT_HEAD"]`, matching the `attendance` module) — re-verify a Finance Manager (`MANAGER`) can no longer manage sites even via direct API call, and that the router-level gap for a plain `EMPLOYEE`/`IT_MANAGER`/`SALES_HEAD` is still open (unresolved, don't assume it's fixed) | Should be Management only; **verify enforcement, MANAGER now excluded** |
| ATT-22 | `PUT /api/attendance-sites/:id/employees` (noStore) | Assign employees to a site | Same gap/note as ATT-21 |
| ATT-23 | `POST /api/attendance-sites/verify` | Ad-hoc geofence check against a site | `requireAuth` only |
| ATT-24 | LocationSearch (Nominatim) | Typing a place debounced-searches OpenStreetMap Nominatim | Whoever can reach `/attendance/sites` |
| ATT-25 | Basemap tiles | Confirm plain OSM raster tiles load | Same |

### 6c. Attendance permission matrix (Settings)

| ID | Feature / Endpoint | What to verify | Roles with access |
|---|---|---|---|
| PERM-01 | `GET /organization/attendance-permissions/me` | Any user can check their own resolved effective permission | Any authenticated |
| PERM-02 | `GET /organization/attendance-permissions` | Returns the matrix for the **5** configurable roles — `SALES_HEAD` was removed from `CONFIGURABLE_ATTENDANCE_ROLES` (it has no Attendance module at all, nothing to configure): `HR, MANAGEMENT, DEPARTMENT_HEAD, IT_MANAGER, EMPLOYEE`. Route guard **narrowed from `ADMIN,CEO,MANAGER` to `ADMIN,CEO`** — Finance Manager can no longer view or edit this matrix, consistent with losing Attendance entirely | `ADMIN, CEO` only |
| PERM-03 | `PUT /organization/attendance-permissions` | Save edited matrix; server silently strips any submitted row for `ADMIN/CEO` (can't be reconfigured) or an invalid/unconfigurable role (now includes `SALES_HEAD` and `MANAGER` in that "invalid" bucket) | `ADMIN, CEO` only |
| PERM-04 | Default: HR with no configured row | Read-only (`canRead: true` only) even before any row is saved — **unchanged** | `HR` |
| PERM-04b | Default: MANAGEMENT / DEPARTMENT_HEAD with no configured row | **New default** — full CRUD (`FULL_ACCESS`) rather than falling through to the generic no-access-unless-flag path, since Attendance is one of their tree modules | `MANAGEMENT`, `DEPARTMENT_HEAD` |
| PERM-05 | Default: legacy `canManageAttendance` flag | A configurable-role user with the legacy per-user flag set gets full CRUD if no explicit matrix row exists yet — still applies to `IT_MANAGER`/`EMPLOYEE` (and `HR` if you want to override its read-only default with an explicit row, not the flag, since HR is special-cased ahead of the flag check) | Configurable roles w/ flag |
| PERM-06 | Default: no flag, no row, not HR/MANAGEMENT/DEPARTMENT_HEAD | Zero access (all 4 actions false) | `IT_MANAGER`, `EMPLOYEE` w/o flag |
| PERM-07 | `ADMIN/CEO` always full | Confirm these 2 (not 3 — `MANAGER` dropped) never appear in the editable matrix UI and always resolve to full CRUD regardless of DB state | `ADMIN, CEO` |
| PERM-08 | Settings UI | Matrix is editable from Settings by `ADMIN/CEO` only now (was `+MANAGER`) | `ADMIN, CEO` |

### 6d. Leave, Holidays, Biometric

| ID | Feature / Endpoint | What to verify | Roles with access |
|---|---|---|---|
| LV-01 | `/leave-requests` page + `POST /api/leaves` | Submit a leave request | Any authenticated (self) |
| LV-02 | `GET /api/leaves` | Non-`leave`-module roles see only own requests; `leave` module roles see all, **except `DEPARTMENT_HEAD` which is scoped to their own department's employees only** (an `employeeId` query param combined with the department filter, not a full override) | Self-scoped (default) / `ADMIN,CEO,HR` (all) / `DEPARTMENT_HEAD` (own dept only) |
| LV-03 | `GET /api/leaves/balance` | `employeeId` query param usable only by `leave`-module roles — verify a non-management user passing another employee's ID is rejected | Self (own) / `ADMIN,CEO,HR,DEPARTMENT_HEAD` (any) |
| LV-04 | `GET /api/leaves/calendar` | Leave calendar view. Route guard now the `leave` module (`ADMIN,CEO,HR,DEPARTMENT_HEAD` — was Management-6, so `SALES_HEAD`/`MANAGEMENT`/`MANAGER` lost this). `DEPARTMENT_HEAD` sees only their own department's approved leave | `ADMIN,CEO,HR,DEPARTMENT_HEAD` (dept-scoped for the latter) |
| LV-05 | `PATCH /api/leaves/:id/review` | Approve/reject. Route guard now the `leave` module. **A `DEPARTMENT_HEAD` reviewing a leave application outside their own department now gets a 404** (new scoping check) — confirm this, not just that the route itself is reachable | `ADMIN,CEO,HR,DEPARTMENT_HEAD` (dept-scoped for the latter) |
| LV-06 | `DELETE /api/leaves/:id` | Cancel own pending leave | Self |
| LV-07 | `/leave-calendar` route | Confirm it redirects to `/calendar` | All roles |
| HOL-01 | `/holidays` page + `GET /api/holidays` | View org holiday list | Any authenticated (view) |
| HOL-02 | `POST/DELETE /api/holidays` | Add/remove holidays. Route guard now the `leave` module (was Management-6) — `SALES_HEAD`/`MANAGEMENT`/`MANAGER` lost this | `ADMIN,CEO,HR,DEPARTMENT_HEAD` |
| BIO-01 | `/settings/attendance-devices` | Configure biometric devices | Owner (`ADMIN,CEO` — narrowed) |
| BIO-02 | `GET/POST/PATCH/DELETE /api/biometric/devices*`, `.../rotate-token`, `.../mappings` | Router-level gate is still `requireAuth` only, but the controller's own `management()` helper **does** enforce role — confirmed not just assumed (was previously flagged as "verify, don't assume" — now verified: `["ADMIN","CEO"].includes(role) || canManageAttendance` flag). Narrowed from `+MANAGER` to match Settings being Owner-only now | `ADMIN, CEO` (+ legacy flag override) |
| BIO-03 | `GET /api/biometric/connector/config`, `POST .../heartbeat`, `POST .../punches` | Device-token auth (`connectorAuth`), not user JWT | Device token only |
| BIO-04 | ADMS protocol (`/assetflow/:orgSlug/iclock/*`) | Raw handshake endpoints for physical device push; no `requireAuth` | Device protocol only |
| BIO-05 | Connector instances (`connector-org-a`, `connector-org-b`) | Two connector instances share one physical device but push to two orgs | N/A (service-level) |

---

## 7. Payroll module

Most granular per-action role-gating in the app — test each action with
exactly the role listed, and confirm every *other* role gets a 403.
`MANAGER`/"Finance Manager" **was removed entirely as a role on
2026-09-24** (see §0) — every row below now reflects Payroll as
`ADMIN`/`CEO` only (a few actions `ADMIN`-only, a few `CEO`-only); rows
still mentioning `MANAGER` gaining or holding an action are describing
pre-2026-09-24 history.

| ID | Feature / Endpoint | What to verify | Roles with access |
|---|---|---|---|
| PAY-01 | `/payroll` page | Payroll dashboard/list. Route guard `canAccessPayroll` = `hasModuleAccess(role,"payroll")`. **Narrowed further 2026-09-24**: was `ADMIN,CEO,MANAGER`, now `ADMIN,CEO` only since `MANAGER` was removed as a role (nobody picked up its `payroll` module entry) | `ADMIN,CEO` |
| PAY-02 | `GET /api/payroll` (noStore) | List all payslips, gated by the `payroll` module. **Narrowed further 2026-09-24**: was `ADMIN,CEO,MANAGER`, now `ADMIN,CEO` only | `ADMIN,CEO` only |
| PAY-03 | `GET /api/payroll/me` (noStore) | Own payslips only | Any authenticated (self) — but see PAY-11 re: route guard |
| PAY-04 | `POST /api/payroll/generate` | Generate a payroll run. **Narrowed back 2026-09-24**: briefly `ADMIN, MANAGER` (2026-09-23 through 2026-09-24), now `requireRole("ADMIN")` only — `MANAGER` lost this along with its removal as a role, and `CEO` was never included here (CEO's role is sign-off, via PAY-06/07/08) | `ADMIN` only |
| PAY-05 | `POST /api/payroll/submit` | Submit for approval to the CEO. Same narrowing as PAY-04 — briefly `ADMIN, MANAGER`, now `ADMIN` only | `ADMIN` only |
| PAY-06 | `POST /api/payroll/approve`, `POST /api/payroll/reject` | Approve/reject a run — unchanged, salaries pay from the CEO's own account | `CEO` only |
| PAY-07 | `POST /api/payroll/:id/mark-paid` | Mark an individual payslip paid — unchanged | `CEO` only |
| PAY-08 | `DELETE /api/payroll/bulk` | Bulk-delete payroll records — unchanged | `CEO` only |
| PAY-09 | `PATCH /api/payroll/:id` | Edit a payslip. Same narrowing as PAY-04/05 — briefly `ADMIN, MANAGER`, now `requireRole("ADMIN")` only | `ADMIN` only |
| PAY-10 | `DELETE /api/payroll/:id` | Delete a single payslip. Briefly `ADMIN, CEO, MANAGER`, now `requireRole("ADMIN","CEO")` — `MANAGER` dropped along with its removal as a role | `ADMIN, CEO` |
| PAY-11 | `/payroll/me` route guard vs. Sidebar | Route guard is `RequirePayrollAccess` (excludes plain `EMPLOYEE`), but Sidebar shows "My Payslips" to `EMPLOYEE` — confirm actual redirect behavior when an `EMPLOYEE` clicks it (gap #2, unchanged) | `EMPLOYEE` (expect blocked, contradicting the visible nav link) |
| PAY-12 | Payroll.jsx UI gating | **Narrowed 2026-09-24**: `canManagePayroll` is now `user?.role === "ADMIN"` only (was `hasModuleAccess(role,"payroll")` with `["ADMIN","MANAGER"]` briefly) — Generate/Submit/Edit/Save controls show for `ADMIN` only now; the Delete control (and CEO's own Approve/Reject/Mark-Paid/Bulk-Delete) uses `canManagePayroll || isCeo`, matching the backend's `ADMIN,CEO` delete guard (PAY-10) | `ADMIN` (prep/edit); `ADMIN, CEO` (delete); `CEO` (sign-off) |
| PAY-13 | `/payroll/reports` (Payroll Reports) | **No longer a placeholder** (was a "Coming soon" stub when first added; built out for real in a later same-week pass, before today's changes — this row was stale and is corrected here): backs onto a real `GET /payroll/summary?year=` endpoint (`requireModule("payrollReports")` + `noStore`), aggregating a year's payroll records by month (net-pay bar chart), department, and status, with a last-5-years picker. No bank account numbers included. Gated by the `payrollReports` module. **Narrowed 2026-09-24**: was `ADMIN,CEO,MANAGER`, now `ADMIN,CEO` only since `MANAGER` was removed as a role | `ADMIN,CEO` |

---

## 8. Organization module

| ID | Feature / Endpoint | What to verify | Roles with access |
|---|---|---|---|
| ORG-01 | `GET /api/organization`, `GET /api/organization/company` | Basic org info | Any authenticated |
| ORG-02 | `/organization-comparison` page + `GET /api/organization/comparison` | Cross-org comparison view. Both frontend `RequireOwner` and backend route narrowed from `ADMIN,CEO,MANAGER` to `ADMIN,CEO` | Owner (`ADMIN,CEO`) |
| ORG-03 | `POST /api/organization/suborganizations`, `DELETE .../suborganizations/:id` | Create/delete a sub-org. Route guard **and** the controller's own internal role check both narrowed from `ADMIN,CEO,MANAGER` to `ADMIN,CEO` (the internal check's error message also updated, was previously stale/misleading) | `ADMIN, CEO` |
| ORG-04 | `PATCH /api/organization` | Edit org settings (name, primary color, working hours/day, timezone). Narrowed from `ADMIN,CEO,MANAGER` to `ADMIN,CEO` | `ADMIN, CEO` |
| ORG-05 | `PATCH /api/organization/company/set-main` | Designate the main company org — unchanged | `CEO` only |
| ORG-06 | `/departments` page + CRUD | **Split for the first time**: reading the list is open to any authenticated user (unchanged, needed for filter dropdowns elsewhere), but create/rename/reassign-manager is now `ADMIN,CEO` only (narrowed from Management-6 via `requireManagement`) — confirm `HR`/`SALES_HEAD`/`MANAGEMENT` can no longer create or edit a department, only view. `DEPARTMENT_HEAD` gets a **read-only** view of just their own department (page hides Add/Delete/manager-reassign controls for them — `canEdit = ["ADMIN","CEO"].includes(role)` in `Departments.jsx`) | View: any authenticated (dept-scoped for `DEPARTMENT_HEAD`); Write: `ADMIN, CEO` only |
| ORG-06b | `GET /api/departments` — `DEPARTMENT_HEAD` scoping | A `DEPARTMENT_HEAD` only ever gets their own department back (`where: { id: departmentId }`), not the full org list — a department head with no `departmentId` set gets an empty array | `DEPARTMENT_HEAD` |
| ORG-07 | Timezone picker (Settings) | All 6 GCC zones labeled with country names, plus Karachi/Kolkata; ~400 remaining IANA zones show a live "City (UTC offset)" label; grouped into `<optgroup>`s by region | Owner (Settings access) |
| ORG-08 | Shared `timezones.js` | `AttendanceSites.jsx` timezone dropdown matches `Settings.jsx` | `ADMIN,CEO,HR,MANAGEMENT,DEPARTMENT_HEAD` on AttendanceSites (attendance module), Owner on Settings |
| ORG-09 | `primaryColor` → accent token | Changing the org's brand color in Settings updates `--accent` app-wide | Owner |

---

## 9. Projects, Tasks, Performance

| ID | Feature / Endpoint | What to verify | Roles with access |
|---|---|---|---|
| PRJ-01 | `/projects` page | For `IT_MANAGER`, App.jsx redirects this route to `/inventory` | `IT_MANAGER` → redirected |
| PRJ-02 | `/projects` for everyone else | Open to all other roles (self-scoped "My Projects" for non-`projects`-module roles) | All roles except IT |
| PRJ-03 | `GET /api/projects`, `GET /api/projects/:id` | Read access; management view (all org projects) is gated by `hasModuleAccess(role,"projects")` = `ADMIN,CEO,MANAGEMENT,DEPARTMENT_HEAD` (`SALES_HEAD` had this too until its removal 2026-09-23, see §0 — no replacement role picked it up) — **`HR` and `MANAGER` have no org-wide view**, falling back to member-scoped "my projects" like a regular employee | Any authenticated (read, self-scoped by default) |
| PRJ-03b | `DEPARTMENT_HEAD` project scoping | A `DEPARTMENT_HEAD`'s "all projects" view (and single-project `GET`) is further scoped to projects that have **at least one member from their own department** — not the whole org | `DEPARTMENT_HEAD` |
| PRJ-04 | `POST/PATCH/DELETE /api/projects`, `.../members`, `.../members/:memberId` | Create/edit/delete project + manage members. Route guard changed from `requireManagement` to the `projects` module (`ADMIN,CEO,SALES_HEAD,MANAGEMENT,DEPARTMENT_HEAD`) — `HR` and `MANAGER` lost this. **New**: a `DEPARTMENT_HEAD` acting on a project outside their department scope (guessing an id, not just what's listed) now gets a 404 via `isProjectInDepartmentScope()`, on update/delete/add-members/update-member-hours | `ADMIN,CEO,SALES_HEAD,MANAGEMENT,DEPARTMENT_HEAD` (latter scoped to own dept's projects) |
| PRJ-05 | `GET /api/projects/work-categories` | Read | Any authenticated |
| PRJ-06 | `POST/PATCH/DELETE /api/projects/work-categories(/:id)` | Manage categories — still `requireManagement` (Management-6, **not** narrowed to the `projects` module — deliberate, work categories are org-wide taxonomy, not per-project) | Management (6) |
| TASK-01 | `/tasks` page ("Tasks" / "My Tasks") | **FIXED 2026-09-23**: `task.routes.js` is now mounted at `/api/tasks` in `backend/src/index.js` (previously never required, so every call 404'd for every role). List/create/update/delete now actually work | All roles reach the page; API now works |
| TASK-01b | **FIXED 2026-09-24**: create form silent no-op | Reported as "Tasks page not working" — the entire DB had zero `Project` rows, `createTask` required `projectId`, and the create-form submit handler silently no-op'd (`if (form.projectId && form.title.trim()) create.mutate()`) whenever nothing was selected, with an always-empty "Select project" dropdown — clicking "Create task" visibly did nothing, no error. The API itself was already correct end-to-end; this was a pure UX gap. **Superseded the same day by TASK-04** (project made fully optional) rather than just fixing the error message — confirm both: a missing **title** now shows a visible inline error ("Task title is required."), and a missing **project** no longer blocks submission at all | Any role reaching the create form |
| TASK-02 | Task management actions | Create/update-others'-fields/delete gated by the `tasks` module (`ADMIN,CEO,MANAGEMENT,DEPARTMENT_HEAD` — `SALES_HEAD` had this too until its removal 2026-09-23, `MANAGER` never had it and was removed as a role entirely 2026-09-24) instead of a local hardcoded array — `HR` cannot create/delete tasks or reassign/reschedule someone else's, but can still update the `status`/`actualHours` of a task assigned to them (self-update path, unchanged) | `ADMIN,CEO,MANAGEMENT,DEPARTMENT_HEAD` (management actions); assignee (status/hours on own task) |
| TASK-03 | `DEPARTMENT_HEAD` task scoping | Task list/create/update/delete for a `DEPARTMENT_HEAD` is scoped to tasks assigned to someone in their department **or** belonging to a project with a member from their department **or** — since TASK-04 made a task's project optional — a project-less, unassigned task the department head created themselves. **Reworked 2026-09-24** as `isTaskInDepartmentScope()` (was `isTaskProjectInDepartmentScope()`, which always returned `false` for a `projectId: null` task — a real bug TASK-04 would otherwise have introduced, since it would have 404'd a DEPARTMENT_HEAD trying to edit/delete *any* project-less task, even ones assigned to their own department). Acting on an out-of-scope task/project returns 404, not just omitted from lists | `DEPARTMENT_HEAD` |
| TASK-04 | **New 2026-09-24**: Task no longer requires a Project | `Task.projectId` is now nullable (`String?`) in `schema.prisma`; `createTask` only requires `title`; a task can be assigned directly to an employee with no parent project. Also fixed two crashes this would otherwise have introduced: `createTask`/`updateTask`'s status-change/assignment notifications used to build their message as `` `${task.project.name}: ...` `` unconditionally, which throws on a null `project` — both now fall back to just the task title. **Manual step pending**: migration `20260924140000_task_project_optional` is not yet deployed to the live DB as of this writing — until `cd backend && npx prisma migrate deploy && npx prisma generate` actually runs, the live DB still enforces `NOT NULL` on `projectId`, so creating a project-less task will still fail at the DB layer even though the app code now allows it | Same as TASK-02 (create/update `projectId`, management-only) |
| TASK-05 | **New 2026-09-24**: full task-edit UI | `updateTask` already supported editing every field, but `Tasks.jsx` only ever exposed the status dropdown. Added an Edit (pencil) button next to Delete (both management-only) that swaps a task card into an inline form covering title/description/assignee/priority/due date/estimated+actual hours/project, via the same `PATCH /tasks/:id`. Status stays its own always-visible dropdown outside edit mode, since a plain assignee (not just management) can update status/actual-hours on their own task, and folding it into the management-only form would take that away | `ADMIN,CEO,MANAGEMENT,DEPARTMENT_HEAD` (edit/delete UI); assignee (status dropdown only) |
| PERF-01 | `/performance` page ("Performance" / "My Performance") | **FIXED 2026-09-23**: `performance.routes.js` mounted at `/api/performance/:employeeId` — but that alone did **not** fully fix this page (see PERF-01b). | All roles reach the page |
| PERF-01b | **FIXED 2026-09-24**: real 404 on submit, silent-empty list | Reported as "Performance page not working," screenshot showing "Route not found: POST /api/performance" on submit. Root cause: `performance.routes.js` only ever defined `GET/POST /performance/:employeeId` (for `Employee360.jsx`); the separate standalone `Performance.jsx` page was written against a flat-collection shape — `GET /performance` to list, `POST /performance` with `employeeId` in the body — that never existed server-side. The list call 404'd silently (React Query left `reviews` at its `[]` default, so the page just looked empty); the create call surfaced the visible "Route not found" error. Fixed by adding `listAllPerformanceReviews`/`createPerformanceReviewForEmployee` (org-wide `GET/POST /performance`, same visibility rule as the per-employee route) alongside the unchanged `GET/POST /:employeeId` — different path shapes on the same router, no conflict. Re-test end-to-end: list now populates and create actually succeeds | All roles (list/create per PERF-02's rule) |
| PERF-02 | Performance review create/list-others | Gated by the `performance` module (`ADMIN,CEO,MANAGEMENT` — was the broad `isManagement()` bucket, which wrongly included `HR,SALES_HEAD,MANAGEMENT,DEPARTMENT_HEAD`; `MANAGER` never had this module and was removed as a role entirely 2026-09-24) — confirm only `MANAGEMENT` (plus ADMIN/CEO) can create a review or view someone else's; everyone else can still see their **own** performance history. This rule is now shared identically by both the per-employee (`/:employeeId`) and org-wide (`/`, PERF-01b) routes | `ADMIN,CEO,MANAGEMENT` (create/view-any); self (view own) |
| PERF-03 | **New 2026-09-24**: `PATCH /performance/:id` | `updatePerformanceReview` — edit period/rating/goals/achievements/feedback on an existing review (employee can't be reassigned). Gated the same as create — management only. Sits on the same router as the existing `GET/POST /:employeeId` per-employee routes with no path conflict (different HTTP methods). `Performance.jsx` gained an Edit (pencil) button per review card that swaps it into an inline form, matching the Employee Forms edit-in-place pattern | `ADMIN,CEO,MANAGEMENT` |
| PERF-04 | **New 2026-09-24**: `DELETE /performance/:id` | `deletePerformanceReview` — management only. `Performance.jsx` gained a matching Delete (trash) button per review card | `ADMIN,CEO,MANAGEMENT` |

---

## 10. Tickets

| ID | Feature / Endpoint | What to verify | Roles with access |
|---|---|---|---|
| TKT-01 | `/tickets` page | File and view tickets | All roles |
| TKT-02 | `GET /api/tickets`, `POST /api/tickets` | Any authenticated user can file a ticket; **the "see everyone's tickets" list scope changed** from the broad Management-6 bucket to the `tickets` module (`ADMIN,CEO,IT_MANAGER`) — `HR/SALES_HEAD/MANAGEMENT/DEPARTMENT_HEAD/MANAGER` now only see their **own** filed tickets, same as a regular employee | Any authenticated (own); `ADMIN,CEO,IT_MANAGER` (all) |
| TKT-03 | `PATCH /api/tickets/:id/status`, `DELETE /api/tickets/:id` | Update status / delete. **Fixed a real gap**: was `requireManagement`, which never included `IT_MANAGER` despite Support/Tickets being IT's own module — IT could see and file tickets but not resolve them. Now gated by the `tickets` module (`ADMIN,CEO,IT_MANAGER`) | `ADMIN,CEO,IT_MANAGER` (changed from Management-6) |
| TKT-04 | Open-ticket count on Dashboard | IT dashboard's stat-card sublabel and the management dashboard's underlying fetch both consume `GET /tickets` — confirm counts match the Tickets page for whichever scope that viewer sees (all vs. own, per TKT-02) | Roles that reach a dashboard |
| TKT-05 | Frontend Tickets.jsx management gate | The page's own `isAdmin` control-visibility variable (status dropdown, delete button) was `isManagement(role)` (Management-6); now `hasModuleAccess(role,"tickets")` — confirm `HR/SALES_HEAD/MANAGEMENT/DEPARTMENT_HEAD` no longer see those controls (they'd have 403'd anyway per TKT-03, this closes the UI/API mismatch) | `ADMIN,CEO,IT_MANAGER` |

---

## 11. Reports, Export, Audit Log

| ID | Feature / Endpoint | What to verify | Roles with access |
|---|---|---|---|
| RPT-01 | `/reports` page (generic, inventory-flavored report) | Route guard changed from `RequireManagement` (Management-6) to the `reports` module (`ADMIN,CEO,MANAGEMENT`) — `DEPARTMENT_HEAD/MANAGER` have no replacement report page; `HR` has its own (HR Reports, restored — see RPT-03) | `ADMIN,CEO,MANAGEMENT` |
| RPT-02 | `GET /dashboard/repair-spend`, `.../attendance-anomalies` | Reporting data endpoints — still `requireManagement` (Management-6, unchanged) | Management (6) |
| RPT-03 | `/reports/hr` (HR Reports) | Removed 2026-09-23 then restored the same day at the user's request. **Built out for real since** (see NAV-05c) — no longer a "Coming soon" placeholder | `ADMIN,CEO,HR` |
| RPT-04 | **REMOVED 2026-09-23**: `/reports/sales`, `/reports/financial` | These 2 placeholder pages were deleted along with their routes/nav links/module keys — confirm each URL now hits the SPA catch-all (redirects to `/`) rather than a blank/error page | N/A — feature removed |
| EXP-01 | `/export` page | Route guard changed from `RequireManagement` to the `reports` module (`ADMIN,CEO,MANAGEMENT`) — narrower than before | `ADMIN,CEO,MANAGEMENT` |
| EXP-02 | `GET /api/export/employees`, `/inventory`, `/departments`, `/tickets` | **Each of the 4 is now gated by its own matching module** instead of one blanket `requireManagement` check: `employees` → `ADMIN,CEO,HR,MANAGEMENT,DEPARTMENT_HEAD`; `inventory` → `ADMIN,CEO,IT_MANAGER`; `departments` → `ADMIN,CEO,DEPARTMENT_HEAD`; `tickets` → `ADMIN,CEO,IT_MANAGER`. Confirm a role that can reach `/export` (`MANAGEMENT`) can actually download the employees/inventory/departments/tickets exports it has modules for, and gets 403 on ones it doesn't (e.g. `MANAGEMENT` has no `inventory` module, so its inventory export call should 403 even though it can reach the page) | Per-module, see left |
| AUD-01 | `/audit-log` page + `GET /api/audit-log` | View system audit trail. **Narrowed from Management-6 to `ADMIN,CEO` only** — the audit log isn't a per-role tree module, so it's kept Owner-only rather than reopened broadly | `ADMIN, CEO` |

---

## 12. Notifications, Announcements, Alerts

| ID | Feature / Endpoint | What to verify | Roles with access |
|---|---|---|---|
| NOT-01 | `/notifications` page | List own notifications | Any authenticated |
| NOT-02 | `GET /api/notifications`, `GET .../unread-count` | Data + badge count | Any authenticated |
| NOT-03 | `POST /api/notifications/read-all`, `.../read-by-type`, `.../:id/read` | Mark-as-read actions | Any authenticated (own notifications) |
| ANN-01 | `/announcements` page | View org announcements | Any authenticated |
| ANN-02 | `GET /dashboard/announcements` | Read | Any authenticated |
| ANN-03 | `POST /dashboard/announcements`, `DELETE .../:id` | Create/delete an announcement — still `requireManagement` (Management-5, unchanged). **Fixed a frontend drift**: `Announcements.jsx`'s own `management` gate was hardcoded to `["ADMIN","CEO","MANAGER"]` — `MANAGER` was never actually part of the `MANAGEMENT_ROLES` bucket (see §0), so this hardcoded array both wrongly included a role that didn't belong and missed `SALES_HEAD/HR/MANAGEMENT/DEPARTMENT_HEAD` entirely; those roles could create/delete via the API but never saw the controls. Now uses the shared `isManagement()` util; confirm all 5 current Management roles see the create/delete controls (`SALES_HEAD` and `MANAGER` no longer exist to test) | Management (5) |
| ALR-01 | Dashboard "Alerts & Notifications" widget | **`GET /api/alerts` is still never mounted — always 404s** (gap #1, unchanged) | Management (6) — widget polls every 30s regardless |

---

## 13. Calendar

| ID | Feature / Endpoint | What to verify | Roles with access |
|---|---|---|---|
| CAL-01 | `/calendar` (AdvancedCalendar) | Full calendar view, merges events + leave + holidays. **Fixed a frontend drift (2026-09-23)**: the "Add event" button's `management` gate was hardcoded `["ADMIN","CEO","SALES_HEAD","HR","MANAGEMENT","DEPARTMENT_HEAD"]` (missing `MANAGER`, which at the time still existed and could reach the backend's `requireManagement` gate directly) — now uses the shared `isManagement()` util. **`MANAGER` was removed entirely as a role on 2026-09-24** (see §0), so this no longer matters in practice — there's no `MANAGER` login left to see the button either way | All roles reach the page; Management (5) see "Add event" |
| CAL-02 | `/leave-calendar` redirect | Confirm it lands on `/calendar`, doesn't 404 or show a stale page | All roles |

---

## 14. Settings

| ID | Feature / Endpoint | What to verify | Roles with access |
|---|---|---|---|
| SET-01 | `/settings` page | Org profile, branding color, working hours, timezone, attendance permission matrix. **Owner narrowed to `ADMIN,CEO`** — `MANAGER` (Finance Manager) can no longer reach Settings at all | Owner (`ADMIN,CEO`) only |
| SET-02 | `/settings/attendance-devices` | Biometric device management UI | Owner (`ADMIN,CEO`) only |
| SET-03 | Attendance permission matrix editor | See §6c (PERM-01…08) — **narrowed to `ADMIN,CEO`**, both the route (`organization.routes.js`) and the frontend | `ADMIN, CEO` |
| SET-04 | Non-owner access attempt | `HR`, `MANAGEMENT`, `DEPARTMENT_HEAD`, `IT_MANAGER`, `EMPLOYEE` hitting `/settings` directly by URL → redirected to `/` (`RequireOwner`'s failure path). **`MANAGER` and `SALES_HEAD` can no longer even be tested here** — both roles were removed entirely (2026-09-24 and 2026-09-23 respectively, see §0), not just excluded from Settings; a login with either can't be created anymore | All non-owner roles (negative test) |

---

## 15. Profile / Account & Misc

| ID | Feature / Endpoint | What to verify | Roles with access |
|---|---|---|---|
| PROF-01 | `/profile` page | Self account settings (password change, etc.) | Any authenticated |
| BILL-01 | `/billing` route | Confirm it redirects to `/` and no UI links to it | N/A (should be unreachable) |
| WELC-01 | `/`, `/login`, `/register` (logged out) | Public marketing/auth pages render without a session | Public |

---

## 16. Cross-cutting security / RBAC test batch

Run these as a dedicated pass after the module-by-module tests above:

1. **Header hardening (module 01)**: confirm `helmet()` HSTS header present.
2. **no-store PII routes (module 01)**: unchanged, still present.
3. **401 handling (module 02)**: unchanged, still correct.
4. **Broken/unmounted endpoints**: `/api/tasks` and
   `/api/performance/:employeeId` were **mounted** 2026-09-23 (previously
   never `require`d, 404 for everyone) — but mounting alone didn't make
   `Performance.jsx` (the standalone org-wide page) actually work end to
   end: it posted to a flat `/performance` shape that didn't exist until
   the 2026-09-24 fix (see PERF-01b). Re-verify all of TASK-01/01b and
   PERF-01/01b/02, not just that the routes return non-404. `/api/alerts`
   is **still** unmounted/broken (unchanged, gap #1).
5. **Payroll self-link contradiction (gap #2)**: unchanged — `EMPLOYEE`
   sees "My Payslips" in nav but is blocked by the route guard.
6. **Attendance-site route gate (gap #3)**: unchanged — router-level gate
   is still `requireAuth` only. The controller's internal management array
   dropped `MANAGER` before it was removed as a role outright on
   2026-09-24 — there's no longer a `MANAGER` login to test this with at
   all (historical note only, see §0).
7. **Biometric device route gate**: **no longer a "verify, don't assume"
   gap** — confirmed the controller does enforce `ADMIN,CEO` (+ legacy
   flag), narrowed from `+MANAGER`.
8. **Dashboard `isManagement` mismatch (gap #5)**: still a separate local
   array in Dashboard.jsx, independent of the new module map. **Updated
   2026-09-24**: dropped `MANAGER` along with its removal as a role — now
   `["ADMIN","CEO"]` (was `ADMIN,CEO,MANAGER`); re-confirm
   `HR/MANAGEMENT/DEPARTMENT_HEAD` reach `/dashboard` but don't see
   Executive Snapshot (`SALES_HEAD` no longer exists to test either, see
   §0).
9. **Org-switch forgery**: unchanged, still enforced in
   `auth.middleware.js`. Also re-run AUTH-11b (org-switcher list vs.
   enforcement fix).
10. **`.env` git-history check**: still open, unchanged.
11. **CEO count enforcement**: unchanged.
12. **REMOVED 2026-09-24** — Finance Manager (`MANAGER`) narrow-scope
    regression: this item previously called for re-testing that a
    `MANAGER` user was blocked from Inventory/Employees/Organization
    Comparison/Settings/the Attendance matrix/Attendance/Departments/Leave
    while keeping Payroll/Payroll Reports. The role itself was removed
    entirely on 2026-09-24 (see §0) — there's no `MANAGER` login left to
    run this against. Nothing to re-test here going forward.
13. **IT_MANAGER capability gaps, now fixed**: re-test that `IT_MANAGER`
    can actually review/fulfill an asset request (INV-12) and
    update/delete a ticket (TKT-03) — previously visible in nav but 403'd
    on the actual action.
14. **Department Head data scoping — new, dedicated pass**: for each of
    Employees (EMP-02b), Attendance (ATT-12b), Projects (PRJ-03b/PRJ-04),
    Tasks (TASK-03), Leave (LV-02/LV-04/LV-05), and Departments (ORG-06b):
    create two departments with different employees/projects/tasks, log
    in as a `DEPARTMENT_HEAD` of one, and confirm zero visibility/action
    into the other department's data — not just that the *listed* rows
    happen to be filtered, but that acting directly on an out-of-scope
    record by id returns 404, not a silent success.
15. **`PATCH /api/employees/:id` scoping gap (new, EMP-06)**: confirm
    whether a `DEPARTMENT_HEAD` can edit an out-of-department employee's
    record directly (expected: currently **can**, unlike the read side) —
    file as a known gap if reproduced, this is a real, currently-open
    inconsistency introduced by this rewrite, not a false positive.
16. **Frontend/backend role-list drift, fixed**: `Projects.jsx`,
    `AdvancedCalendar.jsx`, `AttendanceSites.jsx`,
    `attendance-site.controller.js`, `Announcements.jsx`,
    `EmployeeForms.jsx`, `certification.controller.js`,
    `biometric.controller.js`, `employee.controller.js` (certifications
    visibility), `organization.controller.js` (suborg create/delete
    internal check) all had their own hardcoded role arrays that had
    drifted from the shared util/module map — all now call
    `hasModuleAccess`/`isManagement` instead. Spot-check a couple of these
    files directly to confirm no stray hardcoded array was missed.

---

## Appendix: known pre-existing gaps to track separately (not new bugs to file blind)

These are documented in `CLAUDE.md` as already-known, deliberate, or
tracked items — confirm current status rather than re-reporting them as
new findings:

- Only `MyAttendance` was pulled out of lazy-loading for offline support;
  every other route can still fail with "Failed to fetch dynamically
  imported module" if opened for the first time while offline.
  Deliberately out of scope per prior user request.
- JWT payload still carries a legacy `companyId` claim — flagged as
  possibly unnecessary long-term.
- **New from this rewrite**: `PATCH /api/employees/:id` doesn't re-check a
  `DEPARTMENT_HEAD`'s own department against the target employee (item 15
  above) — a real, currently-open gap, not fully closed like the read-side
  scoping.
- **Payroll Reports** (the one placeholder page kept after the
  2026-09-23 cleanup, see §0) is **no longer a placeholder** — it was
  built out for real (see PAY-13) with a real `GET /payroll/summary?year=`
  backend before today's `MANAGER`-removal changes; this appendix entry
  was stale (it and this file's mention of `MANAGER` predate that
  build-out and the role's removal). It's now gated by the
  `payrollReports` module, `ADMIN`/`CEO` only.
- **Three migrations from 2026-09-24 are not yet deployed to the live DB**
  as of this writing (same "manual step, required" pattern as module 07
  and the `SALES_HEAD`-removal migration — `cd backend && npx prisma
  migrate deploy && npx prisma generate`, all three can run in the same
  pass):
  - `20260924120000_employee_form_submission_optional_fields` — until this
    runs, the public employee form's submit button still 500s (AUTH-12).
  - `20260924130000_remove_manager_role` — the Postgres `UserRole` enum
    still technically includes `MANAGER` until this runs (0 live users
    hold it, so low practical risk, but role-assignment/DB-level tests
    shouldn't assume the enum itself has been rebuilt yet).
  - `20260924140000_task_project_optional` — until this runs, the live DB
    still enforces `NOT NULL` on `Task.projectId`, so creating a
    project-less task (TASK-04) will still fail at the DB layer even
    though the application code now allows it.

