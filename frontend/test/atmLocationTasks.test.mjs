import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import {
  buildBulkATMLocationTaskPayload,
  canHoldATMLocationTask,
  canResumeATMLocationTask,
  canSubmitATMLocationTask,
  createATMLocationTaskRequestPayload,
  filterATMLocationTaskInventory,
  getEmployeeLocationTaskGroups,
  getEmployeeLocationTaskTabCounts,
  getEmployeeLocationTaskTabTasks,
  getATMLocationTaskRequestId,
  getBulkATMLocationTaskErrorMessage,
  getLocationTaskActionErrorMessage,
  isEligibleLocationTaskEmployee,
  searchEligibleLocationTaskEmployees,
  selectEmployeeAssignedATMs,
  setManualATMLocationTaskSelection,
  shouldRefreshATMLocationTaskInventory,
  tryAcquireATMLocationTaskSubmissionLock,
} from "../src/features/atms/atmLocationTask.utils.ts";

const atm = (id, locationConfigured = false, overrides = {}) => ({
  _id: id,
  atmId: `ATM-${id}`,
  locationName: `Location ${id}`,
  address: `Address ${id}`,
  bankId: { _id: "bank-1", bankName: "Bank One" },
  districtId: { _id: "district-1", districtName: "District One" },
  regionId: { _id: "region-1", name: "Region One" },
  locationConfigured,
  ...overrides,
});

const employee = (id, overrides = {}) => ({
  _id: id,
  employeeCode: `EMP-${id}`,
  status: "active",
  assignedAtmIds: [],
  userId: {
    firstName: "Field",
    lastName: "Employee",
    status: "active",
    userType: "employee",
  },
  ...overrides,
});

test("bulk assignment creates per-ATM employees and derives task type from confirmed location state", () => {
  assert.deepEqual(
    buildBulkATMLocationTaskPayload(
      [
        { atmId: "atm-1", employeeId: "employee-1" },
        {
          atmId: "atm-2",
          employeeId: "employee-2",
          correctionReason: "  GPS review requested  ",
        },
      ],
      [atm("atm-1"), atm("atm-2", true)],
      [],
    ),
    {
      tasks: [
        {
          atmId: "atm-1",
          employeeId: "employee-1",
          taskType: "INITIAL_COLLECTION",
        },
        {
          atmId: "atm-2",
          employeeId: "employee-2",
          taskType: "LOCATION_CORRECTION",
          correctionReason: "GPS review requested",
        },
      ],
    },
  );
});

test("bulk assignment rejects active tasks, unavailable locations, missing employees, and empty selection", () => {
  const atms = [atm("atm-1"), atm("atm-2", true), { ...atm("atm-3"), locationConfigured: undefined }];
  const activeTask = { atmId: "atm-1", active: true };
  assert.throws(
    () =>
      buildBulkATMLocationTaskPayload(
        [{ atmId: "atm-1", employeeId: "employee-1" }],
        atms,
        [activeTask],
      ),
    /already has an active/,
  );
  assert.throws(
    () =>
      buildBulkATMLocationTaskPayload(
        [{ atmId: "atm-3", employeeId: "employee-1" }],
        atms,
        [],
      ),
    /location status is unavailable/,
  );
  assert.throws(
    () =>
      buildBulkATMLocationTaskPayload(
        [{ atmId: "atm-2", employeeId: "" }],
        atms,
        [],
      ),
    /Select an employee/,
  );
  assert.throws(
    () => buildBulkATMLocationTaskPayload([], atms, []),
    /Select at least one/,
  );
  assert.throws(
    () =>
      buildBulkATMLocationTaskPayload(
        [
          { atmId: "atm-2", employeeId: "employee-1" },
          { atmId: "atm-2", employeeId: "employee-2" },
        ],
        atms,
        [],
      ),
    /only be assigned one/,
  );
  assert.throws(
      () =>
        buildBulkATMLocationTaskPayload(
          Array.from({ length: 101 }, (_, index) => ({
            atmId: `atm-${index}`,
            employeeId: "employee-1",
          })),
          Array.from({ length: 101 }, (_, index) => atm(`atm-${index}`)),
          [],
        ),
      /at most 100/,
  );
});

