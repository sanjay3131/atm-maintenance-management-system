import test from "node:test";
import assert from "node:assert/strict";
import mongoose from "mongoose";
import { classifyATMDataIntegrity } from "../src/modules/atms/atmDataIntegrityAudit.js";

const id = (value) => new mongoose.Types.ObjectId(value.toString().padStart(24, "0"));
const record = (value, fields = {}) => ({ _id: id(value), ...fields });

const emptyInput = () => ({
  atms: [],
  districts: [],
  regions: [],
  employees: [],
  customers: [],
  jobs: [],
  amcs: [],
  recurringPlans: [],
});

test("classifies missing, malformed, dangling, and inconsistent geography", () => {
  const input = emptyInput();
  const district = record(1);
  const otherDistrict = record(2);
  const activeRegion = record(3, { districtId: district._id, isActive: true });
  const inactiveRegion = record(4, { districtId: otherDistrict._id, isActive: false });
  input.districts.push(district, otherDistrict);
  input.regions.push(activeRegion, inactiveRegion);
  input.atms.push(
    record(5, { districtId: district._id, regionId: activeRegion._id }),
    record(6, { districtId: district._id, regionId: inactiveRegion._id }),
    record(7, { districtId: "invalid-id", regionId: null }),
    record(8, { districtId: id(9), regionId: id(10) }),
    record(11, { districtId: district._id, regionId: null }),
    record(12, { districtId: otherDistrict._id, regionId: inactiveRegion._id }),
    record(13, { districtId: district._id, regionId: "invalid-region-id" }),
    record(14, { regionId: null }),
  );

  const { issues } = classifyATMDataIntegrity(input);
  const counts = Object.fromEntries(issues.map(({ category, count }) => [category, count]));
  assert.equal(counts.atm_district_missing, 1);
  assert.equal(counts.atm_district_malformed, 1);
  assert.equal(counts.atm_district_dangling, 1);
  assert.equal(counts.atm_region_malformed, 1);
  assert.equal(counts.atm_region_dangling, 1);
  assert.equal(counts.atm_region_inactive, 2);
  assert.equal(counts.atm_region_district_mismatch, 1);
  assert.equal(counts.atm_has_no_region_but_district_has_active_regions, 1);
  assert.equal(counts.atm_has_region_but_district_has_no_active_regions, 1);
});

test("classifies one-sided, duplicate, multiple, and dangling employee assignments", () => {
  const input = emptyInput();
  const employee = record(1, {
    assignedAtmIds: [id(2), id(2), id(5), id(99)],
  });
  input.employees.push(employee);
  input.atms.push(
    record(2, { assignedEmployeeId: [employee._id, employee._id] }),
    record(3, { assignedEmployeeId: [employee._id, id(4)] }),
    record(5, { assignedEmployeeId: [] }),
  );

  const { issues } = classifyATMDataIntegrity(input);
  const counts = Object.fromEntries(issues.map(({ category, count }) => [category, count]));
  assert.equal(counts.atm_has_multiple_employee_assignments, 1);
  assert.equal(counts.atm_has_duplicate_employee_refs, 1);
  assert.equal(counts.atm_employee_missing_reciprocal, 1);
  assert.equal(counts.atm_employee_ref_dangling, 1);
  assert.equal(counts.employee_has_duplicate_atm_refs, 1);
  assert.equal(counts.employee_atm_missing_reciprocal, 1);
  assert.equal(counts.employee_atm_ref_dangling, 1);
});

test("marks Customer reciprocal discrepancies for review and catches dangling operational ATM refs", () => {
  const input = emptyInput();
  const customer = record(1, { atmIds: [id(2), id(99)] });
  const otherCustomer = record(3, { atmIds: [] });
  customer.atmIds.push(id(7));
  input.customers.push(customer, otherCustomer);
  input.atms.push(
    record(2, { customer: customer._id }),
    record(7, { customer: otherCustomer._id }),
  );
  input.jobs.push(record(4, { atmId: id(99) }));
  input.amcs.push(record(5, { atmId: "malformed" }));
  input.recurringPlans.push(record(6, { atmId: null }));

  const { issues } = classifyATMDataIntegrity(input);
  const byCategory = Object.fromEntries(
    issues.map((issue) => [issue.category, issue]),
  );
  assert.equal(
    byCategory.atm_customer_reciprocal_missing_review.certainty,
    "manual-review",
  );
  assert.equal(
    byCategory.customer_atm_ref_dangling.certainty,
    "definite",
  );
  assert.equal(
    byCategory.customer_atm_reciprocal_mismatch_review.certainty,
    "manual-review",
  );
  assert.equal(byCategory.job_atm_ref_dangling.count, 1);
  assert.equal(byCategory.amc_atm_ref_malformed.count, 1);
  assert.equal(byCategory.recurring_plan_atm_ref_missing.count, 1);
});
