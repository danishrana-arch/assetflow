# AssetFlow — Production Readiness Audit

**Date:** 2026-08-03
**Scope:** full-stack — backend (`backend/src`), Prisma schema & migrations (`backend/prisma`), and frontend (`frontend/src`).
**Verdict:** **DO NOT SHIP** until the CRITICAL and HIGH items below are closed.

---

## Executive Summary

The code has real architectural instincts (Prisma, TanStack Query, JWT auth, enum-typed statuses, tenant-scoped controllers). But it also has multi-tenant data leaks, plaintext PII, JWT in `localStorage`, and dev scripts that would take over the workspace if accidentally run in production. There are ~130 issues in total. Closing the CRITICAL + HIGH list is roughly 2–3 weeks of focused work paired with a senior.

**Severity distribution**
- CRITICAL: 5
- HIGH: ~35
- MEDIUM: ~45
- LOW: ~45

---

## Part 1 — Backend (`backend/src`)

### 1. Authentication & Authorization

| ID | Severity | File:line | Issue |
|---|---|---|---|
| AUTH-01 | HIGH | `src/utils/jwt.js:4,10` | `process.env.JWT_SECRET` used with no assertion at boot. Missing var throws at first sign. Fix: fail fast on boot; require min entropy. |
| AUTH-02 | HIGH | `src/utils/jwt.js:4,10` | No algorithm pinning on `jwt.sign` / `jwt.verify`. Fix: `algorithms: ['HS256']`. |
| AUTH-03 | HIGH | `src/utils/jwt.js:5` | 7-day access token, no refresh, no revocation. |
| AUTH-04 | HIGH | `src/controllers/auth.controller.js:184-186` | Password change does not invalidate existing tokens. Fix: `tokenVersion` claim. |
| AUTH-05 | HIGH | `src/routes/auth.routes.js:11` | **Employees literally cannot change their own password** — route is gated on `requireRole("ADMIN")`. |
| AUTH-06 | MEDIUM | `src/controllers/auth.controller.js:19,119,184` | Bcrypt cost factor 10 (OWASP 2023 says ≥12). |
| AUTH-07 | HIGH | `src/routes/auth.routes.js:7` | `registerOrganization` is fully public — no CAPTCHA, no email verification, no rate limit. |
| AUTH-08 | HIGH | `src/controllers/auth.controller.js:118,142` | Invitee temp password generated with `Math.random()` and returned in HTTP body. |
| AUTH-09 | LOW | `src/controllers/auth.controller.js:62-69` | Login timing side-channel enables email enumeration. |
| AUTH-10 | HIGH | — | No rate limiting on `/login`, `/register`. No account lockout. |
| AUTH-11 | MEDIUM | all controllers | Tenant scoping is trust-based on JWT claim only. No DB-level RLS, no per-request re-fetch. |
| AUTH-12 | HIGH | `src/controllers/employee.controller.js:38` | IDOR: MANAGER role treated as employee here but never granted any privileges elsewhere. Wire it up or remove. |
| AUTH-13 | MEDIUM | `src/controllers/ticket.controller.js:28-44` | No check that `assetId` belongs to caller's org. Cross-tenant ticket-to-asset possible. |
| AUTH-14 | HIGH | `src/controllers/asset.controller.js:100-124` | `assignAsset` does not verify target employee is in same org. Cross-tenant assignment possible. |
| AUTH-15 | MEDIUM | `src/controllers/employee.controller.js:83-98` | `updateEmployee` accepts arbitrary `status` string; no enum validation. |
| AUTH-16 | MEDIUM | `src/controllers/employee.controller.js:88` | `updateEmployee.departmentId` / `managerId` not org-scoped. |

### 2. Input Validation & Injection

