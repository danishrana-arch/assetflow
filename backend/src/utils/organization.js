// Company access rules, in one place.
//
// A company group is every organization sharing the same `companyId`. All
// companies in a group are equal — there is no Grand Parent / Parent / Child
// ranking any more, and nobody gets access just because of where a company
// sits. Access is:
//
//   CEO                  → every company of the group. Only a CEO can add or
//                          remove companies and decide who else gets access.
//   ADMIN / IT_MANAGER   → their own company, plus each company a CEO
//                          explicitly gave them (OrganizationAccessGrant).
//                          IT keeps its inventory-only module list wherever
//                          it is.
//   everyone else (HR, MANAGEMENT, DEPARTMENT_HEAD, EMPLOYEE …)
//                        → their own company only; grants are ignored.
//
// Access never crosses company groups. The old hierarchy columns
// (`hierarchyRole`, `parentOrganizationId`, `officeType`,
// `User.callCenterAccess`) are kept in the database but no longer read.

// Fields every caller must select for these helpers to work.
const ORG_ACCESS_SELECT = { id: true, companyId: true, archivedAt: true }

const GRANTABLE_ROLES = ["ADMIN", "IT_MANAGER"]

function groupIdOf(org) {
  return org?.companyId || org?.id || null
}

// Can a user with `role`, whose HOME organization is `home`, act inside
// `target`? `grantedOrganizationIds` = the user's OrganizationAccessGrant rows.
function canAccessOrganization(role, home, target, { grantedOrganizationIds = [] } = {}) {
  if (!home || !target || target.archivedAt) return false
  if (target.id === home.id) return true
  if (groupIdOf(home) !== groupIdOf(target)) return false
  if (role === "CEO") return true
  return GRANTABLE_ROLES.includes(role) && grantedOrganizationIds.includes(target.id)
}

// Does this user reach more than their own organization at all?
function hasCrossCompanyAccess(role, home, { grantedOrganizationIds = [] } = {}) {
  if (!home) return false
  if (role === "CEO") return true
  return GRANTABLE_ROLES.includes(role) && grantedOrganizationIds.length > 0
}

// Own company first, then the rest by name.
function sortOrganizations(orgs, homeId) {
  return [...orgs].sort((a, b) =>
    (a.id === homeId ? -1 : b.id === homeId ? 1 : 0) ||
    String(a.name || "").localeCompare(String(b.name || ""), "en", { sensitivity: "base" })
  )
}

async function loadHomeOrganization(prisma, userId) {
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { organization: { select: ORG_ACCESS_SELECT } } })
  return me?.organization || null
}

// The companies a CEO has given this user.
async function loadAccess(prisma, userId) {
  if (!userId) return { grantedOrganizationIds: [] }
  const grants = await prisma.organizationAccessGrant.findMany({ where: { userId }, select: { organizationId: true } })
  return { grantedOrganizationIds: grants.map((g) => g.organizationId) }
}

// Every active organization this user may access (always includes their
// own), own first. `select` adds fields to the returned rows. `access` (see
// loadAccess) is read from the user when not passed.
async function accessibleOrganizations(prisma, { userId, role, home, select = {}, access: given }) {
  const homeOrg = home || (await loadHomeOrganization(prisma, userId))
  if (!homeOrg) return []
  const access = given || (await loadAccess(prisma, userId))
  const fields = { ...ORG_ACCESS_SELECT, name: true, ...select }
  if (!hasCrossCompanyAccess(role, homeOrg, access)) {
    const own = await prisma.organization.findUnique({ where: { id: homeOrg.id }, select: fields })
    return own && !own.archivedAt ? [own] : []
  }
  const groupId = groupIdOf(homeOrg)
  const all = await prisma.organization.findMany({
    where: { archivedAt: null, OR: [{ id: groupId }, { companyId: groupId }] },
    select: fields,
  })
  return sortOrganizations(all.filter((org) => canAccessOrganization(role, homeOrg, org, access)), homeOrg.id)
}

async function accessibleOrganizationIds(prisma, opts) {
  return (await accessibleOrganizations(prisma, opts)).map((o) => o.id)
}

// Only a CEO adds / removes companies and gives other people access.
function canManageCompanies(role) {
  return role === "CEO"
}

module.exports = {
  ORG_ACCESS_SELECT,
  GRANTABLE_ROLES,
  loadAccess,
  canAccessOrganization,
  hasCrossCompanyAccess,
  sortOrganizations,
  loadHomeOrganization,
  accessibleOrganizations,
  accessibleOrganizationIds,
  canManageCompanies,
}
