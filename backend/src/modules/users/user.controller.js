import asyncHandler from "../../utils/asyncHandler.js";
import ApiResponse from "../../utils/ApiResponse.js";
import User from "./user.model.js";
import { sanitizeUser } from "../../utils/sanitizeUser.js";
import { hashPassword } from "../auth/auth.utils.js";
import ApiError from "../../utils/ApiError.js";
import Employee from "../employees/employee.model.js";
import {
  replaceEmployeeATMAssignmentsInTransaction,
  withEmployeeAssignmentTransaction,
} from "../employees/employeeAssignment.service.js";
import Customer from "../customers/customer.model.js";
import Bank from "../banks/bank.model.js";
import { generateEmployeeCode } from "../employees/employee.utils.js";
import { resolveSupervisorId } from "../employees/employeeSupervisor.service.js";
import {
  guardUserEligibilityChange,
  withAMCResponsibilityTransaction,
} from "../amc/amcResponsibility.service.js";
import { throwEmployeeUserIdConflict } from "../employees/employeeUserIdIndex.js";
import { escapeRegex } from "../../utils/geographicQuery.js";

export const getAllUsers = asyncHandler(async (req, res) => {
  const isAdmin =
    req.user.userType === "admin" || req.user.userType === "superAdmin";

  if (!isAdmin) {
    return res
      .status(403)
      .json(
        new ApiResponse(
          403,
          "You do not have permission to access this resource",
        ),
      );
  }

  const users = await User.find()
    .select("-password")
    .sort({
      firstName: 1,
    })
    .select("-password -refreshToken");

  return res
    .status(200)
    .json(new ApiResponse(200, { users }, "Users listed successfully"));
});

export const getSupervisors = asyncHandler(async (req, res) => {
  const supervisors = await User.find({
    userType: "supervisor",
    status: "active",
  })
    .select("_id firstName lastName email status")
    .sort({ firstName: 1, lastName: 1 });

  return res
    .status(200)
    .json(new ApiResponse(200, { supervisors }, "Supervisors fetched"));
});

const isDuplicateKeyError = (error) => error?.code === 11000;

const supervisorManagementFilter = (search) => ({
  userType: "supervisor",
  ...(search
    ? {
        $or: ["firstName", "lastName", "email", "phoneNumber"].map((field) => ({
          [field]: { $regex: escapeRegex(search), $options: "i" },
        })),
      }
    : {}),
});

export const getSupervisorManagementList = asyncHandler(async (req, res) => {
  const { search, page, limit } = req.validatedQuery;
  const filter = supervisorManagementFilter(search);
  const skip = (page - 1) * limit;
  const [supervisors, total] = await Promise.all([
    User.find(filter)
      .select("_id firstName lastName email phoneNumber status createdAt")
      .sort({ firstName: 1, lastName: 1, _id: 1 })
      .skip(skip)
      .limit(limit),
    User.countDocuments(filter),
  ]);
  const supervisorIds = supervisors.map(({ _id }) => _id);
  const teamCounts = supervisorIds.length
    ? await Employee.aggregate([
        { $match: { supervisorId: { $in: supervisorIds } } },
        { $group: { _id: "$supervisorId", count: { $sum: 1 } } },
      ])
    : [];
  const countsBySupervisor = new Map(
    teamCounts.map(({ _id, count }) => [String(_id), count]),
  );

  return res.status(200).json(
    new ApiResponse(
      200,
      {
        supervisors: supervisors.map((supervisor) => ({
          ...supervisor.toObject(),
          teamCount: countsBySupervisor.get(String(supervisor._id)) ?? 0,
        })),
        pagination: {
          page,
          limit,
          total,
          totalPages: Math.ceil(total / limit),
        },
      },
      "Supervisors listed successfully",
    ),
  );
});

