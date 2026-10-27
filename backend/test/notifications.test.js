import test from "node:test";
import assert from "node:assert/strict";
import express from "express";
import jwt from "jsonwebtoken";

process.env.JWT_ACCESS_SECRET ??= "notification-test-access-secret";

const [
  { default: notificationRoutes },
  { default: errorMiddleware },
  { default: User },
  { default: Notification },
  { default: AMC },
  { createNotification },
  { markOverdueAMCs },
] = await Promise.all([
  import("../src/modules/notification/notification.routes.js"),
  import("../src/middlewares/error.middleware.js"),
  import("../src/modules/users/user.model.js"),
  import("../src/modules/notification/notification.model.js"),
  import("../src/modules/amc/amc.model.js"),
  import("../src/modules/notification/notification.service.js"),
  import("../src/modules/amc/amc.service.js"),
]);

const ids = {
  userA: "64b000000000000000000201",
  userB: "64b000000000000000000202",
  admin1: "64b000000000000000000203",
  admin2: "64b000000000000000000204",
  employee: "64b000000000000000000205",
  amc: "64b000000000000000000206",
  atm: "64b000000000000000000207",
  note: (n) => `64b0000000000000000003${String(n).padStart(2, "0")}`,
};

const duplicateKeyError = () =>
  Object.assign(new Error("E11000 duplicate key"), { code: 11000 });

const sameId = (a, b) => String(a) === String(b);

// Minimal in-memory stand-in for the Notification collection, including the
// unique indexes the schema declares.
const createStore = (seed = []) => {
  const docs = seed.map((doc, index) => ({
    _id: ids.note(index + 1),
    isRead: false,
    readAt: null,
    createdAt: new Date(Date.UTC(2026, 0, 1, 0, index)),
    ...doc,
  }));
  const calls = { find: [] };

  const matches = (doc, filter) =>
    Object.entries(filter).every(([key, value]) =>
      key === "_id" || key === "userId"
        ? sameId(doc[key], value)
        : doc[key] === value,
    );

  const findQuery = (filter) => {
    let result = docs.filter((doc) => matches(doc, filter));
    const chain = {
      sort() {
        result = [...result].sort(
          (a, b) => b.createdAt - a.createdAt || (a._id < b._id ? 1 : -1),
        );
        return chain;
      },
      skip(value) {
        calls.find.push({ skip: value });
        result = result.slice(value);
        return chain;
      },
      limit(value) {
        calls.find.push({ limit: value });
        result = result.slice(0, value);
        return chain;
      },
      then: (resolve, reject) => Promise.resolve(result).then(resolve, reject),
    };
    return chain;
  };

  const stubs = {
    find: findQuery,
    countDocuments: async (filter) =>
      docs.filter((doc) => matches(doc, filter)).length,
    findOne: async (filter) => docs.find((doc) => matches(doc, filter)) ?? null,
    findOneAndUpdate: async (filter, update) => {
      const doc = docs.find((candidate) => matches(candidate, filter));
      if (!doc) return null;
      Object.assign(doc, update.$set);
      return doc;
    },
    findOneAndDelete: async (filter) => {
      const index = docs.findIndex((doc) => matches(doc, filter));
      return index === -1 ? null : docs.splice(index, 1)[0];
    },
    updateMany: async (filter, update) => {
      docs.filter((doc) => matches(doc, filter)).forEach((doc) => {
        Object.assign(doc, update);
      });
    },
    create: async (input) => {
      if (
        input.dedupeKey &&
        docs.some(
          (doc) =>
            sameId(doc.userId, input.userId) && doc.dedupeKey === input.dedupeKey,
        )
      ) {
        throw duplicateKeyError();
      }
      const doc = {
        _id: ids.note(docs.length + 1),
        isRead: false,
        readAt: null,
        createdAt: new Date(),
        ...input,
      };
      docs.push(doc);
      return doc;
    },
  };

  return { docs, calls, stubs };
};

const withStubs = async (stubsByModel, callback) => {
  const originals = [];
  for (const [model, stubs] of stubsByModel) {
    for (const [key, value] of Object.entries(stubs)) {
      originals.push([model, key, model[key]]);
      model[key] = value;
    }
  }
  try {
    return await callback();
  } finally {
    for (const [model, key, value] of originals.reverse()) model[key] = value;
  }
};

const tokenFor = (userId) =>
  jwt.sign({ id: userId }, process.env.JWT_ACCESS_SECRET, { expiresIn: "5m" });

const userStub = {
  findById: (id) => ({
    select: async () => ({ _id: id, userType: "employee", status: "active" }),
  }),
};

