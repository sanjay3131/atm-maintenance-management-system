const idString = (value) => {
  const id =
    value && typeof value.toHexString === "function"
      ? value.toHexString()
      : value;
  return id == null ? null : String(id);
};

const indexValue = (value) => {
  if (value == null) return { type: "null", value: null };
  if (value?._bsontype === "ObjectId") {
    return { type: "ObjectId", value: idString(value).toLowerCase() };
  }
  return { type: typeof value, value };
};

const findUniqueKeyConflicts = (
  records,
  { indexName, fields, include = () => true },
) => {
  const groups = new Map();
  for (const record of records) {
    if (!include(record)) continue;
    const keyValues = fields.map((field) => indexValue(record[field]));
    const groupKey = JSON.stringify(keyValues);
    const group = groups.get(groupKey) ?? {
      key: Object.fromEntries(
        fields.map((field) => [field, record[field] ?? null]),
      ),
      records: [],
    };
    group.records.push({
      _id: idString(record._id),
      ...Object.fromEntries(fields.map((field) => [field, record[field] ?? null])),
    });
    groups.set(groupKey, group);
  }

  return [...groups.values()]
    .filter((group) => group.records.length > 1)
    .map((group) => ({ indexName, ...group }));
};

export const findGeographyUniqueKeyConflicts = ({ banks, regions }) => ({
  bankNames: findUniqueKeyConflicts(banks, {
    indexName: "bankName_1",
    fields: ["bankName"],
  }),
  bankCodes: findUniqueKeyConflicts(banks, {
    indexName: "bankCode_1",
    fields: ["bankCode"],
  }),
  regionNames: findUniqueKeyConflicts(regions, {
    indexName: "bankId_1_name_1",
    fields: ["bankId", "name"],
    include: (region) => region.bankId?._bsontype === "ObjectId",
  }),
  regionCodes: findUniqueKeyConflicts(regions, {
    indexName: "bankId_1_code_1",
    fields: ["bankId", "code"],
    include: (region) =>
      region.bankId?._bsontype === "ObjectId" &&
      typeof region.code === "string" &&
      region.code > "",
  }),
});

export const excludeSoftDeletedAtms = (atms) =>
  atms.filter((atm) => atm.isDeleted !== true);
