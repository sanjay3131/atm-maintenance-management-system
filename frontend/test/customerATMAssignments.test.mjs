import test from "node:test";
import assert from "node:assert/strict";
import {
  addATMIds,
  areAllVisibleATMsSelected,
  filterEligibleATMs,
  getATMFilterOptions,
  getATMReferenceId,
  getATMReferenceName,
  getEligibleAvailableATMs,
  getValidAvailableATMs,
  getValidCustomerATMs,
  removeVisibleATMIds,
} from "../src/features/customers/utils/customerATMAssignments.ts";

const atm = (overrides = {}) => ({
  _id: "atm-1",
  atmId: "ATM-001",
  locationName: "Downtown Branch",
  address: "Central District",
  status: "ACTIVE",
  bankId: { _id: "bank-1", bankName: "Example Bank" },
  districtId: { _id: "district-1", districtName: "North" },
  regionId: { _id: "region-1", name: "Coastal" },
  ...overrides,
});

test("customer ATM list ignores null references while retaining valid assignments", () => {
  const assignedATMs = getValidCustomerATMs([
    null,
    {
      _id: "atm-valid",
      atmId: "ATM-001",
      bankId: { _id: "bank-1", bankName: "Example Bank" },
    },
    {
      _id: "atm-valid-2",
      atmId: "ATM-002",
      bankId: null,
      districtId: null,
      regionId: null,
    },
  ]);

  assert.deepEqual(
    assignedATMs.map(({ _id }) => _id),
    ["atm-valid", "atm-valid-2"],
  );
  assert.equal(getATMReferenceName(assignedATMs[1].bankId), undefined);
  assert.equal(getATMReferenceName(assignedATMs[1].districtId), undefined);
  assert.equal(getATMReferenceName(assignedATMs[1].regionId), undefined);
  assert.equal(getATMReferenceId(null), undefined);
});

test("available ATM filtering ignores null entries and keeps unassigned valid ATMs", () => {
  const availableATMs = getValidAvailableATMs(
    [
      null,
      {
        _id: "atm-assigned",
        atmId: "ATM-001",
      },
      {
        _id: "atm-available",
        atmId: "ATM-002",
        bankId: null,
        districtId: null,
        regionId: null,
      },
    ],
    new Set(["atm-assigned"]),
  );

  assert.deepEqual(
    availableATMs.map(({ _id }) => _id),
    ["atm-available"],
  );
});

test("ATM search is trimmed, case-insensitive, and searches code, location, and geography", () => {
  const atms = [
    atm(),
    atm({
      _id: "atm-2",
      atmId: "CODE-002",
      locationName: "Airport",
      bankId: { _id: "bank-2", bankName: "Metro Bank" },
      districtId: { _id: "district-2", districtName: "South" },
      regionId: { _id: "region-2", name: "Highland" },
    }),
  ];

  assert.deepEqual(
    filterEligibleATMs(atms, {
      search: "  code-002 ",
      bankId: "",
      districtId: "",
      regionId: "",
    }).map(({ _id }) => _id),
    ["atm-2"],
  );
  assert.deepEqual(
    filterEligibleATMs(atms, {
      search: "  METRO BANK ",
      bankId: "",
      districtId: "",
      regionId: "",
    }).map(({ _id }) => _id),
    ["atm-2"],
  );
  assert.deepEqual(
    filterEligibleATMs(atms, {
      search: "highland",
      bankId: "",
      districtId: "",
      regionId: "",
    }).map(({ _id }) => _id),
    ["atm-2"],
  );
});

test("bank, district, and region filters combine with each other and search", () => {
  const atms = [
    atm(),
    atm({
      _id: "atm-2",
      atmId: "ATM-002",
      bankId: { _id: "bank-1", bankName: "Example Bank" },
      districtId: { _id: "district-2", districtName: "South" },
      regionId: { _id: "region-2", name: "Highland" },
    }),
    atm({
      _id: "atm-3",
      atmId: "ATM-003",
      bankId: { _id: "bank-2", bankName: "Metro Bank" },
    }),
  ];

  assert.deepEqual(
    filterEligibleATMs(atms, {
      search: " ATM-002 ",
      bankId: "bank-1",
      districtId: "district-2",
      regionId: "region-2",
    }).map(({ _id }) => _id),
    ["atm-2"],
  );
  assert.deepEqual(
    filterEligibleATMs(atms, {
      search: "",
      bankId: "bank-1",
      districtId: "district-1",
      regionId: "region-2",
    }),
    [],
  );
});

test("ATM filter options are derived from referenced available ATM data", () => {
  const options = getATMFilterOptions(
    [
      atm(),
      atm({ _id: "atm-2", bankId: { _id: "bank-1", bankName: "Example Bank" } }),
      atm({ _id: "atm-3", bankId: null, districtId: null, regionId: null }),
    ],
    "bankId",
  );

  assert.deepEqual(options, [{ id: "bank-1", label: "Example Bank" }]);
});

test("eligibility excludes inactive, removed, bank-mismatched, and district-mismatched ATMs", () => {
  const eligible = getEligibleAvailableATMs(
    [
      atm(),
      atm({ _id: "inactive", status: "INACTIVE" }),
      atm({ _id: "removed", status: "REMOVED" }),
      atm({
        _id: "wrong-bank",
        bankId: { _id: "bank-2", bankName: "Metro Bank" },
      }),
      atm({
        _id: "wrong-district",
        districtId: { _id: "district-2", districtName: "South" },
      }),
      atm({ _id: "missing-bank", bankId: null }),
    ],
    new Set(),
    "bank-1",
    ["district-1"],
  );

  assert.deepEqual(eligible.map(({ _id }) => _id), ["atm-1"]);
  assert.deepEqual(
    getEligibleAvailableATMs([atm()], new Set(), undefined, []),
    [],
  );
});

test("select all adds only matching visible ATMs and keeps hidden selections", () => {
  const hidden = atm({ _id: "atm-hidden" });
  const visible = atm({ _id: "atm-visible" });
  const selected = addATMIds(["atm-hidden"], [visible, visible]);

  assert.deepEqual(selected, ["atm-hidden", "atm-visible"]);
  assert.equal(areAllVisibleATMsSelected(selected, [visible]), true);
  assert.equal(areAllVisibleATMsSelected(selected, []), false);
});

test("clear visible selection retains selections hidden by current filters", () => {
  const hidden = atm({ _id: "atm-hidden" });
  const visible = atm({ _id: "atm-visible" });

  assert.deepEqual(
    removeVisibleATMIds(
      ["atm-hidden", "atm-visible", "ATM-VISIBLE"],
      [visible],
    ),
    ["atm-hidden"],
  );
  assert.deepEqual(addATMIds(["atm-visible"], [visible]), ["atm-visible"]);
  assert.deepEqual(
    getValidAvailableATMs(
      [visible, atm({ _id: "ATM-VISIBLE" })],
      new Set(),
    ).map(({ _id }) => _id),
    ["atm-visible"],
  );
  assert.equal(hidden._id, "atm-hidden");
});