| ID | Severity | File:line | Issue |
|---|---|---|---|
| INPUT-01 | HIGH | `package.json:25` | **`zod` is installed but never imported.** Every endpoint uses ad-hoc `if (!x)` checks. |
| INPUT-03 | MEDIUM | `src/controllers/auth.controller.js:8-11` | Register accepts any email string; no format check, no password complexity. |
| INPUT-04 | MEDIUM | `src/controllers/asset.controller.js:104` | No null/type check on `employeeId`. Arrays or objects to Prisma → 500. |
| INPUT-05 | LOW | `asset.controller.js:14-29`, `employee.controller.js:13-20` | Prisma parameterizes queries (safe from SQLi) but no length cap on search `q` — huge string across 7 ILIKE OR fields can DoS the DB. |
| INPUT-07 | LOW | multiple | `new Date(userInput)` yields `Invalid Date` → Prisma throws → 500 leaks stack (see ERR-01). |
| INPUT-08 | MEDIUM | `employee.controller.js:71,89-97`, `auth.controller.js:130-134` | Enum values not validated. |
| INPUT-09 | MEDIUM | `src/index.js:19` | `express.json()` has no `limit`. Default is 100kb; over that produces a 500 with stack. Set explicitly. |
| INPUT-10 | LOW | `asset.controller.js:15-18` | Magic-string `"expired warranty"` in search — undocumented behavior. |

### 3. Error Handling

| ID | Severity | File:line | Issue |
|---|---|---|---|
| ERR-01 | HIGH | `src/middleware/error.middleware.js:16` | Raw `err.message` returned to clients — leaks Prisma internals, SQL fragments, file paths. |
| ERR-02 | MEDIUM | `src/middleware/error.middleware.js:6` | `console.error(err)` unstructured, no request ID, no PII scrubbing. |
| ERR-03 | LOW | same | Only Prisma P2002 / P2025 mapped. P2003 / P2014 / validation errors fall through to 500. |
| ERR-04 | MEDIUM | — | No `express-async-errors`. A missed try/catch → unhandled rejection. |
| ERR-05 | MEDIUM | `src/index.js` | No `process.on('unhandledRejection' \| 'uncaughtException')` handlers. |
| ERR-06 | MEDIUM | `src/index.js:37-39` | No graceful shutdown. No `prisma.$disconnect()` on SIGTERM. |

### 4. Security Headers & Middleware

| ID | Severity | File:line | Issue |
|---|---|---|---|
| SEC-01 | HIGH | `package.json` | **`helmet` not installed.** No CSP, HSTS, X-Frame-Options, X-Content-Type-Options. |
| SEC-02 | HIGH | `src/index.js:18` | CORS defaults to `"*"`. Should hard-fail if `CLIENT_ORIGIN` unset in prod. |
| SEC-03 | HIGH | — | No rate limiting anywhere. `/login`, `/register`, `/export/*` all unlimited. |
| SEC-06 | MEDIUM | — | No morgan/pino. No request ID. Cannot correlate errors. |
| SEC-07 | MEDIUM | `src/index.js` | `app.set('trust proxy', 1)` missing — `req.ip` and future rate-limiters will be wrong behind a LB. |

### 5. Secrets & Config

| ID | Severity | Issue |
|---|---|---|
| CFG-01 | MEDIUM | No `.env.example`, no zod-validation of `process.env` at boot. |
| CFG-03 | LOW | `src/lib/prisma.js:7` — `NODE_ENV` implicitly relied upon. |

### 6. Database / Prisma (application-side)

| ID | Severity | File:line | Issue |
|---|---|---|---|
| DB-01 | HIGH | multiple list & export endpoints | **Unbounded `findMany` everywhere.** No pagination. Excel exports materialize the full org in memory. |
| DB-02 | MEDIUM | `employee.controller.js:22` | `listEmployees` includes `assignedAssets: true` for every user — huge payload + oversharing. |
| DB-03 | MEDIUM | `schema.prisma` | Missing indexes on hot filter columns (org+status, org+date, etc.). See Part 2 §3. |
| DB-04 | MEDIUM | `asset.controller.js:100-124` | `assignAsset` verify+update not transactional. Race window. |
| DB-05 | MEDIUM | `asset.controller.js:126-157` | Same race in `changeAssetStatus`. |
| DB-06 | HIGH | `employee.controller.js:107-119` | `deleteEmployee` is a hard delete with FK impact. Real employees can never be deleted (P2003). |
| DB-07 | HIGH | `department.controller.js:38` | Same problem for `deleteDepartment`. |
| DB-09 | MEDIUM | `attendance.controller.js:89-97` | `saveDayAttendance` transaction is unbounded in size — thousands of records in one tx can lock. |
| DB-10 | HIGH | `attendance.controller.js:5-9` | **Timezone bug**: `d.setHours(0,0,0,0)` uses server local time. DST/TZ boundaries produce duplicate-key errors on the `[employeeId, date]` unique. |
| DB-11 | LOW | `dashboard.controller.js:23` | `expiringWarranties` includes DISPOSED assets. |

