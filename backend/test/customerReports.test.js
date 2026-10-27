import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";
import ExcelJS from "exceljs";

process.env.JWT_ACCESS_SECRET ??= "customer-report-route-test-secret";

const [
  { default: customerRoutes },
  { default: errorMiddleware },
  { default: User },
  { default: Customer },
  { default: Job },
  { default: AMC },
] = await Promise.all([
  import("../src/modules/customers/customer.routes.js"),
  import("../src/middlewares/error.middleware.js"),
  import("../src/modules/users/user.model.js"),
  import("../src/modules/customers/customer.model.js"),
  import("../src/modules/jobs/jobs.model.js"),
  import("../src/modules/amc/amc.model.js"),
]);

const ids = {
  customerA: "64b100000000000000000101",
  customerB: "64b100000000000000000102",
  userA: "64b100000000000000000111",
  userB: "64b100000000000000000112",
  admin: "64b100000000000000000113",
  supervisor: "64b100000000000000000114",
  employee: "64b100000000000000000115",
};

const users = new Map(
  [
    [ids.userA, "customer"],
    [ids.userB, "customer"],
    [ids.admin, "admin"],
    [ids.supervisor, "supervisor"],
    [ids.employee, "employee"],
  ].map(([id, userType]) => [
    id,
    { _id: id, userType, status: "active" },
  ]),
);

const customers = [
  { _id: ids.customerA, userId: ids.userA, isActive: true, isDeleted: false },
  { _id: ids.customerB, userId: ids.userB, isActive: true, isDeleted: false },
];

const jobs = [
  {
    _id: "64b100000000000000000201",
    jobId: "JOB-A-CLOSED",
    jobNumber: "R-1001",
    customerId: ids.customerA,
    title: '=HYPERLINK("https://bad.example","click")',
    workType: "ac",
    acSubType: "town_call",
    priority: "high",
    status: "CLOSED",
    createdAt: new Date("2026-01-31T12:00:00.000Z"),
    completedAt: new Date("2026-01-31T13:00:00.000Z"),
    closedAt: new Date("2026-01-31T14:00:00.000Z"),
    employeeRemarks: "internal only",
    ipAddress: "192.0.2.4",
  },
  {
    _id: "64b100000000000000000202",
    jobId: "JOB-A-APPROVED",
    customerId: ids.customerA,
    title: "Approved repair",
    workType: "repair",
    priority: "medium",
    status: "APPROVED",
    createdAt: new Date("2026-01-15T12:00:00.000Z"),
  },
  {
    _id: "64b100000000000000000203",
    jobId: "JOB-B-CLOSED",
    customerId: ids.customerB,
    title: "Foreign customer work",
    workType: "inspection",
    priority: "low",
    status: "CLOSED",
    createdAt: new Date("2026-01-20T12:00:00.000Z"),
  },
  {
    _id: "64b100000000000000000204",
    jobId: "JOB-AMBIGUOUS",
    title: "No historical customer snapshot",
    status: "CLOSED",
    createdAt: new Date("2026-01-20T12:00:00.000Z"),
  },
  {
    _id: "64b100000000000000000205",
    jobId: "JOB-A-OLD",
    customerId: ids.customerA,
    title: "Outside selected period",
    status: "CLOSED",
    createdAt: new Date("2025-12-31T23:59:59.000Z"),
  },
  {
    _id: "64b100000000000000000206",
    jobId: "JOB-A-PENDING",
    customerId: ids.customerA,
    title: "Not customer visible",
    status: "PENDING",
    createdAt: new Date("2026-01-20T12:00:00.000Z"),
  },
  {
    _id: "64b100000000000000000207",
    jobId: "JOB-A-FEB",
    customerId: ids.customerA,
    title: "After selected period",
    status: "CLOSED",
    createdAt: new Date("2026-02-01T00:00:00.000Z"),
  },
].map((record) => ({ isDeleted: false, ...record }));

const amcs = [
  {
    _id: "64b100000000000000000301",
    amcId: "AMC-A-COMPLETE",
    customerId: ids.customerA,
    status: "COMPLETED",
    month: 1,
    year: 2026,
    visitDate: new Date("2026-01-31T10:00:00.000Z"),
    completedAt: new Date("2026-01-31T11:00:00.000Z"),
    checklistCompleted: true,
    createdAt: new Date("2026-01-31T11:00:00.000Z"),
    employeeRemarks: "internal remark",
    gpsDistance: 4,
    photos: ["private-photo-id"],
  },
  {
    _id: "64b100000000000000000302",
    amcId: "AMC-B-COMPLETE",
    customerId: ids.customerB,
    status: "COMPLETED",
    month: 1,
    year: 2026,
    checklistCompleted: true,
    createdAt: new Date("2026-01-31T11:00:00.000Z"),
  },
  {
    _id: "64b100000000000000000303",
    amcId: "AMC-A-INCOMPLETE",
    customerId: ids.customerA,
    status: "IN_PROGRESS",
    month: 1,
    year: 2026,
    createdAt: new Date("2026-01-31T11:00:00.000Z"),
  },
  {
    _id: "64b100000000000000000304",
    amcId: "AMC-AMBIGUOUS",
    status: "COMPLETED",
    month: 1,
    year: 2026,
    createdAt: new Date("2026-01-31T11:00:00.000Z"),
  },
  {
    _id: "64b100000000000000000305",
    amcId: "AMC-A-OLD",
    customerId: ids.customerA,
    status: "COMPLETED",
    month: 12,
    year: 2025,
    createdAt: new Date("2025-12-31T23:59:59.000Z"),
  },
].map((record) => ({ isDeleted: false, ...record }));

