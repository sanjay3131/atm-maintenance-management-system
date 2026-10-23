import test from "node:test";
import assert from "node:assert/strict";
import {
  AMC_CHECKLIST_ITEMS,
  AMC_STATUSES,
  REQUIRED_AMC_PHOTOS,
  canCompleteAMC,
  canStartAMC,
  createAMCChecklist,
  formatAMCStatus,
  getAMCErrorMessage,
  getAMCPhotoSelectionError,
  getAMCTaskListState,
  hasStartedAMCVisit,
  isAMCChecklistEqual,
  validateAMCChecklist,
} from "../src/features/amc/amcExecution.utils.ts";
import {
  getEmployeeAMCStatusLabelKey,
  getEmployeeAMCValueLabelKey,
} from "../src/features/employee-portal/employeeLanguage.utils.ts";

const completeChecklist = () =>
  AMC_CHECKLIST_ITEMS.map(({ id, options }) => ({
    item: id,
    response: options[0],
    remarks: "",
  }));

test("AMC task list state covers loading, errors, empty results, and loaded records", () => {
  assert.equal(
    getAMCTaskListState({ isLoading: true, isError: false, amcs: [] }),
    "loading",
  );
  assert.equal(
    getAMCTaskListState({ isLoading: false, isError: true, amcs: [] }),
    "error",
  );
  assert.equal(
    getAMCTaskListState({ isLoading: false, isError: false, amcs: [] }),
    "empty",
  );
  assert.equal(
    getAMCTaskListState({
      isLoading: false,
      isError: false,
      amcs: [{ _id: "amc-1" }],
    }),
    "ready",
  );
});

test("AMC statuses use backend values and readable labels", () => {
  assert.deepEqual(AMC_STATUSES, [
    "PENDING",
    "IN_PROGRESS",
    "COMPLETED",
    "OVERDUE",
  ]);
  assert.equal(formatAMCStatus("IN_PROGRESS"), "In Progress");
  assert.equal(getEmployeeAMCStatusLabelKey("PENDING"), "Pending");
  assert.equal(getEmployeeAMCStatusLabelKey("IN_PROGRESS"), "In progress");
  assert.equal(getEmployeeAMCStatusLabelKey("COMPLETED"), "Completed");
  assert.equal(getEmployeeAMCStatusLabelKey("OVERDUE"), "Overdue");
});

test("AMC checklist labels map known values and preserve unknown values for fallback", () => {
  assert.equal(getEmployeeAMCValueLabelKey("Night Light Working"), "Night Light Working");
  assert.equal(getEmployeeAMCValueLabelKey("Not Working"), "Not Working");
  assert.equal(getEmployeeAMCValueLabelKey("unrecognized"), undefined);
});

test("checklist creation follows backend IDs and validates exact allowed responses", () => {
  const checklist = completeChecklist();
  assert.equal(checklist.length, 11);
  assert.equal(validateAMCChecklist(checklist), true);
  assert.equal(
    validateAMCChecklist(
      checklist.map((entry, index) =>
        index === 0 ? { ...entry, response: "Not an allowed response" } : entry,
      ),
    ),
    false,
  );
  assert.equal(
    validateAMCChecklist(checklist.filter((entry) => entry.item !== "door")),
    false,
  );
  assert.deepEqual(
    createAMCChecklist([{ item: "door", response: "Issue", remarks: "Repair" }])[0],
    { item: "door", response: "Issue", remarks: "Repair" },
  );
  assert.equal(isAMCChecklistEqual(checklist, checklist), true);
  assert.equal(
    isAMCChecklistEqual(
      checklist.map((entry) =>
        entry.item === "door" ? { ...entry, response: "Issue" } : entry,
      ),
      checklist,
    ),
    false,
  );
});

test("completion requires an active or overdue visit, saved checklist, and all photos", () => {
  assert.equal(REQUIRED_AMC_PHOTOS, 6);
  assert.equal(
    canCompleteAMC({
      status: "IN_PROGRESS",
      visitDate: "2026-10-21T08:00:00.000Z",
      checklistCompleted: true,
      photoCount: 6,
    }),
    true,
  );
  assert.equal(
    canCompleteAMC({
      status: "OVERDUE",
      visitDate: "2026-10-21T08:00:00.000Z",
      checklistCompleted: true,
      photoCount: 6,
    }),
    true,
  );
  assert.equal(
    canCompleteAMC({
      status: "PENDING",
      visitDate: "2026-10-21T08:00:00.000Z",
      checklistCompleted: true,
      photoCount: 6,
    }),
    false,
  );
  assert.equal(
    canCompleteAMC({
      status: "IN_PROGRESS",
      visitDate: "2026-10-21T08:00:00.000Z",
      checklistCompleted: false,
      photoCount: 6,
    }),
    false,
  );
  assert.equal(
    canCompleteAMC({
      status: "IN_PROGRESS",
      visitDate: "2026-10-21T08:00:00.000Z",
      checklistCompleted: true,
      photoCount: 5,
    }),
    false,
  );
  assert.equal(
    canCompleteAMC({
      status: "IN_PROGRESS",
      checklistCompleted: true,
      photoCount: 6,
    }),
    false,
  );
});

