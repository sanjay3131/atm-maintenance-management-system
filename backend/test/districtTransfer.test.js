import assert from "node:assert/strict";
import { createServer } from "node:http";
import test from "node:test";
import mongoose from "mongoose";
import AMC from "../src/modules/amc/amc.model.js";
import ATM from "../src/modules/atms/atm.model.js";
import Bank from "../src/modules/banks/bank.model.js";
import District from "../src/modules/districts/district.models.js";
import DistrictTransferAudit from "../src/modules/districts/districtTransferAudit.model.js";
import Employee from "../src/modules/employees/employee.model.js";
import Job from "../src/modules/jobs/jobs.model.js";
import RecurringMaintenancePlan from "../src/modules/jobs/recurringMaintenancePlan.model.js";
import Region from "../src/modules/region/region.model.js";
import User from "../src/modules/users/user.model.js";
import { transferDistrict } from "../src/modules/districts/district.controller.js";
import { resolveDistrictTransferRecipients } from "../src/realtime/recipient-resolver.js";
import { closeSocketServer, initSocketServer } from "../src/realtime/socket.js";

const districtId = "64b000000000000000000001";
const sourceRegionId = "64b000000000000000000002";
const destinationRegionId = "64b000000000000000000003";
const bankId = "64b000000000000000000004";
const userId = "64b000000000000000000005";

