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
  users: [],
  customers: [],
  jobs: [],
  amcs: [],
  recurringPlans: [],
});

test("valid AMC responsibility belongs to an assigned active eligible Employee", () => {
  const input = emptyInput();
  const atm = record(1);
  const user = record(2, { status: "active", userType: "employee" });
  const employeeA = record(3, {
    userId: user._id,
    status: "active",
    assignedAtmIds: [atm._id],
  });
  const employeeB = record(4, {
    userId: record(5)._id,
    status: "active",
    assignedAtmIds: [atm._id],
  });
  atm.assignedEmployeeId = [employeeA._id, employeeB._id];
  atm.amcResponsibleEmployeeId = employeeB._id;
  input.atms.push(atm);
  input.employees.push(employeeA, employeeB);
  input.users.push(record(5, { status: "active", userType: "employee" }), user);

  const { issues } = classifyATMDataIntegrity(input);
  assert.equal(
    issues.some((issue) => issue.category.startsWith("atm_amc_responsible_")),
    false,
  );
});

test("reports invalid AMC responsibility membership, reference, and eligibility", () => {
  const input = emptyInput();
  const atm = record(1, {
    assignedEmployeeId: [],
    amcResponsibleEmployeeId: id(2),
  });
  const inactiveUser = record(4, { status: "inactive", userType: "employee" });
  const employee = record(2, {
    status: "inactive",
    userId: inactiveUser._id,
    assignedAtmIds: [],
  });
  const nonEmployeeUser = record(6, { status: "active", userType: "admin" });
  const wrongTypeEmployee = record(7, {
    status: "active",
    userId: nonEmployeeUser._id,
  });
  const malformedATM = record(8, { amcResponsibleEmployeeId: "invalid-id" });
  const danglingATM = record(9, {
    amcResponsibleEmployeeId: id(99),
  });
  const missingUserATM = record(10, {
    assignedEmployeeId: [wrongTypeEmployee._id],
    amcResponsibleEmployeeId: wrongTypeEmployee._id,
  });
  input.atms.push(atm, malformedATM, danglingATM, missingUserATM);
  input.employees.push(employee, wrongTypeEmployee);
  input.users.push(inactiveUser, nonEmployeeUser);

  const { issues } = classifyATMDataIntegrity(input);
  const counts = Object.fromEntries(
    issues.map(({ category, count }) => [category, count]),
  );
  assert.equal(counts.atm_amc_responsible_not_assigned, 1);
  assert.equal(counts.atm_amc_responsible_employee_inactive, 1);
  assert.equal(counts.atm_amc_responsible_user_inactive, 1);
  assert.equal(counts.atm_amc_responsible_user_not_employee, 1);
  assert.equal(counts.atm_amc_responsible_ref_malformed, 1);
  assert.equal(counts.atm_amc_responsible_ref_dangling, 1);
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

test("accepts multiple distinct Employees when both sides are reciprocal", () => {
  const input = emptyInput();
  const atm = record(1);
  const employeeA = record(2, { assignedAtmIds: [atm._id] });
  const employeeB = record(3, { assignedAtmIds: [atm._id] });
  const employeeC = record(4, { assignedAtmIds: [atm._id] });
  atm.assignedEmployeeId = [employeeA._id, employeeB._id, employeeC._id];
  input.atms.push(atm);
  input.employees.push(employeeA, employeeB, employeeC);

  const { issues } = classifyATMDataIntegrity(input);
  assert.equal(
    issues.some((issue) => issue.category === "atm_has_multiple_employee_assignments"),
    false,
  );
  assert.equal(
    issues.some((issue) => issue.category.startsWith("atm_employee_")),
    false,
  );
  assert.equal(
    issues.some((issue) => issue.category.startsWith("employee_atm_")),
    false,
  );
});

test("classifies duplicate, one-sided, dangling, and malformed employee assignments", () => {
  const input = emptyInput();
  const employeeA = record(1, {
    assignedAtmIds: [id(2), id(2), id(5), id(99), "invalid-id", null],
  });
  const employeeB = record(6, { assignedAtmIds: [id(2)] });
  input.employees.push(employeeA, employeeB);
  input.atms.push(
    record(2, {
      assignedEmployeeId: [employeeA._id, employeeB._id, employeeA._id],
    }),
    record(3, { assignedEmployeeId: [employeeA._id, id(4), "invalid-id", null] }),
    record(5, { assignedEmployeeId: [] }),
  );

  const { issues } = classifyATMDataIntegrity(input);
  const counts = Object.fromEntries(issues.map(({ category, count }) => [category, count]));
  assert.equal(counts.atm_has_multiple_employee_assignments, undefined);
  assert.equal(counts.atm_has_duplicate_employee_refs, 1);
  assert.equal(counts.atm_employee_missing_reciprocal, 1);
  assert.equal(counts.atm_employee_ref_dangling, 1);
  assert.equal(counts.atm_employee_ref_malformed, 1);
  assert.equal(counts.employee_has_duplicate_atm_refs, 1);
  assert.equal(counts.employee_atm_missing_reciprocal, 1);
  assert.equal(counts.employee_atm_ref_dangling, 1);
  assert.equal(counts.employee_atm_ref_malformed, 1);
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
