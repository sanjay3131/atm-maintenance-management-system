import asyncHandler from "../../utils/asyncHandler.js";
import ApiResponse from "../../utils/ApiResponse.js";
import ApiError from "../../utils/ApiError.js";
import Bank from "./bank.model.js";
import ATM from "../atms/atm.model.js";
import District from "../districts/district.models.js";
import Region from "../region/region.model.js";
import { withGeographyFence } from "../districts/districtGeography.service.js";

const findLinkedRecord = async (Model, filter, session) =>
  Model.findOne(filter).select("_id").session(session).lean();

const assertBankCanBeDeactivated = async (bankId, session) => {
  if (await findLinkedRecord(Region, { bankId, isActive: true }, session)) {
    throw new ApiError(
      409,
      "Cannot deactivate the Bank while active Regions are linked",
    );
  }
  if (await findLinkedRecord(District, { bankId, isActive: true }, session)) {
    throw new ApiError(
      409,
      "Cannot deactivate the Bank while active Districts are linked",
    );
  }
  if (
    await findLinkedRecord(ATM, { bankId, isDeleted: { $ne: true } }, session)
  ) {
    throw new ApiError(
      409,
      "Cannot deactivate the Bank while non-deleted ATMs are linked",
    );
  }
};

const translateMissingBankFence = (error, bankId) => {
  if (error.message === `Geography fence bank ${bankId} not found`) {
    throw new ApiError(404, "Bank not found");
  }
};

// ============================================
// 1. CREATE BANK
// ============================================
export const createBank = asyncHandler(async (req, res) => {
  const { bankName, bankCode, contactEmail, contactPhone, address } = req.body;

  const existingBank = await Bank.findOne({
    $or: [
      { bankName: bankName.trim() },
      { bankCode: bankCode.trim().toUpperCase() },
    ],
  });

  if (existingBank) {
    throw new ApiError(409, "Bank with this name or code already exists");
  }

  const bank = await Bank.create({
    bankName: bankName.trim(),
    bankCode: bankCode.trim().toUpperCase(),
    contactEmail: contactEmail?.trim().toLowerCase(),
    contactPhone: contactPhone?.trim(),
    address: address?.trim(),
    createdBy: req.user._id,
  });

  return res
    .status(201)
    .json(new ApiResponse(201, bank, "Bank created successfully"));
});

// ============================================
// 2. GET ALL BANKS
// ============================================
export const getAllBanks = asyncHandler(async (req, res) => {
  const { search, isActive } = req.query;

  const query = {};
  if (isActive !== undefined) query.isActive = isActive === "true";
  if (search?.trim()) {
    query.$or = [
      { bankName: { $regex: search.trim(), $options: "i" } },
      { bankCode: { $regex: search.trim(), $options: "i" } },
    ];
  }

  const banks = await Bank.find(query)
    .populate("createdBy", "firstName lastName")
    .sort({ bankName: 1 });

  return res
    .status(200)
    .json(new ApiResponse(200, banks, "Banks fetched successfully"));
});

// ============================================
// 3. GET BANK BY ID
// ============================================
export const getBankById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const bank = await Bank.findById(id).populate(
    "createdBy updatedBy",
    "firstName lastName",
  );

  if (!bank) {
    throw new ApiError(404, "Bank not found");
  }

  return res
    .status(200)
    .json(new ApiResponse(200, bank, "Bank fetched successfully"));
});

// ============================================
// 4. UPDATE BANK
// ============================================
export const updateBank = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { bankName, bankCode, contactEmail, contactPhone, address, isActive } =
    req.body;

  const update = async (session) => {
    let query = Bank.findById(id);
    if (session) query = query.session(session);
    const bank = await query;
    if (!bank) throw new ApiError(404, "Bank not found");

    if (isActive === false) await assertBankCanBeDeactivated(id, session);
    if (bankName !== undefined) bank.bankName = bankName.trim();
    if (bankCode !== undefined) bank.bankCode = bankCode.trim().toUpperCase();
    if (contactEmail !== undefined)
      bank.contactEmail = contactEmail.trim().toLowerCase();
    if (contactPhone !== undefined) bank.contactPhone = contactPhone.trim();
    if (address !== undefined) bank.address = address.trim();
    if (isActive !== undefined) bank.isActive = isActive;

    bank.updatedBy = req.user._id;
    if (session) await bank.save({ session });
    else await bank.save();
    return bank;
  };

  let bank;
  if (isActive === false) {
    try {
      bank = await withGeographyFence({ bankIds: [id] }, update);
    } catch (error) {
      translateMissingBankFence(error, id);
      throw error;
    }
  } else {
    bank = await update();
  }

  return res
    .status(200)
    .json(new ApiResponse(200, bank, "Bank updated successfully"));
});

// ============================================
// 5. DELETE BANK (Soft Delete)
// ============================================
export const deleteBank = asyncHandler(async (req, res) => {
  const { id } = req.params;

  let bank;
  try {
    bank = await withGeographyFence({ bankIds: [id] }, async (session) => {
      const currentBank = await Bank.findById(id).session(session);
      if (!currentBank) throw new ApiError(404, "Bank not found");

      await assertBankCanBeDeactivated(id, session);
      currentBank.isActive = false;
      currentBank.updatedBy = req.user._id;
      await currentBank.save({ session });
      return currentBank;
    });
  } catch (error) {
    translateMissingBankFence(error, id);
    throw error;
  }

  return res
    .status(200)
    .json(new ApiResponse(200, bank, "Bank deactivated successfully"));
});
