// Company hierarchy rules, in one place.
//
// A company group is every organization sharing the same `companyId` (the
// id of its root organization). Inside a group each organization has a
// `hierarchyRole`:
//
//   GRAND_PARENT  (at most one per group)
//        ↓
//   PARENT        (at most one per group)
//        ↓
//   CHILD         (everything else)
//
// Cross-company access is strictly DOWNWARD and only for ADMIN and
// IT_MANAGER (IT keeps its inventory-only module list):
//   - Grand Parent ADMIN/IT → Grand Parent + Parent + every Child
//   - Parent ADMIN/IT       → Parent + every Child (never the Grand Parent)
//   - Child ADMIN/IT        → own company only
// A CEO of ANY company in the group may access every company in the group,
// including the Grand Parent (explicit product decision).
// HR, EMPLOYEE, MANAGEMENT, DEPARTMENT_HEAD … never get cross-company access.
//
// The hierarchy is two designations on a flat group, not a parent-pointer
// tree, so a circular relationship can't exist; one org can't hold both
// designations because it has a single `hierarchyRole`. Uniqueness of each
// designation per group is also enforced by a partial unique index (see
// migration 20261001150000_organization_hierarchy).

const HIERARCHY = { GRAND_PARENT: "GRAND_PARENT", PARENT: "PARENT", CHILD: "CHILD" }
const HIERARCHY_RANK = { GRAND_PARENT: 0, PARENT: 1, CHILD: 2 }

// Fields every caller must select for these helpers to work.
const HIERARCHY_SELECT = { id: true, companyId: true, parentOrganizationId: true, hierarchyRole: true, archivedAt: true }

const CROSS_COMPANY_ROLES = ["ADMIN", "IT_MANAGER"]

function groupIdOf(org) {
  return org?.companyId || org?.id || null
}

function roleOf(org) {
  return org?.hierarchyRole || HIERARCHY.CHILD
}

// Can a user with `role`, whose HOME organization is `home`, act inside `target`?
function canAccessOrganization(role, home, target) {
  if (!home || !target || target.archivedAt) return false
  if (target.id === home.id) return true
  if (groupIdOf(home) !== groupIdOf(target)) return false
  if (role === "CEO") return true
  if (!CROSS_COMPANY_ROLES.includes(role)) return false
  const homeRole = roleOf(home)
  if (homeRole === HIERARCHY.GRAND_PARENT) return true
  if (homeRole === HIERARCHY.PARENT) return roleOf(target) !== HIERARCHY.GRAND_PARENT
  return false
}

// Does this user see more than their own organization at all?
function hasCrossCompanyAccess(role, home) {
  if (!home) return false
  if (role === "CEO") return true
  return CROSS_COMPANY_ROLES.includes(role) && [HIERARCHY.GRAND_PARENT, HIERARCHY.PARENT].includes(roleOf(home))
}

// Grand Parent first, then Parent, then children by name.
function sortByHierarchy(orgs) {
  return [...orgs].sort((a, b) =>
    (HIERARCHY_RANK[roleOf(a)] - HIERARCHY_RANK[roleOf(b)]) || String(a.name || "").localeCompare(String(b.name || ""), "en", { sensitivity: "base" })
  )
}

async function loadHomeOrganization(prisma, userId) {
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { organization: { select: HIERARCHY_SELECT } } })
  return me?.organization || null
}

// Every active organization this user may access (always includes their own),
// sorted for display. `select` adds fields to the returned rows.
async function accessibleOrganizations(prisma, { userId, role, home, select = {} }) {
  const homeOrg = home || (await loadHomeOrganization(prisma, userId))
  if (!homeOrg) return []
  const fields = { ...HIERARCHY_SELECT, name: true, ...select }
  if (!hasCrossCompanyAccess(role, homeOrg)) {
    const own = await prisma.organization.findUnique({ where: { id: homeOrg.id }, select: fields })
    return own && !own.archivedAt ? [own] : []
  }
  const groupId = groupIdOf(homeOrg)
  const all = await prisma.organization.findMany({
    where: { archivedAt: null, OR: [{ id: groupId }, { companyId: groupId }] },
    select: fields,
  })
  return sortByHierarchy(all.filter((org) => canAccessOrganization(role, homeOrg, org)))
}

async function accessibleOrganizationIds(prisma, opts) {
  return (await accessibleOrganizations(prisma, opts)).map((o) => o.id)
}

// Only a CEO whose home organization IS the Grand Parent may change the
// Grand Parent / Parent designations.
function canManageHierarchy(role, home) {
  return role === "CEO" && roleOf(home) === HIERARCHY.GRAND_PARENT
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
  }
}

module.exports = {
  HIERARCHY,
  HIERARCHY_SELECT,
  canAccessOrganization,
  hasCrossCompanyAccess,
  sortByHierarchy,
  loadHomeOrganization,
  accessibleOrganizations,
  accessibleOrganizationIds,
  canManageHierarchy,
  hierarchyFlags,
}
