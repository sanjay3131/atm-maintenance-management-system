import { DISTRICT_INDEXES } from "./districtIndexSetup.js";

const ID_INDEX = {
  name: "_id_",
  key: { _id: 1 },
};

export const REGION_INDEXES = Object.freeze([
  {
    name: "bankId_1",
    key: { bankId: 1 },
  },
  {
    name: "bankId_1_name_1",
    key: { bankId: 1, name: 1 },
    unique: true,
    partialFilterExpression: { bankId: { $type: "objectId" } },
  },
  {
    name: "bankId_1_code_1",
    key: { bankId: 1, code: 1 },
    unique: true,
    partialFilterExpression: {
      bankId: { $type: "objectId" },
      code: { $type: "string", $gt: "" },
    },
  },
]);

export const OBSOLETE_GEOGRAPHY_INDEXES = Object.freeze({
  regions: [
    { name: "districtId_1", key: { districtId: 1 } },
    {
      name: "districtId_1_name_1",
      key: { districtId: 1, name: 1 },
      unique: true,
    },
    {
      name: "districtId_1_code_1",
      key: { districtId: 1, code: 1 },
      unique: true,
      partialFilterExpression: {
        code: { $exists: true, $type: "string" },
      },
    },
  ],
  districts: [
    {
      name: "districtName_1",
      key: { districtName: 1 },
      unique: true,
    },
    { name: "pinCode_1", key: { pinCode: 1 } },
    {
      name: "pinCode_1",
      key: { pinCode: 1 },
      unique: true,
    },
    {
      name: "regionId_1_districtName_1",
      key: { regionId: 1, districtName: 1 },
      unique: true,
      partialFilterExpression: { regionId: { $type: "objectId" } },
    },
    {
      name: "regionId_1_pinCode_1",
      key: { regionId: 1, pinCode: 1 },
      unique: true,
      partialFilterExpression: { regionId: { $type: "objectId" } },
    },
  ],
});

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

const planCollectionIndexes = (actualIndexes, desiredIndexes, obsoleteIndexes) => {
  const expectedIndexes = [ID_INDEX, ...desiredIndexes];
  const recognizedObsolete = actualIndexes.filter((actual) =>
    obsoleteIndexes.some((obsolete) => indexesMatch(actual, obsolete)),
  );
  const retainedIndexes = actualIndexes.filter(
    (actual) => !recognizedObsolete.includes(actual),
  );
  const missing = expectedIndexes.filter(
    (expected) =>
      !retainedIndexes.some((actual) => indexesMatch(actual, expected)),
  );
  const mismatched = expectedIndexes.filter((expected) =>
    retainedIndexes.some(
      (actual) => actual.name === expected.name && !indexesMatch(actual, expected),
    ),
  );
  const unexpected = retainedIndexes.filter(
    (actual) =>
      !expectedIndexes.some((expected) => expected.name === actual.name),
  );
  const createIndexes = desiredIndexes.filter((expected) =>
    missing.some((item) => item.name === expected.name),
  );
  const replacements = createIndexes.flatMap((desired) => {
    const obsolete = recognizedObsolete.find(
      (actual) => actual.name === desired.name,
    );
    return obsolete ? [{ obsolete, desired }] : [];
  });
  const replacementNames = new Set(
    replacements.map(({ desired }) => desired.name),
  );

  return {
    isExact:
      missing.length === 0 &&
      mismatched.length === 0 &&
      unexpected.length === 0 &&
      recognizedObsolete.length === 0,
    isRepairable: mismatched.length === 0 && unexpected.length === 0,
    missing,
    mismatched,
    unexpected,
    obsoleteIndexes: recognizedObsolete,
    createIndexes: createIndexes.filter(
      (index) => !replacementNames.has(index.name),
    ),
    replacements,
  };
};

export const planGeographyIndexes = ({
  regionIndexes,
  districtIndexes,
}) => ({
  regions: planCollectionIndexes(
    regionIndexes,
    REGION_INDEXES,
    OBSOLETE_GEOGRAPHY_INDEXES.regions,
  ),
  districts: planCollectionIndexes(
    districtIndexes,
    DISTRICT_INDEXES,
    OBSOLETE_GEOGRAPHY_INDEXES.districts,
  ),
});

export const planGeographyIndexOperations = (collectionPlans) => {
  const operations = [];
  const collections = Object.entries(collectionPlans);
  if (collections.some(([, plan]) => !plan.isRepairable)) {
    throw new Error("Cannot plan index operations for a non-repairable index set");
  }

  for (const [collection, plan] of collections) {
    for (const index of plan.createIndexes) {
      operations.push({ type: "create", collection, index });
    }
  }

  for (const [collection, plan] of collections) {
    for (const replacement of plan.replacements) {
      operations.push({ type: "replace", collection, ...replacement });
    }
  }

  for (const [collection, plan] of collections) {
    const replacementNames = new Set(
      plan.replacements.map(({ obsolete }) => obsolete.name),
    );
    for (const index of plan.obsoleteIndexes) {
      if (!replacementNames.has(index.name)) {
        operations.push({ type: "drop", collection, index });
      }
    }
  }

  return operations;
};

export const verifyGeographyIndexes = (actualIndexes) => {
  const plan = planGeographyIndexes(actualIndexes);
  return {
    isExact: plan.regions.isExact && plan.districts.isExact,
    regions: plan.regions,
    districts: plan.districts,
  };
};