test("employee eligibility requires an active employee and active employee user", () => {
  assert.equal(isEligibleLocationTaskEmployee(employee("1")), true);
  assert.equal(
    isEligibleLocationTaskEmployee(
      employee("2", { status: "inactive" }),
    ),
    false,
  );
  assert.equal(
    isEligibleLocationTaskEmployee(
      employee("3", {
        userId: { status: "active", userType: "supervisor" },
      }),
    ),
    false,
  );
});

test("ATM inventory filters combine district, region, bank, and text search", () => {
  const inventory = [
    atm("1", false),
    atm("2", false, {
      districtId: { _id: "district-2", districtName: "District Two" },
      regionId: { _id: "region-2", name: "Region Two" },
      bankId: { _id: "bank-2", bankName: "Bank Two" },
      locationName: "Central Branch",
    }),
    atm("3", false, {
      bankId: { _id: "bank-2", bankName: "Bank Two" },
      locationName: "Central Branch",
    }),
  ];
  assert.deepEqual(
    filterATMLocationTaskInventory(inventory, {
      districtId: "district-2",
      regionId: "region-2",
      bankId: "bank-2",
      search: "central",
    }).map(({ _id }) => _id),
    ["2"],
  );
  assert.deepEqual(
    filterATMLocationTaskInventory(inventory, {
      districtId: "",
      regionId: "",
      bankId: "",
      search: "ATM-",
    }).map(({ _id }) => _id),
    ["1", "2", "3"],
  );
});

test("employee picker search matches employee code and full name and excludes ineligible employees", () => {
  const employees = [
    employee("1", {
      employeeCode: "EMP001",
      userId: {
        firstName: "Asha",
        lastName: "Rao",
        status: "active",
        userType: "employee",
      },
    }),
    employee("2", {
      employeeCode: "EMP002",
      userId: {
        firstName: "Ravi",
        lastName: "Shah",
        status: "active",
        userType: "employee",
      },
    }),
    employee("3", { status: "inactive" }),
  ];
  assert.deepEqual(
    searchEligibleLocationTaskEmployees(employees, "emp001").map(({ _id }) => _id),
    ["1"],
  );
  assert.deepEqual(
    searchEligibleLocationTaskEmployees(employees, "ravi shah").map(({ _id }) => _id),
    ["2"],
  );
});

test("employee auto-selection uses assigned eligible ATMs and skips active or unknown-location ATMs", () => {
  const inventory = [
    atm("assigned"),
    atm("active"),
    atm("unknown", false, { locationConfigured: undefined }),
    atm("unassigned"),
  ];
  const result = selectEmployeeAssignedATMs({
    employeeId: "employee-1",
    assignedAtmIds: ["assigned", "active", "unknown"],
    atms: inventory,
    activeTasks: [{ atmId: "active", active: true }],
    visibleATMIds: new Set(inventory.map(({ _id }) => _id)),
    assignments: {},
    origins: {},
  });
  assert.deepEqual(Object.keys(result.assignments), ["assigned"]);
  assert.deepEqual(result.assignments.assigned, {
    employeeId: "employee-1",
    correctionReason: "",
  });
  assert.equal(result.autoSelectedCount, 1);
  assert.equal(result.activeTaskCount, 1);
  assert.equal(result.unavailableLocationCount, 1);
});

test("employee auto-selection respects filters while reporting assigned ATMs outside the visible inventory", () => {
  const inventory = [atm("district-one"), atm("district-two")];
  const result = selectEmployeeAssignedATMs({
    employeeId: "employee-1",
    assignedAtmIds: ["district-one", "district-two"],
    atms: inventory,
    activeTasks: [],
    visibleATMIds: new Set(["district-one"]),
    assignments: {},
    origins: {},
  });
  assert.deepEqual(Object.keys(result.assignments), ["district-one"]);
  assert.equal(result.outsideFilterCount, 1);
});

