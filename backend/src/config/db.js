import mongoose from "mongoose";
import dotenv from "dotenv";
import { validateMongoDatabaseTarget } from "./databaseTarget.js";

dotenv.config();

const connectDb = async () => {
  const expectedDatabase = process.env.MONGODB_EXPECTED_DATABASE;
  const databaseName = validateMongoDatabaseTarget({
    mongodbUrl: process.env.MONGODB_URL,
    expectedDatabase,
  });

  await mongoose.connect(process.env.MONGODB_URL);

  const connectedDatabase = mongoose.connection.name;
  if (connectedDatabase !== databaseName) {
    await mongoose.disconnect();
    throw new Error(
      `Connected database "${connectedDatabase}" does not match expected database "${databaseName}"`,
    );
  }

  console.log(`MongoDB connected successfully (database: ${databaseName})`);
  return mongoose.connection;
};

export default connectDb;
