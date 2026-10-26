import { isAxiosError } from "axios";
import type { ATM } from "./types/atm.types";
import type {
  ATMLocationTask,
  CreateATMLocationTaskItem,
} from "./types/atm-location-task.types";
import type { Employee } from "@/services/employee.service";
import {
  createATMLocationRequestPayload,
  isAcceptableATMLocationRequestAccuracy,
} from "./atmLocationRequest.utils.ts";
import type { SubmitATMLocationRequestPayload } from "./types/atm-location-request.types";

export interface ATMLocationTaskAssignment {
  employeeId: string;
  correctionReason?: string;
}

export type ATMLocationTaskSelectionOrigin = "automatic" | "manual";

export interface ATMLocationTaskInventoryFilters {
  districtId: string;
  regionId: string;
  bankId: string;
  search: string;
}

export const getATMReferenceId = (
  reference: { _id: string } | string | null | undefined,
) => (typeof reference === "string" ? reference : reference?._id ?? "");

export const filterATMLocationTaskInventory = (
  atms: ATM[],
  filters: ATMLocationTaskInventoryFilters,
) => {
  const search = filters.search.trim().toLocaleLowerCase();
  return atms.filter((atm) => {
    if (filters.districtId && getATMReferenceId(atm.districtId) !== filters.districtId) {
      return false;
    }
    if (filters.regionId && getATMReferenceId(atm.regionId) !== filters.regionId) {
      return false;
    }
    if (filters.bankId && getATMReferenceId(atm.bankId) !== filters.bankId) {
      return false;
    }
    return (
      !search ||
      [atm.atmId, atm.locationName, atm.address].some((value) =>
        value.toLocaleLowerCase().includes(search),
      )
    );
  });
};

export const isEligibleLocationTaskEmployee = (employee: Employee) =>
  employee.status === "active" &&
  employee.userId?.status === "active" &&
  employee.userId?.userType === "employee";

export const searchEligibleLocationTaskEmployees = (
  employees: Employee[],
  search: string,
) => {
  const normalizedSearch = search.trim().toLocaleLowerCase();
  return employees.filter(
    (employee) =>
      isEligibleLocationTaskEmployee(employee) &&
      (!normalizedSearch ||
        employee.employeeCode.toLocaleLowerCase().includes(normalizedSearch) ||
        [employee.userId?.firstName, employee.userId?.lastName]
          .filter(Boolean)
          .join(" ")
          .toLocaleLowerCase()
          .includes(normalizedSearch)),
  );
};

export const getEmployeeDisplayName = (employee: Employee) =>
  `${employee.employeeCode} — ${[employee.userId?.firstName, employee.userId?.lastName]
    .filter(Boolean)
    .join(" ")}`.trim();

export const getEmployeeInitials = (employee: Employee) =>
  [employee.userId?.firstName, employee.userId?.lastName]
    .filter(Boolean)
    .map((name) => name?.[0])
    .join("")
    .toLocaleUpperCase() || employee.employeeCode.slice(0, 2).toLocaleUpperCase();

export const getLocationTaskATMId = (task: ATMLocationTask) =>
  typeof task.atmId === "string" ? task.atmId : task.atmId._id;

export const getLocationTaskEmployeeId = (task: ATMLocationTask) =>
  typeof task.assignedEmployeeId === "string"
    ? task.assignedEmployeeId
    : task.assignedEmployeeId._id;

export const getATMLocationTaskRequestId = (
  task: Pick<ATMLocationTask, "locationRequestId">,
) =>
  typeof task.locationRequestId === "string"
    ? task.locationRequestId
    : task.locationRequestId?._id ?? "";

export const canSubmitATMLocationTask = (task: ATMLocationTask) =>
  task.active &&
  task.status === "IN_PROGRESS" &&
  task.locationRequestId == null;

export const canHoldATMLocationTask = (task: ATMLocationTask) =>
  task.active &&
  task.status === "IN_PROGRESS" &&
  task.locationRequestId == null;

export const canResumeATMLocationTask = (task: ATMLocationTask) =>
  task.active &&
  task.status === "ON_HOLD" &&
  task.locationRequestId == null;

export type EmployeeLocationTaskTab =
  | "ASSIGNED"
  | "IN_PROGRESS"
  | "COMPLETED";

export const EMPLOYEE_LOCATION_TASK_STATUSES = [
  "ASSIGNED",
  "IN_PROGRESS",
  "ON_HOLD",
  "PENDING_REVIEW",
  "REJECTED",
  "COMPLETED",
] as const;

const EMPLOYEE_LOCATION_TASK_TAB_STATUSES: Record<
  EmployeeLocationTaskTab,
  readonly ATMLocationTask["status"][]
> = {
  ASSIGNED: ["ASSIGNED"],
  IN_PROGRESS: ["IN_PROGRESS", "ON_HOLD", "PENDING_REVIEW", "REJECTED"],
  COMPLETED: ["COMPLETED"],
};