test("changing selected employees replaces automatic selections but preserves manual ownership", () => {
  const inventory = [atm("auto-1"), atm("auto-2"), atm("manual")];
  const initial = selectEmployeeAssignedATMs({
    employeeId: "employee-1",
    assignedAtmIds: ["auto-1"],
    atms: inventory,
    activeTasks: [],
    visibleATMIds: new Set(inventory.map(({ _id }) => _id)),
    assignments: {
      manual: { employeeId: "employee-3", correctionReason: "Keep this assignment" },
    },
    origins: { manual: "manual" },
  });
  const changed = selectEmployeeAssignedATMs({
    employeeId: "employee-2",
    assignedAtmIds: ["auto-2"],
    atms: inventory,
    activeTasks: [],
    visibleATMIds: new Set(inventory.map(({ _id }) => _id)),
    assignments: initial.assignments,
    origins: initial.origins,
  });
  assert.deepEqual(Object.keys(changed.assignments).sort(), ["auto-2", "manual"]);
  assert.deepEqual(changed.assignments.manual, {
    employeeId: "employee-3",
    correctionReason: "Keep this assignment",
  });
  assert.equal(changed.origins["auto-2"], "automatic");
  assert.equal(changed.assignments["auto-1"], undefined);
});

test("manual ATM selection and deselection update selection ownership", () => {
  const selected = setManualATMLocationTaskSelection({
    atmId: "atm-1",
    checked: true,
    employeeId: "employee-1",
    assignments: {},
    origins: {},
  });
  assert.deepEqual(selected.assignments["atm-1"], {
    employeeId: "employee-1",
    correctionReason: "",
  });
  assert.equal(selected.origins["atm-1"], "manual");
  const deselected = setManualATMLocationTaskSelection({
    atmId: "atm-1",
    checked: false,
    employeeId: "employee-1",
    assignments: selected.assignments,
    origins: selected.origins,
  });
  assert.equal(deselected.assignments["atm-1"], undefined);
  assert.equal(deselected.origins["atm-1"], undefined);
});

test("employee selection fills an unassigned manual selection without taking over a manual assignee", () => {
  const inventory = [atm("manual-blank"), atm("manual-owned")];
  const result = selectEmployeeAssignedATMs({
    employeeId: "employee-1",
    assignedAtmIds: ["manual-blank", "manual-owned"],
    atms: inventory,
    activeTasks: [],
    visibleATMIds: new Set(inventory.map(({ _id }) => _id)),
    assignments: {
      "manual-blank": { employeeId: "", correctionReason: "" },
      "manual-owned": { employeeId: "employee-2", correctionReason: "" },
    },
    origins: { "manual-blank": "manual", "manual-owned": "manual" },
  });
  assert.equal(result.assignments["manual-blank"].employeeId, "employee-1");
  assert.equal(result.assignments["manual-owned"].employeeId, "employee-2");
  assert.equal(result.origins["manual-blank"], "manual");
  assert.equal(result.origins["manual-owned"], "manual");
});

const inProgressTask = (overrides = {}) => ({
  _id: "task-1",
  atmId: { _id: "atm-1" },
  status: "IN_PROGRESS",
  active: true,
  locationRequestId: null,
  ...overrides,
});

test("only an active IN_PROGRESS task without a linked request may submit", () => {
  assert.equal(canSubmitATMLocationTask(inProgressTask()), true);
  assert.equal(canSubmitATMLocationTask(inProgressTask({ status: "ASSIGNED" })), false);
  assert.equal(canSubmitATMLocationTask(inProgressTask({ status: "REJECTED" })), false);
  assert.equal(
    canSubmitATMLocationTask(inProgressTask({ status: "PENDING_REVIEW" })),
    false,
  );
  assert.equal(canSubmitATMLocationTask(inProgressTask({ active: false })), false);
  assert.equal(
    canSubmitATMLocationTask(inProgressTask({ locationRequestId: "request-1" })),
    false,
  );
});