### 7. Logic Bugs

| ID | Severity | File:line | Issue |
|---|---|---|---|
| BUG-01 | HIGH | `src/routes/auth.routes.js:11` | Duplicate of AUTH-05: employees can't change own password. |
| BUG-02 | MEDIUM | `attendance.controller.js:141`, `export.controller.js:12` | Malformed `Content-Disposition`: `attachment filename=...` missing semicolon. Wrong download filename. |
| BUG-03 | MEDIUM | `auth.controller.js:24` | Slug uses `Math.random().toString(36).slice(2,6)` — ~1.6M space, collision risk + non-crypto. |
| BUG-04 | MEDIUM | `asset.controller.js:104-118` | `assignAsset` allows null `employeeId` — silently no-ops the assignment but still forces status ASSIGNED. |
| BUG-07 | MEDIUM | `asset.controller.js:148` | `changeAssetStatus` accepts arbitrary `eventType` — audit event can lie. Derive server-side. |

### 8. Logging / Observability

| ID | Severity | Issue |
|---|---|---|
| LOG-01 | MEDIUM | `console.log`/`console.error` everywhere. |
| LOG-03 | HIGH | Error middleware logs full error object → PII (email, CNIC, password payloads) end up in logs on any Prisma failure. |
| LOG-04 | MEDIUM | No audit log for failed logins, permission denials, admin actions. |
| LOG-05 | LOW | `/health` is a stub — no DB check. |

### 9. Dependencies

| ID | Severity | Issue |
|---|---|---|
| DEP-01 | MEDIUM | Missing `engines` field in `package.json`. |
| DEP-03 | HIGH | `multer@1.4.5-lts.1` — CVE-2022-24434 and later advisories. Currently unused; remove or upgrade. |
| DEP-06 | LOW | `pdfkit`, `nodemailer`, `multer` installed but unused. |
| DEP-07 | HIGH | Missing `helmet`, `express-rate-limit`, `express-async-errors`, `pino`/`winston`. |

### 10. Dev Scripts

| ID | Severity | File:line | Issue |
|---|---|---|---|
| SCRIPT-01 | **CRITICAL** | `prisma/reset-password.js:6-19` | Takes new password on argv (shell history, `ps auxf` leak). No auth. No audit. Anyone with pod shell owns any account. |
| SCRIPT-02 | **CRITICAL** | `prisma/seed.js:13,208-209` | Hardcodes `password123` for 3 admin accounts and prints credentials. Runnable via `npm run seed`. If ever fired against prod → instant admin takeover. |
| SCRIPT-03 | LOW | `prisma/seed.js` | Not idempotent, will P2002 on re-run. |
| SCRIPT-04 | LOW | `prisma/seed.js:83,100,117` | Real-looking Pakistani CNIC values in committed test data. |

---

## Part 2 — Database & Schema (`backend/prisma`)

### 1. Multi-Tenancy (CRITICAL)

Cross-tenant scoping table:

| Table | Has `orgId`? | FK to Organization? | Composite index with orgId? |
|---|---|---|---|
| Organization | n/a | n/a | n/a |
| User | yes | yes | **NO** |
| Department | yes | yes | yes (via `@@unique([organizationId, name])`) |
| Asset | yes | yes | **NO** |
| LifecycleEvent | **NO** | n/a | **NO** |
| Ticket | yes | yes | **NO** |
| **AttendanceRecord** | yes | **NO FK** | employeeId+date only |