export const getSupervisorManagementDetails = asyncHandler(async (req, res) => {
  const supervisor = await User.findOne({
    _id: req.validatedParams.id,
    userType: "supervisor",
  }).select("_id firstName lastName email phoneNumber status createdAt");
  if (!supervisor) throw new ApiError(404, "Supervisor not found");

  const teamCount = await Employee.countDocuments({
    supervisorId: supervisor._id,
  });
  return res.status(200).json(
    new ApiResponse(
      200,
      { supervisor: { ...supervisor.toObject(), teamCount } },
      "Supervisor retrieved successfully",
    ),
  );
});

export const createSupervisor = asyncHandler(async (req, res) => {
  const { firstName, lastName, email, password, phoneNumber } = req.body;
  const normalizedEmail = email.toLowerCase().trim();
  const normalizedPhone = phoneNumber.trim();
  const existingUser = await User.findOne({
    $or: [{ email: normalizedEmail }, { phoneNumber: normalizedPhone }],
  }).select("_id");
  if (existingUser) {
    throw new ApiError(409, "User already exists with this email or phone number");
  }

  let supervisor;
  try {
    supervisor = await User.create({
      firstName: firstName.trim(),
      lastName: lastName?.trim() || "",
      email: normalizedEmail,
      password: await hashPassword(password),
      phoneNumber: normalizedPhone,
      userType: "supervisor",
    });
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new ApiError(409, "User already exists with this email or phone number");
    }
    throw error;
  }
  return res
    .status(201)
    .json(
      new ApiResponse(
        201,
        { supervisor: sanitizeUser(supervisor) },
        "Supervisor created successfully",
      ),
    );
});

export const updateSupervisor = asyncHandler(async (req, res) => {
  const supervisor = await User.findOne({
    _id: req.validatedParams.id,
    userType: "supervisor",
  });
  if (!supervisor) throw new ApiError(404, "Supervisor not found");

  const { firstName, lastName, email, phoneNumber } = req.body;
  const normalizedEmail = email?.toLowerCase().trim();
  const normalizedPhone = phoneNumber?.trim();
  const duplicateFields = [
    ...(normalizedEmail ? [{ email: normalizedEmail }] : []),
    ...(normalizedPhone ? [{ phoneNumber: normalizedPhone }] : []),
  ];
  const duplicate = duplicateFields.length
    ? await User.findOne({
        _id: { $ne: supervisor._id },
        $or: duplicateFields,
      }).select("_id")
    : null;
  if (duplicate) {
    throw new ApiError(409, "User already exists with this email or phone number");
  }

  if (firstName !== undefined) supervisor.firstName = firstName;
  if (lastName !== undefined) supervisor.lastName = lastName;
  if (normalizedEmail !== undefined) supervisor.email = normalizedEmail;
  if (normalizedPhone !== undefined) supervisor.phoneNumber = normalizedPhone;
  try {
    await supervisor.save();
  } catch (error) {
    if (isDuplicateKeyError(error)) {
      throw new ApiError(409, "User already exists with this email or phone number");
    }
    throw error;
  }
  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { supervisor: sanitizeUser(supervisor) },
        "Supervisor updated successfully",
      ),
    );
});

export const updateSupervisorStatus = asyncHandler(async (req, res) => {
  const { id } = req.validatedParams;
  const { status } = req.body;
  let supervisor = await User.findOne({ _id: id, userType: "supervisor" });
  if (!supervisor) throw new ApiError(404, "Supervisor not found");

  if (status === "inactive") {
    supervisor = await withAMCResponsibilityTransaction(async (session) => {
      const currentSupervisor = await User.findOne({
        _id: id,
        userType: "supervisor",
      }).session(session);
      if (!currentSupervisor) return null;
      await guardUserEligibilityChange({
        userId: currentSupervisor._id,
        session,
        updatedBy: req.user._id,
      });
      currentSupervisor.status = status;
      await currentSupervisor.save({ session });
      return currentSupervisor;
    });
    if (!supervisor) throw new ApiError(404, "Supervisor not found");
  } else {
    supervisor.status = status;
    await supervisor.save();
  }
  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { supervisor: sanitizeUser(supervisor) },
        "Supervisor status updated successfully",
      ),
    );
});