test("hold and resume eligibility is restricted to active tasks without linked requests", () => {
  assert.equal(canHoldATMLocationTask(inProgressTask()), true);
  assert.equal(
    canHoldATMLocationTask(inProgressTask({ status: "ASSIGNED" })),
    false,
  );
  assert.equal(
    canHoldATMLocationTask(inProgressTask({ active: false })),
    false,
  );
  assert.equal(
    canHoldATMLocationTask(
      inProgressTask({ locationRequestId: "request-1" }),
    ),
    false,
  );
  assert.equal(
    canResumeATMLocationTask(inProgressTask({ status: "ON_HOLD" })),
    true,
  );
  assert.equal(
    canResumeATMLocationTask(
      inProgressTask({
        status: "ON_HOLD",
        locationRequestId: "request-1",
      }),
    ),
    false,
  );
  assert.equal(
    canResumeATMLocationTask(
      inProgressTask({ status: "ON_HOLD", active: false }),
    ),
    false,
  );
});

test("employee task list groups tasks using authoritative lifecycle statuses", () => {
  const grouped = getEmployeeLocationTaskGroups([
    inProgressTask({ _id: "progress", status: "IN_PROGRESS" }),
    inProgressTask({ _id: "held", status: "ON_HOLD" }),
    inProgressTask({ _id: "review", status: "PENDING_REVIEW" }),
    inProgressTask({ _id: "assigned", status: "ASSIGNED" }),
  ]);
  assert.deepEqual(
    grouped.map(({ status, tasks }) => [status, tasks.map(({ _id }) => _id)]),
    [
      ["ASSIGNED", ["assigned"]],
      ["IN_PROGRESS", ["progress"]],
      ["ON_HOLD", ["held"]],
      ["PENDING_REVIEW", ["review"]],
    ],
  );
});

test("employee location tabs count and filter lifecycle statuses without showing cancelled tasks", () => {
  const tasks = [
    inProgressTask({ _id: "assigned", status: "ASSIGNED" }),
    inProgressTask({ _id: "progress", status: "IN_PROGRESS" }),
    inProgressTask({ _id: "held", status: "ON_HOLD" }),
    inProgressTask({ _id: "review", status: "PENDING_REVIEW" }),
    inProgressTask({ _id: "rejected", status: "REJECTED" }),
    inProgressTask({ _id: "completed", status: "COMPLETED" }),
    inProgressTask({ _id: "cancelled", status: "CANCELLED" }),
  ];

  assert.deepEqual(getEmployeeLocationTaskTabCounts(tasks), {
    ASSIGNED: 1,
    IN_PROGRESS: 4,
    COMPLETED: 1,
  });
  assert.deepEqual(
    getEmployeeLocationTaskTabTasks(tasks, "ASSIGNED").map(({ _id }) => _id),
    ["assigned"],
  );
  assert.deepEqual(
    getEmployeeLocationTaskTabTasks(tasks, "IN_PROGRESS").map(({ _id }) => _id),
    ["progress", "held", "review", "rejected"],
  );
  assert.deepEqual(
    getEmployeeLocationTaskTabTasks(tasks, "COMPLETED").map(({ _id }) => _id),
    ["completed"],
  );
});

test("linked request identification handles populated, string, and missing task relationships", () => {
  assert.equal(
    getATMLocationTaskRequestId({ locationRequestId: "request-1" }),
    "request-1",
  );
  assert.equal(
    getATMLocationTaskRequestId({
      locationRequestId: { _id: "request-2" },
    }),
    "request-2",
  );
  assert.equal(getATMLocationTaskRequestId({ locationRequestId: null }), "");
});

test("a rejected task can be reopened and restarted before a new proposal is eligible", () => {
  let submitted = true;
  const rejectedTask = inProgressTask({
    status: "REJECTED",
    locationRequestId: { _id: "request-1", status: "REJECTED" },
  });
  assert.equal(canSubmitATMLocationTask(rejectedTask), false);

  const reopenedTask = inProgressTask({
    status: "ASSIGNED",
    locationRequestId: null,
  });
  assert.equal(canSubmitATMLocationTask(reopenedTask), false);

  const restartedTask = inProgressTask({ locationRequestId: null });
  if (canSubmitATMLocationTask(restartedTask)) submitted = false;
  assert.equal(submitted, false);
  assert.equal(canSubmitATMLocationTask(restartedTask) && !submitted, true);
});

