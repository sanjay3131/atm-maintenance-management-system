import test from "node:test";
import assert from "node:assert/strict";
import {
  AMC_CHECKLIST_ITEMS,
  AMC_STATUSES,
  REQUIRED_AMC_PHOTOS,
  canCompleteAMC,
  createAMCChecklist,
  formatAMCStatus,
  getAMCErrorMessage,
  getAMCPhotoSelectionError,
  getAMCTaskListState,
  isAMCChecklistEqual,
  validateAMCChecklist,
} from "../src/features/amc/amcExecution.utils.ts";

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
      checklistCompleted: true,
      photoCount: 6,
    }),
    true,
  );
  assert.equal(
    canCompleteAMC({
      status: "OVERDUE",
      checklistCompleted: true,
      photoCount: 6,
    }),
    true,
  );
  assert.equal(
    canCompleteAMC({
      status: "PENDING",
      checklistCompleted: true,
      photoCount: 6,
    }),
    false,
  );
  assert.equal(
    canCompleteAMC({
      status: "IN_PROGRESS",
      checklistCompleted: false,
      photoCount: 6,
    }),
    false,
  );
  assert.equal(
    canCompleteAMC({
      status: "IN_PROGRESS",
      checklistCompleted: true,
      photoCount: 5,
    }),
    false,
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
