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
import {
  addEmployeeATMAssignments,
  replaceEmployeeATMAssignments,
  replaceEmployeeATMAssignmentsInTransaction,
  withEmployeeAssignmentTransaction,
} from "./employeeAssignment.service.js";
import { guardEmployeeEligibilityChange } from "../amc/amcResponsibility.service.js";

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

  const employeeCode = await generateEmployeeCode();
  const employeeData = {
    userId: user._id,
    employeeCode,
    designation,
    department,
    joiningDate,
    employmentType,
    districtIds,
    assignedAtmIds: [],
    salary,
    createdBy: req.user._id,
  };
  const newEmployee = uniqueAssignedAtmIds.length
    ? await withEmployeeAssignmentTransaction(async (session) => {
        const [createdEmployee] = await Employee.create([employeeData], {
          session,
        });
        return replaceEmployeeATMAssignmentsInTransaction({
          employeeId: createdEmployee._id,
          assignedAtmIds: uniqueAssignedAtmIds,
          updatedBy: req.user._id,
          session,
        });
      })
    : await Employee.create(employeeData);

  return res
    .status(201)
    .json(new ApiResponse(201, newEmployee, "Employee created successfully"));
});

// update employee by id (admin and superAdmin)

export const updateEmployee = asyncHandler(async (req, res) => {
  const { employeeId } = req.params;
  const updatePayload = { ...req.body };
  const hasATMUpdate = Object.prototype.hasOwnProperty.call(
    updatePayload,
    "assignedAtmIds",
  );
  let employee;
  if (hasATMUpdate) {
    const assignedAtmIds = [...new Set(updatePayload.assignedAtmIds || [])];
    delete updatePayload.assignedAtmIds;
    employee = await replaceEmployeeATMAssignments({
      employeeId,
      assignedAtmIds,
      updatedBy: req.user._id,
      employeeUpdates: updatePayload,
    });
  } else {
    if (updatePayload.status && updatePayload.status !== "active") {
      employee = await withEmployeeAssignmentTransaction(async (session) => {
        const currentEmployee = await Employee.findById(employeeId).session(
          session,
        );
        if (!currentEmployee) return null;
        await guardEmployeeEligibilityChange({
          employeeId: currentEmployee._id,
          session,
          updatedBy: req.user._id,
        });
        Object.assign(currentEmployee, updatePayload);
        await currentEmployee.save({ session });
        return currentEmployee;
      });
    } else {
      employee = await Employee.findById(employeeId);
    }
  }

  if (!employee) {
    return res
      .status(404)
      .json(new ApiResponse(404, "Employee not found", null));
  }

  if (
    !hasATMUpdate &&
    !(updatePayload.status && updatePayload.status !== "active")
  ) {
    Object.assign(employee, updatePayload);
    await employee.save();
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

export const getMyEmployeeProfile = asyncHandler(async (req, res) => {
  const employee = await Employee.findOne({ userId: req.user._id })
    .select(
      "userId employeeCode designation department joiningDate employmentType status districtIds regionIds assignedAtmIds",
    )
    .populate("userId", "firstName lastName email phoneNumber")
    .populate("districtIds", "districtName pinCode state")
    .populate({
      path: "regionIds",
      select: "name code districtId",
      populate: {
        path: "districtId",
        select: "districtName pinCode",
      },
    })
    .populate({
      path: "assignedAtmIds",
      select: "atmId locationName status districtId regionId",
      populate: [
        {
          path: "districtId",
          select: "districtName pinCode",
        },
        {
          path: "regionId",
          select: "name code",
        },
      ],
    });

  if (!employee) {
    throw new ApiError(404, "Employee profile not found");
  }

  const districtSummary = (district) =>
    district
      ? {
          districtName: district.districtName,
          pinCode: district.pinCode,
          ...(district.state ? { state: district.state } : {}),
        }
      : null;

  const profile = {
    employeeCode: employee.employeeCode,
    designation: employee.designation,
    department: employee.department,
    joiningDate: employee.joiningDate,
    employmentType: employee.employmentType,
    status: employee.status,
    user: employee.userId
      ? {
          firstName: employee.userId.firstName,
          lastName: employee.userId.lastName,
          email: employee.userId.email,
          phoneNumber: employee.userId.phoneNumber,
        }
      : null,
    districts: (employee.districtIds ?? [])
      .filter((district) => district?.districtName)
      .map(districtSummary),
    regions: (employee.regionIds ?? [])
      .filter((region) => region?.name)
      .map((region) => ({
        name: region.name,
        ...(region.code ? { code: region.code } : {}),
        district: districtSummary(region.districtId),
      })),
    assignedAtms: (employee.assignedAtmIds ?? [])
      .filter((atm) => atm?.atmId)
      .map((atm) => ({
        atmId: atm.atmId,
        locationName: atm.locationName,
        status: atm.status,
        district: districtSummary(atm.districtId),
        region: atm.regionId
          ? {
              name: atm.regionId.name,
              ...(atm.regionId.code ? { code: atm.regionId.code } : {}),
            }
          : null,
      })),
  };

  return res
    .status(200)
    .json(new ApiResponse(200, profile, "Employee profile fetched"));
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

  const updatedEmployee = await addEmployeeATMAssignments({
    employeeId: employee._id,
    assignedAtmIds: uniqueAtmIds,
    updatedBy: req.user._id,
  });

  return res
    .status(200)
    .json(new ApiResponse(200, updatedEmployee, "ATMs assigned successfully"));
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
