import assert from "node:assert/strict";
import test from "node:test";
import mongoose from "mongoose";
import ATM from "../../src/modules/atms/atm.model.js";
import ATMIdSequence from "../../src/modules/atms/atmIdSequence.model.js";
import { createATM } from "../../src/modules/atms/atm.controller.js";
import Bank from "../../src/modules/banks/bank.model.js";
import Customer from "../../src/modules/customers/customer.model.js";
import District from "../../src/modules/districts/district.models.js";
import Region from "../../src/modules/region/region.model.js";
import User from "../../src/modules/users/user.model.js";

const expectedDatabaseName = "atm_id_sequence_integration_test";
const integrationOptIn =
  process.env.RUN_ATM_ID_SEQUENCE_INTEGRATION_TESTS === "1";
const initialSequenceValue = 700;

const invokeCreateATM = (body, userId) =>
  new Promise((resolve, reject) => {
    const response = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(payload) {
        resolve({ status: this.statusCode, body: payload });
        return this;
      },
    };

    createATM({ body, user: { _id: userId } }, response, reject);
  });

const validateIntegrationURI = (uri) => {
  if (typeof uri !== "string" || !uri) {
    throw new Error("TEST_MONGODB_URI is required when the explicit opt-in is set");
  }

  let parsedURI;
  try {
    parsedURI = new URL(uri);
  } catch {
    throw new Error("TEST_MONGODB_URI is malformed");
  }

  const replicaSetOptions = parsedURI.searchParams.getAll("replicaSet");
  const allowedOptions = [...parsedURI.searchParams.keys()];
  if (
    parsedURI.protocol !== "mongodb:" ||
    !["localhost", "127.0.0.1"].includes(parsedURI.hostname) ||
    parsedURI.username ||
    parsedURI.password ||
    decodeURIComponent(parsedURI.pathname.slice(1)) !== expectedDatabaseName ||
    replicaSetOptions.length !== 1 ||
    replicaSetOptions[0] !== "rs0" ||
    allowedOptions.some((option) => option !== "replicaSet")
  ) {
    throw new Error(
      `TEST_MONGODB_URI must target the local ${expectedDatabaseName} database with replicaSet=rs0 and no credentials`,
    );
  }

  return parsedURI;
};