test("duplicate in-flight clicks remain guarded and awaiting-review tasks remain ineligible", async () => {
  let releaseSubmission;
  const submission = new Promise((resolve) => {
    releaseSubmission = resolve;
  });
  const lock = { current: false };
  let submissionCount = 0;
  const submitOnce = async () => {
    if (!tryAcquireATMLocationTaskSubmissionLock(lock)) return;
    submissionCount += 1;
    try {
      await submission;
    } finally {
      lock.current = false;
    }
  };

  const firstClick = submitOnce();
  await submitOnce();
  assert.equal(submissionCount, 1);
  releaseSubmission();
  await firstClick;
  assert.equal(lock.current, false);
  assert.equal(
    canSubmitATMLocationTask(
      inProgressTask({
        status: "PENDING_REVIEW",
        locationRequestId: { _id: "request-1", status: "PENDING" },
      }),
    ),
    false,
  );
});

test("task-linked GPS payload requires valid accuracy and carries task ID", () => {
  assert.deepEqual(
    createATMLocationTaskRequestPayload({
      task: inProgressTask(),
      latitude: 12.5,
      longitude: 77.6,
      inputSource: "GPS",
      accuracy: 50,
    }),
    {
      atmId: "atm-1",
      locationTaskId: "task-1",
      latitude: 12.5,
      longitude: 77.6,
      inputSource: "GPS",
      accuracy: 50,
    },
  );
  for (const accuracy of [undefined, null, "5", -1, 50.1, Number.NaN]) {
    assert.throws(
      () =>
        createATMLocationTaskRequestPayload({
          task: inProgressTask(),
          latitude: 12.5,
          longitude: 77.6,
          inputSource: "GPS",
          accuracy,
        }),
      /GPS accuracy/,
    );
  }
  assert.throws(
    () =>
      createATMLocationTaskRequestPayload({
        task: inProgressTask(),
        latitude: 90.1,
        longitude: 77.6,
        inputSource: "GPS",
        accuracy: 5,
      }),
    /valid latitude and longitude ranges/,
  );
});

test("manual task proposals are explicit and omit GPS accuracy", () => {
  assert.deepEqual(
    createATMLocationTaskRequestPayload({
      task: inProgressTask(),
      latitude: -90,
      longitude: 180,
      inputSource: "MANUAL",
    }),
    {
      atmId: "atm-1",
      locationTaskId: "task-1",
      latitude: -90,
      longitude: 180,
      inputSource: "MANUAL",
    },
  );
});