const originals = [];
const override = (target, key, value) => {
  originals.push([target, key, target[key]]);
  target[key] = value;
};

const toComparable = (value) =>
  value instanceof Date ? value.getTime() : String(value);

const matchesValue = (actual, expected) => {
  if (expected && typeof expected === "object" && !(expected instanceof Date)) {
    if (expected.$in) {
      return expected.$in.some((item) => toComparable(item) === toComparable(actual));
    }
    if (expected.$gte || expected.$lt) {
      const time = new Date(actual).getTime();
      return (
        (!expected.$gte || time >= new Date(expected.$gte).getTime()) &&
        (!expected.$lt || time < new Date(expected.$lt).getTime())
      );
    }
  }
  return toComparable(actual) === toComparable(expected);
};

const matches = (record, filter) =>
  Object.entries(filter).every(([key, value]) =>
    matchesValue(record[key], value),
  );

const modelQuery = (records) => ({
  select() {
    return this;
  },
  sort() {
    return this;
  },
  lean() {
    return Promise.resolve(records);
  },
  then(resolve, reject) {
    return Promise.resolve(records).then(resolve, reject);
  },
});

const makeApp = () => {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/v1/customers", customerRoutes);
  app.use(errorMiddleware);
  return app;
};

const tokenFor = (id) =>
  jwt.sign(
    { id, userType: users.get(id).userType },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: "5m" },
  );

const headersFor = (id) => ({ Authorization: `Bearer ${tokenFor(id)}` });

