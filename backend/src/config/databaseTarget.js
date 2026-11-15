const parseMongoDatabaseName = (mongodbUrl) => {
  if (typeof mongodbUrl !== "string" || !mongodbUrl.trim()) {
    throw new Error("MONGODB_URL is required");
  }

  let uri;
  try {
    uri = new URL(mongodbUrl);
  } catch {
    throw new Error("MONGODB_URL must be a valid MongoDB URI");
  }

  if (uri.protocol !== "mongodb:" && uri.protocol !== "mongodb+srv:") {
    throw new Error("MONGODB_URL must use mongodb:// or mongodb+srv://");
  }

  if (!uri.pathname || uri.pathname === "/") {
    throw new Error("MONGODB_URL must include an explicit database name");
  }

  let databaseName;
  try {
    databaseName = decodeURIComponent(uri.pathname.slice(1));
  } catch {
    throw new Error("MONGODB_URL contains an invalid database name");
  }

  if (!databaseName || databaseName.includes("/")) {
    throw new Error("MONGODB_URL must target exactly one database");
  }

  return databaseName;
};

export const validateMongoDatabaseTarget = ({
  mongodbUrl,
  expectedDatabase,
}) => {
  if (typeof expectedDatabase !== "string" || !expectedDatabase.trim()) {
    throw new Error("MONGODB_EXPECTED_DATABASE is required");
  }

  const actualDatabase = parseMongoDatabaseName(mongodbUrl);
  if (actualDatabase !== expectedDatabase) {
    throw new Error(
      `MONGODB_URL targets "${actualDatabase}", but MONGODB_EXPECTED_DATABASE is "${expectedDatabase}"`,
    );
  }

  return actualDatabase;
};