export const getEmployeeLocationTaskTabTasks = (
  tasks: ATMLocationTask[],
  tab: EmployeeLocationTaskTab,
) =>
  tasks.filter((task) =>
    EMPLOYEE_LOCATION_TASK_TAB_STATUSES[tab].includes(task.status),
  );

export const getEmployeeLocationTaskTabCounts = (tasks: ATMLocationTask[]) => {
  const counts: Record<EmployeeLocationTaskTab, number> = {
    ASSIGNED: 0,
    IN_PROGRESS: 0,
    COMPLETED: 0,
  };
  for (const task of tasks) {
    if (task.status === "ASSIGNED") counts.ASSIGNED += 1;
    else if (EMPLOYEE_LOCATION_TASK_TAB_STATUSES.IN_PROGRESS.includes(task.status)) {
      counts.IN_PROGRESS += 1;
    } else if (task.status === "COMPLETED") counts.COMPLETED += 1;
  }
  return counts;
};

export const getEmployeeLocationTaskGroups = (tasks: ATMLocationTask[]) =>
  (
    [
      "ASSIGNED",
      "IN_PROGRESS",
      "ON_HOLD",
      "PENDING_REVIEW",
      "REJECTED",
      "COMPLETED",
      "CANCELLED",
    ] as const
  )
    .map((status) => ({
      status,
      tasks: tasks.filter((task) => task.status === status),
    }))
    .filter((group) => group.tasks.length > 0);

export const tryAcquireATMLocationTaskSubmissionLock = (lock: {
  current: boolean;
}) => {
  if (lock.current) return false;
  lock.current = true;
  return true;
};

export const createATMLocationTaskRequestPayload = ({
  task,
  latitude,
  longitude,
  inputSource,
  accuracy,
}: {
  task: ATMLocationTask;
  latitude: number;
  longitude: number;
  inputSource: "GPS" | "MANUAL";
  accuracy?: number | null;
}): SubmitATMLocationRequestPayload => {
  if (!canSubmitATMLocationTask(task)) {
    throw new Error("This location task is not ready for a proposal.");
  }
  if (
    !Number.isFinite(latitude) ||
    latitude < -90 ||
    latitude > 90 ||
    !Number.isFinite(longitude) ||
    longitude < -180 ||
    longitude > 180
  ) {
    throw new Error("Coordinates must be within valid latitude and longitude ranges.");
  }
  if (
    inputSource === "GPS" &&
    !isAcceptableATMLocationRequestAccuracy(accuracy)
  ) {
    throw new Error("GPS accuracy must be a finite value from 0 to 50 metres.");
  }

  const atmId = typeof task.atmId === "string" ? task.atmId : task.atmId._id;
  return {
    ...createATMLocationRequestPayload({
      atmId,
      latitude,
      longitude,
      inputSource,
      accuracy: inputSource === "GPS" ? accuracy : undefined,
    }),
    locationTaskId: task._id,
  };
};

export const buildBulkATMLocationTaskPayload = (
  assignments: Array<{ atmId: string } & ATMLocationTaskAssignment>,
  atms: ATM[],
  activeTasks: ATMLocationTask[],
) => {
  const atmsById = new Map(atms.map((atm) => [atm._id, atm]));
  const activeATMIds = new Set(
    activeTasks.filter((task) => task.active).map(getLocationTaskATMId),
  );
  const seenATMIds = new Set<string>();
  const tasks: CreateATMLocationTaskItem[] = [];

  for (const { atmId, ...assignment } of assignments) {
    if (seenATMIds.has(atmId)) {
      throw new Error("An ATM can only be assigned one location task.");
    }
    seenATMIds.add(atmId);

    const atm = atmsById.get(atmId);
    if (!atm) throw new Error("A selected ATM is no longer available.");
    if (activeATMIds.has(atmId)) {
      throw new Error(`${atm.atmId} already has an active location task.`);
    }
    if (typeof atm.locationConfigured !== "boolean") {
      throw new Error(`${atm.atmId} location status is unavailable.`);
    }
    if (!assignment.employeeId) {
      throw new Error(`Select an employee for ${atm.atmId}.`);
    }

    tasks.push({
      atmId,
      employeeId: assignment.employeeId,
      taskType: atm.locationConfigured
        ? "LOCATION_CORRECTION"
        : "INITIAL_COLLECTION",
      ...(atm.locationConfigured && assignment.correctionReason?.trim()
        ? { correctionReason: assignment.correctionReason.trim() }
        : {}),
    });
  }

  if (!tasks.length) throw new Error("Select at least one eligible ATM.");
  if (tasks.length > 100) {
    throw new Error("A bulk assignment can include at most 100 ATMs.");
  }
  return { tasks };
};

