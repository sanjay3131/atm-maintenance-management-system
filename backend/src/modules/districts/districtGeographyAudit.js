import {
  normalizeDistrictName,
  normalizeDistrictPinCode,
} from "./districtNormalization.js";

export const DISTRICT_GEOGRAPHY_AUDIT_CATEGORIES = Object.freeze({
  REGION_MISSING_OR_INVALID_BANK: "region_missing_or_invalid_bank",
  DISTRICT_MISSING_OR_INVALID_REGION: "district_missing_or_invalid_region",
  DISTRICT_PARENT_REGION_MISSING_OR_INVALID_BANK:
    "district_parent_region_missing_or_invalid_bank",
  DISTRICT_MISSING_BANK_ID: "district_missing_bank_id",
  DISTRICT_BANK_MISMATCH: "district_bank_mismatch",
  DISTRICT_INVALID_DISPLAY_VALUE: "district_invalid_display_value",
  DISTRICT_MISSING_NORMALIZED_NAME: "district_missing_normalized_name",
  DISTRICT_NORMALIZED_NAME_MISMATCH: "district_normalized_name_mismatch",
  DISTRICT_MISSING_NORMALIZED_PINCODE: "district_missing_normalized_pincode",
  DISTRICT_NORMALIZED_PINCODE_MISMATCH: "district_normalized_pincode_mismatch",
  ATM_MISSING_OR_INVALID_GEOGRAPHY_REFERENCE:
    "atm_missing_or_invalid_geography_reference",
  ATM_GEOGRAPHY_MISMATCH: "atm_geography_mismatch",
});

export const countDistrictGeographyIssues = (issues) => {
  const counts = Object.fromEntries(
    Object.values(DISTRICT_GEOGRAPHY_AUDIT_CATEGORIES).map((category) => [
      category,
      0,
    ]),
  );
  const seenCategories = new Set();

  for (const issue of issues) {
    if (!Object.prototype.hasOwnProperty.call(counts, issue.category)) {
      throw new Error(
        `Unrecognized district geography audit category "${issue.category}"`,
      );
    }
    if (seenCategories.has(issue.category)) {
      throw new Error(
        `Duplicate district geography audit category "${issue.category}"`,
      );
    }
    seenCategories.add(issue.category);
    counts[issue.category] = issue.count;
  }

  return counts;
};

const idOf = (value) => {
  const id = value?._id ?? value;
  return id == null ? null : String(id).toLowerCase();
};

const groupedIssues = (entries) =>
  [...entries].map(([category, samples]) => ({
    category,
    count: samples.count,
    samples: samples.records.slice(0, 10),
  }));

