import mongoose from "mongoose";
import ApiError from "../../utils/ApiError.js";
import ATM from "../atms/atm.model.js";
import User from "../users/user.model.js";
import Bank from "../banks/bank.model.js";
import Customer from "./customer.model.js";

const withSession = (query, session) => query.session(session);

const sameId = (left, right) =>
  String(left?._id ?? left) === String(right?._id ?? right);

export const withCustomerAssignmentTransaction = async (operation) => {
  const session = await mongoose.startSession();
  let result;
  try {
    await session.withTransaction(async () => {
      result = await operation(session);
    });
    return result;
  } finally {
    await session.endSession();
  }
};

export const assignATMCustomerInTransaction = async ({
  atmId,
  customerId,
  atm: existingATM,
  updatedBy,
  session,
}) => {
  const atm =
    existingATM ??
    (await withSession(
      ATM.findOne({ _id: atmId, isDeleted: false }),
      session,
    ));
  if (!atm || atm.isDeleted) throw new ApiError(404, "ATM not found");

  const customer = await withSession(
    Customer.findOne({
      _id: customerId,
      isActive: true,
      isDeleted: false,
    }),
    session,
  );
  if (!customer) throw new ApiError(404, "Customer not found");

  atm.customer = customer._id;
  if (updatedBy) atm.updatedBy = updatedBy;
  await atm.save({ session });

  await Customer.updateMany(
    { _id: { $ne: customer._id }, atmIds: atm._id },
    { $pull: { atmIds: atm._id } },
    { session },
  );

  customer.atmIds = [
    ...(customer.atmIds ?? []).filter((linkedATMId) => !sameId(linkedATMId, atm._id)),
    atm._id,
  ];
  if (updatedBy) customer.updatedBy = updatedBy;
  await customer.save({ session });
  return atm;
};

export const addATMsToCustomerInTransaction = async ({
  customerId,
  atmIds,
  updatedBy,
  session,
}) => {
  const normalizedAtmIds = atmIds.map((id) => String(id).toLowerCase());
  if (new Set(normalizedAtmIds).size !== normalizedAtmIds.length) {
    throw new ApiError(400, "Duplicate ATM assignments are not allowed");
  }

  const customer = await withSession(
    Customer.findOne({
      _id: customerId,
      isActive: true,
      isDeleted: false,
    }),
    session,
  );
  if (!customer) throw new ApiError(404, "Customer not found");

  const customerBank = customer.bankName
    ? await withSession(
        Bank.findOne({
          $or: [
            { bankName: customer.bankName },
            { bankCode: customer.bankName },
          ],
          isActive: true,
        }),
        session,
      )
    : null;
  if (!customerBank) {
    throw new ApiError(
      409,
      "Customer must have an active bank before ATMs can be assigned",
    );
  }

  for (const atmId of normalizedAtmIds) {
    const atm = await withSession(
      ATM.findOne({ _id: atmId, isDeleted: false }),
      session,
    );
    if (!atm) throw new ApiError(404, "ATM not found");
    if (atm.status === "REMOVED") {
      throw new ApiError(409, "Removed ATMs cannot be assigned to a customer");
    }

    if (String(atm.bankId) !== String(customerBank._id)) {
      throw new ApiError(400, "ATM bank does not match the customer bank");
    }
    if (
      customer.districtIds?.length > 0 &&
      !customer.districtIds.some((districtId) =>
        sameId(districtId, atm.districtId),
      )
    ) {
      throw new ApiError(400, "ATM district is not assigned to this customer");
    }

    await assignATMCustomerInTransaction({
      atm,
      atmId: atm._id,
      customerId: customer._id,
      updatedBy,
      session,
    });
  }

  return customer;
};

export const addATMGroupsToCustomersInTransaction = async ({
  customerAtmGroups,
  updatedBy,
  session,
}) => {
  if (!Array.isArray(customerAtmGroups)) {
    throw new ApiError(400, "Customer ATM groups must be an array");
  }
  if (customerAtmGroups.length === 0) return;
  if (
    !session ||
    typeof session.inTransaction !== "function" ||
    session.inTransaction() !== true
  ) {
    throw new ApiError(
      500,
      "An active transaction session is required for Customer ATM assignments",
    );
  }

  const groupsByCustomer = new Map();
  for (const group of customerAtmGroups) {
    if (!Array.isArray(group?.atmIds) || group.atmIds.length === 0) {
      throw new ApiError(400, "Each Customer ATM group must contain ATM IDs");
    }
    if (!mongoose.isValidObjectId(group.customerId)) {
      throw new ApiError(400, "Customer ID is invalid");
    }

    const customerId = new mongoose.Types.ObjectId(group.customerId);
    const customerKey = customerId.toString();
    let customerGroup = groupsByCustomer.get(customerKey);
    if (!customerGroup) {
      customerGroup = { customerId, atmIds: [], atmIdKeys: new Set() };
      groupsByCustomer.set(customerKey, customerGroup);
    }

    for (const atmId of group.atmIds) {
      if (!mongoose.isValidObjectId(atmId)) {
        throw new ApiError(400, "ATM ID is invalid");
      }
      const atmObjectId = new mongoose.Types.ObjectId(atmId);
      const atmKey = atmObjectId.toString();
      if (!customerGroup.atmIdKeys.has(atmKey)) {
        customerGroup.atmIdKeys.add(atmKey);
        customerGroup.atmIds.push(atmObjectId);
      }
    }
  }

  const operations = [...groupsByCustomer.values()].map(
    ({ customerId, atmIds }) => ({
      updateOne: {
        filter: { _id: customerId, isActive: true, isDeleted: false },
        update: {
          $addToSet: { atmIds: { $each: atmIds } },
          ...(updatedBy ? { $set: { updatedBy } } : {}),
        },
      },
    }),
  );
  const result = await Customer.bulkWrite(operations, { session });
  if (result.matchedCount !== operations.length) {
    throw new ApiError(
      404,
      "One or more Customers are missing, inactive, or deleted",
    );
  }
  return result;
};

export const softDeleteATMAndUnlinkCustomer = async ({
  atmId,
  updatedBy,
}) =>
  withCustomerAssignmentTransaction(async (session) => {
    const atm = await withSession(
      ATM.findOne({ _id: atmId, isDeleted: false }),
      session,
    );
    if (!atm) throw new ApiError(404, "ATM not found");

    atm.isDeleted = true;
    atm.updatedBy = updatedBy;
    await atm.save({ session });

    await Customer.updateMany(
      { atmIds: atm._id },
      { $pull: { atmIds: atm._id } },
      { session },
    );
    return atm;
  });

export const softDeleteCustomerIfUnassigned = async ({
  customerId,
  updatedBy,
}) =>
  withCustomerAssignmentTransaction(async (session) => {
    const customer = await withSession(
      Customer.findOne({ _id: customerId, isDeleted: false }),
      session,
    );
    if (!customer) throw new ApiError(404, "Customer not found");

    const activeATM = await withSession(
      ATM.findOne({ customer: customer._id, isDeleted: false }).select("_id"),
      session,
    );
    if (activeATM) {
      throw new ApiError(
        409,
        "Customer cannot be deleted while active ATMs are assigned",
      );
    }

    customer.isDeleted = true;
    customer.updatedBy = updatedBy;
    await customer.save({ session });
    await User.findByIdAndUpdate(
      customer.userId,
      { status: "inactive" },
      { session },
    );
  });
