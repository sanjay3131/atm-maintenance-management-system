import type {
  SupervisorAMCListQuery,
  SupervisorAmcStatus,
} from "@/services/supervisor.service";

export const SUPERVISOR_AMC_STATUSES: SupervisorAmcStatus[] = [
  "PENDING",
  "IN_PROGRESS",
  "COMPLETED",
  "OVERDUE",
];

export const isSupervisorAMCId = (amcId: string) =>
  /^[a-f\d]{24}$/i.test(amcId);

export const isSupervisorAMCResponseConfirmed = ({
  validId,
  isFetchedAfterMount,
  isSuccess,
  isError,
  isFetching,
}: {
  validId: boolean;
  isFetchedAfterMount: boolean;
  isSuccess: boolean;
  isError: boolean;
  isFetching: boolean;
}) =>
  validId &&
  isFetchedAfterMount &&
  isSuccess &&
  !isError &&
  !isFetching;

export const buildSupervisorAMCListQuery = ({
  page,
  limit,
  month,
  year,
  status,
  search,
}: {
  page: number;
  limit: number;
  month: number;
  year: number;
  status: SupervisorAmcStatus | "";
  search: string;
}): SupervisorAMCListQuery => ({
  page,
  limit,
  month,
  year,
  ...(status ? { status } : {}),
  ...(search.trim() ? { search: search.trim() } : {}),
});

export const formatSupervisorAMCLabel = (value?: string | null) =>
  value
    ? value
        .toLowerCase()
        .split("_")
        .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
        .join(" ")
    : "Unavailable";

export const getSupervisorBusinessMonth = (date = new Date()) => {
  const parts = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "numeric",
  }).formatToParts(date);
  return {
    month: Number(parts.find((part) => part.type === "month")?.value),
    year: Number(parts.find((part) => part.type === "year")?.value),
  };
};

export const supervisorAMCEmployeeName = (
  employee?:
    | string
    | { firstName?: string | null; lastName?: string | null }
    | null,
) => {
  if (!employee || typeof employee === "string") return "Employee unavailable";
  return (
    [employee.firstName, employee.lastName].filter(Boolean).join(" ").trim() ||
    "Employee unavailable"
  );
};

export const supervisorAMCATMName = (
  atm?:
    | string
    | { atmId?: string | null; locationName?: string | null }
    | null,
) => {
  if (!atm || typeof atm === "string") return "ATM unavailable";
  return atm.atmId || atm.locationName || "ATM unavailable";
};