const withServer = async (callback) => {
  const server = makeApp().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  try {
    await callback(`http://127.0.0.1:${server.address().port}/api/v1`);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
};

test("customer report summary and Excel exports enforce historical ownership and safe output", async (t) => {
  override(User, "findById", (id) => ({
    select: async () => users.get(String(id)) ?? null,
    then(resolve, reject) {
      return Promise.resolve(users.get(String(id)) ?? null).then(resolve, reject);
    },
  }));
  override(Customer, "findOne", async (filter) =>
    customers.find(
      (customer) =>
        String(customer.userId) === String(filter.userId) &&
        customer.isActive === filter.isActive &&
        customer.isDeleted === filter.isDeleted,
    ) ?? null,
  );
  override(Job, "aggregate", async (pipeline) => {
    const filter = pipeline.find((stage) => stage.$match)?.$match ?? {};
    const counts = new Map();
    for (const job of jobs.filter((record) => matches(record, filter))) {
      counts.set(job.status, (counts.get(job.status) ?? 0) + 1);
    }
    return [...counts].map(([_id, count]) => ({ _id, count }));
  });
  override(Job, "find", (filter) =>
    modelQuery(jobs.filter((record) => matches(record, filter))),
  );
  override(AMC, "countDocuments", async (filter) =>
    amcs.filter((record) => matches(record, filter)).length,
  );
  override(AMC, "find", (filter) =>
    modelQuery(amcs.filter((record) => matches(record, filter))),
  );

  try {
    await withServer(async (baseUrl) => {
      const request = (path, userId, options = {}) =>
        fetch(`${baseUrl}${path}`, {
          ...options,
          headers: {
            ...headersFor(userId),
            ...(options.headers ?? {}),
          },
        });

      await t.test("summary applies owner, visible statuses, date bounds and status filter", async () => {
        const response = await request(
          "/customers/portal/reports/summary?customerId=64b100000000000000000102&fromDate=2026-01-01&toDate=2026-01-31&jobStatus=CLOSED",
          ids.userA,
        );
        assert.equal(response.status, 200, await response.clone().text());
        const { data } = await response.json();
        assert.equal(data.totalJobs, 1);
        assert.equal(data.jobsByStatus.CLOSED, 1);
        assert.equal(data.jobsByStatus.APPROVED, 0);
        assert.equal(data.completedAMCs, 1);
        assert.equal(data.completionRate, 100);
      });

      await t.test("job workbook includes only owned eligible records in selected date/status range", async () => {
        const response = await request(
          "/customers/portal/reports/jobs.xlsx?customerId=64b100000000000000000102&fromDate=2026-01-01&toDate=2026-01-31&jobStatus=CLOSED",
          ids.userA,
        );
        assert.equal(response.status, 200);
        assert.match(
          response.headers.get("content-type"),
          /^application\/vnd\.openxmlformats-officedocument\.spreadsheetml\.sheet/,
        );
        assert.equal(
          response.headers.get("content-disposition"),
          'attachment; filename="customer-job-history-2026-01-01-to-2026-01-31.xlsx"',
        );
        assert.equal(response.headers.get("cache-control"), "private, no-store");

        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
        const worksheet = workbook.getWorksheet("Job History");
        assert.ok(worksheet);
        assert.equal(worksheet.getCell("A4").value, "Job reference");
        assert.equal(worksheet.rowCount, 5);
        assert.equal(worksheet.getCell("A5").value, "R-1001");
        assert.equal(
          worksheet.getCell("B5").value,
          `'=HYPERLINK("https://bad.example","click")`,
        );
        assert.equal(worksheet.getCell("B5").formula, undefined);
        assert.equal(worksheet.getCell("C5").value, "AC");
        assert.equal(worksheet.getCell("D5").value, "Town Call");
        assert.equal(
          JSON.stringify(worksheet.getSheetValues()).includes("internal only"),
          false,
        );
        assert.equal(
          JSON.stringify(worksheet.getSheetValues()).includes("192.0.2.4"),
          false,
        );
        assert.equal(
          JSON.stringify(worksheet.getSheetValues()).includes("JOB-B-CLOSED"),
          false,
        );
      });

      await t.test("AMC workbook contains only completed historically owned AMC rows", async () => {
        const response = await request(
          "/customers/portal/reports/amcs.xlsx?customerId=64b100000000000000000102&fromDate=2026-01-01&toDate=2026-01-31",
          ids.userA,
        );
        assert.equal(response.status, 200);
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
        const worksheet = workbook.getWorksheet("Completed AMC");
        assert.ok(worksheet);
        assert.equal(worksheet.rowCount, 5);
        assert.equal(worksheet.getCell("A5").value, "AMC-A-COMPLETE");
        assert.equal(
          JSON.stringify(worksheet.getSheetValues()).includes("AMC-B-COMPLETE"),
          false,
        );
        assert.equal(
          JSON.stringify(worksheet.getSheetValues()).includes("internal remark"),
          false,
        );
        assert.equal(
          JSON.stringify(worksheet.getSheetValues()).includes("private-photo-id"),
          false,
        );
      });

      await t.test("empty exports are valid workbooks with headings and no data rows", async () => {
        const response = await request(
          "/customers/portal/reports/jobs.xlsx?fromDate=2020-01-01&toDate=2020-01-02",
          ids.userA,
        );
        assert.equal(response.status, 200);
        const workbook = new ExcelJS.Workbook();
        await workbook.xlsx.load(Buffer.from(await response.arrayBuffer()));
        const worksheet = workbook.getWorksheet("Job History");
        assert.equal(worksheet.rowCount, 4);
        assert.equal(worksheet.getCell("A4").value, "Job reference");
      });

      await t.test("invalid date and status filters return 400", async () => {
        assert.equal(
          (
            await request(
              "/customers/portal/reports/summary?fromDate=2026-02-01",
              ids.userA,
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await request(
              "/customers/portal/reports/jobs.xlsx?fromDate=2026-02-30&toDate=2026-03-01",
              ids.userA,
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await request(
              "/customers/portal/reports/jobs.xlsx?jobStatus=PENDING",
              ids.userA,
            )
          ).status,
          400,
        );
        assert.equal(
          (
            await request(
              "/customers/portal/reports/summary?amcStatus=OVERDUE",
              ids.userA,
            )
          ).status,
          400,
        );
      });

      await t.test("internal report failures do not expose server details", async () => {
        override(Job, "aggregate", async () => {
          throw new Error("private filesystem path /srv/app/backend/private");
        });
        const response = await request(
          "/customers/portal/reports/summary",
          ids.userA,
        );
        assert.equal(response.status, 500);
        const body = await response.json();
        assert.equal(body.message, "Unable to process customer report");
        assert.deepEqual(body.errors, []);
        assert.equal(body.stack, undefined);
      });

      await t.test("non-customer roles cannot access report or export endpoints", async () => {
        for (const userId of [ids.admin, ids.supervisor, ids.employee]) {
          assert.equal(
            (
              await request(
                "/customers/portal/reports/summary",
                userId,
              )
            ).status,
            403,
          );
          assert.equal(
            (
              await request(
                "/customers/portal/reports/jobs.xlsx",
                userId,
              )
            ).status,
            403,
          );
          assert.equal(
            (
              await request(
                "/customers/portal/reports/amcs.xlsx",
                userId,
              )
            ).status,
            403,
          );
        }
      });
    });
  } finally {
    for (const [target, key, original] of originals.reverse()) {
      target[key] = original;
    }
    originals.length = 0;
  }
});
