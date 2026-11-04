import { z } from "zod";

export const isValidDateOnly = (value) => {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return false;
  }
  const [year, month, day] = value.split("-").map(Number);
  const date = new Date(0);
  date.setUTCHours(0, 0, 0, 0);
  date.setUTCFullYear(year, month - 1, day);
  return (
    year > 0 &&
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
};

export const effectiveExitDateSchema = z.preprocess(
  (value) => {
    if (value === undefined || value === null || value instanceof Date) {
      return value;
    }
    return isValidDateOnly(value)
      ? new Date(`${value}T00:00:00.000Z`)
      : new Date(Number.NaN);
  },
  z.date().nullable().optional(),
);

const parseJoiningDate = (value) => {
  if (typeof value !== "string") return value;

  const trimmedValue = value.trim();
  if (/^\d{4}-\d{1,2}-\d{1,2}$/.test(trimmedValue)) {
    return isValidDateOnly(trimmedValue)
      ? new Date(`${trimmedValue}T00:00:00.000Z`)
      : new Date(Number.NaN);
  }
  return trimmedValue ? new Date(trimmedValue) : value;
};

export const joiningDateSchema = z.preprocess(parseJoiningDate, z.date());

export const coerceJoiningDateSchema = z.preprocess(
  parseJoiningDate,
  z.coerce.date(),
);

export const toAsiaKolkataDateKey = (date) => {
  const businessDate = new Date(date.getTime() + 330 * 60 * 1000);
  return [
    String(businessDate.getUTCFullYear()).padStart(4, "0"),
    String(businessDate.getUTCMonth() + 1).padStart(2, "0"),
    String(businessDate.getUTCDate()).padStart(2, "0"),
  ].join("-");
};

export const isExitDateOnOrAfterJoiningDate = (joiningDate, exitDate) =>
  !joiningDate ||
  !exitDate ||
  toAsiaKolkataDateKey(exitDate) >= toAsiaKolkataDateKey(joiningDate);
