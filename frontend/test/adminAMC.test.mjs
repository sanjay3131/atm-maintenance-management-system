import test from "node:test";
import assert from "node:assert/strict";
import {
  ADMIN_AMC_STATUSES,
  formatAdminAMCStatus,
  getAdminAMCErrorMessage,
  getAdminAMCDownloadFilename,
  getAdminAMCListState,
  getAdminAMCVisitDate,
  isAdminAMCId,
  isValidAMCGenerationPeriod,
} from "../src/features/amc/amcAdmin.utils.ts";

test("admin AMC list covers loading, error, empty, and loaded states", () => {
  assert.equal(
    getAdminAMCListState({ isLoading: true, isError: false, amcs: [] }),
    "loading",
  );
  assert.equal(
    getAdminAMCListState({ isLoading: false, isError: true, amcs: [] }),
    "error",
  );
  assert.equal(
    getAdminAMCListState({ isLoading: false, isError: false, amcs: [] }),
    "empty",
  );
  assert.equal(
    getAdminAMCListState({
      isLoading: false,
      isError: false,
      amcs: [{ _id: "amc-1" }],
    }),
    "ready",
  );
});

test("admin AMC status filters use persisted backend values", () => {
  assert.deepEqual(ADMIN_AMC_STATUSES, [
    "PENDING",
    "IN_PROGRESS",
    "COMPLETED",
    "OVERDUE",
  ]);
  assert.equal(formatAdminAMCStatus("IN_PROGRESS"), "In Progress");
});

test("generation period validation rejects invalid month and year values", () => {
  assert.equal(isValidAMCGenerationPeriod(1, 2026), true);
  assert.equal(isValidAMCGenerationPeriod(12, 2100), true);
  assert.equal(isValidAMCGenerationPeriod(0, 2026), false);
  assert.equal(isValidAMCGenerationPeriod(13, 2026), false);
  assert.equal(isValidAMCGenerationPeriod(1.5, 2026), false);
  assert.equal(isValidAMCGenerationPeriod(1, 1999), false);
  assert.equal(isValidAMCGenerationPeriod(1, 2101), false);
});

test("admin AMC errors prefer the API message and have a fallback", () => {
  assert.equal(
    getAdminAMCErrorMessage({
      response: { data: { message: "AMC generation failed." } },
    }),
    "AMC generation failed.",
  );
  assert.equal(
    getAdminAMCErrorMessage(new Error("Network unavailable")),
    "Network unavailable",
  );
});

test("admin AMC detail links validate record identifiers", () => {
  assert.equal(isAdminAMCId("64b000000000000000000001"), true);
  assert.equal(isAdminAMCId("invalid"), false);
});

test("AMC download filenames use the actual visit date and sanitize ATM identifiers", () => {
  const amc = {
    atmId: { atmId: "../ATM 123" },
    visitDate: "2026-10-21T12:34:00.000Z",
    completedAt: "2026-10-22T12:34:00.000Z",
    month: 10,
    year: 2026,
  };
  assert.equal(
    getAdminAMCDownloadFilename(amc, "zip"),
    "ATM_123_2026-10-21_AMC_Photos.zip",
  );
  assert.equal(
    getAdminAMCDownloadFilename(amc, "pdf"),
    "ATM_123_2026-10-21_AMC_Report.pdf",
  );
});

test("AMC download filenames fall back to completion date then AMC period", () => {
  const base = { month: 2, year: 2026 };
  assert.equal(
    getAdminAMCVisitDate({
      ...base,
      visitDate: null,
      completedAt: "2026-02-18T17:00:00.000Z",
    }),
    "2026-02-18",
  );
  assert.equal(
    getAdminAMCDownloadFilename(
      { ...base, atmId: null, visitDate: null, completedAt: null },
      "pdf",
    ),
    "ATM_2026-02-01_AMC_Report.pdf",
  );
});
