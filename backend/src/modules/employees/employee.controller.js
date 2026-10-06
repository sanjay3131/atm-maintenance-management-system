// create eployee

import asyncHandler from "../../utils/asyncHandler.js";
import ApiResponse from "../../utils/ApiResponse.js";
import User from "../users/user.model.js";
import Employee from "./employee.model.js";
import { generateEmployeeCode } from "./employee.utils.js";
import ApiError from "../../utils/ApiError.js";
import ATM from "../atms/atm.model.js";
import {
  buildATMGeographicQuery,
  escapeRegex,
  parsePagination,
} from "../../utils/geographicQuery.js";

const ensureATMsAvailableForEmployee = async (atmIds, employeeId = null) => {
  if (atmIds.length === 0) return;

  const atms = await ATM.find({ _id: { $in: atmIds } }).select(
    "_id atmId assignedEmployeeId",
  );
  const conflictingATM = atms.find((atm) =>
    (atm.assignedEmployeeId || []).some(
      (assignedId) => assignedId.toString() !== employeeId?.toString(),
    ),
  );

  if (conflictingATM) {
    throw new ApiError(
      409,
      `ATM ${conflictingATM.atmId} is already assigned to another employee. Reassign it from ATM management.`,
    );
  }
};

const syncEmployeeATMAssignments = async (atmIds, employeeId) => {
  if (atmIds.length === 0) return;

  await Employee.updateMany(
    {
      _id: { $ne: employeeId },
      assignedAtmIds: { $in: atmIds },
    },
    { $pull: { assignedAtmIds: { $in: atmIds } } },
  );
  await ATM.updateMany(
    { _id: { $in: atmIds } },
    { $set: { assignedEmployeeId: [employeeId] } },
  );
};

export const createEmployee = asyncHandler(async (req, res) => {
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

  const { userId } = req.params;

  const user = await User.findById(userId);

  if (!user) {
    return res
      .status(404)
      .json(new ApiResponse(404, "User not found", "User not found"));
  }

  const existingEmployee = await Employee.findOne({ userId: user._id });

  if (existingEmployee) {
    return res
      .status(400)
      .json(
        new ApiResponse(
          400,
          "Employee already exists for this user",
          "Employee already exists for this user",
        ),
      );
  }
  if (user.userType !== "employee") {
    return res
      .status(400)
      .json(
        new ApiResponse(
          400,
          "User is not an employee",
          "User is not an employee",
        ),
      );
  }
  if (user.status !== "active") {
    throw new ApiError(400, "Employee is inactive");
  }
  const {
    designation,
    department,
    joiningDate,
    employmentType,
    districtIds,
    assignedAtmIds,
    salary,
  } = req.body;
  const uniqueAssignedAtmIds = [...new Set((assignedAtmIds || []).map(String))];

  if (uniqueAssignedAtmIds.length > 0) {
    const atms = await ATM.find({
      _id: { $in: uniqueAssignedAtmIds },
    }).select("_id");
    if (atms.length !== uniqueAssignedAtmIds.length) {
      throw new ApiError(404, "One or more ATMs not found");
    }
    await ensureATMsAvailableForEmployee(uniqueAssignedAtmIds);
  }

  const employeeCode = await generateEmployeeCode();

  const newEmployee = await Employee.create({
    userId: user._id,
    employeeCode,
    designation,
    department,
    joiningDate,
    employmentType,
    districtIds,
    assignedAtmIds: uniqueAssignedAtmIds,
    salary,
    createdBy: req.user._id,
  });

  if (uniqueAssignedAtmIds.length > 0) {
    await syncEmployeeATMAssignments(
      uniqueAssignedAtmIds,
      newEmployee._id,
    );
  }

  return res
    .status(201)
    .json(new ApiResponse(201, newEmployee, "Employee created successfully"));
});

// update employee by id (admin and superAdmin)