test("task lifecycle APIs, translated controls, and proposal flows use scoped invalidation", async () => {
  const service = await readFile(
    new URL(
      "../src/features/atms/services/atm-location-tasks.service.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const hooks = await readFile(
    new URL(
      "../src/features/atms/hooks/useATMLocationTasks.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const requestHooks = await readFile(
    new URL(
      "../src/features/atms/hooks/useATMLocationRequests.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const page = await readFile(
    new URL("../src/pages/employee/EmployeeLocationTasksPage.tsx", import.meta.url),
    "utf8",
  );
  const app = await readFile(new URL("../src/App.tsx", import.meta.url), "utf8");
  const adminPage = await readFile(
    new URL("../src/pages/admin/ATMLocationTasksPage.tsx", import.meta.url),
    "utf8",
  );
  const i18n = await readFile(
    new URL("../src/features/employee-portal/i18n.tsx", import.meta.url),
    "utf8",
  );

  assert.match(service, /api\.get<.*>\(\s*"\/atm\/location-tasks"/s);
  assert.match(service, /`\/atm\/location-tasks\/\$\{taskId\}\/start`/);
  assert.match(service, /`\/atm\/location-tasks\/\$\{taskId\}\/hold`/);
  assert.match(service, /`\/atm\/location-tasks\/\$\{taskId\}\/resume`/);
  assert.match(service, /"ON_HOLD"/);
  assert.match(hooks, /useStartATMLocationTask/);
  assert.match(hooks, /useHoldATMLocationTask/);
  assert.match(hooks, /useResumeATMLocationTask/);
  assert.match(hooks, /queryKey: atmLocationTaskQueryKeys\.all/);
  assert.match(requestHooks, /queryKey: \["my-atm-location-requests", payload\.atmId\]/);
  assert.match(page, /useQueries\(\{/);
  assert.match(page, /getAllEmployeeTasksForStatus\(status\)/);
  assert.match(page, /getEmployeeLocationTaskTabCounts\(tasks\)/);
  assert.match(page, /getEmployeeLocationTaskTabTasks\(tasks, selectedTab\)/);
  assert.match(page, /role="tablist"/);
  assert.match(page, /role="tab"/);
  assert.match(page, /onTaskStarted=\{showStartedTask\}/);
  assert.match(page, /onTaskResumed=\{showStartedTask\}/);
  assert.doesNotMatch(page, /useATMLocationTasks\(/);
  assert.match(page, /useStartATMLocationTask/);
  assert.match(page, /useHoldATMLocationTask/);
  assert.match(page, /useResumeATMLocationTask/);
  assert.match(page, /canHoldATMLocationTask/);
  assert.match(page, /canResumeATMLocationTask/);
  assert.match(page, /catch \(holdError\)[\s\S]*?toast\.error\(message\)/);
  assert.match(page, /catch \(resumeError\)[\s\S]*?toast\.error\(message\)/);
  assert.match(page, /createATMLocationTaskRequestPayload/);
  assert.match(page, /queryKey: \["my-atm-location-requests", atmId\]/);
  assert.match(page, /catch \(startError\)/);
  assert.match(page, /catch \(submitError\)/);
  assert.match(
    page,
    /const startedTask = await startMutation\.mutateAsync\(task\._id\);\s*if \(canSubmitATMLocationTask\(startedTask\)\) setSubmitted\(false\);/,
  );
  assert.match(page, /await submitMutation\.mutateAsync\(payload\);\s*setSubmitted\(true\);/);
  assert.match(page, /isRefreshing=\{isFetching\}/);
  const submitCatchStart = page.indexOf("} catch (submitError)");
  const submitFinallyStart = page.indexOf("} finally {", submitCatchStart);
  assert.ok(submitCatchStart >= 0 && submitFinallyStart > submitCatchStart);
  assert.doesNotMatch(
    page.slice(submitCatchStart, submitFinallyStart),
    /setSubmitted\(true\)/,
  );
  assert.match(
    page,
    /catch \(submitError\)[\s\S]*?setError\(message\);[\s\S]*?toast\.error\(message\);/,
  );
  assert.match(app, /path="\/employee\/location-tasks"/);
  assert.match(adminPage, /"ON_HOLD"/);
  assert.match(i18n, /"Do Later \/ Hold": "Do Later \/ Hold"/);
  assert.match(i18n, /"Do Later \/ Hold": "பிறகு செய் \/ நிறுத்தி வை"/);
  assert.match(i18n, /"Continue task": "Continue task"/);
  assert.match(i18n, /"Continue task": "பணியைத் தொடரவும்"/);
  assert.match(i18n, /"No tasks in this status\.": "இந்த நிலையில் பணிகள் இல்லை\."/);
});

test("mutation errors expose backend messages and explain conflicts", () => {
  assert.equal(
    getLocationTaskActionErrorMessage({
      response: { status: 409, data: { message: "Task changed" } },
    }),
    "Task changed The task may have changed; the list is being refreshed.",
  );
  assert.equal(
    getLocationTaskActionErrorMessage({
      response: { status: 400, data: { message: "Invalid task" } },
    }),
    "Invalid task",
  );
});

test("bulk conflict detection refreshes for HTTP 409", () => {
  assert.equal(
    shouldRefreshATMLocationTaskInventory({
      isAxiosError: true,
      response: { status: 409, data: { message: "Task conflict" } },
    }),
    true,
  );
});

test("bulk conflict detection recognizes the backend's active-task aggregate HTTP 400", () => {
  assert.equal(
    shouldRefreshATMLocationTaskInventory({
      isAxiosError: true,
      response: {
        status: 400,
        data: {
          message: "Bulk location task validation failed",
          errors: [
            {
              statusCode: 409,
              message: "ATM already has an active location task",
            },
          ],
        },
      },
    }),
    true,
  );
});

test("ordinary bulk HTTP 400 validation errors do not trigger conflict refresh", () => {
  assert.equal(
    shouldRefreshATMLocationTaskInventory({
      isAxiosError: true,
      response: {
        status: 400,
        data: {
          message: "Bulk location task validation failed",
          errors: [{ statusCode: 400, message: "Employee is inactive" }],
        },
      },
    }),
    false,
  );
  assert.equal(
    shouldRefreshATMLocationTaskInventory({
      isAxiosError: true,
      response: {
        status: 400,
        data: { message: "Validation failed", errors: [] },
      },
    }),
    false,
  );
});

test("bulk assignment validation errors communicate that no tasks were created and include per-ATM details", () => {
  assert.equal(
    getBulkATMLocationTaskErrorMessage({
      response: {
        status: 400,
        data: {
          message: "Bulk location task validation failed",
          errors: [
            {
              atmId: "atm-1",
              statusCode: 409,
              message: "ATM already has an active location task",
            },
          ],
        },
      },
    }),
    "No tasks were created. Bulk location task validation failed: ATM atm-1: ATM already has an active location task",
  );
});

test("task service matches the backend contracts and mutations invalidate task and ATM data", async () => {
  const service = await readFile(
    new URL(
      "../src/features/atms/services/atm-location-tasks.service.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const hooks = await readFile(
    new URL(
      "../src/features/atms/hooks/useATMLocationTasks.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const page = await readFile(
    new URL("../src/pages/admin/ATMLocationTasksPage.tsx", import.meta.url),
    "utf8",
  );
  assert.match(service, /"\/atm\/location-tasks\/bulk"/);
  assert.match(service, /"\/atm\/location-tasks"/);
  assert.match(service, /\/reassign/);
  assert.match(service, /\/reopen/);
  assert.match(service, /\/cancel/);
  assert.match(hooks, /queryKey: atmLocationTaskQueryKeys\.all/);
  assert.match(hooks, /queryKey: \["atms"\]/);
  assert.match(page, /const created = await createTasks\.mutateAsync\(payload\);[\s\S]*toast\.success/);
  assert.match(page, /setActionReason\(""\)/);
  assert.match(page, /A reason is required/);
  assert.match(page, /getLocationTaskActionErrorMessage/);
  assert.match(page, /refreshBulkConflictInventory/);
  assert.match(page, /Promise\.allSettled/);
});

test("ATM selection loads the unpaginated inventory so filters do not silently omit later pages", async () => {
  const atmService = await readFile(
    new URL("../src/features/atms/services/atm.service.ts", import.meta.url),
    "utf8",
  );
  const atmController = await readFile(
    new URL(
      "../../backend/src/modules/atms/atm.controller.js",
      import.meta.url,
    ),
    "utf8",
  );
  const unscopedListStart = atmController.indexOf(
    "const atms = await ATM.find({ isDeleted: false })",
  );
  const singleATMStart = atmController.indexOf("// view single atm", unscopedListStart);
  assert.match(atmService, /api\.get\("\/atm\/getAllATMs"\)/);
  assert.ok(unscopedListStart >= 0 && singleATMStart > unscopedListStart);
  assert.doesNotMatch(
    atmController.slice(unscopedListStart, singleATMStart),
    /\.(skip|limit)\(/,
  );
});

test("employee inventory response includes avatar data for the searchable picker", async () => {
  const employeeController = await readFile(
    new URL(
      "../../backend/src/modules/employees/employee.controller.js",
      import.meta.url,
    ),
    "utf8",
  );
  assert.match(
    employeeController,
    /Employee\.find\(\)\.populate\(\s*"userId",\s*"firstName lastName email userType status avatar"/,
  );
});
