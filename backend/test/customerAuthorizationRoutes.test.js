import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import cookieParser from "cookie-parser";
import jwt from "jsonwebtoken";

process.env.JWT_ACCESS_SECRET ??= "customer-route-test-access-secret";
process.env.JWT_REFRESH_SECRET ??= "customer-route-test-refresh-secret";

const [
  { default: authRoutes },
  { default: customerRoutes },
  { default: jobRoutes },
  { default: jobPhotoRoutes },
  { default: amcRoutes },
  { default: amcPhotoRoutes },
  { default: errorMiddleware },
  { default: User },
  { default: Customer },
  { default: Job },
  { default: JobHistory },
  { default: JobPhoto },
  { default: AMC },
  { default: AMCPhoto },
  { default: Employee },
  { default: ATM },
] = await Promise.all([
  import("../src/modules/auth/auth.routes.js"),
  import("../src/modules/customers/customer.routes.js"),
  import("../src/modules/jobs/jobs.routes.js"),
  import("../src/modules/jobPhotos/jobPhotos.route.js"),
  import("../src/modules/amc/amc.routes.js"),
  import("../src/modules/amcPhotos/amcPhoto.routes.js"),
  import("../src/middlewares/error.middleware.js"),
  import("../src/modules/users/user.model.js"),
  import("../src/modules/customers/customer.model.js"),
  import("../src/modules/jobs/jobs.model.js"),
  import("../src/modules/jobs/jobHistory.model.js"),
  import("../src/modules/jobPhotos/jobPhotos.model.js"),
  import("../src/modules/amc/amc.model.js"),
  import("../src/modules/amcPhotos/amcPhoto.model.js"),
  import("../src/modules/employees/employee.model.js"),
  import("../src/modules/atms/atm.model.js"),
]);

const ids = {
  customerA: "64b000000000000000000101",
  customerB: "64b000000000000000000102",
  userA: "64b000000000000000000111",
  userB: "64b000000000000000000112",
  blocked: "64b000000000000000000113",
  inactive: "64b000000000000000000114",
  admin: "64b000000000000000000115",
  supervisor: "64b000000000000000000116",
  employee: "64b000000000000000000117",
  otherEmployee: "64b000000000000000000118",
  jobA: "64b000000000000000000121",
  jobB: "64b000000000000000000122",
  amcA: "64b000000000000000000131",
  amcB: "64b000000000000000000132",
  atmA: "64b000000000000000000141",
  atmB: "64b000000000000000000142",
};

const users = new Map(
  [
    [ids.userA, "customer", "active"],
    [ids.userB, "customer", "active"],
    [ids.blocked, "customer", "blocked"],
    [ids.inactive, "customer", "inactive"],
    [ids.admin, "admin", "active"],
    [ids.supervisor, "supervisor", "active"],
    [ids.employee, "employee", "active"],
    [ids.otherEmployee, "employee", "active"],
  ].map(([id, userType, status]) => [
    id,
    { _id: id, userType, status, refreshToken: "stored-refresh-hash" },
  ]),
);

const customers = [
  {
    _id: ids.customerA,
    userId: ids.userA,
    isActive: true,
    isDeleted: false,
  },
  {
    _id: ids.customerB,
    userId: ids.userB,
    isActive: true,
    isDeleted: false,
  },
];

const jobs = [
  {
    _id: ids.jobA,
    jobId: "JOB-A",
    title: "Customer A repair",
    description: "A-safe description",
    customerId: ids.customerA,
    atmId: { _id: "64b000000000000000000141", atmId: "ATM-A" },
    assignedEmployeeId: {
      _id: ids.employee,
      firstName: "Assigned",
      lastName: "Employee",
    },
    status: "APPROVED",
    isDeleted: false,
    beforePhotos: [],
    afterPhotos: [],
    toObject() {
      return { ...this };
    },
  },
  {
    _id: ids.jobB,
    jobId: "JOB-B",
    title: "Customer B repair",
    customerId: ids.customerB,
    atmId: { _id: "64b000000000000000000142", atmId: "ATM-B" },
    assignedEmployeeId: { _id: ids.otherEmployee },
    status: "APPROVED",
    isDeleted: false,
    beforePhotos: [],
    afterPhotos: [],
    toObject() {
      return { ...this };
    },
  },
];

const atms = [
  {
    _id: ids.atmA,
    atmId: "ATM-A",
    locationName: "Customer A ATM",
    address: "A address",
    customer: ids.customerA,
    isDeleted: false,
    bankId: { bankName: "A Bank" },
    districtId: { districtName: "A District" },
    regionId: { name: "A Region" },
  },
  {
    _id: ids.atmB,
    atmId: "ATM-B",
    locationName: "Customer B ATM",
    address: "B address",
    customer: ids.customerB,
    isDeleted: false,
  },
];

