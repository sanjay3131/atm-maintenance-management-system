import test from "node:test";
import assert from "node:assert/strict";
import Job from "../src/modules/jobs/jobs.model.js";
import { getAllJobs } from "../src/modules/jobs/jobs.controller.js";

const employeeUserId = "64b000000000000000000051";

test("admin job history filter uses the linked User ID and paginates matching jobs", async () => {
  const originalFind = Job.find;
  const originalCountDocuments = Job.countDocuments;
  const job = {
    _id: "64b000000000000000000052",
    jobId: "JOB-052",
    title: "Inspect ATM",
    status: "COMPLETED",
    atmId: { atmId: "ATM0052" },
    assignedAt: new Date("2026-10-01T08:00:00.000Z"),
    completedAt: new Date("2026-10-01T10:00:00.000Z"),
  };
  let findFilter;
  let countFilter;
  let pageNumber;
  let pageSize;
  Job.find = (filter) => {
    findFilter = filter;
    const query = {
      populate() {
        return this;
      },
      sort() {
        return this;
      },
      skip(value) {
        pageNumber = value;
        return this;
      },
      limit(value) {
        pageSize = value;
        return Promise.resolve([job]);
      },
    };
    return {
      ...query,
      populate: query.populate,
      sort: query.sort,
      skip: query.skip,
      limit: query.limit,
    };
  };
  Job.countDocuments = async (filter) => {
    countFilter = filter;
    return 11;
  };

  try {
    const result = await new Promise((resolve, reject) => {
      const response = {
        statusCode: 200,
        status(statusCode) {
          this.statusCode = statusCode;
          return this;
        },
        json(body) {
          resolve({ statusCode: this.statusCode, body });
        },
      };
      getAllJobs(
        {
          query: { employeeId: employeeUserId, page: "2", limit: "10" },
          user: { _id: "64b000000000000000000053", userType: "admin" },
        },
        response,
        reject,
      );
    });

    assert.equal(result.statusCode, 200);
    assert.deepEqual(findFilter, {
      isDeleted: false,
      assignedEmployeeId: employeeUserId,
    });
    assert.deepEqual(countFilter, findFilter);
    assert.equal(pageNumber, 10);
    assert.equal(pageSize, 10);
    assert.equal(result.body.data.pagination.page, 2);
    assert.equal(result.body.data.pagination.totalPages, 2);
    assert.equal(result.body.data.jobs[0].jobId, "JOB-052");
    assert.equal(result.body.data.jobs[0].atmId.atmId, "ATM0052");
  } finally {
    Job.find = originalFind;
    Job.countDocuments = originalCountDocuments;
  }
});