const withApi = async (seed, callback) => {
  const store = createStore(seed);
  const app = express();
  app.use(express.json());
  app.use("/notifications", notificationRoutes);
  app.use(errorMiddleware);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const baseUrl = `http://127.0.0.1:${server.address().port}/notifications`;
  const api = async (path, userId, method = "GET") => {
    const response = await fetch(`${baseUrl}${path}`, {
      method,
      headers: userId ? { Authorization: `Bearer ${tokenFor(userId)}` } : {},
    });
    return { status: response.status, body: await response.json() };
  };

  try {
    await withStubs(
      [
        [User, userStub],
        [Notification, store.stubs],
      ],
      () => callback({ api, store }),
    );
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }
};

const seedForTwoUsers = () => [
  { userId: ids.userA, type: "system", title: "A1", message: "a1" },
  { userId: ids.userA, type: "system", title: "A2", message: "a2", isRead: true },
  { userId: ids.userB, type: "system", title: "B1", message: "b1" },
  { userId: ids.userB, type: "system", title: "B2", message: "b2" },
  { userId: ids.userB, type: "system", title: "B3", message: "b3" },
];

test("unread count requires authentication", async () => {
  await withApi(seedForTwoUsers(), async ({ api }) => {
    const result = await api("/unread-count");
    assert.equal(result.status, 401);
  });
});

test("unread count only counts the authenticated user's unread notifications", async () => {
  await withApi(seedForTwoUsers(), async ({ api }) => {
    const a = await api("/unread-count", ids.userA);
    const b = await api("/unread-count", ids.userB);
    assert.equal(a.status, 200);
    assert.deepEqual(a.body.data, { unreadCount: 1 });
    assert.deepEqual(b.body.data, { unreadCount: 3 });
  });
});

test("unread count ignores a client-supplied user identifier", async () => {
  await withApi(seedForTwoUsers(), async ({ api }) => {
    const result = await api(`/unread-count?userId=${ids.userB}`, ids.userA);
    assert.deepEqual(result.body.data, { unreadCount: 1 });
  });
});

test("history is recipient-scoped, newest first, and keeps its response shape", async () => {
  await withApi(seedForTwoUsers(), async ({ api }) => {
    const result = await api("/", ids.userB);
    assert.equal(result.status, 200);
    const { notifications, total, unreadCount, pagination } = result.body.data;
    assert.deepEqual(
      notifications.map((n) => n.title),
      ["B3", "B2", "B1"],
    );
    assert.equal(total, 3);
    assert.equal(unreadCount, 3);
    assert.deepEqual(pagination, { page: 1, limit: 20, total: 3, totalPages: 1 });
  });
});

test("history applies pagination and the unreadOnly filter", async () => {
  await withApi(seedForTwoUsers(), async ({ api, store }) => {
    const page = await api("/?page=2&limit=2", ids.userB);
    assert.deepEqual(
      page.body.data.notifications.map((n) => n.title),
      ["B1"],
    );
    assert.equal(page.body.data.pagination.totalPages, 2);
    assert.deepEqual(store.calls.find.slice(-2), [{ skip: 2 }, { limit: 2 }]);

    const unread = await api("/?unreadOnly=true", ids.userA);
    assert.deepEqual(
      unread.body.data.notifications.map((n) => n.title),
      ["A1"],
    );
    assert.equal(unread.body.data.total, 1);
  });
});

test("history accepts the documented maximum limit", async () => {
  await withApi(seedForTwoUsers(), async ({ api }) => {
    const result = await api("/?limit=100", ids.userA);
    assert.equal(result.status, 200);
    assert.equal(result.body.data.pagination.limit, 100);
  });
});

test("history rejects invalid pagination parameters", async () => {
  const invalid = [
    "page=0",
    "page=-1",
    "page=abc",
    "page=1.5",
    "page=1e3",
    "page=",
    "limit=0",
    "limit=-5",
    "limit=101",
    "limit=1000000",
    "limit=abc",
    "limit=2.5",
    "unreadOnly=maybe",
    "page=1&page=2",
  ];
  await withApi(seedForTwoUsers(), async ({ api, store }) => {
    for (const query of invalid) {
      const result = await api(`/?${query}`, ids.userA);
      assert.equal(result.status, 400, `expected 400 for ?${query}`);
      assert.equal(result.body.message, "Validation failed");
    }
    assert.deepEqual(store.calls.find, []);
  });
});

