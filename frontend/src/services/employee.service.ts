import api from "@/lib/axios";

export interface Employee {
  _id: string;
  employeeCode: string;
  designation: string;
  department: string;
  joiningDate: string;
  employmentType: "full-time" | "part-time" | "contract";
  status: "active" | "inactive" | "on_leave" | "resigned";

  userId: {
    _id: string;
    firstName: string;
    lastName?: string;
    email: string;
    userType: string;
  };

  districtIds: string[];
  assignedAtmIds: string[];
  regionIds: string[];

  supervisorId?: string | null;
  salary?: number;

  createdAt: string;
  updatedAt: string;
}

export interface CreateEmployeePayload {
  userId: string;
  designation: string;
  department: string;
  joiningDate: string;
  employmentType: "full-time" | "part-time" | "contract";
  districtIds: string[];
  assignedAtmIds?: string[];
  regionIds?: string[];
  salary?: number;
}

export interface UpdateEmployeePayload {
  designation?: string;
  department?: string;
  joiningDate?: string;
  employmentType?: "full-time" | "part-time" | "contract";
  districtIds?: string[];
  assignedAtmIds?: string[];
  regionIds?: string[];
  status?: "active" | "inactive" | "on_leave" | "resigned";
  salary?: number;
}

export const getEmployees = async (): Promise<Employee[]> => {
  const response = await api.get("/employees");

  return response.data.data;
};

export const getEmployeeById = async (
  employeeId: string,
): Promise<Employee> => {
  const response = await api.get(`/employees/${employeeId}`);

  return response.data.data;
};

export const createEmployee = async (
  userId: string,
  payload: Omit<CreateEmployeePayload, "userId">,
): Promise<Employee> => {
  const response = await api.post(`/employees/create/${userId}`, payload);

  return response.data.data;
};

export const updateEmployee = async (
  employeeId: string,
  payload: UpdateEmployeePayload,
): Promise<Employee> => {
  const response = await api.patch(`/employees/update/${employeeId}`, payload);

  return response.data.data;
};

export const assignEmployeeAtms = async (
  employeeId: string,
  assignedAtmIds: string[],
): Promise<Employee> => {
  const response = await api.post(`/employees/assign-atms/${employeeId}`, {
    assignedAtmIds,
  });

  return response.data.data;
};

export const assignEmployeeDistricts = async (
  employeeId: string,
  districtIds: string[],
): Promise<Employee> => {
  const response = await api.post(`/employees/assign-districts/${employeeId}`, {
    districtIds,
  });

  return response.data.data;
};