export const auditDistrictGeography = ({
  banks = [],
  regions = [],
  districts = [],
  atms = [],
}) => {
  const bankById = new Map(banks.map((record) => [idOf(record._id), record]));
  const regionById = new Map(regions.map((record) => [idOf(record._id), record]));
  const districtsById = new Map(districts.map((record) => [idOf(record._id), record]));
  const issues = new Map();
  const report = (category, record, relatedIds = []) => {
    const entry = issues.get(category) ?? { count: 0, records: [] };
    entry.count += 1;
    if (entry.records.length < 10) {
      entry.records.push({
        recordId: idOf(record?._id),
        relatedIds: relatedIds.filter(Boolean).slice(0, 3),
      });
    }
    issues.set(category, entry);
  };
  const duplicateGroups = (keyFor, category) => {
    const groups = new Map();
    for (const district of districts) {
      if (district.geographyStatus === "UNMAPPED") continue;
      const region = regionById.get(idOf(district.regionId));
      const bankId = idOf(region?.bankId);
      if (!region || !bankById.has(bankId)) continue;
      let value;
      try {
        value = keyFor(district);
      } catch {
        continue;
      }
      const key = `${bankId}:${value}`;
      const group = groups.get(key) ?? { bankId, value, districts: [] };
      group.districts.push(district);
      groups.set(key, group);
    }
    return [...groups.values()]
      .filter((group) => group.districts.length > 1)
      .map((group) => ({
        category,
        bankId: group.bankId,
        normalizedValue: group.value,
        districtIds: group.districts.map((district) => idOf(district._id)),
        inactiveDistrictIds: group.districts
          .filter((district) => district.isActive === false)
          .map((district) => idOf(district._id)),
      }));
  };

  for (const region of regions) {
    const bankId = idOf(region.bankId);
    if (!bankId || !bankById.has(bankId)) {
      report(
        DISTRICT_GEOGRAPHY_AUDIT_CATEGORIES.REGION_MISSING_OR_INVALID_BANK,
        region,
        [bankId],
      );
    }
  }

  for (const district of districts) {
    const regionId = idOf(district.regionId);
    const region = regionById.get(regionId);
    if (!region) {
      report(
        DISTRICT_GEOGRAPHY_AUDIT_CATEGORIES.DISTRICT_MISSING_OR_INVALID_REGION,
        district,
        [regionId],
      );
      continue;
    }
    const parentBankId = idOf(region.bankId);
    if (!parentBankId || !bankById.has(parentBankId)) {
      report(
        DISTRICT_GEOGRAPHY_AUDIT_CATEGORIES
          .DISTRICT_PARENT_REGION_MISSING_OR_INVALID_BANK,
        district,
        [regionId, parentBankId],
      );
      continue;
    }
    if (district.geographyStatus !== "UNMAPPED") {
      if (!idOf(district.bankId)) {
        report(
          DISTRICT_GEOGRAPHY_AUDIT_CATEGORIES.DISTRICT_MISSING_BANK_ID,
          district,
          [regionId, parentBankId],
        );
      } else if (idOf(district.bankId) !== parentBankId) {
        report(
          DISTRICT_GEOGRAPHY_AUDIT_CATEGORIES.DISTRICT_BANK_MISMATCH,
          district,
          [district.bankId, parentBankId],
        );
      }
      let name;
      let pinCode;
      try {
        name = normalizeDistrictName(district.districtName);
        pinCode = normalizeDistrictPinCode(district.pinCode);
      } catch {
        report(
          DISTRICT_GEOGRAPHY_AUDIT_CATEGORIES.DISTRICT_INVALID_DISPLAY_VALUE,
          district,
          [regionId],
        );
        continue;
      }
      if (!district.districtNameNormalized) {
        report(
          DISTRICT_GEOGRAPHY_AUDIT_CATEGORIES.DISTRICT_MISSING_NORMALIZED_NAME,
          district,
          [regionId],
        );
      } else if (district.districtNameNormalized !== name) {
        report(
          DISTRICT_GEOGRAPHY_AUDIT_CATEGORIES
            .DISTRICT_NORMALIZED_NAME_MISMATCH,
          district,
          [regionId],
        );
      }
      if (!district.pinCodeNormalized) {
        report(
          DISTRICT_GEOGRAPHY_AUDIT_CATEGORIES
            .DISTRICT_MISSING_NORMALIZED_PINCODE,
          district,
          [regionId],
        );
      } else if (district.pinCodeNormalized !== pinCode) {
        report(
          DISTRICT_GEOGRAPHY_AUDIT_CATEGORIES
            .DISTRICT_NORMALIZED_PINCODE_MISMATCH,
          district,
          [regionId],
        );
      }
    }
  }

  for (const atm of atms) {
    const regionId = idOf(atm.regionId);
    const districtId = idOf(atm.districtId);
    const region = regionById.get(regionId);
    const district = districtsById.get(districtId);
    if (!idOf(atm.bankId) || !region || !district) {
      report(
        DISTRICT_GEOGRAPHY_AUDIT_CATEGORIES
          .ATM_MISSING_OR_INVALID_GEOGRAPHY_REFERENCE,
        atm,
        [idOf(atm.bankId), regionId, districtId],
      );
      continue;
    }
    const parentBankId = idOf(region.bankId);
    if (
      idOf(atm.bankId) !== parentBankId ||
      idOf(district.bankId) !== parentBankId ||
      idOf(district.regionId) !== regionId
    ) {
      report(
        DISTRICT_GEOGRAPHY_AUDIT_CATEGORIES.ATM_GEOGRAPHY_MISMATCH,
        atm,
        [idOf(atm.bankId), regionId, districtId],
      );
    }
  }

  const atmCountsByDistrict = new Map();
  for (const atm of atms) {
    const districtId = idOf(atm.districtId);
    if (districtId) {
      atmCountsByDistrict.set(
        districtId,
        (atmCountsByDistrict.get(districtId) ?? 0) + 1,
      );
    }
  }

  return {
    issues: groupedIssues(issues),
    duplicateNames: duplicateGroups(
      (district) => normalizeDistrictName(district.districtName),
      "duplicate_district_name_within_bank",
    ),
    duplicatePincodes: duplicateGroups(
      (district) => normalizeDistrictPinCode(district.pinCode),
      "duplicate_district_pincode_within_bank",
    ),
    affectedATMCounts: [...atmCountsByDistrict].map(([districtId, atmCount]) => ({
      districtId,
      atmCount,
    })),
  };
};
