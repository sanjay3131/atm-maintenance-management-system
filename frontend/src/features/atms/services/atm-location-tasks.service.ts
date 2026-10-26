import api from "@/lib/axios";
import type {
  ATMLocationTask,
  ATMLocationTaskFilters,
  ATMLocationTaskListResponse,
  ATMLocationTaskStatus,
  CancelATMLocationTaskPayload,
  CreateATMLocationTasksPayload,
  ReassignATMLocationTaskPayload,
  ReopenATMLocationTaskPayload,
} from "../types/atm-location-task.types";

const TASK_PAGE_SIZE = 100;
const ACTIVE_TASK_STATUSES: ATMLocationTaskStatus[] = [
  "ASSIGNED",
  "IN_PROGRESS",
  "ON_HOLD",
  "PENDING_REVIEW",
  "REJECTED",
];

export const getATMLocationTasks = async ({
  page = 1,
  limit = 20,
  ...filters
}: ATMLocationTaskFilters = {}): Promise<ATMLocationTaskListResponse> => {
  const response = await api.get<{ data: ATMLocationTaskListResponse }>(
    "/atm/location-tasks",
    { params: { ...filters, page, limit } },
  );
  return response.data.data;
};

export const startATMLocationTask = async (
  taskId: string,
): Promise<ATMLocationTask> => {
  const response = await api.post<{ data: ATMLocationTask }>(
    `/atm/location-tasks/${taskId}/start`,
  );
  return response.data.data;
};

export const holdATMLocationTask = async (
  taskId: string,
): Promise<ATMLocationTask> => {
  const response = await api.post<{ data: ATMLocationTask }>(
    `/atm/location-tasks/${taskId}/hold`,
  );
  return response.data.data;
};

export const resumeATMLocationTask = async (
  taskId: string,
): Promise<ATMLocationTask> => {
  const response = await api.post<{ data: ATMLocationTask }>(
    `/atm/location-tasks/${taskId}/resume`,
  );
  return response.data.data;
};

export const getAllActiveATMLocationTasks = async (): Promise<
  ATMLocationTask[]
> => {
  const byStatus = await Promise.all(
    ACTIVE_TASK_STATUSES.map(async (status) => {
      const firstPage = await getATMLocationTasks({
        status,
        page: 1,
        limit: TASK_PAGE_SIZE,
      });
      const remainingPages = await Promise.all(
        Array.from(
          { length: Math.max(0, firstPage.pagination.totalPages - 1) },
          (_, index) =>
            getATMLocationTasks({
              status,
              page: index + 2,
              limit: TASK_PAGE_SIZE,
            }),
        ),
      );
      return [firstPage, ...remainingPages].flatMap((page) => page.tasks);
    }),
  );
  return byStatus.flat().filter((task) => task.active);
};

export const createATMLocationTasks = async (
  payload: CreateATMLocationTasksPayload,
): Promise<ATMLocationTask[]> => {
  const response = await api.post<{ data: { tasks: ATMLocationTask[] } }>(
    "/atm/location-tasks/bulk",
    payload,
  );
  return response.data.data.tasks;
};

export const reassignATMLocationTask = async (
  taskId: string,
  payload: ReassignATMLocationTaskPayload,
): Promise<ATMLocationTask> => {
  const response = await api.patch<{ data: ATMLocationTask }>(
    `/atm/location-tasks/${taskId}/reassign`,
    payload,
  );
  return response.data.data;
};

export const reopenATMLocationTask = async (
  taskId: string,
  payload: ReopenATMLocationTaskPayload,
): Promise<ATMLocationTask> => {
  const response = await api.post<{ data: ATMLocationTask }>(
    `/atm/location-tasks/${taskId}/reopen`,
    payload,
  );
  return response.data.data;
};

export const cancelATMLocationTask = async (
  taskId: string,
  payload: CancelATMLocationTaskPayload,
): Promise<ATMLocationTask> => {
  const response = await api.post<{ data: ATMLocationTask }>(
    `/atm/location-tasks/${taskId}/cancel`,
    payload,
  );
  return response.data.data;
};
