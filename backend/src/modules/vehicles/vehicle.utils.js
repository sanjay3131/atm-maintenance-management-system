export const normalizeRegistrationNumber = (value) => {
  if (typeof value !== "string") {
    throw new TypeError("Registration number is required");
  }

  const display = value.trim().toUpperCase();
  if (!display || !/^[A-Z0-9 -]+$/.test(display)) {
    throw new TypeError(
      "Registration number may contain only letters, numbers, spaces and hyphens",
    );
  }

  const normalized = display.replace(/[ -]/g, "");
  if (!normalized) throw new TypeError("Registration number is required");
  return { display, normalized };
};

export const requireWholeKilometres = (value, label = "Odometer") => {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new RangeError(`${label} must be a non-negative whole number`);
  }
  return value;
};

export const toAsiaKolkataDateKey = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(date);
  const values = Object.fromEntries(
    parts.map(({ type, value }) => [type, value]),
  );
  return `${values.year}-${values.month}-${values.day}`;
};

export const isFutureAsiaKolkataDate = (dateKey, now = new Date()) =>
  dateKey > toAsiaKolkataDateKey(now);

export const getLatestOilService = (services = []) =>
  services
    .filter(
      (service) =>
        service.serviceType === "OIL_CHANGE" &&
        service.timelineReviewRequired !== true,
    )
    .sort((left, right) => {
      const odometerDifference =
        right.serviceOdometerKm - left.serviceOdometerKm;
      if (odometerDifference) return odometerDifference;
      const dateDifference =
        new Date(right.serviceDate) - new Date(left.serviceDate);
      if (dateDifference) return dateDifference;
      const createdDifference =
        new Date(right.createdAt) - new Date(left.createdAt);
      if (createdDifference) return createdDifference;
      return String(right._id).localeCompare(String(left._id));
    })[0] ?? null;

export const getServiceStatus = ({
  currentOdometerKm,
  baselineOdometerKm,
  intervalKm,
}) => {
  if (!Number.isSafeInteger(intervalKm) || intervalKm <= 0) {
    return { status: "POLICY_NOT_CONFIGURED", nextServiceOdometerKm: null };
  }

  const nextServiceOdometerKm = baselineOdometerKm + intervalKm;
  if (currentOdometerKm < nextServiceOdometerKm) {
    return { status: "UPCOMING", nextServiceOdometerKm };
  }
  if (currentOdometerKm === nextServiceOdometerKm) {
    return { status: "DUE", nextServiceOdometerKm };
  }
  return { status: "OVERDUE", nextServiceOdometerKm };
};
