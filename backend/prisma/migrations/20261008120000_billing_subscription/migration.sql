-- Billing & subscription: plans, per-organization subscription, invoices,
-- and Contact-Our-Team inquiries.
CREATE TABLE "BillingPlan" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT NOT NULL DEFAULT '',
    "priceCents" INTEGER NOT NULL DEFAULT 0,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "employeeLimit" INTEGER,
    "isCustom" BOOLEAN NOT NULL DEFAULT false,
    "features" TEXT[],
    "recommended" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "sortOrder" INTEGER NOT NULL DEFAULT 0,
    "salePercent" INTEGER,
    "saleLabel" TEXT,
    "saleStartsAt" TIMESTAMP(3),
    "saleEndsAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingPlan_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BillingPlan_key_key" ON "BillingPlan"("key");

CREATE TABLE "OrganizationSubscription" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "planId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'ACTIVE',
    "priceCents" INTEGER NOT NULL DEFAULT 0,
    "currentPeriodStart" TIMESTAMP(3),
    "currentPeriodEnd" TIMESTAMP(3),
    "stripeCustomerId" TEXT,
    "stripeSubscriptionId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "OrganizationSubscription_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "OrganizationSubscription_organizationId_key" ON "OrganizationSubscription"("organizationId");
CREATE INDEX "OrganizationSubscription_planId_idx" ON "OrganizationSubscription"("planId");
ALTER TABLE "OrganizationSubscription" ADD CONSTRAINT "OrganizationSubscription_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "OrganizationSubscription" ADD CONSTRAINT "OrganizationSubscription_planId_fkey" FOREIGN KEY ("planId") REFERENCES "BillingPlan"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

CREATE TABLE "BillingInvoice" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "number" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "currency" TEXT NOT NULL DEFAULT 'usd',
    "status" TEXT NOT NULL DEFAULT 'PAID',
    "description" TEXT,
    "issuedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMP(3),
    "hostedUrl" TEXT,
    "pdfUrl" TEXT,
    "stripeInvoiceId" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BillingInvoice_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "BillingInvoice_stripeInvoiceId_key" ON "BillingInvoice"("stripeInvoiceId");
CREATE INDEX "BillingInvoice_organizationId_issuedAt_idx" ON "BillingInvoice"("organizationId", "issuedAt");
ALTER TABLE "BillingInvoice" ADD CONSTRAINT "BillingInvoice_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "SalesInquiry" (
    "id" TEXT NOT NULL,
    "organizationId" TEXT NOT NULL,
    "requestedById" TEXT,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "company" TEXT,
    "employeeCount" INTEGER,
    "message" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SalesInquiry_pkey" PRIMARY KEY ("id")
);
CREATE INDEX "SalesInquiry_organizationId_createdAt_idx" ON "SalesInquiry"("organizationId", "createdAt");
CREATE INDEX "SalesInquiry_status_idx" ON "SalesInquiry"("status");
ALTER TABLE "SalesInquiry" ADD CONSTRAINT "SalesInquiry_organizationId_fkey" FOREIGN KEY ("organizationId") REFERENCES "Organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- Default plans (editable from the Billing page).
INSERT INTO "BillingPlan" ("id","key","name","description","priceCents","employeeLimit","isCustom","features","recommended","sortOrder","updatedAt") VALUES
('plan_free','free','Free','For small teams getting started with ManagementDock.',0,2,false,
 ARRAY['Up to 2 employees','Employee management','Attendance','Basic organization management','Basic dashboard','Core ManagementDock features'],false,1,CURRENT_TIMESTAMP),
('plan_team','team','Team','For small teams that need more room to manage their workforce.',5000,4,false,
 ARRAY['Up to 4 employees','Employee management','Attendance management','Organization management','Dashboard','Projects','Announcements','Core ManagementDock features'],false,2,CURRENT_TIMESTAMP),
('plan_business','business','Business','For growing organizations managing a larger workforce.',10000,9,false,
 ARRAY['Up to 9 employees','Full employee management','Advanced attendance','Organization management','Projects','Announcements','Performance','Calendar','Advanced management features'],true,3,CURRENT_TIMESTAMP),
('plan_custom','custom','Custom','For organizations that need more employees, customized requirements, or enterprise-level support.',0,NULL,true,
 ARRAY['Custom employee limit','Custom organization requirements','Dedicated onboarding','Custom billing','Enterprise support'],false,4,CURRENT_TIMESTAMP);

-- Existing companies already have more people than the Free limit; keep them
-- working by grandfathering them onto the (uncapped) Custom plan. Companies
-- created from now on start on Free.
INSERT INTO "OrganizationSubscription" ("id","organizationId","planId","status","priceCents","updatedAt")
SELECT 'sub' || substr(md5(random()::text || o."id"), 1, 22), o."id", 'plan_custom', 'ACTIVE', 0, CURRENT_TIMESTAMP
FROM "Organization" o;