test("starting is available only for unstarted pending or overdue visits", () => {
  assert.equal(canStartAMC({ status: "PENDING" }), true);
  assert.equal(canStartAMC({ status: "OVERDUE" }), true);
  assert.equal(
    canStartAMC({
      status: "OVERDUE",
      visitDate: "2026-10-21T08:00:00.000Z",
    }),
    false,
  );
  assert.equal(
    canStartAMC({
      status: "PENDING",
      visitDate: "2026-10-21T08:00:00.000Z",
    }),
    false,
  );
  assert.equal(
    canStartAMC({
      status: "IN_PROGRESS",
      visitDate: "2026-10-21T08:00:00.000Z",
    }),
    false,
  );
});

test("checklist is ready only after a persisted visit start date and allowed status", () => {
  assert.equal(
    hasStartedAMCVisit({ status: "PENDING", visitDate: null }),
    false,
  );
  assert.equal(
    hasStartedAMCVisit({ status: "OVERDUE", visitDate: null }),
    false,
  );
  assert.equal(
    hasStartedAMCVisit({
      status: "IN_PROGRESS",
      visitDate: "2026-10-21T08:00:00.000Z",
    }),
    true,
  );
  assert.equal(
    hasStartedAMCVisit({
      status: "OVERDUE",
      visitDate: "2026-10-21T08:00:00.000Z",
    }),
    true,
  );
  assert.equal(
    hasStartedAMCVisit({
      status: "COMPLETED",
      visitDate: "2026-10-21T08:00:00.000Z",
    }),
    true,
  );
});

test("photo selection follows backend file types, count, and size limits", () => {
  const allowedFile = { type: "image/jpeg", size: 1024 };
  assert.equal(getAMCPhotoSelectionError([allowedFile], 5), "");
  assert.match(getAMCPhotoSelectionError([], 0), /Choose at least one/);
  assert.match(
    getAMCPhotoSelectionError([allowedFile, allowedFile], 5),
    /upload 1 more/,
  );
  assert.match(
    getAMCPhotoSelectionError([{ type: "image/gif", size: 1024 }], 0),
    /Only JPEG, PNG, and WebP/,
  );
  assert.match(
    getAMCPhotoSelectionError(
      [{ type: "image/png", size: 5 * 1024 * 1024 + 1 }],
      0,
    ),
    /5 MB or smaller/,
  );
});

test("photo selection errors use the provided employee-language translator", () => {
  const translated = [];
  const t = (key, values) => {
    translated.push({ key, values });
    return key === "You can upload {count} more photo(s)."
      ? `Tamil message: ${values.count}`
      : `Tamil message: ${key}`;
  };

  assert.equal(getAMCPhotoSelectionError([], 0, t), "Tamil message: Choose at least one photo.");
  assert.equal(
    getAMCPhotoSelectionError(
      [
        { type: "image/jpeg", size: 1024 },
        { type: "image/jpeg", size: 1024 },
      ],
      5,
      t,
    ),
    "Tamil message: 1",
  );
  assert.equal(
    getAMCPhotoSelectionError([{ type: "image/gif", size: 1024 }], 0, t),
    "Tamil message: Only JPEG, PNG, and WebP images are allowed.",
  );
  assert.equal(
    getAMCPhotoSelectionError([{ type: "image/png", size: 5 * 1024 * 1024 + 1 }], 0, t),
    "Tamil message: Each photo must be 5 MB or smaller.",
  );
  assert.deepEqual(translated[1], {
    key: "You can upload {count} more photo(s).",
    values: { count: 1 },
  });
});

test("mutation errors prefer safe API messages and fall back clearly", () => {
  assert.equal(
    getAMCErrorMessage({
      response: { data: { message: "ATM location not configured." } },
    }),
    "ATM location not configured.",
  );
  assert.equal(getAMCErrorMessage(new Error("Network unavailable")), "Network unavailable");
  assert.equal(getAMCErrorMessage(null), "Please try again.");
});
