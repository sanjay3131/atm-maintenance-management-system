import api from "@/lib/axios";

export interface CustomerUser {
  _id: string;
  firstName?: string;
  lastName?: string;
  email?: string;
  phoneNumber?: string;
  status?: string;
  userType?: string;
}

export interface CustomerListItem {
  _id: string;
  userId: CustomerUser | null;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  bankName?: string;
  isActive: boolean;
  isDeleted: boolean;
  createdAt: string;
  updatedAt: string;
  linkedATMCount: number;
}

export interface CustomerAssignedATM {
  _id: string;
  atmId: string;
  locationName?: string;
  address?: string;
  bankId?: { _id: string; bankName?: string } | string | null;
  districtId?: { _id: string; districtName?: string } | string | null;
  regionId?: { _id: string; name?: string } | string | null;
  installationType?: string;
  status?: string;
}

export interface CustomerDistrict {
  _id: string;
  districtName: string;
}

export interface CustomerDetail extends CustomerListItem {
  atmIds: CustomerAssignedATM[];
  districtIds: CustomerDistrict[];
}

export interface CustomerListParams {
  search?: string;
  status?: "active" | "inactive";
  bankName?: string;
  bankId?: string;
  page: number;
  limit: number;
}

export interface CustomerListResponse {
  customers: CustomerListItem[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  summary: {
    total: number;
    active: number;
    inactive: number;
  };
}

export interface CustomerUpdateData {
  customerName?: string;
  customerPhone?: string;
  bankName?: string;
  isActive?: boolean;
}

export interface CustomerComplaintATM {
  _id: string;
  atmId?: string;
  locationName?: string;
}

export interface CustomerComplaint {
  _id: string;
  complaintNumber: string;
  title: string;
  priority: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
  status: "OPEN" | "ASSIGNED" | "IN_PROGRESS" | "RESOLVED" | "CLOSED" | "CANCELLED";
  atmId?: CustomerComplaintATM | string | null;
  createdAt: string;
  reportedAt?: string;
}

export interface CustomerComplaintsResponse {
  complaints: CustomerComplaint[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
}

export interface DistrictCustomer {
  _id: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  bankName?: string;
  isActive: boolean;
  isDeleted: boolean;
  userId?: {
    _id: string;
    firstName?: string;
    lastName?: string;
    email?: string;
    phoneNumber?: string;
    status?: string;
    userType?: string;
  } | null;
  linkedATMCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ScopedCustomersResponse {
  customers: DistrictCustomer[];
  pagination: {
    page: number;
    limit: number;
    total: number;
    totalPages: number;
  };
  summary: {
    total: number;
    active: number;
    inactive: number;
  };
}

export interface Customer {
  _id: string;
  customerName: string;
  customerEmail: string;
  customerPhone: string;
  isActive: boolean;
  isDeleted?: boolean;
}

export const getCustomers = async (): Promise<Customer[]> => {
  const response = await api.get("/customers");
  return response.data.data;
};

export const getAdminCustomers = async (
  params: CustomerListParams,
): Promise<CustomerListResponse> => {
  const response = await api.get<{ data: CustomerListResponse }>(
    "/customers",
    { params },
  );
  return response.data.data;
};

export const getCustomerById = async (id: string): Promise<CustomerDetail> => {
  const response = await api.get<{ data: CustomerDetail }>(`/customers/${id}`);
  return response.data.data;
};

export const getCustomerComplaints = async (
  customerId: string,
  params: { page: number; limit: number; status?: string },
): Promise<CustomerComplaintsResponse> => {
  const response = await api.get<{ data: CustomerComplaintsResponse }>(
    `/complaints/customer/${customerId}`,
    { params },
  );
  return response.data.data;
};

export const updateCustomer = async (
  id: string,
  data: CustomerUpdateData,
): Promise<CustomerListItem> => {
  const response = await api.put<{ data: CustomerListItem }>(
    `/customers/${id}`,
    data,
  );
  return response.data.data;
};

export const deactivateCustomer = async (id: string): Promise<void> => {
  await api.delete(`/customers/${id}`);
};

export const getDistrictCustomers = async (
  districtId: string,
  page: number,
  limit: number,
): Promise<ScopedCustomersResponse> => {
  const response = await api.get<{ data: ScopedCustomersResponse }>(
    "/customers",
    { params: { districtId, page, limit } },
  );
  return response.data.data;
};

export const getRegionCustomers = async (
  regionId: string,
  page: number,
  limit: number,
): Promise<ScopedCustomersResponse> => {
  const response = await api.get<{ data: ScopedCustomersResponse }>(
    "/customers",
    { params: { regionId, page, limit } },
  );
  return response.data.data;
};
