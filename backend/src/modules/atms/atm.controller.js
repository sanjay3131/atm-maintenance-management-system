import ApiError from "../../utils/ApiError.js";
import ApiResponse from "../../utils/ApiResponse.js";
import asyncHandler from "../../utils/asyncHandler.js";
import Customer from "../customers/customer.model.js";
import District from "../districts/district.models.js";
import Employee from "../employees/employee.model.js";
import Region from "../region/region.model.js";
import User from "../users/user.model.js";
import ATM from "./atm.model.js";
import { generateATMId } from "./atm.utils.js";

const validateActiveEmployee = async (employeeId) => {
  const employee = await Employee.findById(employeeId).populate(
    "userId",
    "userType status",
  );

  if (!employee) throw new ApiError(404, "Employee not found");
  if (
    employee.status !== "active" ||
    employee.userId?.status !== "active" ||
    employee.userId?.userType !== "employee"
  ) {
    throw new ApiError(400, "Employee is inactive");
  }

  return employee;
};

const syncATMEmployeeAssignment = async (atm, employeeId, updatedBy) => {
  atm.assignedEmployeeId = employeeId ? [employeeId] : [];
  atm.updatedBy = updatedBy;
  await atm.save();

  await Employee.updateMany(
    { assignedAtmIds: atm._id },
    { $pull: { assignedAtmIds: atm._id } },
  );

  if (employeeId) {
    await Employee.updateOne(
      { _id: employeeId },
      {
        $addToSet: { assignedAtmIds: atm._id },
        $set: { updatedBy },
      },
    );
  }
};

export const createATM = asyncHandler(async (req, res) => {
  const {
    bankId,
    districtId,
    regionId,
    locationName,
    address,
    installationType,
    location,
    customerId,
    status,
    assignedEmployeeId,
  } = req.body;
  const assignedEmployeeIds = [...new Set((assignedEmployeeId || []).map(String))];

  if (assignedEmployeeIds.length > 0) {
    if (assignedEmployeeIds.length > 1) {
      throw new ApiError(400, "An ATM can have only one assigned employee");
    }
    await validateActiveEmployee(assignedEmployeeIds[0]);
  }

  const isValidDistrictId = await District.findById(districtId);
  const isValidRegionId = await Region.findById(regionId);

  const resolvedCustomerId = customerId;
  if (resolvedCustomerId) {
    const cust = await Customer.findOne({
      _id: resolvedCustomerId,
      isActive: true,
      isDeleted: false,
    });

    if (!cust) throw new ApiError(404, "Customer not found...");
  }
  if (!isValidDistrictId || !isValidRegionId) {
    throw new ApiError(404, "district or region is not valid");
  }
  const atmId = await generateATMId();

  const atm = await ATM.create({
    atmId,
    bankId,
    customer: resolvedCustomerId,
    districtId,
    regionId,
    locationName,
    address,
    installationType,
    location,
    status,
    assignedEmployeeId: assignedEmployeeIds,
    createdBy: req.user._id,
  });

  if (assignedEmployeeIds.length > 0) {
    await syncATMEmployeeAssignment(atm, assignedEmployeeIds[0], req.user._id);
  }

  return res
    .status(201)
    .json(new ApiResponse(201, atm, "ATM created successfully"));
});

// view all atm
export const getAllATMs = asyncHandler(async (req, res) => {
  const atms = await ATM.find({ isDeleted: false })
    .populate("bankId", "bankName")
    .populate("districtId", "districtName")
    .populate("regionId", "name")
    .populate({
      path: "assignedEmployeeId",
      select: "employeeCode userId",
      populate: { path: "userId", select: "firstName lastName status" },
    })
    .populate("customer", "customerName");

  return res
    .status(200)
    .json(new ApiResponse(200, atms, "ATMs fetched successfully"));
});

// view single atm

export const getATMById = asyncHandler(async (req, res) => {
  const atm = await ATM.findById(req.params.id)
    .populate("bankId", "bankName")
    .populate("districtId", "districtName")
    .populate("regionId", "name")
    .populate("customer", "customerName")
    .populate({
      path: "assignedEmployeeId",
      select: "employeeCode userId",
      populate: {
        path: "userId",
        select: "firstName lastName phoneNumber email",
      },
    });
  if (!atm || atm.isDeleted) {
    throw new ApiError(404, "ATM not found");
  }

  return res
    .status(200)
    .json(new ApiResponse(200, atm, "ATM fetched successfully"));
});

