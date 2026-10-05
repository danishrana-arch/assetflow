// Company hierarchy rules, in one place.
//
// A company group is every organization sharing the same `companyId`.
// Inside a group the organizations form a tree, at most three levels deep,
// via `parentOrganizationId` (the company directly above):
//
//   GRAND_PARENT  (any number per group; parentOrganizationId = null)
//        ↓
//   PARENT        (belongs to one Grand Parent)
//        ↓
//   CHILD         (belongs to a Parent, or directly to a Grand Parent)
//
// Every organization is also an IT_OFFICE or a CALL_CENTER.
//
// Cross-company access is only for ADMIN and IT_MANAGER (IT keeps its
// inventory-only module list), and only to:
//   1. IT OFFICES below their home company (downward; never upward, never
//      into another Grand Parent's companies):
//        Grand Parent ADMIN/IT → IT offices under it
//        Parent ADMIN/IT       → IT offices among its own Children
//        Child ADMIN/IT        → nothing below
//      Call centers are NOT reached this way — a CEO decides who gets them:
//   2. companies a CEO explicitly granted them (OrganizationAccessGrant),
//      IT office or call center, anywhere in the group;
//   3. for an ADMIN a CEO marked `User.callCenterAccess`: every call center
//      of the group (and then no IT office below them except via grants —
//      the flag replaces their downward reach).
// A CEO of ANY company in the group may access every company in the group,
// every Grand Parent included — the only role that crosses Grand Parents on
// its own. HR, EMPLOYEE, MANAGEMENT, DEPARTMENT_HEAD … never get
// cross-company access (grants and the flag are ignored for them).
//
// The shape (Parent → a Grand Parent; Child → a Grand Parent or Parent) is
// validated whenever it's changed (setCompanyHierarchy), so there are no
// cycles and the depth never exceeds three — which is why checking the
// target's parent and grandparent is enough to decide "is it under me?".

const HIERARCHY = { GRAND_PARENT: "GRAND_PARENT", PARENT: "PARENT", CHILD: "CHILD" }
const HIERARCHY_RANK = { GRAND_PARENT: 0, PARENT: 1, CHILD: 2 }
const OFFICE_TYPE = { IT_OFFICE: "IT_OFFICE", CALL_CENTER: "CALL_CENTER" }

// Fields every caller must select for these helpers to work.
const HIERARCHY_SELECT = {
  id: true,
  companyId: true,
  parentOrganizationId: true,
  hierarchyRole: true,
  officeType: true,
  archivedAt: true,
  parentOrganization: { select: { id: true, parentOrganizationId: true } },
}

const CROSS_COMPANY_ROLES = ["ADMIN", "IT_MANAGER"]

function groupIdOf(org) {
  return org?.companyId || org?.id || null
}

function roleOf(org) {
  return org?.hierarchyRole || HIERARCHY.CHILD
}

// Is `target` below `ancestorId` in the tree (its parent or grandparent)?
function isUnder(target, ancestorId) {
  return target.parentOrganizationId === ancestorId || target.parentOrganization?.parentOrganizationId === ancestorId
}

function isCallCenterAdmin(role, callCenterAccess) {
  return role === "ADMIN" && !!callCenterAccess
}

// Can a user with `role`, whose HOME organization is `home`, act inside `target`?
// `access` = { callCenterAccess (User.callCenterAccess), grantedOrganizationIds
// (the user's OrganizationAccessGrant rows) } — see loadAccess().
function canAccessOrganization(role, home, target, { callCenterAccess = false, grantedOrganizationIds = [] } = {}) {
  if (!home || !target || target.archivedAt) return false
  if (target.id === home.id) return true
  if (groupIdOf(home) !== groupIdOf(target)) return false
  if (role === "CEO") return true
  if (!CROSS_COMPANY_ROLES.includes(role)) return false
  if (grantedOrganizationIds.includes(target.id)) return true
  if (isCallCenterAdmin(role, callCenterAccess)) return target.officeType === OFFICE_TYPE.CALL_CENTER
  if (target.officeType === OFFICE_TYPE.CALL_CENTER) return false
  if (roleOf(home) === HIERARCHY.CHILD) return false
  return isUnder(target, home.id)
}

// Does this user see more than their own organization at all?
function hasCrossCompanyAccess(role, home, { callCenterAccess = false, grantedOrganizationIds = [] } = {}) {
  if (!home) return false
  if (role === "CEO") return true
  if (!CROSS_COMPANY_ROLES.includes(role)) return false
  if (grantedOrganizationIds.length || isCallCenterAdmin(role, callCenterAccess)) return true
  return [HIERARCHY.GRAND_PARENT, HIERARCHY.PARENT].includes(roleOf(home))
}

