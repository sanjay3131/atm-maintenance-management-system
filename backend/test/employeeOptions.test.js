import assert from "node:assert/strict";
import test from "node:test";
import Employee from "../src/modules/employees/employee.model.js";
import employeeRoutes from "../src/modules/employees/employee.routes.js";
import { getEmployeeOptions } from "../src/modules/employees/employee.controller.js";
import { employeeOptionsQuerySchema } from "../src/modules/employees/employee.validate.js";

const employeeOptionsRoute = employeeRoutes.stack.find(
  (layer) => layer.route?.path === "/options" && layer.route.methods.get,
).route;

const invoke = (handler, req) =>
  new Promise((resolve, reject) => {
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        resolve({ status: this.statusCode, body });
        return this;
      },
    };
    handler(req, res, reject);
  });

const invokeOptionsRoute = (query) =>
  new Promise((resolve) => {
    const req = {
      user: { userType: "admin" },
      params: {},
      body: {},
    };
    Object.defineProperty(req, "query", {
      get: () => query,
    });
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        resolve({ status: this.statusCode, body, req });
        return this;
      },
    };
    const handlers = employeeOptionsRoute.stack.map(({ handle }) => handle);

    const dispatch = (index, error) => {
      if (error) {
        resolve({ error, req });
        return;
      }
      if (index >= handlers.length) return;
      try {
        const result = handlers[index](req, res, (nextError) =>
          dispatch(index + 1, nextError),
        );
        Promise.resolve(result).catch((nextError) =>
          dispatch(index + 1, nextError),
        );
      } catch (nextError) {
        dispatch(index + 1, nextError);
      }
    };

    dispatch(1);
  });

test("employee options route allows only admin and superAdmin roles", () => {
  const registeredPaths = employeeRoutes.stack
    .map((layer) => layer.route?.path)
    .filter(Boolean);
  assert.ok(
    registeredPaths.indexOf("/options") <
      registeredPaths.indexOf("/:employeeId"),
    "the options route must precede the dynamic employee ID route",
  );

  const authorize = employeeOptionsRoute.stack[1].handle;

  for (const userType of ["admin", "superAdmin"]) {
    let continued = false;
    authorize({ user: { userType } }, {}, () => {
      continued = true;
    });
    assert.equal(continued, true);
  }

  for (const userType of ["supervisor", "employee", "customer"]) {
    assert.throws(
      () => authorize({ user: { userType } }, {}, () => {}),
      { statusCode: 403 },
    );
  }
});

test("employee options query validates bounded pagination and search text", () => {
  assert.deepEqual(
    employeeOptionsQuerySchema.parse({ search: " A.* ", page: "2", limit: "50" }),
    { search: "A.*", page: 2, limit: 50 },
  );
  assert.deepEqual(employeeOptionsQuerySchema.parse({}), {
    search: "",
    page: 1,
    limit: 20,
  });
  assert.equal(employeeOptionsQuerySchema.parse({ activeOnly: "true" }).activeOnly, "true");
  assert.equal(employeeOptionsQuerySchema.safeParse({ limit: "51" }).success, false);
  assert.equal(
    employeeOptionsQuerySchema.safeParse({ search: "x".repeat(101) }).success,
    false,
  );
  assert.equal(
    employeeOptionsQuerySchema.safeParse({ page: "1", other: "value" }).success,
    false,
  );
});

test("employee options route validates search and pagination without assigning req.query", async () => {
  const originalAggregate = Employee.aggregate;
  let pipeline;
  Employee.aggregate = async (value) => {
    pipeline = value;
    return [{ employees: [], metadata: [{ total: 0 }] }];
  };

  try {
    const result = await invokeOptionsRoute({
      search: "ca",
      page: "1",
      limit: "20",
    });
    assert.equal(result.status, 200);
    assert.deepEqual(result.req.validatedQuery, {
      search: "ca",
      page: 1,
      limit: 20,
    });
    assert.equal(
      pipeline.find((stage) => stage.$match).$match.$or[0].employeeCode.$regex,
      "ca",
    );

    const invalid = await invokeOptionsRoute({
      search: "ca",
      page: "0",
      limit: "51",
    });
    assert.equal(invalid.error.statusCode, 400);
    assert.equal(invalid.req.validatedQuery, undefined);
  } finally {
    Employee.aggregate = originalAggregate;
  }
});

