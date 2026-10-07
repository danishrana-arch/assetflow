-- Pick the exact working weekdays (was only a count per week).
ALTER TABLE "Organization" ADD COLUMN "workingDays" TEXT NOT NULL DEFAULT '1,2,3,4,5';

-- Same days the old count meant: the first N weekdays from Monday; 7 = every day.
UPDATE "Organization" SET "workingDays" = CASE
  WHEN "workingDaysPerWeek" >= 7 THEN '0,1,2,3,4,5,6'
  ELSE (SELECT string_agg(g::text, ',' ORDER BY g) FROM generate_series(1, GREATEST("workingDaysPerWeek", 1)) g)
END;