// get user by id

export const getUserById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const user = await User.findById(id).select("-password");

  if (!user) {
    return res
      .status(404)
      .json(new ApiResponse(404, "User not found", "User not found"));
  }

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { user: sanitizeUser(user) },
        "User retrieved successfully",
      ),
    );
});

// update user by id (user and admins)

export const updateUserById = asyncHandler(async (req, res) => {
  const { id } = req.params;

  const isAdmin =
    req.user.userType === "admin" || req.user.userType === "superAdmin";
  const isSelf = req.user._id.toString() === id;

  if (!isAdmin && !isSelf) {
    return res
      .status(403)
      .json(
        new ApiResponse(
          403,
          "You do not have permission to access this resource",
        ),
      );
  }
  const { firstName, lastName, email, phoneNumber } = req.body;

  const user = await User.findById(id);

  if (!user) {
    return res
      .status(404)
      .json(new ApiResponse(404, "User not found", "User not found"));
  }

  user.firstName = firstName || user.firstName;
  user.lastName = lastName || user.lastName;
  user.email = email || user.email;
  user.phoneNumber = phoneNumber || user.phoneNumber;

  await user.save();

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { user: sanitizeUser(user) },
        "User updated successfully",
      ),
    );
});

// role assign by admin and superAdmin
export const assignRoleToUser = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { role } = req.body;

  const isAdmin =
    req.user.userType === "admin" || req.user.userType === "superAdmin";

  if (!isAdmin) {
    return res
      .status(403)
      .json(
        new ApiResponse(
          403,
          "You do not have permission to access this resource",
        ),
      );
  }

  let user = await User.findById(id);

  if (!user) {
    return res
      .status(404)
      .json(new ApiResponse(404, "User not found", "User not found"));
  }

  if (role && role !== "employee") {
    user = await withAMCResponsibilityTransaction(async (session) => {
      const currentUser = await User.findById(id).session(session);
      if (!currentUser) return null;
      await guardUserEligibilityChange({
        userId: currentUser._id,
        session,
        updatedBy: req.user._id,
      });
      currentUser.userType = role;
      await currentUser.save({ session });
      return currentUser;
    });
  } else {
    user.userType = role || user.userType;
    await user.save();
  }

  if (!user) {
    return res
      .status(404)
      .json(new ApiResponse(404, "User not found", "User not found"));
  }

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { user: sanitizeUser(user) },
        "User role updated successfully",
      ),
    );
});

// status change by admin and superAdmin

export const changeUserStatus = asyncHandler(async (req, res) => {
  const { id } = req.params;
  const { status } = req.body;

  const isAdmin =
    req.user.userType === "admin" || req.user.userType === "superAdmin";

  if (!isAdmin) {
    return res
      .status(403)
      .json(
        new ApiResponse(
          403,
          "You do not have permission to access this resource",
        ),
      );
  }

  let user = await User.findById(id);

  if (!user) {
    return res
      .status(404)
      .json(new ApiResponse(404, "User not found", "User not found"));
  }

  if (status && status !== "active") {
    user = await withAMCResponsibilityTransaction(async (session) => {
      const currentUser = await User.findById(id).session(session);
      if (!currentUser) return null;
      await guardUserEligibilityChange({
        userId: currentUser._id,
        session,
        updatedBy: req.user._id,
      });
      currentUser.status = status;
      await currentUser.save({ session });
      return currentUser;
    });
  } else {
    user.status = status || user.status;
    await user.save();
  }

  if (!user) {
    return res
      .status(404)
      .json(new ApiResponse(404, "User not found", "User not found"));
  }

  return res
    .status(200)
    .json(
      new ApiResponse(
        200,
        { user: sanitizeUser(user) },
        "User status updated successfully",
      ),
    );
});

