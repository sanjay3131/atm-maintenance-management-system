import path from "node:path";
import process from "node:process";
import { fileURLToPath } from "node:url";
import mongoose from "mongoose";
import dotenv from "dotenv";
import User from "../src/modules/users/user.model.js";
import { hashPassword } from "../src/modules/auth/auth.utils.js";
import { validateMongoDatabaseTarget } from "../src/config/databaseTarget.js";

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const CONFIRMATION = "CREATE-FIRST-SUPER-ADMIN";
const valueFor = (prefix) =>
  process.argv.find((argument) => argument.startsWith(prefix))?.slice(prefix.length);

export const validateBootstrapInput = (env, targetDatabase, confirmation) => {
  if (!targetDatabase || targetDatabase !== env.MONGODB_EXPECTED_DATABASE) {
    throw new Error(
      "--target-database must exactly match MONGODB_EXPECTED_DATABASE",
    );
  }
  if (confirmation !== CONFIRMATION) {
    throw new Error(`Explicit confirmation required: --confirm=${CONFIRMATION}`);
  }

  const required = [
    "BOOTSTRAP_SUPER_ADMIN_FIRST_NAME",
    "BOOTSTRAP_SUPER_ADMIN_EMAIL",
    "BOOTSTRAP_SUPER_ADMIN_PHONE",
    "BOOTSTRAP_SUPER_ADMIN_PASSWORD",
  ];
  const missing = required.filter(
    (key) => typeof env[key] !== "string" || !env[key].trim(),
  );
  if (missing.length) {
    throw new Error(`Missing required bootstrap environment variables: ${missing.join(", ")}`);
  }
  if (env.BOOTSTRAP_SUPER_ADMIN_PASSWORD.length < 12) {
    throw new Error("Bootstrap password must contain at least 12 characters");
  }
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(env.BOOTSTRAP_SUPER_ADMIN_EMAIL)) {
    throw new Error("Bootstrap email address is invalid");
  }
};

const ensureBootstrapCollection = async () => {
  try {
    await mongoose.connection.createCollection("systemBootstrap");
  } catch (error) {
    if (error.code !== 48 && error.codeName !== "NamespaceExists") throw error;
  }
};

const main = async () => {
  const targetDatabase = valueFor("--target-database=");
  const confirmation = valueFor("--confirm=");
  validateBootstrapInput(process.env, targetDatabase, confirmation);
  validateMongoDatabaseTarget({
    mongodbUrl: process.env.MONGODB_URL,
    expectedDatabase: targetDatabase,
  });

  await mongoose.connect(process.env.MONGODB_URL);

  await User.init();
  await ensureBootstrapCollection();

  const firstName = process.env.BOOTSTRAP_SUPER_ADMIN_FIRST_NAME.trim();
  const lastName = process.env.BOOTSTRAP_SUPER_ADMIN_LAST_NAME?.trim() ?? "";
  const email = process.env.BOOTSTRAP_SUPER_ADMIN_EMAIL.trim().toLowerCase();
  const phoneNumber = process.env.BOOTSTRAP_SUPER_ADMIN_PHONE.trim();
  const password = await hashPassword(process.env.BOOTSTRAP_SUPER_ADMIN_PASSWORD);

  const session = await mongoose.startSession();
  try {
    await session.withTransaction(async () => {
      const existingSuperAdmin = await User.exists({
        userType: "superAdmin",
      }).session(session);
      if (existingSuperAdmin) {
        throw new Error("A Super Admin already exists; bootstrap is permanently closed");
      }

      await mongoose.connection.collection("systemBootstrap").insertOne(
        {
          _id: "initial-super-admin",
          createdAt: new Date(),
          databaseName: targetDatabase,
        },
        { session },
      );

      await User.create(
        [
          {
            firstName,
            lastName,
            email,
            password,
            phoneNumber,
            userType: "superAdmin",
            status: "active",
          },
        ],
        { session },
      );
    });
  } finally {
    await session.endSession();
  }

  console.log("Initial Super Admin created successfully. Bootstrap is now permanently closed.");
};

if (
  process.argv[1] &&
  path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)
) {
  dotenv.config({ path: path.resolve(scriptDirectory, "../.env") });
  main()
    .catch((error) => {
      console.error("Super Admin bootstrap failed:", error.message);
      process.exitCode = 1;
    })
    .finally(async () => {
      await mongoose.disconnect();
    });
}
