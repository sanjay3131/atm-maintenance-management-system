import test from "node:test";
import assert from "node:assert/strict";
import Job from "../src/modules/jobs/jobs.model.js";
import { updateJob } from "../src/modules/jobs/jobs.controller.js";
import {
  AC_SUB_TYPES,
  JOB_WORK_TYPES,
  LEGACY_JOB_WORK_TYPES,
} from "../src/modules/jobs/jobWorkTypes.js";
import {
  createJobSchema,
  updateJobSchema,
} from "../src/modules/jobs/jobs.validation.js";

const validCreateJob = {
  title: "Work order",
  atmId: "64b000000000000000000001",
};

const executeUpdate = async (initialWorkType, body) => {
  const job = {
    _id: "64b000000000000000000002",
    status: "PENDING",
    workType: initialWorkType,
    acSubType: initialWorkType === "ac" ? "amc" : undefined,
    isDeleted: false,
    saveCount: 0,
    async save() {
      this.saveCount += 1;
      return this;
    },
  };
  const originalFindById = Job.findById;
  const query = {
    populate() {
      return this;
    },
    then(resolve, reject) {
      return Promise.resolve(job).then(resolve, reject);
    },
  };
  Job.findById = () => query;

  try {
    const result = await new Promise((resolve) => {
      updateJob(
        {
          params: { id: job._id },
          body,
          user: {
            _id: "64b000000000000000000003",
            userType: "admin",
          },
        },
        {
          status() {
            return this;
          },
          json(response) {
            resolve({ response });
          },
        },
        (error) => resolve({ error }),
      );
    });
    return { ...result, job };
  } finally {
    Job.findById = originalFindById;
  }
};

test("create validation allows all approved work types and rejects legacy selections", () => {
  for (const workType of JOB_WORK_TYPES) {
    const data = {
      ...validCreateJob,
      workType,
      ...(workType === "ac" ? { acSubType: "amc" } : {}),
    };
    assert.equal(createJobSchema.safeParse(data).success, true, workType);
  }

  for (const workType of LEGACY_JOB_WORK_TYPES) {
    assert.equal(
      createJobSchema.safeParse({ ...validCreateJob, workType }).success,
      false,
      workType,
    );
  }
});

test("backend requires a supported AC sub-type only for AC work", () => {
  assert.equal(
    createJobSchema.safeParse({ ...validCreateJob, workType: "ac" }).success,
    false,
  );
  for (const acSubType of AC_SUB_TYPES) {
    assert.equal(
      createJobSchema.safeParse({
        ...validCreateJob,
        workType: "ac",
        acSubType,
      }).success,
      true,
      acSubType,
    );
  }
  assert.equal(
    createJobSchema.safeParse({
      ...validCreateJob,
      workType: "ac",
      acSubType: "invalid",
    }).success,
    false,
  );
  assert.equal(
    createJobSchema.safeParse({
      ...validCreateJob,
      workType: "repair",
      acSubType: "amc",
    }).success,
    false,
  );
  assert.equal(
    createJobSchema.safeParse({
      ...validCreateJob,
      workType: "installation",
    }).success,
    true,
  );
});

test("Mongoose persists AC subtype and keeps legacy work types valid", async () => {
  const required = {
    jobId: "JOB-TEST-001",
    title: "Work order",
    atmId: "64b000000000000000000001",
    createdBy: "64b000000000000000000003",
  };
  const acJob = new Job({
    ...required,
    workType: "ac",
    acSubType: "town_call",
  });
  await acJob.validate();
  assert.equal(acJob.acSubType, "town_call");

  for (const workType of LEGACY_JOB_WORK_TYPES) {
    await new Job({ ...required, workType }).validate();
  }

  await assert.rejects(
    new Job({ ...required, workType: "ac", acSubType: "invalid" }).validate(),
  );
  await assert.rejects(
    new Job({ ...required, workType: "repair", acSubType: "amc" }).validate(),
  );
  await assert.rejects(
    new Job({ ...required, workType: "ac" }).validate(),
  );
});

test("job editing persists the AC subtype and clears it when switching away", async () => {
  const acUpdate = updateJobSchema.safeParse({
    workType: "ac",
    acSubType: "installation",
  });
  assert.equal(acUpdate.success, true);

  const { job: editedJob } = await executeUpdate("repair", acUpdate.data);
  assert.equal(editedJob.workType, "ac");
  assert.equal(editedJob.acSubType, "installation");
  assert.equal(editedJob.saveCount, 1);

  const { job: switchedJob } = await executeUpdate("ac", {
    workType: "service",
  });
  assert.equal(switchedJob.workType, "service");
  assert.equal(switchedJob.acSubType, undefined);
});

test("legacy work types remain editable in place but cannot be newly assigned", async () => {
  assert.equal(updateJobSchema.safeParse({ workType: "inspection" }).success, true);
  const unchanged = await executeUpdate("inspection", {
    title: "Updated historic job",
    workType: "inspection",
  });
  assert.equal(unchanged.error, undefined);
  assert.equal(unchanged.job.workType, "inspection");

  const newlyAssigned = await executeUpdate("repair", {
    workType: "inspection",
  });
  assert.equal(newlyAssigned.error?.statusCode, 400);
  assert.equal(newlyAssigned.job.saveCount, 0);
});