const jobPhotos = [
  {
    _id: "64b000000000000000000151",
    jobId: ids.jobA,
    url: "https://photos.example.test/job-a.jpg",
    thumbnailUrl: "https://photos.example.test/job-a-thumb.jpg",
    photoType: "after",
    uploadedAt: new Date("2026-10-01T00:00:00.000Z"),
    isExpired: false,
  },
];
const foreignJobPhoto = {
  _id: "64b000000000000000000152",
  jobId: ids.jobB,
  url: "https://photos.example.test/job-b.jpg",
  thumbnailUrl: "https://photos.example.test/job-b-thumb.jpg",
  photoType: "before",
  uploadedAt: new Date("2026-10-02T00:00:00.000Z"),
  isExpired: false,
};
jobs[0].beforePhotos = [foreignJobPhoto];
jobs[0].afterPhotos = [jobPhotos[0]];

const amcs = [
  {
    _id: ids.amcA,
    amcId: "AMC-A",
    customerId: ids.customerA,
    employeeId: {
      _id: ids.employee,
      firstName: "Assigned",
      lastName: "Employee",
      email: "assigned@example.test",
    },
    status: "COMPLETED",
    month: 10,
    year: 2026,
    checklist: [{ item: "door", response: "Good", remarks: "" }],
    atmId: { _id: "64b000000000000000000141", atmId: "ATM-A" },
    isDeleted: false,
  },
  {
    _id: ids.amcB,
    amcId: "AMC-B",
    customerId: ids.customerB,
    employeeId: { _id: ids.otherEmployee },
    status: "COMPLETED",
    month: 10,
    year: 2026,
    checklist: [],
    isDeleted: false,
  },
  {
    _id: "64b000000000000000000133",
    amcId: "AMC-A-PENDING",
    customerId: ids.customerA,
    status: "PENDING",
    month: 11,
    year: 2026,
    checklist: [],
    isDeleted: false,
  },
];

const amcPhotos = [
  {
    _id: "64b000000000000000000161",
    amcId: ids.amcA,
    url: "https://photos.example.test/amc-a.jpg",
    thumbnailUrl: "https://photos.example.test/amc-a-thumb.jpg",
    uploadedAt: new Date("2026-10-01T00:00:00.000Z"),
    isExpired: false,
  },
];

const query = (value) => ({
  populate() {
    return this;
  },
  sort() {
    return this;
  },
  skip() {
    return this;
  },
  limit() {
    return this;
  },
  select() {
    return this;
  },
  lean() {
    return Promise.resolve(value);
  },
  then(resolve, reject) {
    return Promise.resolve(value).then(resolve, reject);
  },
});

const originals = [];
const override = (target, key, value) => {
  originals.push([target, key, target[key]]);
  target[key] = value;
};

const makeApp = () => {
  const app = express();
  app.use(express.json());
  app.use(cookieParser());
  app.use("/api/v1/auth", authRoutes);
  app.use("/api/v1/customers", customerRoutes);
  app.use("/api/v1/jobs", jobRoutes);
  app.use("/api/v1/photos", jobPhotoRoutes);
  app.use("/api/v1/amc", amcRoutes);
  app.use("/api/v1/amc-photos", amcPhotoRoutes);
  app.use(errorMiddleware);
  return app;
};

const tokenFor = (id) =>
  jwt.sign(
    { id, userType: users.get(id).userType },
    process.env.JWT_ACCESS_SECRET,
    { expiresIn: "5m" },
  );

async function withServer(callback) {
  const server = makeApp().listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const { port } = server.address();
  try {
    await callback(`http://127.0.0.1:${port}/api/v1`);
  } finally {
    await new Promise((resolve, reject) =>
      server.close((error) => (error ? reject(error) : resolve())),
    );
  }
}

const withHeaders = (id) => ({
  Authorization: `Bearer ${tokenFor(id)}`,
});