test("employee options searches escaped name/code text and returns a safe paginated projection", async () => {
  const originalAggregate = Employee.aggregate;
  let pipeline;
  const returnedEmployee = {
    _id: "64b000000000000000000001",
    employeeCode: "EMP-042",
    firstName: "Asha",
    lastName: "Patel",
    avatarUrl: "https://images.example.test/avatar.png",
  };
  Employee.aggregate = async (value) => {
    pipeline = value;
    return [{ employees: [returnedEmployee], metadata: [{ total: 51 }] }];
  };

  try {
    const { status, body } = await invoke(getEmployeeOptions, {
      validatedQuery: { search: "A.*", page: 2, limit: 25 },
    });

    assert.equal(status, 200);
    assert.deepEqual(body.data, {
      employees: [returnedEmployee],
      pagination: { page: 2, limit: 25, total: 51, totalPages: 3 },
    });
    assert.equal(pipeline[0].$lookup.from, "users");
    const match = pipeline.find((stage) => stage.$match)?.$match;
    assert.equal(match.$or[0].employeeCode.$regex, "A\\.\\*");
    assert.equal(match.$or[1].$expr.$regexMatch.regex, "A\\.\\*");
    assert.deepEqual(pipeline.at(-2), {
      $sort: { employeeCode: 1, _id: 1 },
    });
    assert.deepEqual(pipeline.at(-1).$facet.employees.slice(0, 2), [
      { $skip: 25 },
      { $limit: 25 },
    ]);
    assert.deepEqual(
      pipeline.at(-1).$facet.employees.at(-1).$project,
      {
        _id: 1,
        employeeCode: { $ifNull: ["$employeeCode", null] },
        firstName: { $ifNull: ["$user.firstName", null] },
        lastName: { $ifNull: ["$user.lastName", null] },
        avatarUrl: { $ifNull: ["$user.avatar.url", null] },
      },
    );
    assert.equal(JSON.stringify(pipeline).includes("salary"), false);
    assert.equal(JSON.stringify(pipeline).includes("email"), false);
    assert.equal(JSON.stringify(pipeline).includes("phoneNumber"), false);
    assert.equal(JSON.stringify(pipeline).includes("assignedAtm"), false);
    assert.equal(JSON.stringify(pipeline).includes("status"), false);
  } finally {
    Employee.aggregate = originalAggregate;
  }
});

test("activeOnly filters active employees with active employee accounts before pagination", async () => {
  const originalAggregate = Employee.aggregate;
  let pipeline;
  Employee.aggregate = async (value) => {
    pipeline = value;
    return [{ employees: [], metadata: [{ total: 0 }] }];
  };

  try {
    const result = await invokeOptionsRoute({
      search: "Ravi",
      page: "2",
      limit: "20",
      activeOnly: "true",
    });
    assert.equal(result.status, 200);
    assert.equal(result.req.validatedQuery.activeOnly, "true");
    assert.deepEqual(pipeline[0], { $match: { status: "active" } });
    assert.equal(pipeline[1].$lookup.from, "users");
    assert.deepEqual(pipeline[3].$match, {
      "user.status": "active",
      "user.userType": "employee",
    });
    assert.deepEqual(pipeline.at(-1).$facet.employees.slice(0, 2), [
      { $skip: 20 },
      { $limit: 20 },
    ]);
    assert.equal(pipeline.at(-1).$facet.employees.some((stage) => stage.$lookup), false);
  } finally {
    Employee.aggregate = originalAggregate;
  }
});

test("employee options includes all statuses and employees without ATM assignments", async () => {
  const originalAggregate = Employee.aggregate;
  let pipeline;
  Employee.aggregate = async (value) => {
    pipeline = value;
    return [
      {
        employees: [
          { _id: "active-id", employeeCode: "EMP-A" },
          { _id: "inactive-id", employeeCode: "EMP-I" },
          { _id: "resigned-id", employeeCode: "EMP-R" },
        ],
        metadata: [{ total: 3 }],
      },
    ];
  };

  try {
    const { body } = await invoke(getEmployeeOptions, {
      validatedQuery: { search: "", page: 1, limit: 20 },
    });
    assert.deepEqual(
      body.data.employees.map(({ _id }) => _id),
      ["active-id", "inactive-id", "resigned-id"],
    );
    assert.equal(pipeline.some((stage) => stage.$match), false);
    assert.deepEqual(pipeline[0], {
      $sort: { employeeCode: 1, _id: 1 },
    });
    assert.deepEqual(pipeline[1].$facet.employees.slice(0, 2), [
      { $skip: 0 },
      { $limit: 20 },
    ]);
    assert.equal(pipeline[1].$facet.employees[2].$lookup.from, "users");
    assert.equal(pipeline[1].$facet.metadata[0].$count, "total");
    assert.equal(JSON.stringify(pipeline).includes("atms"), false);
  } finally {
    Employee.aggregate = originalAggregate;
  }
});

