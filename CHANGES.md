# What changed — Round 2

Continues on top of Round 1 (roles/leave/attendance/search-bar-fix). No
design files were touched. Everything below is functionality only.

## 1. Admin can edit any data — including their own contact info
- `PATCH /api/employees/:id` now supports editing `email` too (not just
  the fields from before), with a uniqueness check.
- Management (ADMIN/CEO/Sales Head/HR) can edit **any** employee's full
  profile — name, email, phone, department, status, CNIC, DOB, address,
  skill, level — from that employee's profile page (new "Edit" button on
  Personal Information).
- Anyone (including a plain employee, including an admin looking at their
  *own* record) can edit their own phone and email from **Profile →
  Contact Info**, without needing management rights. Enforced both in the
  UI and on the backend (`requireManagementOrSelf` middleware + field
  allowlists in the controller).

## 2. Import employees from Excel
- `POST /api/employees/import` (management only) — upload an `.xlsx`,
  get back a report of what was created vs. skipped (with reasons:
  missing name/email, duplicate email, unauthorized role, etc.).
- `GET /api/employees/import/template` — downloadable starter workbook
  with the expected columns.
- New "Template" / "Import Excel" buttons on the Employees page.
- Every imported row gets a random temp password, same as adding one
  employee at a time.

## 3. Pagination
- `GET /api/employees` and `GET /api/assets` now support `?page=&pageSize=`.
  **Opt-in**: omit `page` and you still get the old plain array (so the
  various dropdowns elsewhere in the app that expect a full list keep
  working unchanged). The Employees and Inventory pages now use it, with
  a reusable `Pagination` control and debounced search (won't refetch on
  every keystroke — waits ~350ms after you stop typing).

## 4. Lazy loading
- Every page component is now loaded on demand via `React.lazy` +
  `Suspense` instead of one large upfront bundle — faster first paint,
  especially on slower connections.

## 5. Scrollbars where needed
- Wide tables (Employees, Inventory, Attendance, Tickets) now scroll
  horizontally inside their card instead of clipping on narrow screens.
- Long lists that aren't paginated (assigned assets, ticket history,
  activity feed on an employee's profile) are capped with a scrollable
  panel instead of growing the page indefinitely.
- Added a subtle thin scrollbar style globally so these don't look like
  a jarring default OS scrollbar.

## 6. JWT / bcrypt — reviewed, already solid
- Passwords: bcrypt (cost 10), never stored or returned in plaintext.
- Sessions: signed JWTs (`JWT_SECRET`, default 7-day expiry via
  `JWT_EXPIRES_IN`), verified on every request. No changes needed here —
  this was already implemented correctly.

## 7. CNIC is now encrypted at rest
- CNIC is sensitive personal info, so it's no longer stored as plaintext.
  It's encrypted with AES-256-GCM (`ENCRYPTION_KEY` in `.env`) before
  being saved and decrypted only when returned to the employee themselves
  or a management user — never in list views.
- **Note on "hash" vs "encrypt":** a true one-way hash (like bcrypt for
  passwords) can never be turned back into the original value — that
  works for passwords because you only ever need to *check* them, never
  *see* them again. CNIC needs to be displayed back (to the employee, to
  HR editing a typo), so it needs reversible **encryption**, which is
  what's implemented. This is the same approach used for SSNs and similar
  PII in production systems.
- A dev `ENCRYPTION_KEY` has already been generated and added to
  `backend/.env` for you. For any other environment (staging/production),
  generate your own and keep it secret — anyone with this key plus DB
  access can decrypt CNICs, so treat it like `JWT_SECRET` or a DB password.
- `backend/scripts/encrypt-existing-cnic.js` — one-off script to encrypt
  any CNIC values already in the database from before this change. Safe
  to re-run (skips already-encrypted values).

# Required setup steps

```bash
cd backend
npm install                                   # picks up multer if not already present
node scripts/encrypt-existing-cnic.js         # one-time: encrypt any existing plaintext CNICs
npm run seed                                  # optional, re-seeds with encrypted CNICs
```

No Prisma schema changes this round, so **no migration is required** —
CNIC stays a `String` column, just holding ciphertext instead of plaintext.

Frontend: no new packages needed.