test("mounted routes enforce customer scope, status, photo ownership, and operational role contracts", async (t) => {
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
  override(ATM, "find", (filter) =>
    query(
      atms.filter(
        (atm) =>
          String(atm.customer) === String(filter.customer) &&
          atm.isDeleted === filter.isDeleted,
      ),
    ),
  );
  override(ATM, "countDocuments", async (filter) =>
    atms.filter(
      (atm) =>
        String(atm.customer) === String(filter.customer) &&
        atm.isDeleted === filter.isDeleted,
    ).length,
  );
  override(ATM, "findOne", (filter) =>
    query(
      atms.find(
        (atm) =>
          String(atm._id) === String(filter._id) &&
          String(atm.customer) === String(filter.customer) &&
          atm.isDeleted === filter.isDeleted,
      ) ?? null,
    ),
  );
  override(Job, "find", (filter) => {
    const result = jobs.filter(
      (job) =>
        !job.isDeleted &&
        (filter.customerId === undefined ||
          String(job.customerId) === String(filter.customerId)) &&
        (!filter.status ||
          (filter.status.$in
            ? filter.status.$in.includes(job.status)
            : filter.status === job.status)),
    );
    return query(result);
  });
  override(Job, "countDocuments", async () => 1);
  override(Job, "findOne", (filter) =>
    query(
      jobs.find(
        (job) =>
          String(job._id) === String(filter._id) &&
          (filter.customerId === undefined ||
            String(job.customerId) === String(filter.customerId)) &&
          (!filter.status?.$in || filter.status.$in.includes(job.status)) &&
          !job.isDeleted,
      ) ?? null,
    ),
  );
  override(Job, "findById", (id) =>
    query(jobs.find((job) => String(job._id) === String(id)) ?? null),
  );
  override(JobHistory, "find", () => query([]));
  override(JobPhoto, "find", (filter) =>
    query(jobPhotos.filter((photo) => String(photo.jobId) === String(filter.jobId))),
  );
  override(AMC, "findById", (id) =>
    query(amcs.find((amc) => String(amc._id) === String(id)) ?? null),
  );
  override(AMC, "find", (filter) =>
    query(
      amcs.filter(
        (amc) =>
          String(amc.customerId) === String(filter.customerId) &&
          amc.status === filter.status &&
          amc.isDeleted === filter.isDeleted,
      ),
    ),
  );
  override(AMC, "countDocuments", async (filter) =>
    amcs.filter(
      (amc) =>
        String(amc.customerId) === String(filter.customerId) &&
        amc.status === filter.status &&
        amc.isDeleted === filter.isDeleted,
    ).length,
  );
  override(AMCPhoto, "find", (filter) => ({
    populate() {
      return this;
    },
    sort: async () =>
      amcPhotos.filter(
        (photo) => String(photo.amcId) === String(filter.amcId),
      ),
  }));
  override(Employee, "find", () => query([{ userId: ids.employee }]));

  try {
    await withServer(async (baseUrl) => {
      const request = (path, id, options = {}) =>
        fetch(`${baseUrl}${path}`, {
          ...options,
          headers: {
            ...withHeaders(id),
            ...(options.headers ?? {}),
          },
        });

      await t.test("customer profile and ATM APIs use current server-side assignment", async () => {
        const profileResponse = await request(
          `/customers/portal/profile?customerId=${ids.customerB}`,
          ids.userA,
        );
        assert.equal(profileResponse.status, 200);
        const profileBody = await profileResponse.json();
        assert.equal(profileBody.data.profile._id, ids.customerA);
        assert.equal(profileBody.data.totalATMs, 1);
        assert.equal("userId" in profileBody.data.profile, false);

        const atmListResponse = await request(
          `/customers/portal/atms?customerId=${ids.customerB}`,
          ids.userA,
        );
        assert.equal(atmListResponse.status, 200);
        const atmList = await atmListResponse.json();
        assert.deepEqual(
          atmList.data.atms.map((atm) => atm._id),
          [ids.atmA],
        );
        assert.equal(
          (await request(`/customers/portal/atms/${ids.atmB}`, ids.userA))
            .status,
          404,
        );
        assert.equal(
          (
            await request(
              `/customers/portal/atms/${ids.atmA}`,
              ids.userB,
            )
          ).status,
          404,
        );
        assert.equal(
          (
            await request(
              `/customers/portal/atms/${ids.atmB}`,
              ids.userB,
            )
          ).status,
          200,
        );
      });

      await t.test("customer AMC list returns only completed historical records for its owner", async () => {
        const response = await request(
          `/customers/portal/amcs?customerId=${ids.customerB}`,
          ids.userA,
        );
        assert.equal(response.status, 200, await response.clone().text());
        const body = await response.json();
        assert.deepEqual(body.data.amcs.map((amc) => amc._id), [ids.amcA]);
        assert.equal(body.data.amcs[0].employeeId, undefined);
        const customerBResponse = await request(
          "/customers/portal/amcs",
          ids.userB,
        );
        assert.equal(customerBResponse.status, 200);
        const customerBBody = await customerBResponse.json();
        assert.deepEqual(
          customerBBody.data.amcs.map((amc) => amc._id),
          [ids.amcB],
        );
      });

      await t.test("customer list ignores a forged owner filter and rejects hidden statuses", async () => {
        const response = await request(
          `/customers/portal/jobs?customerId=${ids.customerB}&status=APPROVED`,
          ids.userA,
        );
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.deepEqual(body.data.jobs.map((job) => job._id), [ids.jobA]);
        assert.equal(
          (await request(`/jobs?customerId=${ids.customerB}`, ids.userA)).status,
          200,
        );
        assert.equal(
          (
            await request(
              "/customers/portal/jobs?status=PENDING",
              ids.userA,
            )
          ).status,
          400,
        );
      });

      await t.test("customer job detail and history reject foreign record IDs", async () => {
        assert.equal(
          (
            await request(`/customers/portal/jobs/${ids.jobB}`, ids.userA)
          ).status,
          404,
        );
        assert.equal(
          (await request(`/jobs/${ids.jobB}`, ids.userA)).status,
          404,
        );
        assert.equal(
          (await request(`/jobs/${ids.jobB}/history`, ids.userA)).status,
          404,
        );
        assert.equal(
          (
            await request(`/customers/portal/jobs/${ids.jobA}`, ids.userA)
          ).status,
          200,
        );
        assert.equal(
          (await request(`/jobs/${ids.jobA}/history`, ids.userA)).status,
          200,
        );
      });

      await t.test("customer job photo endpoints deny foreign jobs and return only associated photos", async () => {
        assert.equal(
          (await request(`/photos/job/${ids.jobB}`, ids.userA)).status,
          404,
        );
        const response = await request(
          `/photos/job/${ids.jobA}`,
          ids.userA,
        );
        assert.equal(response.status, 200);
        const body = await response.json();
        assert.deepEqual(
          body.data.photos.map((photo) => photo.url),
          [jobPhotos[0].url],
        );
        const portalResponse = await request(
          `/customers/portal/jobs/${ids.jobA}/photos`,
          ids.userA,
        );
        assert.equal(portalResponse.status, 200);
        const portalBody = await portalResponse.json();
        assert.deepEqual(portalBody.data.beforePhotos, []);
        assert.deepEqual(
          portalBody.data.afterPhotos.map((photo) => photo.url),
          [jobPhotos[0].url],
        );
        assert.equal(
          JSON.stringify(portalBody.data).includes("job-b"),
          false,
        );
      });

      await t.test("customer AMC details, photos, and PDFs require the matching owner", async () => {
        assert.equal((await request(`/amc/${ids.amcA}`, ids.userA)).status, 200);
        assert.equal((await request(`/amc/${ids.amcB}`, ids.userA)).status, 404);
        assert.equal(
          (await request(`/amc-photos/${ids.amcA}`, ids.userA)).status,
          200,
        );
        assert.equal(
          (await request(`/amc-photos/${ids.amcB}`, ids.userA)).status,
          404,
        );
        assert.equal(
          (await request(`/amc/${ids.amcB}/report`, ids.userA)).status,
          404,
        );
        const report = await request(`/amc/${ids.amcA}/report`, ids.userA);
        assert.equal(report.status, 200);
        assert.match(report.headers.get("content-type"), /application\/pdf/);
      });

      await t.test("blocked and inactive users cannot use access or refresh tokens", async () => {
        for (const [id, status] of [
          [ids.blocked, 403],
          [ids.inactive, 403],
        ]) {
          assert.equal((await request("/jobs", id)).status, status);
          const refreshToken = jwt.sign(
            { id, userType: "customer" },
            process.env.JWT_REFRESH_SECRET,
            { expiresIn: "5m" },
          );
          const refresh = await fetch(`${baseUrl}/auth/refresh`, {
            method: "POST",
            headers: { Cookie: `refreshToken=${refreshToken}` },
          });
          assert.equal(refresh.status, 403);
        }
      });

      await t.test("Admin, assigned Employee, and supervised Supervisor retain their permitted views", async () => {
        assert.equal(
          (await request(`/jobs/${ids.jobA}`, ids.admin)).status,
          200,
        );
        assert.equal(
          (await request(`/jobs/${ids.jobA}`, ids.employee)).status,
          200,
        );
        assert.equal(
          (await request(`/jobs/${ids.jobA}`, ids.supervisor)).status,
          403,
        );
        assert.equal(
          (await request(`/amc/${ids.amcA}`, ids.admin)).status,
          200,
        );
        assert.equal(
          (await request(`/amc/${ids.amcA}`, ids.supervisor)).status,
          200,
        );
        assert.equal(
          (await request(`/amc/${ids.amcA}`, ids.employee)).status,
          200,
        );
        assert.equal(
          (
            await request(`/amc/${ids.amcA}`, ids.otherEmployee)
          ).status,
          403,
        );
      });
    });
  } finally {
    for (const [target, key, original] of originals.reverse()) {
      target[key] = original;
    }
    originals.length = 0;
  }
});
