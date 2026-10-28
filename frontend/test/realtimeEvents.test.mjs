import test from "node:test";
import assert from "node:assert/strict";
import {
  invalidateRealtimeEvent,
  invalidateRealtimeDomains,
} from "../src/realtime/realtime-events.ts";

const event = (overrides = {}) => ({
  eventVersion: 1,
  eventId: "event-1",
  entityType: "job",
  entityId: "job-1",
  action: "updated",
  occurredAt: "2026-10-28T00:00:00.000Z",
  data: {},
  ...overrides,
});

const queryClient = () => {
  const calls = [];
  return {
    calls,
    invalidateQueries: async ({ queryKey }) => {
      calls.push(queryKey);
    },
  };
};

test("invalidates job detail, list, customer, supervisor, and dashboard families", async () => {
  const client = queryClient();
  await invalidateRealtimeEvent(client, event());

  assert.deepEqual(client.calls, [
    ["jobs"],
    ["job", "job-1"],
    ["job-history", "job-1"],
    ["my-jobs"],
    ["supervisor-jobs"],
    ["supervisor-job", "job-1"],
    ["supervisor-job-history", "job-1"],
    ["customer-portal", "jobs"],
    ["customer-portal", "job", "job-1"],
    ["customer-portal", "job-history", "job-1"],
    ["customer-complaints"],
    ["complaints", "admin-list"],
    ["dashboard-stats"],
    ["dashboard-job-trends"],
    ["dashboard-recent-activity"],
    ["dashboard-employee-performance"],
  ]);
});

test("invalidates location request and task families without carrying coordinates", async () => {
  const client = queryClient();
  await invalidateRealtimeEvent(
    client,
    event({
      eventId: "event-2",
      entityType: "atm-location-request",
      entityId: "request-1",
      data: { atmId: "atm-1", locationRequestId: "request-2" },
    }),
  );

  assert.deepEqual(client.calls, [
    ["atm-location-requests"],
    ["atm-location-request", "request-1"],
    ["atm-location-request", "request-2"],
    ["my-atm-location-requests"],
    ["atm-location-tasks"],
    ["atms"],
    ["atm"],
    ["dashboard-stats"],
    ["dashboard-recent-activity"],
  ]);
});

test("reconnect recovery invalidates only the implemented realtime domains", async () => {
  const client = queryClient();
  await invalidateRealtimeDomains(client);

  assert.equal(client.calls.some(([key]) => key === "users"), false);
  assert.equal(client.calls.some(([key]) => key === "notifications"), false);
  assert.equal(client.calls.some(([key]) => key === "jobs"), true);
  assert.equal(client.calls.some(([key]) => key === "atm-location-tasks"), true);
});
