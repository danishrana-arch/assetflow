// Main-company rules, in one place.
//
// A company group is every organization sharing the same `companyId` (the
// id of its root organization). The root is the PRIMARY main company. The
// CEO may also mark ONE other organization in the group as a SECOND main
// company (`isCoMain`) — e.g. one office abroad and one in-country.
//
// Being a main company is what lets that organization's ADMIN (all modules)
// and IT_MANAGER (inventory only — their module list is unchanged) switch
// into every other organization of the group. A CEO is always company-wide.
// HR and every other role stay locked to their own organization regardless.

// Fields every caller must select for these helpers to work.
const MAIN_COMPANY_SELECT = { id: true, companyId: true, parentOrganizationId: true, isCoMain: true }

function isPrimaryMain(org) {
  return !!org && !org.parentOrganizationId && (!org.companyId || org.companyId === org.id)
}

function isMainOrganization(org) {
  return isPrimaryMain(org) || !!org?.isCoMain
}

// Roles whose home organization being a main company grants company-wide
// organization switching.
const MAIN_COMPANY_SWITCH_ROLES = ["ADMIN", "IT_MANAGER"]

function canSwitchCompanyWide(role, homeOrg) {
  return role === "CEO" || (MAIN_COMPANY_SWITCH_ROLES.includes(role) && isMainOrganization(homeOrg))
}

// Company-wide *reporting* (dashboard ?scope=company etc.): CEO, or an ADMIN
// whose HOME organization (not the one currently switched into) is a main
// company. Needs prisma, so it's async.
async function canReportCompanyWide(prisma, userId, role) {
  if (role === "CEO") return true
  if (role !== "ADMIN") return false
  const me = await prisma.user.findUnique({ where: { id: userId }, select: { organization: { select: MAIN_COMPANY_SELECT } } })
  return isMainOrganization(me?.organization)
}

module.exports = { MAIN_COMPANY_SELECT, isPrimaryMain, isMainOrganization, canSwitchCompanyWide, canReportCompanyWide }
