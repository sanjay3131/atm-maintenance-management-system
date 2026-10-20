import test from "node:test";
import assert from "node:assert/strict";
import {
  buildSupervisorAMCListQuery,
  formatSupervisorAMCLabel,
  getSupervisorBusinessMonth,
  isSupervisorAMCId,
  isSupervisorAMCResponseConfirmed,
  supervisorAMCATMName,
  supervisorAMCEmployeeName,
  SUPERVISOR_AMC_STATUSES,
} from "../src/features/supervisor/supervisorAmc.utils.ts";

test("AMC status filters match the persisted backend status values", () => {
  assert.deepEqual(SUPERVISOR_AMC_STATUSES, [
    "PENDING",
    "IN_PROGRESS",
    "COMPLETED",
    "OVERDUE",
  ]);
  assert.equal(formatSupervisorAMCLabel("IN_PROGRESS"), "In Progress");
});

test("AMC details route validates ObjectIds and handles missing references", () => {
  assert.equal(isSupervisorAMCId("64b000000000000000000001"), true);
  assert.equal(isSupervisorAMCId("invalid"), false);
  assert.equal(supervisorAMCEmployeeName(null), "Employee unavailable");
  assert.equal(supervisorAMCEmployeeName("64b000000000000000000001"), "Employee unavailable");
  assert.equal(
    supervisorAMCEmployeeName({ firstName: "Mira", lastName: "Shah" }),
    "Mira Shah",
  );
  assert.equal(supervisorAMCATMName(null), "ATM unavailable");
  assert.equal(supervisorAMCATMName({ atmId: "ATM-12" }), "ATM-12");
});

test("AMC list query includes supported search, status, period, and page fields", () => {
  assert.deepEqual(
    buildSupervisorAMCListQuery({
      page: 2,
      limit: 20,
      month: 10,
      year: 2026,
      status: "OVERDUE",
      search: " AMC-2026 ",
    }),
    {
      page: 2,
      limit: 20,
      month: 10,
      year: 2026,
      status: "OVERDUE",
      search: "AMC-2026",
    },
  );
  assert.deepEqual(
    buildSupervisorAMCListQuery({
      page: 1,
      limit: 20,
      month: 10,
      year: 2026,
      status: "",
      search: " ",
    }),
    { page: 1, limit: 20, month: 10, year: 2026 },
  );
});

test("cached AMC details stay hidden until the current request confirms access", () => {
  const currentFetch = {
    validId: true,
    isFetchedAfterMount: true,
    isSuccess: true,
    isError: false,
    isFetching: false,
  };
  assert.equal(isSupervisorAMCResponseConfirmed(currentFetch), true);
  assert.equal(
    isSupervisorAMCResponseConfirmed({ ...currentFetch, isFetching: true }),
    false,
  );
  assert.equal(
    isSupervisorAMCResponseConfirmed({ ...currentFetch, isError: true }),
    false,
  );
  assert.equal(
    isSupervisorAMCResponseConfirmed({
      ...currentFetch,
      isFetchedAfterMount: false,
    }),
    false,
  );
});

test("AMC period defaults use Asia/Kolkata calendar boundaries", () => {
  const period = getSupervisorBusinessMonth(new Date("2026-12-31T20:00:00.000Z"));
  assert.deepEqual(period, { month: 1, year: 2027 });
});
