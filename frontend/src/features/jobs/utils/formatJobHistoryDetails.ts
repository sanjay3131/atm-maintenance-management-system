import type { EmployeeLanguageContextValue } from "../../employee-portal/i18n";

function isDetailsRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function formatAdditionalWorkerSnapshot(
  value: unknown,
  translateLabel: (label: string) => string,
): string | null {
  if (!isDetailsRecord(value)) return null;

  const fields: string[] = [];
  if (typeof value.workerType === "string" && value.workerType) {
    fields.push(`${translateLabel("Worker type")}: ${value.workerType}`);
  }
  if (typeof value.quantity === "number" && Number.isFinite(value.quantity)) {
    fields.push(`${translateLabel("Quantity")}: ${value.quantity}`);
  }
  if (typeof value.notes === "string" && value.notes.trim()) {
    fields.push(`${translateLabel("Notes")}: ${value.notes}`);
  }
  return fields.length > 0 ? fields.join(", ") : null;
}

export function formatHistoryDetailLines(
  action: string,
  details: unknown,
  t: EmployeeLanguageContextValue["t"],
  translateLabel: (label: string) => string,
  atm?: { documentId?: string; identifier?: string },
): string[] {
  if (details === null || details === undefined || details === "") return [];
  if (typeof details === "string") return [details];
  if (typeof details !== "object") return [String(details)];

  if (Array.isArray(details)) {
    const values = details.filter(
      (value) =>
        typeof value === "string" ||
        typeof value === "number" ||
        typeof value === "boolean",
    );
    return values.length > 0
      ? [t("Details: {details}", { details: values.join(", ") })]
      : [];
  }

  const record = details as Record<string, unknown>;
  if (
    action === "additional_worker_added" ||
    action === "additional_worker_updated" ||
    action === "additional_worker_removed"
  ) {
    const before = formatAdditionalWorkerSnapshot(record.before, translateLabel);
    const after = formatAdditionalWorkerSnapshot(record.after, translateLabel);
    const lines: string[] = [];
    if (action === "additional_worker_added" && after) {
      lines.push(t("Added: {details}", { details: after }));
    } else if (action === "additional_worker_updated") {
      if (before) lines.push(t("Before: {details}", { details: before }));
      if (after) lines.push(t("After: {details}", { details: after }));
    } else if (action === "additional_worker_removed" && before) {
      lines.push(t("Removed: {details}", { details: before }));
    }
    return lines.length > 0
      ? lines
      : [t("Additional worker details recorded.")];
  }

  if (action === "gps_validated") {
    const gpsLines: string[] = [];
    const distance = record.gpsDistance;
    const accuracy = record.gpsAccuracy;
    if (typeof distance === "number" && Number.isFinite(distance)) {
      gpsLines.push(t("GPS Distance: {distance} m", { distance }));
    }
    if (typeof accuracy === "number" && Number.isFinite(accuracy)) {
      gpsLines.push(t("GPS Accuracy: {accuracy} m", { accuracy }));
    }

    const formatLocation = (
      label: "Employee Location" | "ATM Location",
      location: unknown,
    ) => {
      if (!isDetailsRecord(location)) return;
      const { latitude, longitude } = location;
      if (
        typeof latitude === "number" &&
        Number.isFinite(latitude) &&
        typeof longitude === "number" &&
        Number.isFinite(longitude)
      ) {
        gpsLines.push(
          t(`${label}: {latitude}, {longitude}`, { latitude, longitude }),
        );
      }
    };

    formatLocation("Employee Location", record.employeeLocation);
    formatLocation("ATM Location", record.atmLocation);
    if (gpsLines.length > 0) return gpsLines;
  }

  const labels: Record<string, string> = {
    adminRemarks: "Admin Remarks",
    assignedTo: "Assigned employee updated",
    employeeId: "Assigned employee updated",
    fromEmployee: "Previous employee updated",
    holdReason: "Hold Reason",
    reason: "Reason",
    rejectionReason: "Rejection Reason",
    reassignmentReason: "Reassignment Reason",
    title: "Title",
    toEmployee: "New employee assigned",
    atmId: "ATM ID",
  };
  return Object.entries(record).flatMap(([key, value]) => {
    if (value === null || value === undefined || value === "") return [];
    if (key === "atmId" && typeof value === "string") {
      const resolvesToCurrentATM =
        atm?.documentId &&
        atm.identifier &&
        value.toLowerCase() === atm.documentId.toLowerCase();
      return [
        `${t("ATM ID")}: ${resolvesToCurrentATM ? atm.identifier : value}`,
      ];
    }
    if (
      ["assignedTo", "employeeId", "fromEmployee", "toEmployee"].includes(key)
    ) {
      return [translateLabel(labels[key])];
    }

    const label =
      labels[key] ||
      key
        .replace(/([A-Z])/g, " $1")
        .replace(/^./, (character) => character.toUpperCase());
    if (Array.isArray(value)) {
      const scalarValues = value.filter(
        (item) =>
          typeof item === "string" ||
          typeof item === "number" ||
          typeof item === "boolean",
      );
      return scalarValues.length > 0
        ? [`${translateLabel(label)}: ${scalarValues.join(", ")}`]
        : [];
    }
    if (typeof value === "object") {
      return [`${translateLabel(label)}: ${t("details recorded")}`];
    }
    return [`${translateLabel(label)}: ${String(value)}`];
  });
}
