const isObjectId = (value) =>
  value != null &&
  typeof value === "object" &&
  value._bsontype === "ObjectId" &&
  typeof value.toHexString === "function";

const keyOf = (value) => (isObjectId(value) ? value.toHexString() : null);

const safeId = (value) => {
  if (isObjectId(value)) return value.toHexString();
  if (typeof value === "string" && /^[a-fA-F0-9]{24}$/.test(value)) {
    return value.toLowerCase();
  }
  return null;
};

const hasField = (record, field) =>
  Object.prototype.hasOwnProperty.call(record, field);

const references = (
  record,
  field,
  report,
  category,
  optional = false,
  expectArray = true,
) => {
  if (!hasField(record, field) || record[field] == null) {
    if (!optional) report(`${category}_missing`, record);
    return [];
  }

  const value = record[field];
  if (!Array.isArray(value)) {
    if (!expectArray) return [value];
    report(`${category}_malformed`, record);
    return [value];
  }
  return value;
};

const mapById = (records) =>
  new Map(records.map((record) => [keyOf(record._id), record]).filter(([id]) => id));

const refsForCompare = (values) => values.map(keyOf).filter(Boolean);
const normalizeReferenceList = (value) =>
  Array.isArray(value) ? value : value == null ? [] : [value];

export const classifyATMDataIntegrity = ({
  atms,
  districts,
  regions,
  employees,
  customers,
  jobs,
  amcs,
  recurringPlans,
}) => {
  const records = {
    atms,
    districts,
    regions,
    employees,
    customers,
    jobs,
    amcs,
    recurringPlans,
  };
  const issues = new Map();
  const report = (category, record, relatedIds = [], certainty = "definite") => {
    const issue = issues.get(category) ?? {
      category,
      count: 0,
      certainty,
      samples: [],
      seenRecordIds: new Set(),
    };
    const recordId = safeId(record?._id);
    if (!recordId || !issue.seenRecordIds.has(recordId)) {
      issue.count += 1;
      if (recordId) issue.seenRecordIds.add(recordId);
      if (issue.samples.length < 5) {
        issue.samples.push({
          recordId,
          relatedIds: relatedIds.map(safeId).filter(Boolean).slice(0, 2),
        });
      }
    }
    issues.set(category, issue);
  };

  const districtById = mapById(districts);
  const regionById = mapById(regions);
  const employeeById = mapById(employees);
  const customerById = mapById(customers);
  const atmById = mapById(atms);
  const activeRegionCounts = new Map();
  for (const region of regions) {
    if (region.isActive !== true) continue;
    const districtKey = keyOf(region.districtId);
    if (districtKey) {
      activeRegionCounts.set(
        districtKey,
        (activeRegionCounts.get(districtKey) ?? 0) + 1,
      );
    }
  }

  const atmEmployeeRefs = new Map();
  const atmCustomerRefs = new Map();

  for (const atm of atms) {
    const atmKey = keyOf(atm._id);
    const districtValues = references(
      atm,
      "districtId",
      report,
      "atm_district",
      false,
      false,
    );
    const districtValue = districtValues[0];
    const districtKey = keyOf(districtValue);
    if (districtValue != null && !districtKey) {
      report("atm_district_malformed", atm);
    } else if (districtKey && !districtById.has(districtKey)) {
      report("atm_district_dangling", atm, [districtValue]);
    }

    const regionValue = hasField(atm, "regionId") ? atm.regionId : null;
    const regionKey = keyOf(regionValue);
    const districtExists = districtKey && districtById.has(districtKey);
    if (regionValue != null && !regionKey) {
      report("atm_region_malformed", atm);
    } else if (regionKey) {
      const region = regionById.get(regionKey);
      if (!region) {
        report("atm_region_dangling", atm, [regionValue]);
      } else {
        if (region.isActive === false) {
          report("atm_region_inactive", atm, [regionValue]);
        } else if (region.isActive !== true) {
          report("atm_region_active_status_unknown", atm, [regionValue], "manual-review");
        }
        const regionDistrictKey = keyOf(region.districtId);
        if (districtKey && regionDistrictKey && regionDistrictKey !== districtKey) {
          report("atm_region_district_mismatch", atm, [
            regionValue,
            region.districtId,
          ]);
        }
        if (
          districtExists &&
          (activeRegionCounts.get(districtKey) ?? 0) === 0
        ) {
          report(
            "atm_has_region_but_district_has_no_active_regions",
            atm,
            [regionValue, districtValue],
          );
        }
      }
    } else if (
      districtExists &&
      (activeRegionCounts.get(districtKey) ?? 0) > 0
    ) {
      report(
        "atm_has_no_region_but_district_has_active_regions",
        atm,
        [districtValue],
      );
    }

    const employeeValues = references(
      atm,
      "assignedEmployeeId",
      report,
      "atm_employee_refs",
      true,
    );
    const employeeKeys = refsForCompare(employeeValues);
    atmEmployeeRefs.set(atmKey, new Set(employeeKeys));
    if (new Set(employeeKeys).size > 1) {
      report("atm_has_multiple_employee_assignments", atm, employeeValues);
    }
    if (new Set(employeeKeys).size !== employeeKeys.length) {
      report("atm_has_duplicate_employee_refs", atm, employeeValues);
    }
    for (const value of employeeValues) {
      const employeeKey = keyOf(value);
      if (value == null || !employeeKey) {
        report("atm_employee_ref_malformed", atm);
      } else if (!employeeById.has(employeeKey)) {
        report("atm_employee_ref_dangling", atm, [value]);
      } else if (
        !refsForCompare(
          normalizeReferenceList(employeeById.get(employeeKey).assignedAtmIds),
        ).includes(atmKey)
      ) {
        report("atm_employee_missing_reciprocal", atm, [value]);
      }
    }

    const customerValue = hasField(atm, "customer") ? atm.customer : null;
    const customerKey = keyOf(customerValue);
    atmCustomerRefs.set(atmKey, customerKey);
    if (customerValue != null && !customerKey) {
      report("atm_customer_ref_malformed", atm);
    } else if (customerKey) {
      const customer = customerById.get(customerKey);
      if (!customer) {
        report("atm_customer_ref_dangling", atm, [customerValue]);
      } else if (
        !refsForCompare(normalizeReferenceList(customer.atmIds)).includes(atmKey)
      ) {
        report(
          "atm_customer_reciprocal_missing_review",
          atm,
          [customerValue],
          "manual-review",
        );
      }
    }
  }

  for (const employee of employees) {
    const employeeKey = keyOf(employee._id);
    const values = references(
      employee,
      "assignedAtmIds",
      report,
      "employee_atm_refs",
      true,
    );
    const atmKeys = refsForCompare(values);
    if (new Set(atmKeys).size !== atmKeys.length) {
      report("employee_has_duplicate_atm_refs", employee, values);
    }
    for (const value of values) {
      const atmKey = keyOf(value);
      if (value == null || !atmKey) {
        report("employee_atm_ref_malformed", employee);
      } else if (!atmById.has(atmKey)) {
        report("employee_atm_ref_dangling", employee, [value]);
      } else if (!atmEmployeeRefs.get(atmKey)?.has(employeeKey)) {
        report("employee_atm_missing_reciprocal", employee, [value]);
      }
    }
  }

  for (const customer of customers) {
    const customerKey = keyOf(customer._id);
    const values = references(
      customer,
      "atmIds",
      report,
      "customer_atm_refs",
      true,
    );
    const atmKeys = refsForCompare(values);
    if (new Set(atmKeys).size !== atmKeys.length) {
      report("customer_has_duplicate_atm_refs_review", customer, values, "manual-review");
    }
    for (const value of values) {
      const atmKey = keyOf(value);
      if (value == null || !atmKey) {
        report("customer_atm_ref_malformed", customer);
      } else if (!atmById.has(atmKey)) {
        report("customer_atm_ref_dangling", customer, [value]);
      } else if (atmCustomerRefs.get(atmKey) !== customerKey) {
        report(
          "customer_atm_reciprocal_mismatch_review",
          customer,
          [value],
          "manual-review",
        );
      }
    }
  }

  const auditOperationalReferences = (collectionName, sourceRecords) => {
    for (const record of sourceRecords) {
      const values = references(
        record,
        "atmId",
        report,
        `${collectionName}_atm_ref`,
        false,
        false,
      );
      const atmValue = values[0];
      const atmKey = keyOf(atmValue);
      if (atmValue != null && !atmKey) {
        report(`${collectionName}_atm_ref_malformed`, record);
      } else if (atmKey && !atmById.has(atmKey)) {
        report(`${collectionName}_atm_ref_dangling`, record, [atmValue]);
      }
    }
  };
  auditOperationalReferences("job", jobs);
  auditOperationalReferences("amc", amcs);
  auditOperationalReferences("recurring_plan", recurringPlans);

  return {
    totals: Object.fromEntries(
      Object.entries(records).map(([name, items]) => [name, items.length]),
    ),
    softDeletedIncluded: true,
    issues: [...issues.values()]
      .map(({ seenRecordIds, ...issue }) => issue)
      .sort((left, right) => left.category.localeCompare(right.category)),
  };
};
