-- Monthly check schedules and the tasks they create. Additive only.
CREATE TABLE "client_schedule" (
    "clientId" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "dayOfMonth" INTEGER NOT NULL,
    "assigneeId" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "lastPeriod" TEXT,
    "updatedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "client_schedule_pkey" PRIMARY KEY ("clientId"),
    CONSTRAINT "client_schedule_day_check" CHECK ("dayOfMonth" BETWEEN 1 AND 28)
);
CREATE INDEX "client_schedule_orgId_idx" ON "client_schedule"("orgId");
ALTER TABLE "client_schedule" ADD CONSTRAINT "client_schedule_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "client_schedule" ADD CONSTRAINT "client_schedule_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;

CREATE TABLE "reminder_task" (
    "id" TEXT NOT NULL,
    "orgId" TEXT NOT NULL,
    "clientId" TEXT NOT NULL,
    "period" TEXT NOT NULL,
    "dueOn" DATE NOT NULL,
    "doneAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "reminder_task_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "reminder_task_clientId_period_key" ON "reminder_task"("clientId", "period");
CREATE INDEX "reminder_task_orgId_doneAt_idx" ON "reminder_task"("orgId", "doneAt");
ALTER TABLE "reminder_task" ADD CONSTRAINT "reminder_task_clientId_fkey"
    FOREIGN KEY ("clientId") REFERENCES "client"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "reminder_task" ADD CONSTRAINT "reminder_task_orgId_fkey"
    FOREIGN KEY ("orgId") REFERENCES "organization"("id") ON DELETE CASCADE ON UPDATE CASCADE;
