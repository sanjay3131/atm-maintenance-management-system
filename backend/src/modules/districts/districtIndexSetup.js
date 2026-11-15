import {
  normalizeDistrictName,
  normalizeDistrictPinCode,
} from "./districtNormalization.js";

export const DISTRICT_INDEXES = Object.freeze([
  {
    name: "regionId_1",
    key: { regionId: 1 },
  },
  {
    name: "districtName_1",
    key: { districtName: 1 },
  },
  {
    name: "uniq_district_bank_name_normalized",
    key: { bankId: 1, districtNameNormalized: 1 },
    unique: true,
    partialFilterExpression: { geographyStatus: "MAPPED" },
  },
  {
    name: "uniq_district_bank_pin_normalized",
    key: { bankId: 1, pinCodeNormalized: 1 },
    unique: true,
    partialFilterExpression: { geographyStatus: "MAPPED" },
  },
]);

const ID_INDEX = {
  name: "_id_",
  key: { _id: 1 },
};

const EXPECTED_INDEXES = [ID_INDEX, ...DISTRICT_INDEXES];

const canonicalize = (value) => {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    return Object.fromEntries(
      Object.keys(value)
        .sort()
        .map((key) => [key, canonicalize(value[key])]),
    );
  }
  return value;
};

const comparableIndex = (index) => {
  const { v, ns, background, ...specification } = index;
  return canonicalize({
    ...specification,
    key: Object.entries(specification.key ?? {}),
  });
};

const indexesMatch = (actual, expected) =>
  JSON.stringify(comparableIndex(actual)) ===
  JSON.stringify(comparableIndex(expected));

export const verifyDistrictIndexes = (actualIndexes) => {
  const missing = EXPECTED_INDEXES.filter(
    (expected) => !actualIndexes.some((actual) => indexesMatch(actual, expected)),
  );
  const mismatched = EXPECTED_INDEXES.filter((expected) =>
    actualIndexes.some(
      (actual) => actual.name === expected.name && !indexesMatch(actual, expected),
    ),
  );
  const unexpected = actualIndexes.filter(
    (actual) => !EXPECTED_INDEXES.some((expected) => expected.name === actual.name),
  );

  return {
    isExact:
      missing.length === 0 &&
      mismatched.length === 0 &&
      unexpected.length === 0,
    missing,
    mismatched,
    unexpected,
  };
};

export const planDistrictIndexes = (actualIndexes) => {
  const verification = verifyDistrictIndexes(actualIndexes);
  const names = new Set(actualIndexes.map((index) => index.name));

  return {
    ...verification,
    createIndexes: DISTRICT_INDEXES.filter(
      (index) => !names.has(index.name),
    ),
  };
};

const idString = (value) => {
  const id =
    value && typeof value.toHexString === "function"
      ? value.toHexString()
      : value;
  return typeof id === "string" && /^[a-fA-F0-9]{24}$/.test(id)
    ? id.toLowerCase()
    : null;
};

const duplicateGroups = (districts, field) => {
  const groups = new Map();
  for (const district of districts) {
    const key = JSON.stringify([district.bankIdKey, district[field]]);
    const group = groups.get(key) ?? {
      bankId: district.bankIdKey,
      normalizedValue: district[field],
      districtIds: [],
    };
    group.districtIds.push(district.id);
    groups.set(key, group);
  }
  return [...groups.values()].filter((group) => group.districtIds.length > 1);
};

export const preflightDistrictIndexes = (districts) => {
  const mapped = districts.filter(
    (district) => district.geographyStatus === "MAPPED",
  );
  const invalidMappedDistricts = [];
  const validMappedDistricts = [];

  for (const district of mapped) {
    const districtId = idString(district._id) ?? String(district._id ?? "unknown");
    const bankIdKey = idString(district.bankId);
    let expectedName;
    let expectedPinCode;
    try {
      expectedName = normalizeDistrictName(district.districtName);
      expectedPinCode = normalizeDistrictPinCode(district.pinCode);
    } catch {
      invalidMappedDistricts.push(districtId);
      continue;
    }

    if (
      !bankIdKey ||
      district.districtNameNormalized !== expectedName ||
      district.pinCodeNormalized !== expectedPinCode
    ) {
      invalidMappedDistricts.push(districtId);
      continue;
    }

    validMappedDistricts.push({
      id: districtId,
      bankIdKey,
      districtNameNormalized: district.districtNameNormalized,
      pinCodeNormalized: district.pinCodeNormalized,
    });
  }

  const duplicateNames = duplicateGroups(
    validMappedDistricts,
    "districtNameNormalized",
  );
  const duplicatePincodes = duplicateGroups(
    validMappedDistricts,
    "pinCodeNormalized",
  );

  return {
    mappedDistrictCount: mapped.length,
    invalidMappedDistricts,
    duplicateNames,
    duplicatePincodes,
    isClean:
      invalidMappedDistricts.length === 0 &&
      duplicateNames.length === 0 &&
      duplicatePincodes.length === 0,
  };
};
