import asyncHandler from "../../utils/asyncHandler.js";
import ApiResponse from "../../utils/ApiResponse.js";
import ApiError from "../../utils/ApiError.js";
import Bank from "./bank.model.js";

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

  const bank = await Bank.findById(id);
  if (!bank) {
    throw new ApiError(404, "Bank not found");
  }

  if (bankName !== undefined) bank.bankName = bankName.trim();
  if (bankCode !== undefined) bank.bankCode = bankCode.trim().toUpperCase();
  if (contactEmail !== undefined)
    bank.contactEmail = contactEmail.trim().toLowerCase();
  if (contactPhone !== undefined) bank.contactPhone = contactPhone.trim();
  if (address !== undefined) bank.address = address.trim();
  if (isActive !== undefined) bank.isActive = isActive;

  bank.updatedBy = req.user._id;
  await bank.save();

  return res
    .status(200)
    .json(new ApiResponse(200, bank, "Bank updated successfully"));
});

// ============================================
// 5. DELETE BANK (Soft Delete)
// ============================================
export const deleteBank = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const bank = await Bank.findById(id);
  if (!bank) {
    throw new ApiError(404, "Bank not found");
  }

  // Check if any ATM is using this bank
  const ATM = (await import("../atms/atm.model.js")).default;
  const linkedATMs = await ATM.countDocuments({ bankId: id, isDeleted: false });

  if (linkedATMs > 0) {
    throw new ApiError(
      400,
      `Cannot delete bank. ${linkedATMs} ATM(s) are linked to this bank.`,
    );
  }

  bank.isActive = false;
  bank.updatedBy = req.user._id;
  await bank.save();

  return res
    .status(200)
    .json(new ApiResponse(200, bank, "Bank deactivated successfully"));
});