test("another user's notification cannot be marked read and is not revealed", async () => {
  await withApi(seedForTwoUsers(), async ({ api, store }) => {
    const foreign = await api(`/${ids.note(3)}/read`, ids.userA, "PUT");
    const missing = await api(`/${ids.note(99)}/read`, ids.userA, "PUT");
    assert.equal(foreign.status, 404);
    assert.deepEqual(foreign.body, missing.body);
    assert.equal(store.docs[2].isRead, false);
    assert.equal(JSON.stringify(foreign.body).includes("b1"), false);
  });
});

test("another user's notification cannot be deleted and is not revealed", async () => {
  await withApi(seedForTwoUsers(), async ({ api, store }) => {
    const foreign = await api(`/${ids.note(3)}`, ids.userA, "DELETE");
    const missing = await api(`/${ids.note(99)}`, ids.userA, "DELETE");
    assert.equal(foreign.status, 404);
    assert.deepEqual(foreign.body, missing.body);
    assert.equal(store.docs.length, 5);

    const own = await api(`/${ids.note(3)}`, ids.userB, "DELETE");
    assert.equal(own.status, 200);
    assert.equal(store.docs.length, 4);
  });
});

test("mark one read updates only the owner's notification and preserves readAt", async () => {
  await withApi(seedForTwoUsers(), async ({ api, store }) => {
    const first = await api(`/${ids.note(1)}/read`, ids.userA, "PUT");
    assert.equal(first.status, 200);
    assert.equal(first.body.data.isRead, true);
    const readAt = store.docs[0].readAt;
    assert.ok(readAt instanceof Date);

    const again = await api(`/${ids.note(1)}/read`, ids.userA, "PUT");
    assert.equal(again.status, 200);
    assert.equal(store.docs[0].readAt, readAt);
  });
});

test("mark all read only affects the authenticated user", async () => {
  await withApi(seedForTwoUsers(), async ({ api }) => {
    const result = await api("/read-all", ids.userB, "PUT");
    assert.equal(result.status, 200);
    assert.deepEqual((await api("/unread-count", ids.userB)).body.data, {
      unreadCount: 0,
    });
    assert.deepEqual((await api("/unread-count", ids.userA)).body.data, {
      unreadCount: 1,
    });
  });
});

test("malformed notification IDs are rejected before querying", async () => {
  await withApi(seedForTwoUsers(), async ({ api }) => {
    assert.equal((await api("/not-an-id/read", ids.userA, "PUT")).status, 400);
    assert.equal((await api("/not-an-id", ids.userA, "DELETE")).status, 400);
  });
});

test("createNotification persists a notification with its dedupe key", async () => {
  const store = createStore();
  await withStubs([[Notification, store.stubs]], async () => {
    const result = await createNotification({
      userId: ids.userA,
      type: "system",
      title: "Hello",
      message: "World",
      dedupeKey: "system:1",
    });
    assert.equal(result.created, true);
    assert.equal(result.duplicate, false);
    assert.equal(store.docs.length, 1);
    assert.equal(store.docs[0].dedupeKey, "system:1");
  });
});

test("createNotification treats a duplicate dedupe key as a no-op for the same recipient only", async () => {
  const store = createStore();
  await withStubs([[Notification, store.stubs]], async () => {
    const input = {
      type: "system",
      title: "Hello",
      message: "World",
      dedupeKey: "system:1",
    };
    assert.equal((await createNotification({ ...input, userId: ids.userA })).created, true);
    const duplicate = await createNotification({ ...input, userId: ids.userA });
    assert.deepEqual(duplicate, { created: false, duplicate: true, notification: null });
    assert.equal((await createNotification({ ...input, userId: ids.userB })).created, true);
    assert.equal(store.docs.length, 2);
  });
});

test("createNotification allows concurrent duplicate writes to resolve to one record", async () => {
  const store = createStore();
  await withStubs([[Notification, store.stubs]], async () => {
    const results = await Promise.all(
      Array.from({ length: 5 }, () =>
        createNotification({
          userId: ids.userA,
          type: "system",
          title: "Hello",
          message: "World",
          dedupeKey: "system:race",
        }),
      ),
    );
    assert.equal(results.filter((r) => r.created).length, 1);
    assert.equal(store.docs.length, 1);
  });
});

test("createNotification rethrows errors that are not duplicates", async () => {
  await withStubs(
    [
      [
        Notification,
        {
          create: async () => {
            throw new Error("connection lost");
          },
        },
      ],
    ],
    async () => {
      await assert.rejects(
        createNotification({
          userId: ids.userA,
          type: "system",
          title: "t",
          message: "m",
        }),
        { message: "connection lost" },
      );
    },
  );
});