- **CRITICAL:** `schema.prisma:158` — `serialNumber String @unique` is **globally unique**. Two orgs cannot share a serial. Also leaks cross-tenant existence via P2002.
- **CRITICAL:** `schema.prisma:104` — `email String @unique` is **globally unique**. Same person cannot join two workspaces; enables cross-tenant enumeration.
- **CRITICAL:** `schema.prisma:220` + `migration.sql:196-200` — `AttendanceRecord.organizationId` has **no FK** to Organization. Orphan rows possible.
- **HIGH:** `LifecycleEvent` (schema.prisma:184-193) has no `organizationId`. Tenant scope only reachable transitively via Asset.
- **HIGH:** No composite FKs enforcing same-org relationships. A Ticket can, at the DB level, reference an Asset in another org.

Fix pattern: add `@@unique([organizationId, email])` and `@@unique([organizationId, serialNumber])`; add composite unique on parent `(id, organizationId)` and composite FKs on children; add missing `AttendanceRecord.organizationId → Organization.id` FK.

### 2. Indexes (HIGH)

**Postgres does not auto-index FKs.** The init migration creates only 5 uniques. Every non-unique FK column is unindexed:
- `User.organizationId`, `User.departmentId`, `User.managerId`
- `Department.organizationId`
- `Asset.organizationId`, `Asset.departmentId`, `Asset.assignedToId`
- `LifecycleEvent.assetId`, `LifecycleEvent.actorId`
- `Ticket.organizationId`, `Ticket.raisedById`, `Ticket.assetId`
- `AttendanceRecord.markedById`, `AttendanceRecord.organizationId`

Every "list assets in my org", "list tickets by user", cascade lookup becomes a seq scan.

Also missing composites for the actual query patterns:
- `@@index([organizationId, status])` on Asset and Ticket
- `@@index([organizationId, createdAt(sort: Desc)])` on Ticket, Asset, User
- `@@index([assetId, occurredAt(sort: Desc)])` on LifecycleEvent — the timeline query
- `@@index([organizationId, date])` on AttendanceRecord
- Index on `Asset.warrantyEnd` for the dashboard's "expiring in 30 days"

### 3. Cascades & Referential Integrity

| Relation | Behavior | Verdict |
|---|---|---|
| User → Organization | RESTRICT | OK |
| User → Department | SET NULL | OK |
| User → User (manager) | SET NULL | OK |
| Department → Organization | RESTRICT | OK |
| Asset → Organization | RESTRICT | OK |
| Asset → Department | SET NULL | OK |
| Asset → User (assignedTo) | SET NULL | OK |
| **LifecycleEvent → Asset** | **RESTRICT** | **HIGH** — you cannot delete an Asset until every event is manually purged. Timeline is append-only, but Asset removal is currently blocked. |
| LifecycleEvent → User (actor) | SET NULL | OK |
| Ticket → Organization | RESTRICT | OK |
| **Ticket → User (raisedBy)** | **RESTRICT** | **MEDIUM** — blocks user deletion. |
| Ticket → Asset | SET NULL | OK |
| AttendanceRecord → User (employee) | RESTRICT | Same problem as Ticket.raisedBy. |
| AttendanceRecord → User (markedBy) | SET NULL | OK |
| **AttendanceRecord → Organization** | **MISSING** | **CRITICAL** (see §1). |

Off-boarding an entire tenant currently requires hand-crafted delete order across 7 tables. Either soft-delete Organization + background purge, or switch these to CASCADE with clear docs.

### 4. Sensitive Fields (CRITICAL)

- `schema.prisma:117` `cnic String?` — **plaintext PII**. Government ID under GDPR + Pakistan PDPB. No encryption at rest, no redaction in logs.
- Same concern (HIGH) for `dob`, `address`, `phone` (schema.prisma:106, 118-119) — all PII, all plaintext.
- `password String` (schema.prisma:105) — no comment enforcing bcrypt/argon2; no CHECK constraint.
- No `PasswordResetToken` model — product cannot support user-initiated password reset without more schema work.
- No `lastLoginAt`, `failedLoginAttempts`, `lockedUntil`, `mfa*` on User.

### 5. Modeling Issues

