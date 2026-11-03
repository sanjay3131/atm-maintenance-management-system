import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import {
  buildAdminAdditionalWorkerPayload,
  canManageAdditionalWorkers,
  executeAdminAdditionalWorkerMutation,
} from "../src/features/jobs/utils/adminAdditionalWorkers.utils.ts";
import { formatHistoryDetailLines } from "../src/features/jobs/utils/formatJobHistoryDetails.ts";

const readSource = (path) =>
  readFile(new URL(path, import.meta.url), "utf8");

const [component, page, hooks, dictionaries, employeeComponent] =
  await Promise.all([
    readSource("../src/features/jobs/components/AdminAdditionalWorkersSection.tsx"),
    readSource("../src/pages/admin/JobDetailsPage.tsx"),
    readSource("../src/features/jobs/hooks/useAdditionalWorkers.ts"),
    readSource("../src/features/employee-portal/i18n.tsx"),
    readSource("../src/features/jobs/components/EmployeeAdditionalWorkersSection.tsx"),
  ]);

function getTranslation(language, key) {
  const escaped = key.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const section =
    language === "en"
      ? dictionaries.slice(
          dictionaries.indexOf("export const employeeEnglish"),
          dictionaries.indexOf("const employeeTamil"),
        )
      : dictionaries.slice(
          dictionaries.indexOf("const employeeTamil"),
          dictionaries.indexOf("export type EmployeeLanguage"),
        );
  const match = section.match(new RegExp(`"${escaped}":\\s*"([^"]*)"`));
  return match?.[1] ?? key;
}

function translator(language) {
  return (key, values = {}) =>
    getTranslation(language, key).replace(
      /\{(\w+)\}/g,
      (match, name) => values[name] ?? match,
    );
}

test("admin and superAdmin management is enabled outside read-only mode", () => {
  for (const role of ["admin", "superAdmin"]) {
    assert.equal(canManageAdditionalWorkers(role, false), true);
    assert.equal(canManageAdditionalWorkers(role, true), false);
  }
  for (const role of ["employee", "customer", "supervisor", undefined]) {
    assert.equal(canManageAdditionalWorkers(role, false), false);
  }
});

test("add and edit payload validation trims fields and respects backend limits", () => {
  assert.deepEqual(
    buildAdminAdditionalWorkerPayload(
      { workerType: "  Electrician  ", quantity: "2", notes: "  helper  " },
      7,
      19,
      true,
    ),
    {
      success: true,
      payload: {
        workerType: "Electrician",
        quantity: 2,
        notes: "helper",
        expectedVersion: 7,
      },
    },
  );
  assert.deepEqual(
    buildAdminAdditionalWorkerPayload(
      { workerType: "Painter", quantity: "1", notes: "" },
      4,
      20,
      false,
    ),
    {
      success: true,
      payload: {
        workerType: "Painter",
        quantity: 1,
        expectedVersion: 4,
      },
    },
  );
  assert.equal(
    buildAdminAdditionalWorkerPayload(
      { workerType: " ", quantity: "1", notes: "" },
      0,
      0,
      true,
    ).success,
    false,
  );
  assert.equal(
    buildAdminAdditionalWorkerPayload(
      { workerType: "x".repeat(81), quantity: "1", notes: "" },
      0,
      0,
      true,
    ).success,
    false,
  );
  assert.equal(
    buildAdminAdditionalWorkerPayload(
      { workerType: "Painter", quantity: "1.5", notes: "" },
      0,
      0,
      true,
    ).success,
    false,
  );
  assert.equal(
    buildAdminAdditionalWorkerPayload(
      { workerType: "Painter", quantity: "1", notes: "x".repeat(301) },
      0,
      0,
      true,
    ).success,
    false,
  );
  assert.deepEqual(
    buildAdminAdditionalWorkerPayload(
      { workerType: "Painter", quantity: "1", notes: "" },
      undefined,
      0,
      true,
    ),
    {
      success: false,
      error:
        "Job version unavailable. Refresh before managing additional workers.",
    },
  );
});

