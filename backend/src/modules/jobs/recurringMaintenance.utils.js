export const MAINTENANCE_TIMEZONE = "Asia/Kolkata";
const IST_OFFSET_MINUTES = 330;
const SUCCESSFUL_JOB_STATUSES = new Set([
  "COMPLETED",
  "VERIFIED",
  "APPROVED",
  "CLOSED",
]);

export const getBusinessDateParts = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: MAINTENANCE_TIMEZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    weekday: "short",
  }).formatToParts(date);
  const partMap = Object.fromEntries(
    parts.map(({ type, value }) => [type, value]),
  );
  const weekday = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].indexOf(
    partMap.weekday,
  );

  return {
    year: Number(partMap.year),
    month: Number(partMap.month),
    day: Number(partMap.day),
    weekday,
    dateKey: `${partMap.year}-${partMap.month}-${partMap.day}`,
  };
};

export const getBusinessDayStart = (dateKey) => {
  const [year, month, day] = dateKey.split("-").map(Number);
  return new Date(
    Date.UTC(year, month - 1, day) - IST_OFFSET_MINUTES * 60_000,
  );
};

export const getBusinessDayEnd = (dateKey) =>
  new Date(getBusinessDayStart(dateKey).getTime() + 86_400_000 - 1);

export const getRecurringJobDueState = (job, now = new Date()) => {
  if (!job.recurringMaintenance) return null;
  if (SUCCESSFUL_JOB_STATUSES.has(job.status)) return "COMPLETED";

  const scheduledDate = job.recurringMaintenance?.scheduledDate;
  if (!scheduledDate) return null;
  const scheduledKey = getBusinessDateParts(new Date(scheduledDate)).dateKey;
  const todayKey = getBusinessDateParts(now).dateKey;

  if (scheduledKey > todayKey) return "UPCOMING";
  if (new Date(job.recurringMaintenance.dueAt) < now) return "OVERDUE";
  return "DUE";
};
