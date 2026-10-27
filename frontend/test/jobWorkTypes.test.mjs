import assert from "node:assert/strict";
import test from "node:test";
import {
  AC_SUB_TYPES,
  JOB_WORK_TYPES,
} from "../src/features/jobs/types/job.types.ts";
import {
  createJobFormSchema,
  updateJobFormSchema,
} from "../src/features/jobs/types/create-job.schema.ts";
import {
  formatAcSubType,
  formatJobWorkType,
  getAcSubTypeAfterWorkTypeChange,
  isAcWorkType,
} from "../src/features/jobs/utils/jobWorkType.utils.ts";

const validForm = {
  title: "Work order",
  atmId: "64b000000000000000000001",
};

test("all approved work types are selectable with the exact client labels", () => {
  assert.deepEqual(JOB_WORK_TYPES, [
    "carpentry",
    "electrical",
    "plumbing",
    "shifting",
    "service",
    "installation",
    "maintenance",
    "repair",
    "free_of_cost",
    "renovation",
    "dismantling",
    "event",
    "ac",
  ]);
  for (const workType of JOB_WORK_TYPES) {
    const acSubType = workType === "ac" ? "amc" : undefined;
    assert.equal(
      createJobFormSchema.safeParse({
        ...validForm,
        workType,
        ...(acSubType ? { acSubType } : {}),
      }).success,
      true,
      workType,
    );
  }
  assert.equal(formatJobWorkType("free_of_cost"), "For (Free of Cost)");
  assert.equal(formatJobWorkType("ac"), "AC");
});

test("AC options are exact and mandatory only when AC is the main work type", () => {
  assert.deepEqual(AC_SUB_TYPES, ["amc", "town_call", "installation"]);
  assert.deepEqual(
    AC_SUB_TYPES.map(formatAcSubType),
    ["AMC", "Town Call", "Installation"],
  );
  assert.equal(isAcWorkType("ac"), true);
  assert.equal(isAcWorkType("installation"), false);
  assert.equal(
    createJobFormSchema.safeParse({ ...validForm, workType: "ac" }).success,
    false,
  );
  assert.equal(
    updateJobFormSchema.safeParse({
      title: "Work order",
      workType: "ac",
      priority: "medium",
    }).success,
    false,
  );
  assert.equal(
    createJobFormSchema.safeParse({
      ...validForm,
      workType: "installation",
    }).success,
    true,
  );
  assert.equal(
    createJobFormSchema.safeParse({
      ...validForm,
      workType: "ac",
      acSubType: "installation",
    }).success,
    true,
  );
});

test("invalid AC sub-types and sub-types on unrelated work are rejected", () => {
  assert.equal(
    createJobFormSchema.safeParse({
      ...validForm,
      workType: "ac",
      acSubType: "emergency",
    }).success,
    false,
  );
  assert.equal(
    createJobFormSchema.safeParse({
      ...validForm,
      workType: "repair",
      acSubType: "amc",
    }).success,
    false,
  );
});

test("changing away from AC clears its sub-type; historical types remain readable", () => {
  assert.equal(getAcSubTypeAfterWorkTypeChange("ac", "town_call"), "town_call");
  assert.equal(getAcSubTypeAfterWorkTypeChange("service", "town_call"), undefined);
  assert.equal(formatJobWorkType("inspection"), "Inspection");
  assert.equal(formatJobWorkType("emergency"), "Emergency");
  assert.equal(
    updateJobFormSchema.safeParse({
      title: "Historical job",
      workType: "inspection",
      priority: "medium",
    }).success,
    true,
  );
});
