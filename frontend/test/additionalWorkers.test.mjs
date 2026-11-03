import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  hasAuthoritativeAdditionalWorkersResponse,
  isValidAdditionalWorkersVersion,
  runWithAdditionalWorkerMutationLock,
} from "../src/features/jobs/utils/additionalWorkers.utils.ts";
import { formatHistoryDetailLines } from "../src/features/jobs/utils/formatJobHistoryDetails.ts";

const readSource = (path) =>
  readFile(new URL(path, import.meta.url), "utf8");

const [service, hooks, component, page, types, i18n] = await Promise.all([
  readSource("../src/features/jobs/services/jobs.service.ts"),
  readSource("../src/features/jobs/hooks/useAdditionalWorkers.ts"),
  readSource("../src/features/jobs/components/EmployeeAdditionalWorkersSection.tsx"),
  readSource("../src/pages/employee/EmployeeJobDetailsView.tsx"),
  readSource("../src/features/jobs/types/job.types.ts"),
  readSource("../src/features/employee-portal/i18n.tsx"),
]);

test("Additional Worker services use the backend methods, paths, and payloads", () => {
  assert.ok(service.includes("`/jobs/${jobId}/additional-workers`"));
  assert.ok(
    service.includes("`/jobs/${jobId}/additional-workers/${workerId}`"),
  );
  assert.ok(service.includes("api.delete<{"));
  assert.ok(service.includes("data: { expectedVersion }"));
  assert.match(service, /expectedVersion:\s*number/);
});

test("job version validation rejects missing, malformed, and unsafe revisions", () => {
  for (const version of [undefined, null, -1, 1.5, Number.NaN, Number.MAX_SAFE_INTEGER + 1]) {
    assert.equal(isValidAdditionalWorkersVersion(version), false);
  }
  assert.equal(isValidAdditionalWorkersVersion(0), true);
  assert.equal(isValidAdditionalWorkersVersion(12), true);
  assert.match(component, /const expectedVersion = job\.__v/);
  assert.doesNotMatch(component, /__v\s*\?\?\s*0/);
});

test("mutation responses update cached workers only with authoritative version data", () => {
  assert.equal(
    hasAuthoritativeAdditionalWorkersResponse({
      additionalWorkers: [],
      version: 3,
    }),
    true,
  );
  assert.equal(
    hasAuthoritativeAdditionalWorkersResponse({
      additionalWorkers: [],
      version: undefined,
    }),
    false,
  );
  assert.match(hooks, /additionalWorkers:\s*response\.additionalWorkers/);
  assert.match(hooks, /__v:\s*response\.version/);
  assert.match(hooks, /queryKey:\s*\["job",\s*jobId\]/);
  assert.match(hooks, /queryKey:\s*\["job-history",\s*jobId\]/);
  assert.match(hooks, /retry:\s*false/);
});

