// Platform administration — the people who run ManagementDock itself, as
// opposed to a company's own ADMIN/CEO. Deliberately separate from
// utils/organization.js: company access never grants any of this.
//
// A platform admin is ONLY a user whose role is PLATFORM_ADMIN. That account
// lives in its own hidden organization (scripts/create-platform-admin.js),
// belongs to no customer company, and cannot be created or assigned from the
// app — no company role, email list or setting can grant it.

const PLATFORM_ORG_SLUG = "managementdock-platform"

function isPlatformAdminUser(user) {
  return !!user && user.role === "PLATFORM_ADMIN"
}

function requirePlatformAdmin(req, res, next) {
  if (!isPlatformAdminUser(req.user)) {
    return res.status(403).json({ error: "This area is for ManagementDock platform administrators" })
  }
  next()
}

// Gate a route behind an organization's feature entitlement (for features that
// have no ROLE_MODULES key — see utils/features.js).
function requireFeature(featureKey) {
  const { isFeatureEntitled } = require("./features")
  return async (req, res, next) => {
    try {
      if (!(await isFeatureEntitled(req.user.organizationId, featureKey))) {
        return res.status(403).json({ error: "This feature isn't included in your organization's plan", code: "FEATURE_NOT_ENTITLED" })
      }
      next()
    } catch (err) {
      next(err)
    }
  }
}

module.exports = { PLATFORM_ORG_SLUG, isPlatformAdminUser, requirePlatformAdmin, requireFeature }