// update atm
export const updateATM = asyncHandler(async (req, res) => {
  const updatePayload = { ...req.body };
  const atm = await ATM.findById(req.params.id);

  if (!atm || atm.isDeleted) {
    throw new ApiError(404, "ATM not found");
  }

  let assignedEmployeeIds;
  if (
    Object.prototype.hasOwnProperty.call(updatePayload, "assignedEmployeeId")
  ) {
    assignedEmployeeIds = [
      ...new Set((updatePayload.assignedEmployeeId || []).map(String)),
    ];

    if (assignedEmployeeIds.length > 0) {
      if (assignedEmployeeIds.length > 1) {
        throw new ApiError(400, "An ATM can have only one assigned employee");
      }
      await validateActiveEmployee(assignedEmployeeIds[0]);
    }

    delete updatePayload.assignedEmployeeId;
  }

  if (Object.prototype.hasOwnProperty.call(updatePayload, "customerId")) {
    const customerId = updatePayload.customerId || updatePayload.customer;

    if (customerId) {
      const cust = await Customer.findOne({
        _id: customerId,
        isActive: true,
        isDeleted: false,
      });
      if (!cust) throw new ApiError(404, "Customer not found");
    }

    if (customerId) {
      updatePayload.customer = customerId;
    }
    delete updatePayload.customerId;
  }

  const updatedATM = await ATM.findByIdAndUpdate(
    req.params.id,
    {
      ...updatePayload,
      updatedBy: req.user._id,
    },
    {
      new: true,
      runValidators: true,
    },
  );

  if (!updatedATM || updatedATM.isDeleted) {
    throw new ApiError(404, "ATM not found");
  }

  if (assignedEmployeeIds !== undefined) {
    await syncATMEmployeeAssignment(
      updatedATM,
      assignedEmployeeIds[0] || null,
      req.user._id,
    );
  }

  return res
    .status(200)
    .json(new ApiResponse(200, updatedATM, "ATM updated successfully"));
});

// delete atm (soft delete)
export const deleteATM = asyncHandler(async (req, res) => {
  const atm = await ATM.findById(req.params.id);

  if (!atm || atm.isDeleted) {
    throw new ApiError(404, "ATM not found");
  }

  atm.isDeleted = true;
  atm.updatedBy = req.user._id;

  await atm.save();

  return res
    .status(200)
    .json(new ApiResponse(200, atm, "ATM deleted successfully"));
});

// assign employee to atm
export const assignEmployeeToATM = asyncHandler(async (req, res) => {
  const { employeeId } = req.body;
  const atmId = req.params.id;

  if (!/^[a-fA-F0-9]{24}$/.test(atmId)) {
    throw new ApiError(400, "Invalid ATM ID");
  }

  const atm = await ATM.findById(atmId);
  if (!atm || atm.isDeleted) {
    throw new ApiError(404, "ATM not found");
  }

  await validateActiveEmployee(employeeId);
  await syncATMEmployeeAssignment(atm, employeeId, req.user._id);

  return res
    .status(200)
    .json(
      new ApiResponse(200, atm, "ATM employee assignment updated successfully"),
    );
});

// ============================================
// SET ATM LOCATION (Employee)
// ============================================
export const setATMLocation = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { latitude, longitude, accuracy } = req.body;

  if (req.user.userType !== "employee") {
    throw new ApiError(403, "Only employees can set ATM location");
  }

  const atm = await ATM.findById(id);
  if (!atm || atm.isDeleted) throw new ApiError(404, "ATM not found");

  // Verify employee is assigned to this ATM
  const employee = await Employee.findOne({ userId: req.user._id });
  if (!employee) throw new ApiError(404, "Employee not found");

  const atmEmployeeIds = (atm.assignedEmployeeId || []).map((employeeId) =>
    employeeId.toString(),
  );
  if (!atmEmployeeIds.includes(employee._id.toString())) {
    throw new ApiError(403, "You are not assigned to this ATM");
  }

  // If already configured, block (admin can override via updateATM)
  if (atm.locationConfigured) {
    throw new ApiError(
      400,
      "ATM location already configured. Contact admin to reset.",
    );
  }

  // Validate coordinates
  if (typeof latitude !== "number" || typeof longitude !== "number") {
    throw new ApiError(400, "Invalid coordinates");
  }

  if (accuracy && accuracy > 50) {
    throw new ApiError(
      400,
      "GPS accuracy is too low. Please move to an open area and try again.",
    );
  }

  atm.location = {
    type: "Point",
    coordinates: [longitude, latitude],
  };
  atm.locationConfigured = true;
  atm.locationCapturedAt = new Date();
  atm.locationCapturedBy = req.user._id;
  atm.locationAccuracy = accuracy || null;
  atm.updatedBy = req.user._id;

  await atm.save();

  return res
    .status(200)
    .json(new ApiResponse(200, atm, "ATM location configured successfully"));
});

// ============================================
// GET ATM LOCATION STATUS (Admin)
// ============================================
export const getATMLocationStatus = asyncHandler(async (req, res) => {
  const isAdmin = ["admin", "superAdmin"].includes(req.user.userType);
  if (!isAdmin) throw new ApiError(403, "Access denied");

  const { configured, page = 1, limit = 20 } = req.query;

  const query = { isDeleted: false };
  if (configured !== undefined) {
    query.locationConfigured = configured === "true";
  }

  const skip = (parseInt(page) - 1) * parseInt(limit);

  const [atms, total] = await Promise.all([
    ATM.find(query)
      .populate("districtId", "districtName")
      .populate("bankId", "bankName")
      .populate("locationCapturedBy", "firstName lastName")
      .populate("assignedEmployeeId", "employeeCode firstName lastName")
      .sort({ locationConfigured: 1, createdAt: -1 })
      .skip(skip)
      .limit(parseInt(limit)),
    ATM.countDocuments(query),
  ]);

  const stats = {
    total: await ATM.countDocuments({ isDeleted: false }),
    configured: await ATM.countDocuments({
      isDeleted: false,
      locationConfigured: true,
    }),
    notConfigured: await ATM.countDocuments({
      isDeleted: false,
      locationConfigured: false,
    }),
  };

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        atms,
        stats,
        pagination: { page: parseInt(page), limit: parseInt(limit), total },
      },
      "ATM location status fetched",
    ),
  );
});
