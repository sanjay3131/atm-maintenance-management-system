export type UserRole = "employee" | "supervisor" | "customer";

export type EmploymentType = "full-time" | "part-time" | "contract";

export interface UserDetailsForm {
  firstName: string;
  lastName: string;
  email: string;
  phoneNumber: string;
  password: string;
}

export interface EmployeeDetailsForm {
  designation: string;
  department: string;
  joiningDate: string;
  employmentType: EmploymentType;
  districtIds: string[];
  assignedAtmIds: string[];
  regionIds: string[];
  salary?: number;
}

export interface CustomerDetailsForm {
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  bankName: string;
  atmIds: string[];
  districtIds: string[];
}

export interface CreateUserFormData {
  user: UserDetailsForm;
  role: UserRole | "";
  employee?: EmployeeDetailsForm;
  customer?: CustomerDetailsForm;
}
