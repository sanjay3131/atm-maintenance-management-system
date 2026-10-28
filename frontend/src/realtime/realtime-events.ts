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
  ["atm-location-request", event.entityId],
  ...(typeof event.data.locationRequestId === "string"
    ? [["atm-location-request", event.data.locationRequestId] as QueryKey]
    : []),
  ["my-atm-location-requests"],
  ["atm-location-tasks"],
  ["atms"],
  ["atm"],
  ["dashboard-stats"],
  ["dashboard-recent-activity"],
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
  return [];
};

export const invalidateRealtimeEvent = (
  queryClient: QueryClient,
  event: RealtimeEvent,
) => invalidate(queryClient, queryKeysForRealtimeEvent(event));

export const invalidateRealtimeDomains = (queryClient: QueryClient) =>
  invalidate(queryClient, [
    ["jobs"],
    ["my-jobs"],
    ["supervisor-jobs"],
    ["customer-portal", "jobs"],
    ["atm-location-requests"],
    ["my-atm-location-requests"],
    ["atm-location-tasks"],
    ["atms"],
    ["dashboard-stats"],
    ["dashboard-job-trends"],
    ["dashboard-recent-activity"],
  ]);