export const updateEmployee = asyncHandler(async (req, res) => {
  const { employeeId } = req.params;
  const employee = await Employee.findById(employeeId);

  if (!employee) {
    return res
      .status(404)
      .json(new ApiResponse(404, "Employee not found", null));
  }

  const updatePayload = { ...req.body };
  let assignedAtmIds;
  let previousAtmIds;
  if (Object.prototype.hasOwnProperty.call(updatePayload, "assignedAtmIds")) {
    assignedAtmIds = [
      ...new Set((updatePayload.assignedAtmIds || []).map(String)),
    ];
    previousAtmIds = (employee.assignedAtmIds || []).map((id) => id.toString());

    if (assignedAtmIds.length > 0) {
      const atms = await ATM.find({ _id: { $in: assignedAtmIds } }).select(
        "_id atmId assignedEmployeeId",
      );
      if (atms.length !== assignedAtmIds.length) {
        throw new ApiError(404, "One or more ATMs not found");
      }
      const resultingEmployeeStatus =
        updatePayload.status ?? employee.status;
      if (resultingEmployeeStatus !== "active") {
        throw new ApiError(400, "Employee is inactive");
      }
      const employeeUser = await User.findById(employee.userId).select(
        "status userType",
      );
      if (
        employeeUser?.status !== "active" ||
        employeeUser?.userType !== "employee"
      ) {
        throw new ApiError(400, "Employee is inactive");
      }
      await ensureATMsAvailableForEmployee(assignedAtmIds, employee._id);
    }

    employee.assignedAtmIds = assignedAtmIds;
    delete updatePayload.assignedAtmIds;
  }

  Object.assign(employee, updatePayload);
  await employee.save();

  if (assignedAtmIds) {
    const removedAtmIds = previousAtmIds.filter(
      (atmId) => !assignedAtmIds.includes(atmId),
    );
    if (removedAtmIds.length > 0) {
      await ATM.updateMany(
        { _id: { $in: removedAtmIds } },
        { $pull: { assignedEmployeeId: employee._id } },
      );
    }
    if (assignedAtmIds.length > 0) {
      await syncEmployeeATMAssignments(assignedAtmIds, employee._id);
    }
  }

  await employee.populate("userId", "firstName lastName email userType");
  return res
    .status(200)
    .json(new ApiResponse(200, employee, "Employee updated successfully"));
});

// view employee by id (admin and superAdmin)

export const viewEmployeeById = asyncHandler(async (req, res) => {
  const { employeeId } = req.params;

  const employee = await Employee.findById(employeeId).populate(
    "userId",
    "firstName lastName email userType",
  );

  if (!employee) {
    return res
      .status(404)
      .json(new ApiResponse(404, "Employee not found", null));
  }

  return res
    .status(200)
    .json(new ApiResponse(200, employee, "Employee retrieved successfully"));
});

// view all employees (admin and superAdmin)

export const viewAllEmployees = asyncHandler(async (req, res) => {
  const { districtId, regionId, bankId, status, search, page, limit } =
    req.query;
  const isScoped =
    districtId !== undefined ||
    regionId !== undefined ||
    bankId !== undefined ||
    status !== undefined ||
    search !== undefined ||
    page !== undefined ||
    limit !== undefined;

  if (isScoped) {
    const atmQuery = buildATMGeographicQuery({ districtId, regionId, bankId });
    const pagination = parsePagination(page, limit);
    if (
      status !== undefined &&
      !["active", "inactive", "on_leave", "resigned"].includes(status)
    ) {
      throw new ApiError(400, "Invalid status");
    }
    if (search !== undefined && typeof search !== "string") {
      throw new ApiError(400, "Invalid search");
    }

    const normalizedSearch = search?.trim();
    const employeeFilter = {
      ...(status ? { "employee.status": status } : {}),
      ...(normalizedSearch
        ? {
            $or: [
              {
                "employee.employeeCode": {
                  $regex: escapeRegex(normalizedSearch),
                  $options: "i",
                },
              },
              {
                "employee.designation": {
                  $regex: escapeRegex(normalizedSearch),
                  $options: "i",
                },
              },
              {
                "employee.department": {
                  $regex: escapeRegex(normalizedSearch),
                  $options: "i",
                },
              },
              {
                "user.firstName": {
                  $regex: escapeRegex(normalizedSearch),
                  $options: "i",
                },
              },
              {
                "user.lastName": {
                  $regex: escapeRegex(normalizedSearch),
                  $options: "i",
                },
              },
              {
                "user.email": {
                  $regex: escapeRegex(normalizedSearch),
                  $options: "i",
                },
              },
            ],
          }
        : {}),
    };

    const [result] = await ATM.aggregate([
      { $match: atmQuery },
      { $unwind: "$assignedEmployeeId" },
      { $match: { assignedEmployeeId: { $ne: null } } },
      {
        $group: {
          _id: "$assignedEmployeeId",
          linkedAtmIds: { $addToSet: "$_id" },
        },
      },
      {
        $lookup: {
          from: Employee.collection.name,
          localField: "_id",
          foreignField: "_id",
          as: "employee",
        },
      },
      { $unwind: "$employee" },
      {
        $lookup: {
          from: User.collection.name,
          let: { userId: "$employee.userId" },
          pipeline: [
            { $match: { $expr: { $eq: ["$_id", "$$userId"] } } },
            {
              $project: {
                firstName: 1,
                lastName: 1,
                email: 1,
                phoneNumber: 1,
                userType: 1,
                status: 1,
              },
            },
          ],
          as: "user",
        },
      },
      {
        $facet: {
          total: [{ $count: "count" }],
          statusCounts: [
            {
              $group: {
                _id: "$employee.status",
                count: { $sum: 1 },
              },
            },
          ],
          matchingEmployees: [
            { $match: employeeFilter },
            { $sort: { "employee.employeeCode": 1, _id: 1 } },
            { $skip: pagination.skip },
            { $limit: pagination.limit },
            {
              $project: {
                _id: "$employee._id",
                userId: { $arrayElemAt: ["$user", 0] },
                employeeCode: "$employee.employeeCode",
                designation: "$employee.designation",
                department: "$employee.department",
                joiningDate: "$employee.joiningDate",
                employmentType: "$employee.employmentType",
                status: "$employee.status",
                supervisorId: "$employee.supervisorId",
                salary: "$employee.salary",
                createdAt: "$employee.createdAt",
                updatedAt: "$employee.updatedAt",
                linkedATMCount: { $size: "$linkedAtmIds" },
              },
            },
          ],
          matchingTotal: [
            { $match: employeeFilter },
            { $count: "count" },
          ],
        },
      },
    ]);

    const statusCounts = Object.fromEntries(
      (result?.statusCounts ?? []).map(({ _id, count }) => [_id, count]),
    );
    const matchingTotal = result?.matchingTotal?.[0]?.count ?? 0;
    return res.status(200).json(
      new ApiResponse(
        200,
        {
          employees: result?.matchingEmployees ?? [],
          pagination: {
            page: pagination.page,
            limit: pagination.limit,
            total: matchingTotal,
            totalPages: Math.ceil(matchingTotal / pagination.limit),
          },
          summary: {
            total: result?.total?.[0]?.count ?? 0,
            statusCounts,
          },
        },
        "Employees retrieved successfully",
      ),
    );
  }

  const employees = await Employee.find().populate(
    "userId",
    "firstName lastName email userType status",
  );

  return res
    .status(200)
    .json(new ApiResponse(200, employees, "Employees retrieved successfully"));
});