function invoke(handler, req) {
  return new Promise((resolve, reject) => {
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
}

async function withOverrides(overrides, callback) {
  const originals = overrides.map(([target, key]) => [target, key, target[key]]);
  for (const [target, key, value] of overrides) target[key] = value;
  try {
    return await callback();
  } finally {
    for (const [target, key, original] of originals) target[key] = original;
  }
}

function makeQuery(getValue, sessions) {
  return {
    select() {
      return this;
    },
    session(session) {
      sessions.push(session);
      return this;
    },
    lean() {
      return Promise.resolve(getValue());
    },
    then(onFulfilled, onRejected) {
      return Promise.resolve(getValue()).then(onFulfilled, onRejected);
    },
  };
}

function createTransactionMocks({
  failATMUpdate = false,
  incompleteATMUpdate = false,
  failDistrictUpdate = false,
  atmMatchedCount,
  duplicateName = false,
  duplicatePin = false,
  destinationBankId = bankId,
  mismatchedATMRegionId,
} = {}) {
  const state = {
    district: {
      _id: districtId,
      bankId,
      regionId: sourceRegionId,
      districtName: "Sample",
      districtNameNormalized: "sample",
      pinCode: "00123",
      pinCodeNormalized: "00123",
      geographyStatus: "MAPPED",
      geographyFence: 0,
    },
    regions: {
      [sourceRegionId]: {
        _id: sourceRegionId,
        bankId,
        name: "Source",
        isActive: true,
        geographyStatus: "MAPPED",
      },
      [destinationRegionId]: {
        _id: destinationRegionId,
        bankId: destinationBankId,
        name: "Destination",
        isActive: true,
        geographyStatus: "MAPPED",
      },
    },
    atms: [
      {
        _id: "64b000000000000000000006",
        atmId: "ATM-001",
        districtId,
        regionId: sourceRegionId,
        bankId,
        geographyStatus: "MAPPED",
        isDeleted: false,
      },
      {
        _id: "64b000000000000000000007",
        atmId: "ATM-002",
        districtId,
        regionId: mismatchedATMRegionId ?? sourceRegionId,
        bankId,
        geographyStatus: "MAPPED",
        isDeleted: false,
      },
    ],
    audits: [],
  };
  const sessions = [];
  const transactionSession = {
    async withTransaction(operation) {
      const before = structuredClone(state);
      try {
        return await operation(this);
      } catch (error) {
        Object.assign(state, before);
        throw error;
      }
    },
    async endSession() {},
  };
  const overrides = [
    [
      mongoose,
      "startSession",
      async () => transactionSession,
    ],
    [
      District,
      "updateOne",
      async (filter, update, options) => {
        sessions.push(options.session);
        if (update.$inc?.geographyFence) {
          state.district.geographyFence += update.$inc.geographyFence;
          return { matchedCount: 1 };
        }
        if (failDistrictUpdate) return { matchedCount: 0 };
        if (
          String(state.district._id) !== String(filter._id) ||
          String(state.district.regionId) !== String(filter.regionId) ||
          state.district.geographyStatus !== filter.geographyStatus
        ) {
          return { matchedCount: 0 };
        }
        Object.assign(state.district, update.$set);
        return { matchedCount: 1 };
      },
    ],
    [
      District,
      "findById",
      () => makeQuery(() => ({ ...state.district }), sessions),
    ],
    [
      District,
      "findOne",
      (filter) =>
        makeQuery(
          () =>
            (filter.districtNameNormalized && duplicateName) ||
            (filter.pinCodeNormalized && duplicatePin)
              ? { _id: "64b000000000000000000099" }
              : null,
          sessions,
        ),
    ],
    [
      Region,
      "findById",
      (id) =>
        makeQuery(
          () => state.regions[String(id)] && { ...state.regions[String(id)] },
          sessions,
        ),
    ],
    [
      Bank,
      "findById",
      (id) =>
        makeQuery(
          () => (String(id) === bankId ? { _id: bankId, isActive: true } : null),
          sessions,
        ),
    ],
    [
      ATM,
      "find",
      (filter) =>
        makeQuery(
          () =>
            state.atms
              .filter(
                (atm) =>
                  String(atm.districtId) === String(filter.districtId) &&
                  atm.isDeleted === filter.isDeleted,
              )
              .map((atm) => ({ ...atm })),
          sessions,
        ),
    ],
    [
      ATM,
      "updateMany",
      async (filter, update, options) => {
        sessions.push(options.session);
        const affected = state.atms.filter(
          (atm) =>
            String(atm.districtId) === String(filter.districtId) &&
            atm.isDeleted === filter.isDeleted,
        );
        const updated = incompleteATMUpdate ? affected.slice(0, 1) : affected;
        for (const atm of updated) Object.assign(atm, update.$set);
        if (failATMUpdate) throw new Error("Injected ATM update failure");
        return { matchedCount: atmMatchedCount ?? affected.length };
      },
    ],
    [Job, "find", () => makeQuery(() => [], sessions)],
    [AMC, "find", () => makeQuery(() => [], sessions)],
    [
      RecurringMaintenancePlan,
      "find",
      () => makeQuery(() => [], sessions),
    ],
    [
      DistrictTransferAudit,
      "create",
      async ([audit], options) => {
        sessions.push(options.session);
        const created = { ...audit, _id: "audit-001" };
        state.audits.push(created);
        return [created];
      },
    ],
    [User, "find", () => makeQuery(() => [], sessions)],
  ];

  return { state, sessions, transactionSession, overrides };
}

function createDistrictRecipientMocks() {
  const ids = {
    admin: "64b000000000000000000101",
    superAdmin: "64b000000000000000000102",
    employeeA: "64b000000000000000000103",
    employeeB: "64b000000000000000000104",
    employeeInactive: "64b000000000000000000105",
    employeeWithInactiveUser: "64b000000000000000000106",
    employeeOutsideDistrict: "64b000000000000000000107",
    employeeDeletedATM: "64b000000000000000000114",
    inactiveAdmin: "64b000000000000000000115",
    inactiveSuperAdmin: "64b000000000000000000116",
    userA: "64b000000000000000000108",
    userB: "64b000000000000000000109",
    inactiveEmployeeUser: "64b000000000000000000110",
    inactiveUser: "64b000000000000000000111",
    activeSupervisor: "64b000000000000000000112",
    inactiveSupervisor: "64b000000000000000000113",
  };
  const calls = { employeeFilters: [], userFilters: [] };
  const affectedATMs = [
    {
      districtId,
      isDeleted: false,
      assignedEmployeeId: [
        ids.employeeA,
        ids.employeeB,
        ids.employeeInactive,
        ids.employeeWithInactiveUser,
      ],
    },
    { districtId, isDeleted: false, assignedEmployeeId: [ids.employeeA] },
    {
      districtId: "64b000000000000000000099",
      isDeleted: false,
      assignedEmployeeId: [ids.employeeOutsideDistrict],
    },
    {
      districtId,
      isDeleted: true,
      assignedEmployeeId: [ids.employeeDeletedATM],
    },
  ];
  const employees = [
    {
      _id: ids.employeeA,
      userId: ids.userA,
      supervisorId: ids.activeSupervisor,
      status: "active",
    },
    {
      _id: ids.employeeB,
      userId: ids.userB,
      supervisorId: ids.activeSupervisor,
      status: "active",
    },
    {
      _id: ids.employeeInactive,
      userId: ids.inactiveEmployeeUser,
      status: "inactive",
    },
    {
      _id: ids.employeeWithInactiveUser,
      userId: ids.inactiveUser,
      supervisorId: ids.inactiveSupervisor,
      status: "active",
    },
  ];
  const users = [
    { _id: ids.admin, userType: "admin", status: "active" },
    { _id: ids.superAdmin, userType: "superAdmin", status: "active" },
    { _id: ids.inactiveAdmin, userType: "admin", status: "inactive" },
    {
      _id: ids.inactiveSuperAdmin,
      userType: "superAdmin",
      status: "inactive",
    },
    { _id: ids.userA, status: "active" },
    { _id: ids.userB, status: "active" },
    { _id: ids.inactiveEmployeeUser, status: "active" },
    { _id: ids.inactiveUser, status: "inactive" },
    { _id: ids.activeSupervisor, status: "active" },
    { _id: ids.inactiveSupervisor, status: "inactive" },
  ];
  const overrides = [
    [
      ATM,
      "find",
      (filter) => {
        assert.deepEqual(filter, { districtId, isDeleted: false });
        return makeQuery(
          () =>
            affectedATMs.filter(
              (atm) =>
                String(atm.districtId) === String(filter.districtId) &&
                atm.isDeleted === filter.isDeleted,
            ),
          [],
        );
      },
    ],
    [
      Employee,
      "find",
      (filter) => {
        calls.employeeFilters.push(filter);
        const assignedIds = filter.$or[0]._id.$in.map(String);
        return makeQuery(
          () =>
            employees.filter(
              (employee) =>
                assignedIds.includes(String(employee._id)) &&
                employee.status === filter.status,
            ),
          [],
        );
      },
    ],
    [
      User,
      "find",
      (filter) => {
        calls.userFilters.push(filter);
        if (filter.userType) {
          return makeQuery(
            () =>
              users.filter(
                (user) =>
                  ["admin", "superAdmin"].includes(user.userType) &&
                  user.status === filter.status,
              ),
            [],
          );
        }
        const candidateIds = filter._id.$in.map(String);
        return makeQuery(
          () =>
            users.filter(
              (user) =>
                candidateIds.includes(String(user._id)) &&
                user.status === filter.status,
            ),
          [],
        );
      },
    ],
  ];

  return { ids, calls, overrides };
}

const request = {
  params: { id: districtId },
  body: { regionId: destinationRegionId, reason: "Operational realignment" },
  user: { _id: userId },
};

test("district transfer atomically updates the parent, ATMs, and audit", async () => {
  const { state, sessions, transactionSession, overrides } =
    createTransactionMocks();

  await withOverrides(overrides, async () => {
    const response = await invoke(transferDistrict, request);

    assert.equal(response.status, 200);
    assert.equal(response.body.data._id, "audit-001");
    assert.equal(response.body.data.affectedATMCount, state.atms.length);
    assert.equal(state.district.regionId, destinationRegionId);
    assert.ok(
      state.atms.every(
        (atm) =>
          atm.regionId === destinationRegionId &&
          atm.bankId === bankId,
      ),
    );
    assert.equal(state.audits.length, 1);
    assert.equal(state.audits[0].fromRegionId, sourceRegionId);
    assert.equal(state.audits[0].toRegionId, destinationRegionId);
    assert.ok(
      sessions.length > 0 && sessions.every((session) => session === transactionSession),
      "all transactional reads and writes must use the fence transaction session",
    );
  });
});

test("district transfer publishes its event after the transaction commits", async () => {
  const { state, overrides } = createTransactionMocks();
  const io = initSocketServer(createServer());
  const emittedEvents = [];
  io.to = (room) => ({
    emit: (event, payload) => {
      emittedEvents.push({
        room,
        event,
        payload,
        stateAtEmission: structuredClone(state),
      });
    },
  });
  const activeAdminId = "64b000000000000000000120";
  const userFind = () =>
    makeQuery(() => [{ _id: activeAdminId, status: "active" }], []);

  try {
    await withOverrides([...overrides, [User, "find", userFind]], async () => {
      const response = await invoke(transferDistrict, request);

      assert.equal(response.status, 200);
      assert.equal(emittedEvents.length, 1);
      const [emitted] = emittedEvents;
      assert.equal(emitted.event, "domain:district:transferred");
      assert.equal(emitted.room, `user:${activeAdminId}`);
      assert.equal(emitted.payload.entityType, "district");
      assert.equal(emitted.payload.entityId, districtId);
      assert.equal(emitted.payload.action, "transferred");
      assert.deepEqual(emitted.payload.data, {
        transferId: "audit-001",
        fromRegionId: sourceRegionId,
        toRegionId: destinationRegionId,
        affectedATMCount: state.atms.length,
      });

      assert.equal(emitted.stateAtEmission.district.regionId, destinationRegionId);
      assert.ok(
        emitted.stateAtEmission.atms.every(
          (atm) =>
            atm.regionId === destinationRegionId &&
            atm.bankId === bankId,
        ),
      );
      assert.equal(emitted.stateAtEmission.audits.length, 1);
      assert.equal(emitted.stateAtEmission.audits[0]._id, "audit-001");
      assert.equal(
        emitted.stateAtEmission.audits[0].toRegionId,
        destinationRegionId,
      );
    });
  } finally {
    await closeSocketServer();
  }
});

test("district transfer rolls back the parent, ATM updates, and audit on update failure", async () => {
  const { state, overrides } = createTransactionMocks({ failATMUpdate: true });
  const io = initSocketServer(createServer());
  const emittedEvents = [];
  io.to = (room) => ({
    emit: (event, payload) => emittedEvents.push({ room, event, payload }),
  });
  const activeAdminId = "64b000000000000000000120";
  const userFind = () =>
    makeQuery(() => [{ _id: activeAdminId, status: "active" }], []);

  try {
    await withOverrides([...overrides, [User, "find", userFind]], async () => {
      await assert.rejects(
        invoke(transferDistrict, request),
        /Injected ATM update failure/,
      );
    });

    assert.deepEqual(emittedEvents, []);
    assert.equal(state.district.regionId, sourceRegionId);
    assert.ok(state.atms.every((atm) => atm.regionId === sourceRegionId));
    assert.equal(state.audits.length, 0);
  } finally {
    await closeSocketServer();
  }
});

test("district transfer rolls back when any affected ATM has the wrong source Region", async () => {
  const mismatchedRegionId = "64b000000000000000000008";
  const { state, overrides } = createTransactionMocks({
    mismatchedATMRegionId: mismatchedRegionId,
  });
  const io = initSocketServer(createServer());
  const emittedEvents = [];
  io.to = (room) => ({
    emit: (event, payload) => emittedEvents.push({ room, event, payload }),
  });
  const activeAdminId = "64b000000000000000000120";
  const userFind = () =>
    makeQuery(() => [{ _id: activeAdminId, status: "active" }], []);

  try {
    await withOverrides([...overrides, [User, "find", userFind]], async () => {
      await assert.rejects(
        invoke(transferDistrict, request),
        /ATM ATM-002 does not match the district's source geography/,
      );
    });

    assert.deepEqual(emittedEvents, []);
    assert.equal(state.district.regionId, sourceRegionId);
    assert.deepEqual(
      state.atms.map((atm) => atm.regionId),
      [sourceRegionId, mismatchedRegionId],
    );
    assert.equal(state.audits.length, 0);
  } finally {
    await closeSocketServer();
  }
});

test("district transfer rolls back when post-update ATM verification fails", async () => {
  const { state, overrides } = createTransactionMocks({
    incompleteATMUpdate: true,
  });

  await withOverrides(overrides, async () => {
    await assert.rejects(
      invoke(transferDistrict, request),
      /ATM geography verification failed/,
    );
  });

  assert.equal(state.district.regionId, sourceRegionId);
  assert.ok(state.atms.every((atm) => atm.regionId === sourceRegionId));
  assert.equal(state.audits.length, 0);
});

test("district transfer rolls back when the conditional District update matches nothing", async () => {
  const { state, overrides } = createTransactionMocks({
    failDistrictUpdate: true,
  });

  await withOverrides(overrides, async () => {
    await assert.rejects(
      invoke(transferDistrict, request),
      /District parent region changed during transfer/,
    );
  });

  assert.equal(state.district.regionId, sourceRegionId);
  assert.ok(state.atms.every((atm) => atm.regionId === sourceRegionId));
  assert.equal(state.audits.length, 0);
});

test("district transfer rolls back when the ATM update matched count is too low", async () => {
  const { state, overrides } = createTransactionMocks({ atmMatchedCount: 1 });

  await withOverrides(overrides, async () => {
    await assert.rejects(
      invoke(transferDistrict, request),
      /affected ATM set changed during transfer/,
    );
  });

  assert.equal(state.district.regionId, sourceRegionId);
  assert.ok(state.atms.every((atm) => atm.regionId === sourceRegionId));
  assert.equal(state.audits.length, 0);
});

test("district transfer blocks a duplicate Bank-wide normalized name before any writes", async () => {
  const { state, overrides } = createTransactionMocks({ duplicateName: true });

  await withOverrides(overrides, async () => {
    await assert.rejects(
      invoke(transferDistrict, request),
      /District name already exists in this bank/,
    );
  });

  assert.equal(state.district.regionId, sourceRegionId);
  assert.ok(state.atms.every((atm) => atm.regionId === sourceRegionId));
  assert.equal(state.audits.length, 0);
});

test("district transfer continues to reject cross-Bank destinations", async () => {
  const { state, overrides } = createTransactionMocks({
    destinationBankId: "64b000000000000000000099",
  });
  await withOverrides(overrides, async () => {
    await assert.rejects(
      invoke(transferDistrict, request),
      /A district can only be transferred within the same bank/,
    );
  });
  assert.equal(state.district.regionId, sourceRegionId);
  assert.ok(state.atms.every((atm) => atm.regionId === sourceRegionId));
  assert.equal(state.audits.length, 0);
});

test("district transfer publishes no event when a Bank-wide duplicate blocks it", async () => {
  const { state, overrides } = createTransactionMocks({ duplicatePin: true });
  const io = initSocketServer(createServer());
  const emittedEvents = [];
  io.to = (room) => ({
    emit: (event, payload) => emittedEvents.push({ room, event, payload }),
  });

  try {
    await withOverrides(overrides, async () => {
      await assert.rejects(
        invoke(transferDistrict, request),
        /District PIN code already exists in this bank/,
      );
    });
    assert.deepEqual(emittedEvents, []);
    assert.equal(state.audits.length, 0);
  } finally {
    await closeSocketServer();
  }
});

test("district transfer blocks a duplicate Bank-wide normalized PIN before any writes", async () => {
  const { state, overrides } = createTransactionMocks({ duplicatePin: true });

  await withOverrides(overrides, async () => {
    await assert.rejects(
      invoke(transferDistrict, request),
      /District PIN code already exists in this bank/,
    );
  });

  assert.equal(state.district.regionId, sourceRegionId);
  assert.ok(state.atms.every((atm) => atm.regionId === sourceRegionId));
  assert.equal(state.audits.length, 0);
});

test("district transfer recipients include active admins, assigned employees, and supervisors once", async () => {
  const { ids, overrides } = createDistrictRecipientMocks();

  await withOverrides(overrides, async () => {
    const recipients = await resolveDistrictTransferRecipients(districtId);

    assert.deepEqual(
      recipients.sort(),
      [
        ids.admin,
        ids.superAdmin,
        ids.userA,
        ids.userB,
        ids.activeSupervisor,
      ].sort(),
    );
    assert.equal(new Set(recipients).size, recipients.length);
  });
});

test("district transfer recipients exclude inactive users and employees outside the district", async () => {
  const { ids, calls, overrides } = createDistrictRecipientMocks();

  await withOverrides(overrides, async () => {
    const recipients = await resolveDistrictTransferRecipients(districtId);

    assert.ok(!recipients.includes(ids.inactiveEmployeeUser));
    assert.ok(!recipients.includes(ids.inactiveUser));
    assert.ok(!recipients.includes(ids.inactiveSupervisor));
    assert.ok(!recipients.includes(ids.employeeOutsideDistrict));
    assert.ok(!recipients.includes(ids.employeeDeletedATM));
    assert.ok(!recipients.includes(ids.inactiveAdmin));
    assert.ok(!recipients.includes(ids.inactiveSuperAdmin));
    assert.ok(
      calls.employeeFilters.every((filter) => filter.status === "active"),
    );
    assert.ok(
      calls.userFilters.every((filter) => filter.status === "active"),
    );
    assert.ok(
      calls.employeeFilters.every(
        (filter) =>
          !filter.$or[0]._id.$in
            .map(String)
            .some(
              (employeeId) =>
                employeeId === ids.employeeOutsideDistrict ||
                employeeId === ids.employeeDeletedATM,
            ),
      ),
    );
  });
});
