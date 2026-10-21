import type { AdminAMCRecord, AMCStatus } from "@/services/amc.service";

export const ADMIN_AMC_STATUSES: AMCStatus[] = [
  "PENDING",
  "IN_PROGRESS",
  "COMPLETED",
  "OVERDUE",
];

export const getAdminAMCListState = ({
  isLoading,
  isError,
  amcs,
}: {
  isLoading: boolean;
  isError: boolean;
  amcs: AdminAMCRecord[];
}) => {
  if (isLoading) return "loading" as const;
  if (isError) return "error" as const;
  return amcs.length ? ("ready" as const) : ("empty" as const);
};

export const formatAdminAMCStatus = (status: AMCStatus) =>
  status
    .toLowerCase()
    .split("_")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");

export const getAdminAMCErrorMessage = (error: unknown) => {
  if (
    typeof error === "object" &&
    error !== null &&
    "response" in error &&
    typeof error.response === "object" &&
    error.response !== null &&
    "data" in error.response &&
    typeof error.response.data === "object" &&
    error.response.data !== null &&
    "message" in error.response.data &&
    typeof error.response.data.message === "string"
  ) {
    return error.response.data.message;
  }
  return error instanceof Error ? error.message : "Please try again.";
};

export const isValidAMCGenerationPeriod = (month: number, year: number) =>
  Number.isInteger(month) &&
  month >= 1 &&
  month <= 12 &&
  Number.isInteger(year) &&
  year >= 2000 &&
  year <= 2100;

export const isAdminAMCId = (amcId: string) => /^[a-f\d]{24}$/i.test(amcId);

const safeAMCFilePart = (value: string | null | undefined, fallback: string) =>
  (value || "")
    .normalize("NFKD")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^[._-]+|[._-]+$/g, "")
    .slice(0, 80) || fallback;

export const getAdminAMCVisitDate = ({
  visitDate,
  completedAt,
  month,
  year,
}: {
  visitDate?: string | null;
  completedAt?: string | null;
  month: number;
  year: number;
}) => {
  const formatVisitDate = (date: Date) => {
    const parts = new Intl.DateTimeFormat("en-IN", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(date);
    const part = (type: string) =>
      parts.find((value) => value.type === type)?.value;
    return `${part("year")}-${part("month")}-${part("day")}`;
  };

  for (const value of [visitDate, completedAt]) {
    if (!value) continue;
    const date = new Date(value);
    if (!Number.isNaN(date.getTime())) return formatVisitDate(date);
  }
  return formatVisitDate(new Date(Date.UTC(year, month - 1, 1)));
};

export const getAdminAMCDownloadFilename = (
  amc: {
    atmId?: { atmId?: string | null } | string | null;
    visitDate?: string | null;
    completedAt?: string | null;
    month: number;
    year: number;
  },
  type: "zip" | "pdf",
) => {
  const atmId =
    typeof amc.atmId === "object" && amc.atmId !== null
      ? amc.atmId.atmId
      : undefined;
  const safeATMId = safeAMCFilePart(atmId, "ATM");
  const visitDate = getAdminAMCVisitDate(amc);
  return type === "zip"
    ? `${safeATMId}_${visitDate}_AMC_Photos.zip`
    : `${safeATMId}_${visitDate}_AMC_Report.pdf`;
};
