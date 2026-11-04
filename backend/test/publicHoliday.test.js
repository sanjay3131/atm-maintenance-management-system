import test from "node:test";
import assert from "node:assert/strict";
import PublicHoliday from "../src/modules/holidays/publicHoliday.model.js";
import {
  createPublicHoliday,
  deletePublicHoliday,
  listPublicHolidays,
  updatePublicHoliday,
} from "../src/modules/holidays/publicHoliday.service.js";
import {
  createPublicHolidaySchema,
  publicHolidayListQuerySchema,
  updatePublicHolidaySchema,
} from "../src/modules/holidays/publicHoliday.validation.js";

const admin = { _id: "64b000000000000000000001", userType: "admin" };
const superAdmin = { _id: "64b000000000000000000002", userType: "superAdmin" };
const holidayId = "64b000000000000000000003";

const withOverrides = async (overrides, callback) => {
  const originals = overrides.map(([target, key]) => [target, key, target[key]]);
  for (const [target, key, replacement] of overrides) {
    target[key] = replacement;
  }
  try {
    await callback();
  } finally {
    for (const [target, key, original] of originals.reverse()) {
      target[key] = original;
    }
  }
};

test("public holiday validation accepts calendar dates and rejects invalid ranges", () => {
  assert.equal(
    createPublicHolidaySchema.safeParse({
      date: "2024-02-29",
      name: "Founder's Day",
    }).success,
    true,
  );
  for (const date of ["2025-02-29", "2025-13-01", "2025-1-01"]) {
    assert.equal(
      createPublicHolidaySchema.safeParse({ date, name: "Holiday" }).success,
      false,
    );
  }
  assert.equal(
    publicHolidayListQuerySchema.safeParse({
      fromDate: "2025-02-02",
      toDate: "2025-02-01",
    }).success,
    false,
  );
  assert.equal(
    publicHolidayListQuerySchema.safeParse({
      fromDate: "2025-02-01",
      toDate: "2025-02-28",
      page: "2",
      limit: "50",
    }).data.page,
    2,
  );
  assert.equal(updatePublicHolidaySchema.safeParse({}).success, false);
});

test("public holiday model declares a unique business-date index", () => {
  assert.deepEqual(
    PublicHoliday.schema.indexes().find(([keys]) => keys.date === 1),
    [{ date: 1 }, { name: "public_holiday_date_unique", unique: true }],
  );
});

test("admin and superAdmin can create, update, list, and delete holidays", async () => {
  const created = {
    date: "2025-01-01",
    name: "New Year",
    description: "",
    createdBy: admin._id,
    updatedBy: admin._id,
  };
  const saved = {
    _id: holidayId,
    ...created,
    async save() {
      this.saved = true;
      return this;
    },
  };
  const listed = [saved];
  const findQuery = {
    sort(sort) {
      assert.deepEqual(sort, { date: 1, _id: 1 });
      return this;
    },
    skip(skip) {
      assert.equal(skip, 0);
      return this;
    },
    async limit(limit) {
      assert.equal(limit, 20);
      return listed;
    },
  };
  const overrides = [
    [
      PublicHoliday,
      "create",
      async (values) => {
        assert.deepEqual(values, created);
        return saved;
      },
    ],
    [PublicHoliday, "findOne", async () => null],
    [PublicHoliday, "find", (filter) => {
      assert.deepEqual(filter, { date: { $gte: "2025-01-01", $lte: "2025-12-31" } });
      return findQuery;
    }],
    [PublicHoliday, "countDocuments", async () => 1],
    [PublicHoliday, "findById", async () => saved],
    [
      PublicHoliday,
      "findByIdAndDelete",
      async () => ({ _id: holidayId, date: "2025-01-01" }),
    ],
  ];

  await withOverrides(overrides, async () => {
    const result = await createPublicHoliday(admin, {
      date: "2025-01-01",
      name: "New Year",
    });
    assert.equal(result, saved);
    assert.equal(result.createdBy, admin._id);
    assert.equal(result.updatedBy, admin._id);

    const updated = await updatePublicHoliday(superAdmin, holidayId, {
      name: "Updated holiday",
    });
    assert.equal(updated.name, "Updated holiday");
    assert.equal(updated.updatedBy, superAdmin._id);
    assert.equal(updated.saved, true);

    const list = await listPublicHolidays(admin, {
      fromDate: "2025-01-01",
      toDate: "2025-12-31",
      page: 1,
      limit: 20,
    });
    assert.equal(list.holidays.length, 1);
    assert.deepEqual(list.pagination, {
      page: 1,
      limit: 20,
      total: 1,
      totalPages: 1,
    });

    assert.deepEqual(await deletePublicHoliday(admin, holidayId), {
      id: holidayId,
      date: "2025-01-01",
    });
  });
});

test("duplicate holiday dates return a conflict for create and update", async () => {
  const duplicateError = Object.assign(new Error("duplicate"), { code: 11000 });
  const holiday = {
    async save() {
      throw duplicateError;
    },
  };
  await withOverrides(
    [
      [PublicHoliday, "create", async () => {
        throw duplicateError;
      }],
      [PublicHoliday, "findOne", async () => null],
      [PublicHoliday, "findById", async () => holiday],
    ],
    async () => {
      await assert.rejects(
        createPublicHoliday(admin, { date: "2025-01-01", name: "Holiday" }),
        { statusCode: 409 },
      );
      await assert.rejects(
        updatePublicHoliday(admin, holidayId, { date: "2025-01-01" }),
        { statusCode: 409 },
      );
    },
  );
});

test("duplicate dates are rejected before writes when already present", async () => {
  const overrides = [
    [PublicHoliday, "findOne", async () => ({ _id: holidayId })],
    [PublicHoliday, "create", async () => assert.fail("Should not create")],
  ];
  await withOverrides(overrides, async () => {
    await assert.rejects(
      createPublicHoliday(admin, { date: "2025-01-01", name: "Holiday" }),
      { statusCode: 409 },
    );
  });
});

test("holiday operations reject non-admin roles and missing records", async () => {
  let modelCalled = false;
  await withOverrides(
    [
      [PublicHoliday, "find", () => {
        modelCalled = true;
      }],
      [PublicHoliday, "findById", async () => null],
      [PublicHoliday, "findByIdAndDelete", async () => null],
    ],
    async () => {
      await assert.rejects(
        listPublicHolidays(
          { _id: "64b000000000000000000004", userType: "supervisor" },
          { page: 1, limit: 20 },
        ),
        { statusCode: 403 },
      );
      assert.equal(modelCalled, false);
      await assert.rejects(
        updatePublicHoliday(admin, holidayId, { name: "Holiday" }),
        { statusCode: 404 },
      );
      await assert.rejects(deletePublicHoliday(admin, holidayId), {
        statusCode: 404,
      });
    },
  );
});