// Tree order: each Grand Parent followed by its Parents (each followed by its
// Children) and then its direct Children. Every row gets `depth` (0 = top of
// the given list), so the UI can indent without rebuilding the tree.
function sortByHierarchy(orgs) {
  const compare = (a, b) =>
    (HIERARCHY_RANK[roleOf(a)] - HIERARCHY_RANK[roleOf(b)]) || String(a.name || "").localeCompare(String(b.name || ""), "en", { sensitivity: "base" })
  const ids = new Set(orgs.map((o) => o.id))
  const children = new Map()
  const roots = []
  for (const org of orgs) {
    const parentId = org.parentOrganizationId
    if (parentId && parentId !== org.id && ids.has(parentId)) {
      if (!children.has(parentId)) children.set(parentId, [])
      children.get(parentId).push(org)
    } else {
      roots.push(org)
    }
  }
  const out = []
  const seen = new Set()
  const visit = (org, depth) => {
    if (seen.has(org.id)) return
    seen.add(org.id)
    out.push({ ...org, depth })
    for (const child of (children.get(org.id) || []).sort(compare)) visit(child, depth + 1)
  }
  roots.sort(compare).forEach((org) => visit(org, 0))
  orgs.forEach((org) => visit(org, 0)) // defensive: anything left in a cycle
  return out
}

async function loadHomeOrganization(prisma, userId) {
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { organization: { select: HIERARCHY_SELECT } } })
  return me?.organization || null
}

// The per-user extras a CEO controls: the "all call centers" flag and the
// explicit company grants.
async function loadAccess(prisma, userId) {
  if (!userId) return { callCenterAccess: false, grantedOrganizationIds: [] }
  const me = await prisma.user.findUnique({
    where: { id: userId },
    select: { callCenterAccess: true, accessGrants: { select: { organizationId: true } } },
  })
  return { callCenterAccess: !!me?.callCenterAccess, grantedOrganizationIds: (me?.accessGrants || []).map((g) => g.organizationId) }
}

// Every active organization this user may access (always includes their own),
// sorted for display. `select` adds fields to the returned rows.
// `access` (see loadAccess) is read from the user when not passed.
async function accessibleOrganizations(prisma, { userId, role, home, select = {}, access: given }) {
  const homeOrg = home || (await loadHomeOrganization(prisma, userId))
  if (!homeOrg) return []
  const access = given || (await loadAccess(prisma, userId))
  const fields = { ...HIERARCHY_SELECT, name: true, ...select }
  if (!hasCrossCompanyAccess(role, homeOrg, access)) {
    const own = await prisma.organization.findUnique({ where: { id: homeOrg.id }, select: fields })
    return own && !own.archivedAt ? [own] : []
  }
  const groupId = groupIdOf(homeOrg)
  const all = await prisma.organization.findMany({
    where: { archivedAt: null, OR: [{ id: groupId }, { companyId: groupId }] },
    select: fields,
  })
  return sortByHierarchy(all.filter((org) => canAccessOrganization(role, homeOrg, org, access)))
}

async function accessibleOrganizationIds(prisma, opts) {
  return (await accessibleOrganizations(prisma, opts)).map((o) => o.id)
}

// Any CEO may change the hierarchy (what sits under what) — a CEO already
// has access to every company of the group.
function canManageHierarchy(role, home) {
  return role === "CEO" && !!home
}

// Flags sent to the frontend with every organization.
function hierarchyFlags(org) {
  const hierarchyRole = roleOf(org)
  return {
    hierarchyRole,
    isGrandParent: hierarchyRole === HIERARCHY.GRAND_PARENT,
    isParent: hierarchyRole === HIERARCHY.PARENT,
    // Back-compat: "main" = an organization with downward reach.
    isMain: hierarchyRole !== HIERARCHY.CHILD,
    officeType: org?.officeType || OFFICE_TYPE.IT_OFFICE,
    isCallCenter: org?.officeType === OFFICE_TYPE.CALL_CENTER,
  }
}

module.exports = {
  HIERARCHY,
  OFFICE_TYPE,
  HIERARCHY_SELECT,
  loadAccess,
  canAccessOrganization,
  hasCrossCompanyAccess,
  sortByHierarchy,
  loadHomeOrganization,
  accessibleOrganizations,
  accessibleOrganizationIds,
  canManageHierarchy,
  hierarchyFlags,
}
