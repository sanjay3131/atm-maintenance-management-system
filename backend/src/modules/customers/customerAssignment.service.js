import mongoose from "mongoose";
import ApiError from "../../utils/ApiError.js";
import ATM from "../atms/atm.model.js";
import User from "../users/user.model.js";
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
