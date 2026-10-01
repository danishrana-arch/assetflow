-- Second main company: the CEO may mark one more organization of a company
-- group as a main company (the root, id = companyId, is always the first).
-- Additive; existing organizations default to false (no behavior change).
ALTER TABLE "Organization" ADD COLUMN IF NOT EXISTS "isCoMain" BOOLEAN NOT NULL DEFAULT false;