- **MEDIUM:** All text columns are `TEXT` (unbounded). No `@db.VarChar(n)` caps. Client can insert 50 MB into `description`.
- **MEDIUM:** `Organization.theme` is a `String` with a comment "light | dark" — should be an enum.
- **MEDIUM:** Colors (`primaryColor`, `accentColor`) have no CHECK constraint (`^#[0-9A-Fa-f]{6}$`).
- **MEDIUM:** `Asset.ram`, `Asset.storage` are free-text strings ("16GB"). Prevents filtering.
- **MEDIUM:** `photos: String[]`, `documents: String[]` — no metadata (mime, size, uploader, ACL). Should be a separate `AssetAttachment` table.
- **MEDIUM:** No monetary field on `Asset` (`purchasePrice`, `currentValue`) — surprising for an asset-management product. When added, use `Decimal @db.Decimal(12,2)`, never `Float`.
- **HIGH:** No soft-delete columns (`deletedAt`) anywhere. Combined with RESTRICT cascades, hard deletion is basically impossible in practice.
- **HIGH:** No audit log table. `LifecycleEvent` covers asset lifecycle only — role changes, PII edits, department moves are unlogged.
- **MEDIUM:** No `createdById` / `updatedById` on Asset, Ticket, Department, User. Actor of last change is unknown.
- **LOW:** `Department` missing `updatedAt`; `LifecycleEvent` missing `createdAt` (has business `occurredAt` only).

### 6. Migration Notes

- Only one migration (`20260730074904_init`). Future-dated timestamp (2026-07-30) suggests intern's system clock was wrong.
- Schema matches migration.sql (verified) — the missing `AttendanceRecord.organizationId → Organization` FK is a schema-level omission, not migration drift.
- Seed script is **not** wrapped in a transaction; partial-run leaves inconsistent tenant.

---

## Part 3 — Frontend (`frontend/src`)

### 1. Auth & Token Handling

- **CRITICAL:** `src/api/client.js:8` and `src/context/AuthContext.jsx:12,23,29,36` — JWT stored in `localStorage`. Any XSS trivially exfiltrates the token. Should be an `HttpOnly; Secure; SameSite=Lax/Strict` cookie set by the backend.
- **HIGH:** `src/api/client.js:13-22` — 401 handler blindly nukes the token and does `window.location.href = "/login"`. Redirect loops on the login page itself; no refresh token flow; no queued retries.
- **HIGH:** `src/context/AuthContext.jsx:11-25` — `AuthProvider` sits outside `BrowserRouter` in `main.jsx:15`, so the whole tree waits for `/auth/me` before `/login` renders.
- **MEDIUM:** `src/context/AuthContext.jsx:35-39` — client-only logout. No server-side revocation.

### 2. API Client

- **HIGH:** `src/api/client.js:3-5` — no `timeout`. Hung backend = hung UI forever.
- **HIGH:** `src/api/client.js:4` — base URL fallback hardcodes `http://localhost:4000/api`. If `VITE_API_URL` unset at build time, prod bundle ships localhost.
- **MEDIUM:** No retry / backoff on transient 5xx or network errors (only `retry: 1` at the React Query level in `main.jsx:9`).
- **MEDIUM:** Silent failures across mutations — most `useMutation` calls have no `onError`, so failures don't surface to the user.
- **MEDIUM:** `window.location.href` inside the axios interceptor blows away SPA state.

### 3. Route Protection

- **HIGH:** `App.jsx:24-28` — `RequireAdmin` is client-only. Backend must re-enforce.
- **MEDIUM:** `Sidebar.jsx:112-113` — `canManageAttendance` gates the nav link only. The `/attendance` route is wrapped in `RequireAdmin` (role check), not the capability check the page itself uses. Nav visibility ≠ route protection.

### 4. XSS & Content Safety

- **LOW:** No `dangerouslySetInnerHTML` usage anywhere. No `href={userProvidedUrl}` patterns. Good.
- **LOW:** `ThemeContext.jsx:5-8` — `applyAccent(hex)` writes user-controlled data into a CSS custom property. Modern browsers ignore `javascript:` in CSS values; still worth validating hex on read (`^#[0-9a-fA-F]{6}$`).

### 5. State Management (real bugs)