// assign atm to employee (admin and superAdmin)

export const assignAtms = asyncHandler(async (req, res) => {
  const { employeeId } = req.params;
  const { assignedAtmIds } = req.body;

  if (!Array.isArray(assignedAtmIds) || assignedAtmIds.length === 0) {
    throw new ApiError(400, "assignedAtmIds must be a non-empty array");
  }

  const uniqueAtmIds = [...new Set(assignedAtmIds.map(String))];

  const employee = await Employee.findById(employeeId);

  if (!employee) {
    throw new ApiError(404, "Employee not found");
  }
  if (employee.status !== "active") {
    throw new ApiError(400, "Employee is inactive");
  }
  const employeeUser = await User.findById(employee.userId).select(
    "userType status",
  );
  if (
    employeeUser?.userType !== "employee" ||
    employeeUser?.status !== "active"
  ) {
    throw new ApiError(400, "Employee is inactive");
  }

  // Verify all ATMs exist
  const atms = await ATM.find({
    _id: { $in: uniqueAtmIds },
  }).select("_id atmId assignedEmployeeId");

  if (atms.length !== uniqueAtmIds.length) {
    throw new ApiError(404, "One or more ATMs not found");
  }
  await ensureATMsAvailableForEmployee(uniqueAtmIds, employee._id);

  // Add ATMs to employee
  employee.assignedAtmIds = [
    ...new Set([
      ...(employee.assignedAtmIds || []).map(String),
      ...uniqueAtmIds,
    ]),
  ];

  await employee.save();

  // Add employee to all ATMs
  await syncEmployeeATMAssignments(uniqueAtmIds, employee._id);

  return res
    .status(200)
    .json(new ApiResponse(200, employee, "ATMs assigned successfully"));
});

// assign district to employee (admin and superAdmin)

export const assignDistricts = asyncHandler(async (req, res) => {
  const { employeeId } = req.params;
  const { districtIds } = req.body;

  const employee = await Employee.findById(employeeId);

  if (!employee) {
    throw new ApiError(404, "Employee not found");
  }

  const existingDistrictIds = (employee.districtIds || []).map((id) =>
    id.toString(),
  );
  const incomingDistrictIds = (districtIds || []).map((id) => id.toString());
  const mergedDistrictIds = Array.from(
    new Set([...existingDistrictIds, ...incomingDistrictIds]),
  );

  employee.districtIds = mergedDistrictIds;

  await employee.save();

  return res
    .status(200)
    .json(new ApiResponse(200, employee, "Districts assigned successfully"));
});