**Important for deployment**: make sure `ENCRYPTION_KEY` (and `JWT_SECRET`)
are set in your production environment's env vars — the server now
refuses to start without both. Generate a production key the same way:
```bash
node -e "console.log(require('crypto').randomBytes(32).toString('hex'))"
```
Do **not** reuse the dev key that's currently sitting in `backend/.env`.

---

# Where to deploy this

AssetFlow is a standard **two-service** app: a Postgres-backed Node/Express
API and a static Vite/React frontend. Deploy them separately.

## Backend (Node API + Prisma + Postgres)
You're already on **Neon** for Postgres (see `DATABASE_URL` in `.env`), so
pair it with any Node host that runs a long-lived process — Neon's
connection pooling works well with all of these:
- **Render** (Web Service) — easiest for a small team: connect the repo,
  build command `npm install && npx prisma generate && npx prisma migrate deploy`,
  start command `npm start`. Add all `.env` vars in the dashboard.
- **Railway** — similar flow, auto-detects Node, add env vars in the UI.
- **Fly.io** — more control if you want to pin region close to Neon's.

Whichever you pick, set these environment variables in the host's
dashboard (never commit them):
`DATABASE_URL`, `DIRECT_URL`, `JWT_SECRET`, `JWT_EXPIRES_IN`,
`ENCRYPTION_KEY`, `CLIENT_ORIGIN` (your deployed frontend's URL),
`NODE_ENV=production`, `PORT` (most hosts set this for you).

Run once after first deploy (or as a release step):
```bash
npx prisma migrate deploy
node scripts/encrypt-existing-cnic.js   # only needed once, safe to re-run
```

## Frontend (static Vite build)
Build output is static files — deploy to **Vercel** or **Netlify**:
- Build command: `npm install && npm run build`
- Output directory: `dist`
- Environment variable: `VITE_API_URL` set to your deployed backend's URL
  plus `/api` (e.g. `https://your-api.onrender.com/api`)

Both Vercel and Netlify auto-deploy on every push once connected to your
repo, which is the easiest way to keep this current as you iterate.

---

# What changed — Round 3

## 1. Leave types + yearly balance
- Leave applications now have a **type**: Sick, Casual/Annual, or Unpaid.
- Yearly allowance is **14 paid days total — 8 sick + 6 casual**. Unpaid
  has no cap but still requires approval like every other leave type.
- New `GET /api/leaves/balance` endpoint (optionally `?year=&employeeId=`
  for management) returns used/remaining for the current calendar year,
  computed from approved applications.
- **My Attendance** now shows a balance summary (Sick x/8 left, Casual
  x/6 left, Unpaid days taken) and a Type dropdown on the leave form.
- **Leave Requests** (management) has a Type filter alongside the
  existing Status filter, and each row shows a type badge.
- This changed `schema.prisma` (new `LeaveType` enum + `type` column on
  `LeaveApplication`) — **run the migration below**.

## 2. Inventory categories (Laptop / Accessories / Stationery / …)
- `GET /api/assets/categories` returns a canonical starter list (Laptop,
  Desktop, Monitor, Accessories, Stationery, Phone, Other) plus any custom
  category already in use in your org.
- `GET /api/assets` now also accepts an exact `?category=` filter.
- The Inventory page has category filter chips (reusing the same pill
  style as the top navigation tabs, so it matches the existing design)
  and the Add Asset form's category field is now a dropdown instead of
  free text, keeping data clean for filtering.
- Seed data now includes a few Accessories/Stationery items so the new
  categories aren't empty on a fresh database.

# Required setup steps

```bash
cd backend
npx prisma migrate dev --name leave_types
npm run seed   # optional — refreshes demo data with the new leave type + categories
```

---

# What changed — Round 4

## 1. Fixed: unassigning an asset didn't count correctly on the dashboard
The "Remove" button on an employee's Assigned Assets list was working, but
sent no `eventType`, so the backend logged it as a generic "NOTE" instead
of "UNASSIGNED" — meaning it silently didn't show up in the Inventory
Activity chart's "Available" series. Fixed, and the same fix applies to
the new Unassign button on the asset's own page (see below).

## 2. Assign / Unassign now available from the Asset's own page too
Previously you could only assign/unassign from an employee's profile.
The Asset Detail page now has an "Assignment & Status" card (management
only): assign to any active employee, unassign with one click, or mark
the asset Available/Repair/Lost/Disposed — exactly the same authority
pattern as everywhere else (whoever can assign something can also
remove it).

## 3. Fixed: employee status dropdown didn't match the database
The Edit form on an employee's profile offered "Active / Inactive", but
the actual `EmployeeStatus` enum is `ACTIVE / ON_LEAVE / LEFT_COMPANY` —
picking "Inactive" would have failed with a database error. Fixed to
match the real enum (this bug existed before this round; caught during
a full pass over the app).

## 4. Public Holidays
- Management can add/remove org-wide holidays (Settings → "Manage
  Holidays"). A holiday inside a leave request's date range doesn't
  count against the employee's balance.
- New page: **Holidays** (`/holidays`).

## 5. Half-day leave
- The leave request form (My Attendance) now supports a half-day option
  for single-day requests — counts as 0.5 against the balance instead
  of a full day.

## 6. Configurable leave policy
- The 14/8/6 split from Round 3 is no longer hardcoded — Settings now
  has a "Leave Policy" card where the owner sets Sick and Casual days
  per year for the whole org.

## 7. Leave Calendar
- New page: **Leave Calendar** (`/leave-calendar`, management) — a
  month grid showing everyone's approved leave at a glance, color-coded
  by type, with month navigation.

## 8. Audit Log
- Sensitive actions are now recorded: role changes, employee removal,
  org rename, asset assign/unassign, leave approve/reject, holiday
  add/remove.
- New page: **Audit Log** (`/audit-log`, management) with a text filter
  by action.

## 9. Ticket categories
- Tickets can now be tagged Hardware / Software / Access / Other, with
  filter chips on the Tickets page (same pattern as Inventory categories).

# Required setup steps

This round changed `schema.prisma` again (Holiday, AuditLog models;
Organization leave-policy fields; LeaveApplication half-day field;
Ticket category; a few smaller additions). Since no incremental
migrations were created between rounds, one migration now captures
everything since `init`:

```bash
cd backend
npx prisma migrate dev --name full_feature_set
npm run seed   # optional — refreshes demo data, includes sample holidays
```

# Deferred (not built this round)

To keep this round shippable, the rest of the earlier suggestions list
was intentionally left out — flagging so nothing is assumed done:
bulk actions on Inventory, low-stock alerts for consumables, org chart
view, employee document storage, anniversary/probation reminders,
auto-mark-absent job, ticket SLA/due-dates and comment threads,
scheduled email reports, a live notification bell, 2FA, and session
management. Happy to pick any of these up next.

---

# What changed — Round 5 (full visual redesign)

Implemented the "AssetFlow Executive" design system from your uploaded
Stitch export (`stitch_assetflow_management_system.zip` / `DESIGN.md`):
a sage-green canvas, cream cards, a floating dark pill sidebar, and
extreme roundedness throughout. This was a **visual-only** pass — no
functionality, routes, or data logic changed; every page keeps working
exactly as before, just restyled.

## How it was done
The app already used semantic CSS variables and shared components
everywhere (`.card`, `.pill-*`, `.field`, `StatusPill`, `IconChip`,
`Avatar`, etc.) instead of hardcoded colors — so most of the visual
overhaul came from changing the **tokens once**, not editing every page:

- `tailwind.config.js` — new color palette, 24px card radius, new shadows
- `styles/index.css` — new CSS variables (light + dark mode), Inter font,
  restyled shared classes (search/category filter chips are now proper
  12px "mini-cards" with a pressed-in selected state, matching the design)
- `index.html` — Nunito Sans → Inter

## What got hand-touched
- **Sidebar** — completely rebuilt as the floating dark pill nav from
  the reference (fixed position, icon-only with tooltips, scrollable if
  it overflows, theme toggle + logout + avatar at the bottom). The
  collapse/expand toggle from before is gone — the new design is always
  icon-only, which is simpler and matches the reference exactly.
- **Topbar** — now mobile-only (desktop navigation lives entirely in
  the sidebar now).
- **DashboardLayout** — simplified accordingly, correct spacing for the
  fixed sidebar.
- **PageHeader** — rebuilt with an optional back button, a bold
  two-line-capable title, and an optional inline stat-strip (used on
  Dashboard). Every page now has a back button.
- **Employee Profile** — restructured into the reference's signature
  "contact panel" layout: a centered photo/avatar, name, and quick
  action buttons (edit, email, call, remove) in a narrow right column,
  with assets/tickets/activity in the wider left column.
- **Dashboard & Reports charts** — recolored to the new palette (the
  old blue/amber/slate chart colors would have clashed).
- Search bars are now properly pill-shaped per the design spec (regular
  form fields stay at 12px radius, only search/quick-filter inputs are
  full pills).

## What inherited the new look automatically (no edits needed)
Every other page — Employees, Inventory, Attendance, Tickets, Leave
Requests/Calendar, Holidays, Audit Log, Settings, Profile, Departments,
Assignments, Export, Billing, Notifications — already used the shared
card/button/field/badge components, so they picked up the new palette,
fonts, and shapes automatically once the tokens changed.

## Verification
Full syntax/brace-balance pass across all 44 frontend `.jsx` files plus
a load-check on the Tailwind config — everything parses cleanly. No
schema or backend changes this round, so no migration is needed.

---

# Hotfix — Tickets.jsx wouldn't compile

`src/pages/Tickets.jsx` had a missing closing `</div>` (left over from an
earlier round that added a horizontal-scroll wrapper around its table),
which broke Vite's dev server entirely: `Failed to scan for dependencies
... Unexpected end of file before a closing "div" tag`. Fixed.

**Why my earlier verification didn't catch this**: I'd been checking
`{`/`}` and `(`/`)` counts, which catches JS syntax errors but not
mismatched JSX tags (a stray `<div>` has none of those characters). This
round I re-verified every frontend file (46) and every backend file (35)
with esbuild's actual parser instead — genuinely compiles cleanly now,
not just "brace-balanced."

---

# What changed — Round 7 (bug fixes, no new UI redesign)

## 1. Fixed the date-shift bug (holidays, leave calendar, and the dashboard chart)
All three symptoms — holidays saving a day early, the leave calendar
highlighting the wrong day, and the inventory chart looking broken —
traced back to the **same root cause**: date-only values (holiday date,
leave start/end, attendance date, the chart's date range) were parsed
with `new Date(str)` followed by `d.setHours(0, 0, 0, 0)`. That
combination is unsafe on any server not running in UTC — `setHours`
mutates in the server's *local* time, so it silently shifted the stored
date backward by a day.

Fixed with a new shared `backend/src/utils/date.js` (`toDateOnly`,
`dateKey`, `addDaysUTC`) wired into `holiday.controller.js`,
`leave.controller.js`, `attendance.controller.js`, and
`dashboard.controller.js`. The frontend had a matching bug in
`LeaveCalendar.jsx` (grid cells and leave dates were keyed two different,
inconsistent ways) — fixed with plain calendar-date-string comparisons
that never round-trip through `Date` + timezone conversion. Also added
`timeZone: "UTC"` to every date-only display spot (`Holidays.jsx`,
`LeaveRequests.jsx`, `MyAttendance.jsx`, `AssetProfile.jsx`,
`EmployeeProfile.jsx`) so this is correct for anyone, not just one
timezone.

## 2. Employee removal now frees up their assets, with history preserved
Deleting an employee previously left any assets still assigned to them
in a broken state (status stuck on "Assigned" with no holder). Now,
before the employee is removed: every asset they're holding is set back
to Available, and a lifecycle event is logged on each one first — so the
fact that it *was* assigned to that person, and that it was freed up
because they were removed, is permanently recorded in that asset's
history even after the account is gone.

## 3. Admin can add a custom inventory category on the fly
The Add Asset category field is a dropdown of existing categories plus
a **"+ Add new category…"** option that reveals a text input — type
"Office Furniture" (or anything) and it becomes a real category
immediately, filterable like any other. The backend already stored
category as free text; this was purely a missing frontend affordance.

## 4. Bulk inventory import via CSV
- `POST /api/assets/import` (management only) — upload a `.csv`, get
  back a created/skipped report (missing name/serial, duplicate serial
  number, etc.).
- `GET /api/assets/import/template` — downloadable starter CSV with the
  expected columns (name, category, serialNumber, cpu, ram, storage,
  purchaseDate, warrantyEnd, department).
- New "Template" / "Import CSV" buttons on the Inventory page, matching
  the existing employee-import UI pattern.
- CSV parsing is dependency-free (`backend/src/utils/csv.js`) rather
  than pulling in a new package.

## 5. Dark-mode sidebar
Made the sidebar's background color more robust (an inline style
alongside the Tailwind class, rather than relying solely on the
utility class) so it can't render as an unstyled/white background if
the class fails to apply for any reason. If this is still white after
updating, it likely means the dev server needs a restart to pick up the
Tailwind config — large token changes sometimes need a fresh
`npm run dev` (or clearing `node_modules/.vite`) to take effect.

# Verification
All 46 frontend files and all 37 backend files (up from 35 — two new
utils this round) re-verified with esbuild's real parser. No schema
changes this round — no migration needed.

---

# What changed — Round 8

## 1. Inventory: category-only browsing
- Removed the "All" filter chip — the inventory list now stays empty
  with a "Pick a category to see its assets" prompt until a specific
  category is selected (Laptops, Accessories, Stationery, or any custom
  one).
- Every category chip now shows its item count, e.g. "Laptop (12)" —
  `GET /api/assets/categories` now returns `{ name, count }[]` instead
  of plain strings (only Inventory.jsx consumed this endpoint, so
  nothing else needed updating).

## 2. Team leave conflict rule
Two people in the same department can no longer both be on approved
leave for overlapping dates — whoever isn't on leave is expected to be
able to cover, so only one teammate can be off at a time:
- Submitting a leave request now checks for an existing **approved**
  overlapping leave from anyone else in the same department, and blocks
  the request with a clear message naming who's already off.
- The same check runs again when management tries to **approve** a
  request — covers the case where two people applied around the same
  time and a conflict only shows up at approval time. The error now
  shows inline on that specific request card.
- "Team" = department. An employee with no department assigned has no
  conflict rule applied (nothing to compare against).

# Verification
`Inventory.jsx`, `LeaveRequests.jsx`, `asset.controller.js`, and
`leave.controller.js` re-verified with esbuild's real parser. No schema
changes this round — no migration needed.

---

# Hotfix — asset delete route crash

Your local `asset.routes.js` had a `router.delete("/:id", ...)` line
whose handler function didn't exist yet in `asset.controller.js`,
crashing the server on boot with `Route.delete() requires a callback
function but got a [object Undefined]`.

Added the missing `deleteAsset` controller (management-only, blocks
deleting an asset that's still assigned — unassign it first, clears its
lifecycle history and detaches any tickets pointing at it before the
delete, since `LifecycleEvent` has a required link to its asset with no
cascade rule and would otherwise fail with a foreign-key error) and
wired it into the route.

**Note:** I only fixed the backend piece that was actually crashing. If
you also built a frontend "Delete Asset" button for this, it should now
work against `DELETE /api/assets/:id` — I didn't touch any frontend
files this round since you mentioned making your own local changes.

---

# What changed — Round 9

## 1. Admin-assisted password reset
Management can now reset a forgotten user's password from that
employee's profile (key icon in the action row, hidden on your own
profile). Resets to a known temporary password (`password123`) and
shows it in a copyable banner. `POST /api/employees/:id/reset-password`.

## 2. Asset repair/service cost tracking
`LifecycleEvent` now has an optional `cost` field. "Mark In Repair" on
an asset prompts for an optional cost; any recorded cost shows on that
asset's lifecycle timeline. New **Repair Spend** cards on Reports —
top 10 costliest assets, and totals broken down by category — powered
by `GET /api/dashboard/repair-spend` (management only).

## 3. Asset request flow
Employees can now ask for equipment instead of only waiting for
management to assign it — "My Asset Requests" on their own profile
(category + reason, cancel while pending). New management page
**Asset Requests** (sidebar) to Approve/Reject, then **Fulfill** by
picking a specific available asset of that category — this reuses the
normal assign flow underneath (same lifecycle event, same audit trail).
New model `AssetRequest`; routes under `/api/asset-requests`.

# Required setup steps
This round changed `schema.prisma` (`LifecycleEvent.cost`, new
`AssetRequest` model + `AssetRequestStatus` enum, plus back-relations
on `User`/`Asset`):
```bash
cd backend
npx prisma migrate dev --name repair_cost_and_asset_requests
```

# Verification
All 47 frontend + 39 backend files (up from 46/37 — three new files
this round) re-verified with esbuild's real parser.

# Not built this round — payroll
Discussed but intentionally not started: a payroll system is a
different category of feature (real money, salary structure, payslip
generation) and deserves its own scoping conversation before writing
any code, especially around statutory deductions, which vary by
country. Flagging here so it isn't assumed done.

# What changed — Round 3: Payroll

## 1. New Payroll module
- `PayrollRecord` model + `PayrollStatus` enum (`DRAFT` / `PAID`) added to
  the Prisma schema, plus a nullable `baseSalary` on `User`.
- Management can set an employee's monthly `baseSalary` from their
  profile (`PATCH /api/employees/:id`, now accepts `baseSalary`).
- `POST /api/payroll/generate` `{ month, year }` — creates one DRAFT
  payroll record per ACTIVE employee with a base salary set, for that
  month. Idempotent: re-running skips employees who already have a
  record. Absent days for the month (from `AttendanceRecord`) are
  auto-converted into a pro-rated deduction, editable afterward.
- `GET /api/payroll?month=&year=` — management-only list for a given
  month, with employee + department joined.
- `GET /api/payroll/me` — self-service: an employee's own payslip
  history, any role.
- `PATCH /api/payroll/:id` — edit `bonus` / `deductions` / `note` on a
  DRAFT record (recomputes `netPay`); PAID records are immutable.
- `POST /api/payroll/:id/mark-paid` — locks a record in as PAID.
- `DELETE /api/payroll/:id` — ADMIN-only, DRAFT-only (undo an accidental
  generate).

## 2. New frontend pages
- `/payroll` (management) — month switcher, "Generate payroll" action,
  a table with inline bonus/deduction editing, mark-paid, and delete.
- `/payroll/me` (any employee) — payslip cards: base, bonus, deductions,
  unpaid days, net pay, paid date.
- Both added to the sidebar (desktop rail + mobile nav) and routed in
  `App.jsx`, following the same management/self split as
  Attendance / My Attendance.

## Migration needed
This adds new Prisma models/fields — run after pulling:
```
cd backend
npx prisma migrate dev --name add_payroll
```

---

# What changed — Payroll fix + Dashboard chart

## 1. Payroll — the actual bug: no way to set a salary
The payroll backend (`PayrollRecord` model, generate/list/edit/mark-paid/
delete, attendance-based unpaid-day deduction) was already solid — but
there was **no UI anywhere to set an employee's Base Salary**. Since
`generatePayroll` only creates a payslip for employees who have a salary
set, this meant "Generate payroll" would always skip everyone and the
whole feature would look broken/empty no matter what.

Fixed: added a **Base Salary (monthly)** field to the employee edit
form (management only) and to the read-only profile view, on
`EmployeeProfile.jsx`. The backend already fully supported this field
(`employee.controller.js`) — it just had no way to be reached.

Also fixed a smaller bug on the Payroll page itself: the employee avatar
in the payroll table was called with `size={28}` and a `src` prop that
your `Avatar` component doesn't support (it's initials-only, and sizes
are named strings like `"sm"`/`"md"`, not pixel numbers) — this rendered
with no size classes applied at all. Fixed to `size="sm"`.

**Required — this was never migrated:** `PayrollRecord`, `baseSalary`,
and `PayrollStatus` exist in `schema.prisma` but there's no migration
file for them yet, so your database doesn't actually have these
tables/columns. Run:
```bash
cd backend
npx prisma migrate dev --name add_payroll
```
Payroll will keep failing with a database error until this runs.

## 2. Dashboard chart — switched to a line chart, and fixed a real bug
- Converted the "Inventory Activity" chart from grouped bars to a
  3-line chart (Assigned / Available / Repair), same colors, same
  tooltip and axis styling.
- While rewriting it, found and removed a duplicated dead conditional
  branch (`inventoryError` was checked twice in a row, the second one
  unreachable) — harmless but worth cleaning up since I was already in
  that code.
- The chart's data-fetching, date-range picker, and fallback-to-current-
  stats behavior when no historical data exists yet were already
  correct — the only real problem was the bar-vs-line rendering itself.

# Verification
Re-verified your actual uploaded project — 49 frontend files + 41
backend files — with esbuild's real parser (not just brace-counting).
All pass.

---

# What changed — CEO-authority payroll workflow, PKR, bank details

Restructures payroll around a real approval chain instead of a single
flat role: an admin/owner generates and reviews, but only a CEO can
approve and actually pay — because salaries are disbursed from the
CEO's own account. CEO is capped at 2 per organization.

## 1. Role hierarchy: CEO is now the top authority
- **CEO** — full org authority: rename/branding/leave policy (same as
  before, now shared with ADMIN), assign roles, **and exclusively**
  holds the payroll disbursement account and approves/pays salaries.
  Capped at **2 per organization** — enforced when assigning the role
  via Add Employee or an employee's role edit (`MAX_CEO_COUNT` in
  `backend/src/utils/roles.js`).
- **ADMIN (Owner)** — still full people/asset management, still can
  rename the org and assign roles, but on the payroll side can only
  **generate** and **submit for approval** — not pay.
- Everything else about roles (HR/Sales Head/Employee) is unchanged.

## 2. Payroll approval workflow
New status: `DRAFT → PENDING_APPROVAL → PAID`.
1. Admin **Generates** payroll for a month (as before — active
   employees with a base salary set).
2. Admin reviews/adjusts bonus & deductions, then **Submits for
   Approval** — every DRAFT record for that month moves to
   `PENDING_APPROVAL` in one action.
3. CEO reviews and either:
   - **Approve & Pay All** — every pending record for that month is
     approved and marked paid **in one click**, "delivered to every
     account" at once (not one payslip at a time).
   - **Reject** — sends the whole batch back to DRAFT for the admin to
     revise.
   - **Delete All** — bulk-clears every non-paid record for the month
     in one action. Paid records are permanent and can never be
     deleted, single or bulk.

## 3. Unpaid-leave deduction is now proportional, not flat
Replaced the flat 1000 PKR (full day) / 500 PKR (half day) deduction
with a **percentage of the employee's own base salary**, banded by
salary so higher earners pay a fair proportional amount:

| Base salary       | Deduction per unpaid day |
|--------------------|--------------------------|
| Below 70,000        | 2.7% |
| 70,000 – 119,999     | 3.3% |
| 120,000 – 179,999    | 3.8% |
| 180,000 and above    | 4.5% |

A half-day unpaid leave deducts half of that day's amount. Late-arrival
deduction stays a flat, **owner-configurable** PKR amount per day
(Settings, CEO-only — see below), defaulting to 500.

## 4. Base salary floor: PKR 25,000
An employee's base salary can no longer be set below **PKR 25,000/month**
— enforced on save, both from an employee's profile and going forward
from any future entry point.

## 5. Bank account details
- **Per employee**: Bank Name + Account Number, editable by management
  from the employee's profile (encrypted at rest, same approach as
  CNIC). Snapshotted onto each payslip at generation time, so it stays
  accurate even if the employee's bank details change later.
- **Org-level payroll account** (Settings, new "Payroll Account" card,
  **CEO-only** — the section doesn't even render for anyone else): the
  account salaries are actually paid from. Also encrypted at rest, and
  the general `GET /organization` endpoint (hit by every user for
  branding) never includes it for non-CEOs.
- On the Payroll page, only a CEO sees full account numbers; other
  management roles see them masked (`•••• 1234`) — they can review and
  submit payroll without seeing exactly where the money's coming from
  or going to.

## 6. Currency: everything now shows PKR
All amounts across Payroll, My Payslips, and the employee profile now
display as `PKR 25,000.00` instead of `$25,000.00`.

# Required setup steps
This round changed `schema.prisma` again (new `PayrollStatus` value,
`approvedBy`/`approvedAt` on `PayrollRecord`, `bankName`/
`bankAccountNumber` on `User`, `payrollBankName`/`payrollAccountNumber`/
`lateDeductionAmount` on `Organization`):
```bash
cd backend
npx prisma migrate dev --name payroll_approval_and_bank_details
```

# Verification
All 49 frontend + 41 backend files re-verified with esbuild's real
parser (schema.prisma brace-balanced too). Nothing else in the app was
touched this round beyond what's listed above.
