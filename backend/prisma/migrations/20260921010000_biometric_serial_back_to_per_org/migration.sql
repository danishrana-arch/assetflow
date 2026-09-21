-- Serial numbers can genuinely collide across different vendors/device
-- batches, so global uniqueness was the wrong constraint. Multi-tenancy for
-- ADMS is now resolved by the organization slug in the URL path instead
-- (see adms.controller.js), so the device lookup is already scoped to one
-- organization before serialNumber is even considered — back to per-org
-- uniqueness only, which just prevents double-registering the same device
-- within one organization's own device list.
DROP INDEX IF EXISTS "BiometricDevice_serialNumber_key";
CREATE UNIQUE INDEX IF NOT EXISTS "BiometricDevice_organizationId_serialNumber_key" ON "BiometricDevice"("organizationId", "serialNumber");