test("worker mutation dispatcher invokes create, update, and delete with the selected version", async () => {
  const calls = [];
  const mutations = {
    create: async (variables) => calls.push(["create", variables]),
    update: async (variables) => calls.push(["update", variables]),
    delete: async (variables) => calls.push(["delete", variables]),
  };
  const payload = {
    workerType: "Technician",
    quantity: 3,
    notes: "Night shift",
    expectedVersion: 9,
  };

  await executeAdminAdditionalWorkerMutation({
    action: "create",
    jobId: "job-1",
    payload,
    expectedVersion: 9,
    mutations,
  });
  await executeAdminAdditionalWorkerMutation({
    action: "update",
    jobId: "job-1",
    workerId: "worker-1",
    payload,
    expectedVersion: 9,
    mutations,
  });
  await executeAdminAdditionalWorkerMutation({
    action: "delete",
    jobId: "job-1",
    workerId: "worker-1",
    expectedVersion: 9,
    mutations,
  });

  assert.deepEqual(calls, [
    ["create", { jobId: "job-1", ...payload }],
    ["update", { jobId: "job-1", workerId: "worker-1", ...payload }],
    [
      "delete",
      { jobId: "job-1", workerId: "worker-1", expectedVersion: 9 },
    ],
  ]);
});

test("admin section wires pending guards, version checks, conflict refresh, and delete confirmation", () => {
  assert.match(component, /readOnly:\s*boolean/);
  assert.match(component, /canManageAdditionalWorkers\(user\?\.userType,\s*readOnly\)/);
  assert.match(component, /mutationPending \|\|/);
  assert.match(component, /mutationLock\.current/);
  assert.match(component, /status === 409/);
  assert.match(component, /setRequiresRefresh\(true\)/);
  assert.match(component, /onClick=\{\(\) => void refreshLatest\(\)\}/);
  assert.match(component, /<Dialog/);
  assert.match(component, /onClick=\{confirmRemove\}/);
  assert.match(component, /expectedVersion = job\.__v/);
  assert.match(component, /!hasValidVersion/);
  assert.match(hooks, /retry:\s*false/);
  assert.match(hooks, /queryKey:\s*\["job",\s*jobId\]/);
  assert.match(hooks, /queryKey:\s*\["job-history",\s*jobId\]/);
  assert.match(page, /readOnly && \(\s*<AdminAdditionalWorkersSection[\s\S]+?readOnly/s);
  assert.match(page, /!readOnly && \(\s*<>\s*<AdminAdditionalWorkersSection/s);
  assert.match(page, /onRefreshLatest=\{refreshLatestJob\}/);
});

test("admin history action and snapshots have natural English and Tamil output", () => {
  const details = {
    before: { workerType: "Painter", quantity: 1, notes: "Old" },
    after: { workerType: "Technician", quantity: 2, notes: "New" },
  };
  for (const language of ["en", "ta"]) {
    const t = translator(language);
    const lines = formatHistoryDetailLines(
      "additional_worker_updated",
      details,
      t,
      (label) => t(label),
    );
    assert.equal(lines.length, 2);
    assert.ok(lines[0].includes(language === "en" ? "Before" : "முன்பு"));
    assert.ok(lines[1].includes(language === "en" ? "After" : "பிறகு"));
    assert.equal(
      t("Additional Worker Updated"),
      language === "en"
        ? "Additional Worker Updated"
        : "கூடுதல் பணியாளர் விவரம் புதுப்பிக்கப்பட்டது",
    );
  }
});

test("admin-facing labels are present in both dictionaries and employee restrictions remain intact", () => {
  for (const key of [
    "Worker entries are separate from materials and job costs.",
    "Additional Workers",
    "Remove additional worker?",
  ]) {
    assert.ok(getTranslation("en", key), key);
    assert.ok(getTranslation("ta", key), key);
  }
  assert.match(employeeComponent, /job\.status === "IN_PROGRESS"/);
  assert.match(employeeComponent, /assignedEmployeeId === user\._id/);
});