test(
  "single ATM creation commits the sequence and rolls it back on failure",
  { skip: !integrationOptIn },
  async (t) => {
    const testURI = process.env.TEST_MONGODB_URI;
    validateIntegrationURI(testURI);

    mongoose.set("autoIndex", false);
    mongoose.set("autoCreate", false);
    await mongoose.connect(testURI, {
      autoIndex: false,
      autoCreate: false,
      serverSelectionTimeoutMS: 5000,
    });

    if (mongoose.connection.name !== expectedDatabaseName) {
      await mongoose.disconnect();
      throw new Error("Connected database does not match the approved test database");
    }

    const owned = {
      users: [],
      banks: [],
      regions: [],
      districts: [],
      customers: [],
      sequence: false,
      adminId: null,
    };

    t.after(async () => {
      try {
        if (owned.adminId) {
          await ATM.deleteMany({ createdBy: owned.adminId });
        }
        for (const [model, ids] of [
          [Customer, owned.customers],
          [District, owned.districts],
          [Region, owned.regions],
          [Bank, owned.banks],
          [User, owned.users],
        ]) {
          if (ids.length) await model.deleteMany({ _id: { $in: ids } });
        }
        if (owned.sequence) {
          await ATMIdSequence.collection.deleteOne({ _id: "atmId" });
        }
      } finally {
        if (mongoose.connection.readyState !== 0) {
          await mongoose.disconnect();
        }
      }
    });

    const [existingATMCount, existingSequence] = await Promise.all([
      ATM.countDocuments({}),
      ATMIdSequence.collection.findOne({ _id: "atmId" }),
    ]);
    if (existingATMCount !== 0 || existingSequence) {
      throw new Error(
        "Refusing to run unless the isolated integration database has no ATMs or ATM ID sequence",
      );
    }

    await ATMIdSequence.collection.insertOne({
      _id: "atmId",
      value: initialSequenceValue,
    });
    owned.sequence = true;
    assert.equal(
      (await ATMIdSequence.collection.findOne({ _id: "atmId" })).value,
      initialSequenceValue,
    );

    const suffix = new mongoose.Types.ObjectId().toString();
    const admin = await User.create({
      firstName: "ATM Sequence",
      lastName: "Integration Admin",
      email: `atm-sequence-admin-${suffix}@integration.invalid`,
      password: "test-only-password",
      phoneNumber: `seq-admin-${suffix}`,
      userType: "admin",
      status: "active",
    });
    owned.users.push(admin._id);
    owned.adminId = admin._id;

    const customerUser = await User.create({
      firstName: "ATM Sequence",
      lastName: "Integration Customer",
      email: `atm-sequence-customer-${suffix}@integration.invalid`,
      password: "test-only-password",
      phoneNumber: `seq-customer-${suffix}`,
      userType: "customer",
      status: "active",
    });
    owned.users.push(customerUser._id);

    const bankName = `ATM Sequence Test Bank ${suffix}`;
    const bank = await Bank.create({
      bankName,
      bankCode: `AS${suffix.slice(-8).toUpperCase()}`,
      isActive: true,
      createdBy: admin._id,
    });
    owned.banks.push(bank._id);

    const region = await Region.create({
      bankId: bank._id,
      geographyStatus: "MAPPED",
      name: `ATM Sequence Test Region ${suffix}`,
      code: `AS${suffix.slice(-8).toUpperCase()}`,
      isActive: true,
      createdBy: admin._id,
    });
    owned.regions.push(region._id);

    const postalCode = String(
      Number.parseInt(suffix.slice(-6), 16) % 1_000_000,
    ).padStart(6, "0");
    const district = await District.create({
      regionId: region._id,
      bankId: bank._id,
      geographyStatus: "MAPPED",
      districtName: `ATM Sequence Test District ${suffix}`,
      districtNameNormalized: `atm sequence test district ${suffix}`,
      pinCode: postalCode,
      pinCodeNormalized: postalCode,
      state: "Integration",
      isActive: true,
      createdBy: admin._id,
    });
    owned.districts.push(district._id);

    const customer = await Customer.create({
      userId: customerUser._id,
      customerName: `ATM Sequence Test Customer ${suffix}`,
      customerEmail: `atm-sequence-${suffix}@integration.invalid`,
      customerPhone: `seq-${suffix}`,
      bankName,
      districtIds: [district._id],
      isActive: true,
      isDeleted: false,
      createdBy: admin._id,
    });
    owned.customers.push(customer._id);

    const requestBody = (overrides = {}) => ({
      bankId: bank._id,
      clientAtmId: `SEQ-${suffix}-${new mongoose.Types.ObjectId().toString()}`,
      customerId: customer._id,
      districtId: district._id,
      regionId: region._id,
      locationName: "ATM sequence integration test",
      city: "Integration",
      address: "Test-only address",
      installationType: "ONSITE",
      status: "ACTIVE",
      ...overrides,
    });

    const success = await invokeCreateATM(requestBody(), admin._id);
    assert.equal(success.status, 201);
    assert.equal(success.body.data.atmId, "ATM0701");
    assert.equal(
      (await ATMIdSequence.collection.findOne({ _id: "atmId" })).value,
      initialSequenceValue + 1,
    );
    assert.equal(await ATM.countDocuments({ createdBy: admin._id }), 1);

    await assert.rejects(
      invokeCreateATM(requestBody({ address: undefined }), admin._id),
      (error) =>
        error.name === "ValidationError" &&
        Boolean(error.errors?.address),
    );
    assert.equal(
      (await ATMIdSequence.collection.findOne({ _id: "atmId" })).value,
      initialSequenceValue + 1,
    );
    assert.equal(await ATM.countDocuments({ createdBy: admin._id }), 1);

    await assert.rejects(
      invokeCreateATM(
        requestBody({ customerId: new mongoose.Types.ObjectId() }),
        admin._id,
      ),
      (error) =>
        error.statusCode === 404 &&
        error.message === "Customer not found",
    );
    assert.equal(
      (await ATMIdSequence.collection.findOne({ _id: "atmId" })).value,
      initialSequenceValue + 1,
    );
    assert.equal(await ATM.countDocuments({ createdBy: admin._id }), 1);
  },
);
