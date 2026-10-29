import type { QueryClient, QueryKey } from "@tanstack/react-query";

export const REALTIME_EVENTS = {
  JOB_UPDATED: "domain:job:updated",
  LOCATION_TASK_UPDATED: "domain:atm-location-task:updated",
  LOCATION_REQUEST_UPDATED: "domain:atm-location-request:updated",
} as const;

export type RealtimeEventName =
  (typeof REALTIME_EVENTS)[keyof typeof REALTIME_EVENTS];

export interface RealtimeEvent {
  eventVersion: 1;
  eventId: string;
  entityType: string;
  entityId: string;
  action: string;
  occurredAt: string;
  data: Record<string, unknown>;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isNonEmptyString = (value: unknown): value is string =>
  typeof value === "string" && value.trim().length > 0;

export const isRealtimeEvent = (
  value: unknown,
  expectedEvent: RealtimeEventName,
): value is RealtimeEvent => {
  if (!isRecord(value) || value.eventVersion !== 1) return false;
  if (
    !isNonEmptyString(value.eventId) ||
    !isNonEmptyString(value.entityId) ||
    !isNonEmptyString(value.action) ||
    typeof value.occurredAt !== "string" ||
    Number.isNaN(Date.parse(value.occurredAt)) ||
    !isRecord(value.data)
  ) {
    return false;
  }

  const allowedEntityTypes: Record<RealtimeEventName, string[]> = {
    [REALTIME_EVENTS.JOB_UPDATED]: ["job"],
    [REALTIME_EVENTS.LOCATION_TASK_UPDATED]: ["atm-location-task"],
    [REALTIME_EVENTS.LOCATION_REQUEST_UPDATED]: [
      "atm-location-request",
      "atm-location",
    ],
  };
  if (
    typeof value.entityType !== "string" ||
    !allowedEntityTypes[expectedEvent].includes(value.entityType)
  ) {
    return false;
  }

  for (const idField of ["atmId", "locationRequestId"]) {
    if (
      idField in value.data &&
      !isNonEmptyString(value.data[idField])
    ) {
      return false;
    }
  }

  if (
    value.entityType !== "job" &&
    !isNonEmptyString(value.data.atmId)
  ) {
    return false;
  }

  return true;
};

const invalidate = (queryClient: QueryClient, queryKeys: QueryKey[]) =>
  Promise.all(
    queryKeys.map((queryKey) =>
      queryClient.invalidateQueries({ queryKey }),
    ),
  );

const jobQueryKeys = (event: RealtimeEvent): QueryKey[] => [
  ["jobs"],
  ["job", event.entityId],
  ["job-history", event.entityId],
  ["my-jobs"],
  ["supervisor-jobs"],
  ["supervisor-job", event.entityId],
  ["supervisor-job-history", event.entityId],
  ["supervisor-job-photos", event.entityId],
  ["customer-portal", "jobs"],
  ["customer-portal", "job", event.entityId],
  ["customer-portal", "job-history", event.entityId],
  ["customer-complaints"],
  ["complaints", "admin-list"],
  ["dashboard-stats"],
  ["dashboard-job-trends"],
  ["dashboard-recent-activity"],
  ["dashboard-employee-performance"],
];

const locationQueryKeys = (event: RealtimeEvent): QueryKey[] => [
  ["atm-location-requests"],
  ...(event.entityType === "atm-location-request"
    ? [["atm-location-request", event.entityId] as QueryKey]
    : []),
  ...(typeof event.data.locationRequestId === "string"
    ? [["atm-location-request", event.data.locationRequestId] as QueryKey]
    : []),
  ["atms"],
  ["atm", event.data.atmId ?? event.entityId],
  ...(event.entityType === "atm-location"
    ? []
    : [
        ["my-atm-location-requests"],
        ["atm-location-tasks"],
        ["dashboard-stats"],
        ["dashboard-recent-activity"],
      ]),
];

const requestWindowQueryKeys = (event: RealtimeEvent): QueryKey[] => [
  ["atm-location-requests"],
  ["atms"],
  ["atm", event.entityId],
];

export const queryKeysForRealtimeEvent = (
  event: RealtimeEvent,
): QueryKey[] => {
  if (event.entityType === "job") return jobQueryKeys(event);
  if (
    event.entityType === "atm-location-task" ||
    event.entityType === "atm-location-request"
  ) {
    return locationQueryKeys(event);
  }
  if (event.entityType === "atm-location") {
    return requestWindowQueryKeys(event);
  }
  return [];
};

export const invalidateRealtimeEvent = (
  queryClient: QueryClient,
  event: RealtimeEvent,
) => invalidate(queryClient, queryKeysForRealtimeEvent(event));

export const invalidateRealtimeDomains = (queryClient: QueryClient) =>
  invalidate(queryClient, [
    ["jobs"],
    ["job"],
    ["job-history"],
    ["my-jobs"],
    ["supervisor-jobs"],
    ["supervisor-job"],
    ["supervisor-job-history"],
    ["supervisor-job-photos"],
    ["customer-portal", "jobs"],
    ["customer-portal", "job"],
    ["customer-portal", "job-history"],
    ["customer-complaints"],
    ["complaints", "admin-list"],
    ["atm-location-requests"],
    ["atm-location-request"],
    ["my-atm-location-requests"],
    ["atm-location-tasks"],
    ["atms"],
    ["atm"],
    ["dashboard-stats"],
    ["dashboard-job-trends"],
    ["dashboard-recent-activity"],
    ["dashboard-employee-performance"],
  ]);
