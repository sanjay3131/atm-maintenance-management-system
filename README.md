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

## Supervisor attendance

Supervisor self-attendance reuses the existing `Attendance` collection and
keeps existing employee records intact. Before deploying the updated backend,
run `npm --prefix backend run attendance:ensure-supervisor-indexes` against
the configured `atm_management` database. The migration validates existing
records, replaces the employee/date uniqueness index with an equivalent
partial index, and adds supervisor/date and one-open-session uniqueness
indexes; it does not modify or delete attendance records. Run it in a
maintenance window before deploying the updated backend.

## Attendance report exports

Admin and Super Admin users can export complete filtered reports as XLSX or
PDF. Exports retain the report's `asOf` cutoff and use the same attendance
calculator as the paginated report API. Date ranges are limited to 366 days,
exports to 1,000 employees, and employee calculations are fetched in batches
of 100. Generated files are limited to 64 MiB; PDF working data is limited to
128 MiB of temporary storage. Report generation has a 120-second deadline.
Database queries are capped by the remaining deadline. The deadline is
cooperative: synchronous CPU work cannot be interrupted mid-operation, so it
is not a hard wall-clock guarantee.

Only one export may run at a time per backend process; this limit is not
shared across multiple backend instances. Export files use unique temporary
directories and are removed after delivery or failure. On a later export run,
cleanup checks only application-prefixed directories older than seven days
whose recorded process is no longer running. PDF exports bundle the SIL Open
Font License Noto Sans Tamil font for Tamil names.
