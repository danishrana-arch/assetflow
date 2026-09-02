-- Add management roles that are already supported by the application layer.
-- IF NOT EXISTS keeps this migration safe if a value was added manually.
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'MANAGEMENT';
ALTER TYPE "UserRole" ADD VALUE IF NOT EXISTS 'DEPARTMENT_HEAD';