- **HIGH:** `Settings.jsx:19-27` — **sets React state inside `queryFn`**. Every refetch clobbers unsaved edits mid-typing.
- **HIGH:** `Attendance.jsx:28-33, 47-51` — `saved=true` fires before the refetch resolves, then `useEffect` resets `rows` from server state. Edits made during save vanish silently while UI says "saved".
- **MEDIUM:** `ThemeContext.jsx:27` and `AuthContext.jsx:42` — provider `value={{ ... }}` object recreated on every render. All consumers re-render.

### 6. Data Fetching

- **HIGH:** **No `error` state rendered anywhere.** `Dashboard`, `AssetProfile`, `EmployeeProfile`, `Employees`, `Inventory`, `Assignments`, `Tickets`, `Reports`, `Notifications`, `Billing`, `Settings`, `Departments`, `Attendance` — every one destructures only `data`/`isLoading`. Failing queries silently show "Loading..." then empty.
- **MEDIUM:** Search inputs fire on every keystroke without debounce — refetch storm on `Employees.jsx:21` and `Inventory.jsx:22`.
- **MEDIUM:** No `staleTime` set — every back-navigation re-queues all queries.
- **MEDIUM:** No AbortController / signal threading — orphaned in-flight requests on rapid navigation.

### 7. Form Handling

- **HIGH:** Client-side validation essentially absent — `Login`, `Employees`, `Inventory`, `Departments`, `Tickets`, `Profile` all rely on HTML `required` and trim-only checks. No email regex, no length caps, no CNIC format check despite the placeholder.
- **HIGH:** `react-hook-form@^7.52.2` is in `package.json` and **not imported anywhere**. Dead dependency.
- **LOW:** `Login.jsx:8` — default email prefilled with `admin@acme.test`. Dev artifact shipped to prod.

### 8. Accessibility

- **HIGH:** Every `<label>` in the codebase is a bare `<label>` wrapping text with an adjacent input. **None use `htmlFor`/`id`.** Screen readers can't announce label→field associations. `Tickets.jsx:78-92` textarea has no label at all.
- **MEDIUM:** Sidebar mobile scrim (`Sidebar.jsx:63-69`) is a `<div onClick>` with no keyboard handler and no Escape support.
- **MEDIUM:** No focus management on inline "Add …" panels — focus does not move to the first field on expand, nor return to the toggle on collapse.

### 9. Performance

- **HIGH:** Unbounded lists rendered without virtualization. Every row in `Employees`, `Inventory`, `Attendance`, `Tickets`, `Notifications` renders eagerly.
- **MEDIUM:** No `React.lazy` — every page bundle ships all pages, including `recharts` (~200 KB gzipped) on routes that don't need it.
- **MEDIUM:** `framer-motion@^11.3.24` — declared, not imported. Dead dep.

### 10. Bugs & Bad Logic

- **HIGH:** `Attendance.jsx:116` — will crash with "Cannot read properties of undefined" if backend ever returns a status not in `STATUS_CONFIG`. No fallback. Same at `AssetProfile.jsx:66`, `Dashboard.jsx:100`, `Notifications.jsx:20`, `Tickets.jsx:148,153`.
- **MEDIUM:** No error boundary anywhere. A single throw from a null-deref white-screens the whole app.
- **MEDIUM:** `EmployeeProfile.jsx:66` sends the hardcoded English string `"Removed from employee"` to the backend as if it were user data. Should be an event type/enum.
- **LOW:** `Attendance.jsx:56-63`, `Export.jsx:13-20` — file downloads via anchor click, but `URL.revokeObjectURL(url)` is never called. Memory leak on repeated downloads.

### 11. UX / Prod Polish

- **HIGH:** Dev credentials prefilled in login (`Login.jsx:8`).
- **MEDIUM:** `Inventory.jsx:60` — placeholder `'Try "Dell", "16GB", "Muhammad", or "Expired Warranty"'` mentions a person's name; unprofessional for prod.
- **MEDIUM:** `Billing.jsx:5-61` — pricing and plan features hardcoded in the bundle.
- **MEDIUM:** `Reports.jsx:43-47` — user-visible TODO copy: *"More reports … plug into this same pattern — pull from /api/dashboard and /api/assets and add a chart."*
- **LOW:** `Sidebar.jsx:94-98` search input is a no-op (no state, no handler). Decoration only.
- **LOW:** No per-route `<title>` updates. No `<meta description>`. No favicon.

