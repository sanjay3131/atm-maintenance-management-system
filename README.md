# atm-maintenance-management-system

## Recurring maintenance jobs

Recurring daily cleaning and weekly mopping use the existing Job lifecycle.
Monthly deep cleaning remains in the AMC workflow.

Admin and Super Admin APIs:

- `POST /api/v1/jobs/recurring/plans` creates a plan with `atmId` and
  `maintenanceType` (`DAILY_CLEANING` or `WEEKLY_MOPPING`). Weekly plans also
  require `dayOfWeek` (`0` = Sunday through `6` = Saturday). `startDate` is
  optional.
- `GET /api/v1/jobs/recurring/plans` lists plans.
- `PATCH /api/v1/jobs/recurring/plans/:planId` updates a weekly plan's day,
  start date, or active state. Deactivate a plan with `{ "isActive": false }`.
- `POST /api/v1/jobs/recurring/generate` manually runs generation and returns
  creation, skip, due, overdue, and error details.

The daily scheduler runs at 12:05 AM in `Asia/Kolkata`. It generates only
occurrences scheduled for the current business date; missed occurrences are
not backfilled. A generated Job is assigned to the ATM's current responsible
Employee's linked User account and retains its assignment if the ATM is later
reassigned. Jobs are due through the end of their scheduled day in India time.
Unique occurrence keys prevent the same ATM/type/date from producing duplicate
Jobs.
