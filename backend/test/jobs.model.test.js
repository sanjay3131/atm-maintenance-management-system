import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import Job from "../src/modules/jobs/jobs.model.js";

test("legacy Job hydration does not implicitly backfill photo revision on save", () => {
  const job = Job.hydrate({
    _id: new mongoose.Types.ObjectId(),
    jobId: "PHOTO-LEGACY-1",
    title: "Legacy photo job",
    atmId: new mongoose.Types.ObjectId(),
    status: "PENDING",
  });

  assert.equal(job.photoFinalizationRevision, undefined);
  assert.equal(job.isModified("photoFinalizationRevision"), false);

  const changes = job.getChanges();
  assert.equal(
    Object.hasOwn(changes.$set ?? {}, "photoFinalizationRevision"),
    false,
  );
});
