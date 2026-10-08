-- Business plan: state that every feature is included.
UPDATE "BillingPlan"
SET "features" = array_append("features", 'All features included'), "updatedAt" = CURRENT_TIMESTAMP
WHERE "key" = 'business' AND NOT ('All features included' = ANY("features"));