test("notification schema declares a partial unique per-recipient dedupe index", () => {
  const index = Notification.schema
    .indexes()
    .find(([fields]) => fields.dedupeKey === 1);
  assert.ok(index, "dedupeKey index is missing");
  assert.deepEqual(index[0], { userId: 1, dedupeKey: 1 });
  assert.equal(index[1].unique, true);
  assert.deepEqual(index[1].partialFilterExpression, {
    dedupeKey: { $type: "string" },
  });
  assert.equal(Notification.schema.path("dedupeKey").options.select, false);
});

const overdueFixture = () => {
  const deadlineDate = new Date("2026-01-01T00:00:00.000Z");
  const amc = {
    _id: ids.amc,
    status: "PENDING",
    deadlineDate,
    month: 1,
    year: 2026,
    isDeleted: false,
    employeeId: { _id: ids.employee, firstName: "Ravi", lastName: "Kumar" },
    atmId: { _id: ids.atm, atmId: "ATM-1", locationName: "Main Branch" },
  };
  const queryFor = (value) => ({
    populate() {
      return this;
    },
    then: (resolve, reject) => Promise.resolve(value).then(resolve, reject),
  });
  return {
    amc,
    amcStubs: {
      find: () => queryFor([amc]),
      findOneAndUpdate: () => {
        amc.status = "OVERDUE";
        return queryFor(amc);
      },
    },
    userStubs: {
      find: async () => [{ _id: ids.admin1 }, { _id: ids.admin2 }],
    },
  };
};

const recipientsOf = (store) =>
  store.docs.map((doc) => String(doc.userId)).sort();

test("overdue notifications are created per recipient even if one recipient already has one", async () => {
  const { amcStubs, userStubs } = overdueFixture();
  const store = createStore([
    {
      userId: ids.admin1,
      type: "amc_overdue",
      title: "AMC Overdue Alert",
      message: "legacy",
      data: { amcId: ids.amc },
    },
  ]);

  await withStubs(
    [
      [AMC, amcStubs],
      [User, userStubs],
      [Notification, store.stubs],
    ],
    async () => {
      const result = await markOverdueAMCs();
      assert.equal(result.marked, 1);
      assert.equal(result.notified, 1);
      assert.equal(result.notificationFailures, 0);
      assert.deepEqual(
        recipientsOf(store),
        [ids.admin1, ids.admin1, ids.admin2, ids.employee].sort(),
      );
    },
  );
});

test("a legacy duplicate-key conflict for one recipient does not stop the others", async () => {
  const { amcStubs, userStubs } = overdueFixture();
  const store = createStore();
  const create = store.stubs.create;
  // Simulates the pre-existing {userId,type,data.amcId} unique index that
  // legacy amc_overdue documents occupy for admin1.
  store.stubs.create = async (input) => {
    if (sameId(input.userId, ids.admin1)) throw duplicateKeyError();
    return create(input);
  };

  await withStubs(
    [
      [AMC, amcStubs],
      [User, userStubs],
      [Notification, store.stubs],
    ],
    async () => {
      const result = await markOverdueAMCs();
      assert.equal(result.marked, 1);
      assert.equal(result.notified, 1);
      assert.equal(result.notificationFailures, 0);
      assert.deepEqual(recipientsOf(store), [ids.admin2, ids.employee].sort());
    },
  );
});

test("re-running overdue processing does not duplicate notifications", async () => {
  const { amcStubs, userStubs } = overdueFixture();
  const store = createStore();

  await withStubs(
    [
      [AMC, amcStubs],
      [User, userStubs],
      [Notification, store.stubs],
    ],
    async () => {
      await markOverdueAMCs();
      const second = await markOverdueAMCs();
      assert.equal(second.notified, 0);
      assert.equal(store.docs.length, 3);
      assert.ok(
        store.docs.every((doc) => doc.dedupeKey === `amc_overdue:${ids.amc}`),
      );
    },
  );
});

test("a non-duplicate failure for one recipient is reported without aborting processing", async () => {
  const { amcStubs, userStubs } = overdueFixture();
  const store = createStore();
  const create = store.stubs.create;
  store.stubs.create = async (input) => {
    if (sameId(input.userId, ids.admin1)) throw new Error("write failed");
    return create(input);
  };
  const originalError = console.error;
  console.error = () => {};

  try {
    await withStubs(
      [
        [AMC, amcStubs],
        [User, userStubs],
        [Notification, store.stubs],
      ],
      async () => {
        const result = await markOverdueAMCs();
        assert.equal(result.marked, 1);
        assert.equal(result.notified, 1);
        assert.equal(result.notificationFailures, 1);
        assert.deepEqual(recipientsOf(store), [ids.admin2, ids.employee].sort());
      },
    );
  } finally {
    console.error = originalError;
  }
});