test("mutation lock rejects duplicate submissions and releases after either outcome", async () => {
  const lock = { current: false };
  let release;
  let calls = 0;
  const first = runWithAdditionalWorkerMutationLock(lock, async () => {
    calls += 1;
    await new Promise((resolve) => {
      release = resolve;
    });
  });
  const second = await runWithAdditionalWorkerMutationLock(lock, async () => {
    calls += 1;
  });

  assert.equal(second, false);
  assert.equal(calls, 1);
  release();
  assert.equal(await first, true);
  assert.equal(lock.current, false);

  await assert.rejects(
    runWithAdditionalWorkerMutationLock(lock, async () => {
      throw new Error("failed");
    }),
    /failed/,
  );
  assert.equal(lock.current, false);
  assert.match(component, /runWithAdditionalWorkerMutationLock\(mutationLock/);
});

test("employee controls require assignment, IN_PROGRESS, and a valid version", () => {
  assert.match(component, /job\.status === "IN_PROGRESS"/);
  assert.match(component, /assignedEmployeeId === user\._id/);
  assert.match(component, /!hasValidVersion/);
  assert.match(page, /<EmployeeAdditionalWorkersSection/);
  assert.match(types, /additionalWorkers\?: AdditionalWorker\[\]/);
  assert.match(types, /__v\?: number/);
});

test("the employee form enforces worker type, notes, quantity, and entry limits", () => {
  assert.match(component, /maxLength=\{80\}/);
  assert.match(component, /maxLength=\{300\}/);
  assert.match(component, /Number\.isSafeInteger\(quantity\) \|\| quantity <= 0/);
  assert.match(component, /workers\.length >= 20/);
});

test("HTTP 409 keeps the form draft and requires explicit refresh before retry", () => {
  assert.match(component, /status === 409/);
  assert.match(component, /setRequiresRefresh\(true\)/);
  assert.match(component, /setDraft\(EMPTY_DRAFT\)/);
  assert.match(component, /onClick=\{\(\) => void refreshLatest\(\)\}/);
  assert.match(component, /requiresRefresh \|\|/);
  assert.doesNotMatch(component, /onSuccess[\s\S]{0,100}refetch/);
});

test("worker history formats before and after values without raw object dumps", () => {
  const translated = (key, values = {}) =>
    key.replace(/\{(\w+)\}/g, (_match, field) => values[field] ?? "");
  const labels = (label) => label;

  assert.deepEqual(
    formatHistoryDetailLines(
      "additional_worker_updated",
      {
        before: { workerType: "Electrician", quantity: 1, notes: "Old note" },
        after: { workerType: "Technician", quantity: 2, notes: "New note" },
      },
      translated,
      labels,
    ),
    [
      "Before: Worker type: Electrician, Quantity: 1, Notes: Old note",
      "After: Worker type: Technician, Quantity: 2, Notes: New note",
    ],
  );
  assert.deepEqual(
    formatHistoryDetailLines(
      "additional_worker_added",
      { after: { workerType: "Technician", quantity: 2 } },
      translated,
      labels,
    ),
    ["Added: Worker type: Technician, Quantity: 2"],
  );
  assert.deepEqual(
    formatHistoryDetailLines(
      "additional_worker_removed",
      { before: { workerType: "Helper", quantity: 1 } },
      translated,
      labels,
    ),
    ["Removed: Worker type: Helper, Quantity: 1"],
  );
});

test("all Additional Workers visible text has English and Tamil dictionary entries", () => {
  const keys = [
    "Additional Workers",
    "External workers who accompanied you on this Job.",
    "No additional workers have been recorded.",
    "Add worker",
    "Edit worker",
    "Remove worker",
    "Edit {workerType}",
    "Remove {workerType}",
    "Worker type / name",
    "Notes (optional)",
    "Enter the worker type or name.",
    "Worker type must be 80 characters or fewer.",
    "Quantity must be a positive whole number.",
    "Notes must be 300 characters or fewer.",
    "Saving...",
    "Update worker",
    "Add worker entry",
    "Maximum of 20 worker entries reached.",
    "Additional workers can only be changed on an assigned Job in progress.",
    "Job version unavailable. Refresh before managing additional workers.",
    "Refresh Job",
    "Refreshing...",
    "Could not refresh the latest Job data. Your draft is still here.",
    "This Job changed elsewhere. Refresh the latest data before saving again. Your draft has been kept.",
    "This Job is no longer assigned to you or cannot be changed in its current status. Refresh the Job.",
    "Job or worker entry no longer exists. Refresh the Job.",
    "Check worker type, quantity, and notes, then try again.",
    "Could not save worker details. Check your connection and try again.",
    "Worker added.",
    "Worker updated.",
    "Worker removed.",
    "Remove additional worker?",
    "Remove {workerType} from this Job? This cannot be undone.",
    "Keep worker",
    "Worker type",
    "Quantity",
    "Notes",
    "Cancel",
    "Added: {details}",
    "Before: {details}",
    "After: {details}",
    "Removed: {details}",
    "Additional worker details recorded.",
    "Additional Worker Added",
    "Additional Worker Updated",
    "Additional Worker Removed",
  ];

  for (const key of keys) {
    if (key === "Quantity" || key === "Cancel") {
      assert.equal(
        [...i18n.matchAll(new RegExp(`\\b${key}\\s*:`, "g"))].length,
        2,
      );
      continue;
    }
    const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    assert.equal([...i18n.matchAll(new RegExp(`"${escaped}":`, "g"))].length, 2, key);
  }
});
