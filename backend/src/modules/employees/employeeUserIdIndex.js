import ApiError from "../../utils/ApiError.js";

export const EMPLOYEE_USER_ID_INDEX = {
  fields: { userId: 1 },
  options: {
    unique: true,
    name: "userId_1_unique_non_null",
    partialFilterExpression: { userId: { $type: "objectId" } },
  },
};

export class DuplicateEmployeeUserIdError extends Error {
  constructor(duplicates) {
    super("Duplicate Employee.userId values must be resolved before indexing");
    this.name = "DuplicateEmployeeUserIdError";
    this.duplicates = duplicates;
  }
}

export class EmployeeUserIdLegacyIndexRemovalError extends Error {
  constructor(indexName, cause) {
    super(
      `Unique Employee.userId index is active, but legacy index "${indexName}" could not be removed. Rerun the migration to retry cleanup.`,
      { cause },
    );
    this.name = "EmployeeUserIdLegacyIndexRemovalError";
    this.indexName = indexName;
  }
}

export class EmployeeUserIdIndexCreationError extends Error {
  constructor(cause) {
    super(
      "Unique Employee.userId index creation failed. Existing userId indexes were left unchanged; correct the cause and rerun the migration.",
      { cause },
    );
    this.name = "EmployeeUserIdIndexCreationError";
  }
}

const isUserIdOnlyIndex = (index) =>
  Object.keys(index.key ?? {}).length === 1 && index.key.userId === 1;

const isDesiredIndex = (index) => {
  const partialFilterExpression = index.partialFilterExpression;
  const userIdFilter = partialFilterExpression?.userId;

  return (
    index.name === EMPLOYEE_USER_ID_INDEX.options.name &&
    index.unique === true &&
    Object.keys(partialFilterExpression ?? {}).length === 1 &&
    Object.keys(userIdFilter ?? {}).length === 1 &&
    userIdFilter.$type === "objectId"
  );
};

export const findDuplicateEmployeeUserIds = async (collection) =>
  collection
    .aggregate([
      { $match: { userId: { $type: "objectId" } } },
      {
        $group: {
          _id: "$userId",
          employeeIds: { $push: "$_id" },
          count: { $sum: 1 },
        },
      },
      { $match: { count: { $gt: 1 } } },
      {
        $project: {
          _id: 0,
          userId: "$_id",
          employeeIds: 1,
          count: 1,
        },
      },
      { $sort: { userId: 1 } },
    ])
    .toArray();

export const ensureEmployeeUserIdUniqueIndex = async (collection) => {
  const duplicates = await findDuplicateEmployeeUserIds(collection);
  if (duplicates.length > 0) {
    throw new DuplicateEmployeeUserIdError(duplicates);
  }

  const indexes = await collection.listIndexes().toArray();

  const userIdIndexes = indexes.filter(isUserIdOnlyIndex);
  const desiredIndexExists = userIdIndexes.some(isDesiredIndex);

  if (!desiredIndexExists) {
    try {
      // Create first so a failed build leaves the existing index untouched.
      await collection.createIndex(
        EMPLOYEE_USER_ID_INDEX.fields,
        EMPLOYEE_USER_ID_INDEX.options,
      );
    } catch (error) {
      throw new EmployeeUserIdIndexCreationError(error);
    }
  }

  let keptDesiredIndex = false;
  for (const index of userIdIndexes) {
    if (isDesiredIndex(index) && !keptDesiredIndex) {
      keptDesiredIndex = true;
      continue;
    }
    try {
      await collection.dropIndex(index.name);
    } catch (error) {
      throw new EmployeeUserIdLegacyIndexRemovalError(index.name, error);
    }
  }

  return EMPLOYEE_USER_ID_INDEX.options.name;
};

export const isEmployeeUserIdDuplicateKeyError = (error) =>
  error?.code === 11000 &&
  (error.keyPattern?.userId === 1 ||
    error.keyValue?.userId != null ||
    /userId_1(?:_unique_non_null)?/.test(error.message ?? ""));

export const throwEmployeeUserIdConflict = (error) => {
  if (isEmployeeUserIdDuplicateKeyError(error)) {
    throw new ApiError(409, "Employee already exists for this user");
  }
  throw error;
};