export const selectEmployeeAssignedATMs = ({
  employeeId,
  assignedAtmIds,
  atms,
  activeTasks,
  visibleATMIds,
  assignments,
  origins,
  maxSelections = 100,
}: {
  employeeId: string;
  assignedAtmIds: string[];
  atms: ATM[];
  activeTasks: ATMLocationTask[];
  visibleATMIds: Set<string>;
  assignments: Record<string, ATMLocationTaskAssignment>;
  origins: Record<string, ATMLocationTaskSelectionOrigin>;
  maxSelections?: number;
}) => {
  const nextAssignments = { ...assignments };
  const nextOrigins = { ...origins };
  for (const [atmId, origin] of Object.entries(nextOrigins)) {
    if (origin === "automatic") {
      delete nextAssignments[atmId];
      delete nextOrigins[atmId];
    }
  }

  const atmsById = new Map(atms.map((atm) => [atm._id, atm]));
  const activeATMIds = new Set(
    activeTasks.filter((task) => task.active).map(getLocationTaskATMId),
  );
  let outsideFilterCount = 0;
  let activeTaskCount = 0;
  let unavailableLocationCount = 0;
  let limitReachedCount = 0;
  let autoSelectedCount = 0;

  for (const atmId of new Set(assignedAtmIds)) {
    const atm = atmsById.get(atmId);
    if (!visibleATMIds.has(atmId)) {
      outsideFilterCount += 1;
      continue;
    }
    if (nextAssignments[atmId]) {
      if (!nextAssignments[atmId].employeeId) {
        nextAssignments[atmId] = {
          ...nextAssignments[atmId],
          employeeId,
        };
      }
      continue;
    }
    if (!atm || activeATMIds.has(atmId)) {
      activeTaskCount += 1;
      continue;
    }
    if (typeof atm.locationConfigured !== "boolean") {
      unavailableLocationCount += 1;
      continue;
    }
    if (Object.keys(nextAssignments).length >= maxSelections) {
      limitReachedCount += 1;
      continue;
    }

    nextAssignments[atmId] = { employeeId, correctionReason: "" };
    nextOrigins[atmId] = "automatic";
    autoSelectedCount += 1;
  }

  return {
    assignments: nextAssignments,
    origins: nextOrigins,
    autoSelectedCount,
    outsideFilterCount,
    activeTaskCount,
    unavailableLocationCount,
    limitReachedCount,
  };
};

export const setManualATMLocationTaskSelection = ({
  atmId,
  checked,
  employeeId,
  assignments,
  origins,
}: {
  atmId: string;
  checked: boolean;
  employeeId: string;
  assignments: Record<string, ATMLocationTaskAssignment>;
  origins: Record<string, ATMLocationTaskSelectionOrigin>;
}) => {
  const nextAssignments = { ...assignments };
  const nextOrigins = { ...origins };
  if (checked) {
    nextAssignments[atmId] = { employeeId, correctionReason: "" };
    nextOrigins[atmId] = "manual";
  } else {
    delete nextAssignments[atmId];
    delete nextOrigins[atmId];
  }
  return { assignments: nextAssignments, origins: nextOrigins };
};

export const getBulkATMLocationTaskErrorMessage = (
  error: unknown,
  getATMLabel: (atmId: string) => string = (atmId) => atmId,
) => {
  const message = getLocationTaskActionErrorMessage(error);
  const errors =
    typeof error === "object" &&
    error !== null &&
    "response" in error &&
    typeof error.response === "object" &&
    error.response !== null &&
    "data" in error.response &&
    typeof error.response.data === "object" &&
    error.response.data !== null &&
    "errors" in error.response.data &&
    Array.isArray(error.response.data.errors)
      ? error.response.data.errors
      : [];
  const details = errors
    .filter(
      (item): item is { atmId?: string; message?: string } =>
        typeof item === "object" && item !== null,
    )
    .map(
      (item) =>
        `${item.atmId ? `ATM ${getATMLabel(item.atmId)}: ` : ""}${item.message ?? "Validation failed"}`,
    );
  return details.length
    ? `No tasks were created. ${message}: ${details.join("; ")}`
    : message;
};

export const getLocationTaskActionErrorMessage = (error: unknown) => {
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
    const message = error.response.data.message;
    const status =
      "status" in error.response && typeof error.response.status === "number"
        ? error.response.status
        : undefined;
    return status === 409
      ? `${message} The task may have changed; the list is being refreshed.`
      : message;
  }
  return error instanceof Error ? error.message : "Please try again.";
};

interface ATMLocationTaskBulkErrorResponse {
  message?: string;
  errors?: Array<{
    statusCode?: number;
    message?: string;
  }>;
}

export const shouldRefreshATMLocationTaskInventory = (error: unknown) => {
  if (!isAxiosError<ATMLocationTaskBulkErrorResponse>(error)) return false;

  if (error.response?.status === 409) return true;
  if (error.response?.status !== 400) return false;

  return error.response.data.errors?.some(
    (item) =>
      item.statusCode === 409 &&
      item.message === "ATM already has an active location task",
  ) ?? false;
};