test("employee options pipelines use Employee _id as a tie-breaker for every employee-code value", async () => {
  const originalAggregate = Employee.aggregate;
  const pipelines = [];
  Employee.aggregate = async (pipeline) => {
    pipelines.push(pipeline);
    return [{ employees: [], metadata: [] }];
  };

  try {
    await invoke(getEmployeeOptions, {
      validatedQuery: { search: "", page: 1, limit: 20 },
    });
    await invoke(getEmployeeOptions, {
      validatedQuery: { search: "Asha", page: 1, limit: 20 },
    });

    assert.deepEqual(pipelines[0][0], {
      $sort: { employeeCode: 1, _id: 1 },
    });
    assert.deepEqual(pipelines[1].at(-2), {
      $sort: { employeeCode: 1, _id: 1 },
    });
  } finally {
    Employee.aggregate = originalAggregate;
  }
});

test("employee options pipeline preserves unmatched users and filters by code or composed name", async () => {
  const originalAggregate = Employee.aggregate;
  const pipelines = [];
  Employee.aggregate = async (pipeline) => {
    pipelines.push(pipeline);
    return [{ employees: [], metadata: [] }];
  };

  try {
    await invoke(getEmployeeOptions, {
      validatedQuery: { search: "", page: 1, limit: 20 },
    });
    await invoke(getEmployeeOptions, {
      validatedQuery: { search: "EMP-042", page: 1, limit: 20 },
    });
    await invoke(getEmployeeOptions, {
      validatedQuery: { search: "Asha", page: 1, limit: 20 },
    });

    const noSearch = pipelines[0];
    const noSearchUserUnwind = noSearch[1].$facet.employees[3];
    assert.deepEqual(noSearchUserUnwind.$unwind, {
      path: "$user",
      preserveNullAndEmptyArrays: true,
    });
    assert.deepEqual(noSearch[1].$facet.metadata, [{ $count: "total" }]);
    assert.deepEqual(
      noSearch[1].$facet.employees.at(-1).$project.firstName,
      { $ifNull: ["$user.firstName", null] },
    );

    const codeSearch = pipelines[1];
    const codeMatch = codeSearch.find((stage) => stage.$match).$match;
    assert.ok(
      codeSearch.findIndex((stage) => stage.$match) <
        codeSearch.findIndex((stage) => stage.$facet),
    );
    assert.equal(codeMatch.$or[0].employeeCode.$regex, "EMP-042");
    assert.equal(codeMatch.$or[1].$expr.$regexMatch.input.$concat[0].$ifNull[0],
      "$user.firstName");
    assert.deepEqual(codeSearch[1].$unwind, {
      path: "$user",
      preserveNullAndEmptyArrays: true,
    });
    assert.deepEqual(codeSearch.at(-1).$facet.metadata, [{ $count: "total" }]);
    assert.deepEqual(
      codeSearch.at(-1).$facet.employees.at(-1).$project.lastName,
      { $ifNull: ["$user.lastName", null] },
    );

    const nameSearch = pipelines[2];
    const nameMatch = nameSearch.find((stage) => stage.$match).$match;
    assert.ok(
      nameSearch.findIndex((stage) => stage.$match) <
        nameSearch.findIndex((stage) => stage.$facet),
    );
    assert.equal(nameMatch.$or[1].$expr.$regexMatch.regex, "Asha");
    assert.deepEqual(nameSearch.at(-1).$facet.metadata, [{ $count: "total" }]);
    assert.deepEqual(nameSearch.at(-1).$facet.employees.slice(0, 2), [
      { $skip: 0 },
      { $limit: 20 },
    ]);
  } finally {
    Employee.aggregate = originalAggregate;
  }
});
