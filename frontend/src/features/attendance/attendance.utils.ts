export function formatWorkedDuration(workedDurationMs: number) {
  if (!Number.isFinite(workedDurationMs) || workedDurationMs < 0) {
    throw new RangeError("Worked duration must be a non-negative finite number");
  }

  const totalMinutes = Math.floor(workedDurationMs / 60_000);
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  return `${hours}h ${minutes}m`;
}
