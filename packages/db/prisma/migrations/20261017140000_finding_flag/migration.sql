-- A reviewer's flag on a finding (ask the client / resolved). Additive only.
ALTER TABLE "finding" ADD COLUMN "flag" TEXT;
CREATE INDEX "finding_flag_idx" ON "finding"("flag");