export const createEmployeeUser = asyncHandler(async (req, res) => {
  const { firstName, lastName, email, password, phoneNumber } = req.body;

  const normalizedEmail = email.toLowerCase().trim();

  // Check duplicate email
  const existingEmail = await User.findOne({
    email: normalizedEmail,
  });

  if (existingEmail) {
    throw new ApiError(409, "Email already exists");
  }

  // Check duplicate phone
  const existingPhone = await User.findOne({
    phoneNumber,
  });

  if (existingPhone) {
    throw new ApiError(409, "Phone number already exists");
  }

  const hashedPassword = await hashPassword(password);

  const user = await User.create({
    firstName: firstName.trim(),
    lastName: lastName?.trim() || "",
    email: normalizedEmail,
    password: hashedPassword,
    phoneNumber: phoneNumber.trim(),
    userType: "employee",
  });

  const sanitizedUser = sanitizeUser(user);

  return res
    .status(201)
    .json(
      new ApiResponse(
        201,
        { user: sanitizedUser },
        "Employee user created successfully",
      ),
    );
});

const createUserForRole = async (
  req,
  res,
  role,
  requireActiveCustomerBank = false,
) => {
  const { user: userData, employee, customer } = req.body;
  let supervisorId = null;

  if (role === "employee" && employee.supervisorId) {
    supervisorId = await resolveSupervisorId(employee.supervisorId);
  }

  if (role === "customer" && requireActiveCustomerBank) {
    const bank = await Bank.findOne({
      bankName: customer.bankName,
      isActive: true,
    });
    if (!bank) {
      throw new ApiError(400, "Select an active bank");
    }
  }

  const existingUser = await User.findOne({
    $or: [
      { email: userData.email.toLowerCase() },
      { phoneNumber: userData.phoneNumber },
    ],
  });

  if (existingUser) {
    throw new ApiError(
      409,
      "User already exists with this email or phone number",
    );
  }

  const hashedPassword = await hashPassword(userData.password);

  const user = await User.create({
    firstName: userData.firstName,
    lastName: userData.lastName,
    email: userData.email.toLowerCase(),
    password: hashedPassword,
    phoneNumber: userData.phoneNumber,
    userType: role,
  });

  try {
    if (role === "employee") {
      const employeeCode = await generateEmployeeCode();
      const assignedAtmIds = [
        ...new Set((employee.assignedAtmIds || []).map(String)),
      ];

      const employeeData = {
        userId: user._id,
        employeeCode,
        designation: employee.designation,
        department: employee.department,
        joiningDate: employee.joiningDate,
        employmentType: employee.employmentType,
        districtIds: employee.districtIds,
        assignedAtmIds: [],
        regionIds: employee.regionIds,
        supervisorId,
        salary: employee.salary,
        createdBy: req.user._id,
      };

      if (assignedAtmIds.length > 0) {
        await withEmployeeAssignmentTransaction(async (session) => {
          const [newEmployee] = await Employee.create([employeeData], {
            session,
          });
          return replaceEmployeeATMAssignmentsInTransaction({
            employeeId: newEmployee._id,
            assignedAtmIds,
            updatedBy: req.user._id,
            session,
          });
        });
      } else {
        await Employee.create(employeeData);
      }
    }

    if (role === "customer") {
      await Customer.create({
        userId: user._id,
        customerName: customer.customerName,
        customerEmail: customer.customerEmail,
        customerPhone: customer.customerPhone,
        bankName: customer.bankName,
        atmIds: [],
        districtIds: customer.districtIds,
        createdBy: req.user._id,
      });
    }
  } catch (error) {
    await User.findByIdAndDelete(user._id);

    throwEmployeeUserIdConflict(error);
  }

  return res.status(201).json(
    new ApiResponse(
      201,
      {
        user: sanitizeUser(user),
        role,
      },
      "User created successfully",
    ),
  );
};

export const createUserWizard = asyncHandler(async (req, res) =>
  createUserForRole(req, res, req.body.role),
);

export const createCustomerUserWizard = asyncHandler(async (req, res) =>
  createUserForRole(req, res, "customer", true),
);