### 12. Env / Config

- **HIGH:** Only one env var used (`VITE_API_URL`). No `.env.example`. If unset at build time, `http://localhost:4000/api` ships.
- **MEDIUM:** `vite.config.js` is bare — no `envPrefix`, no `resolve.alias`, no `server.proxy`.

### 13. Build & Deps

- **HIGH:** `index.html:1-19` — **no CSP**. Google Fonts loaded from third-party with no SRI (integrity hashes). If a font CDN is compromised, arbitrary CSS executes.
- **MEDIUM:** Axios 1.7.4 predates several 1.7.7+ security patches (SSRF / proto pollution CVEs). Bump.
- **MEDIUM:** No lint / no type-check / no test runner in `package.json` scripts. `eslint` / `prettier` not in devDeps.
- **LOW:** No `.nvmrc` / `engines` field.
- **LOW:** No code-splitting — all pages eagerly imported in `App.jsx:7-22`.

---

## Prioritized Fix List (2-3 week plan)

### Sprint 0 — Do this before anyone else runs the code
1. **Kill or guard `prisma/seed.js` and `prisma/reset-password.js`** (SCRIPT-01, SCRIPT-02). Hard-block if `NODE_ENV === "production"`; randomize seed passwords; move reset-password logic behind a real admin console flow.

### Sprint 1 — Security & data integrity
2. Multi-tenant unique keys — `@@unique([organizationId, email])`, `@@unique([organizationId, serialNumber])`. Drop global uniques. (DATA-01, DATA-06)
3. Add `AttendanceRecord.organizationId → Organization` FK. (Part 2 §1)
4. Encrypt CNIC / DOB / address at rest, or drop the columns if not required. (Part 2 §4)
5. Cross-org validation on `assignAsset.employeeId`, `createTicket.assetId`, `updateEmployee.departmentId`/`managerId`. (AUTH-13/14/16)
6. Move JWT to HttpOnly cookie + CSRF. Fix employee-cannot-change-password bug (AUTH-05).
7. Add helmet, express-rate-limit, generic 500 error responses, structured logging with PII redaction. (SEC-01/03, ERR-01, LOG-03)
8. Add Zod validation on every route (`zod` is already installed). (INPUT-01)

### Sprint 2 — Reliability & performance
9. Pagination on every list/export endpoint + hard caps. Stream Excel writes. (DB-01)
10. Timezone-safe attendance dates. (DB-10)
11. Soft-delete User/Department + transactional cleanup on delete. (DB-06, DB-07)
12. All missing FK + composite indexes. (Part 2 §2)
13. Frontend: axios `timeout`, error states, ErrorBoundary, fix Settings.jsx / Attendance.jsx state races. Remove `admin@acme.test` default and dead deps.
14. Password reset token model + lockout / MFA fields on User.

### Sprint 3 — Polish
15. Refresh-token flow; shorter access-token TTL; invalidate on password change. (AUTH-03/04)
16. Debounce search inputs; add `staleTime`. Add `React.lazy` for page bundles. Move recharts behind lazy-import. Virtualize long lists once backend paginates.
17. A11y sweep: `htmlFor` on every label, focus management on inline panels, keyboard Escape on sidebar scrim.
18. CSP meta tag, SRI on Google Fonts, `URL.revokeObjectURL` after downloads. Bump axios.

---

## Mostly Done correctly

- Enum-typed statuses used correctly across the board.
- `cuid` over `Int` for primary keys.
- Prisma singleton via `globalThis` in non-prod (`src/lib/prisma.js`).
- Tenant-scoped Prisma queries consistently use `organizationId` from the JWT claim.
- No `dangerouslySetInnerHTML`, no `javascript:` URI patterns.
- Password hashing with bcrypt (just too weak a cost factor).
- `@db.Date` on attendance (correct type).
- `AttendanceRecord` uses `@@unique([employeeId, date])` (correct composite key).
- `Department` uses `@@unique([organizationId, name])` — the correct multi-tenant pattern.
- Frontend uses controlled inputs everywhere.
- React Query keys are broadly consistent enough to invalidate cleanly.

