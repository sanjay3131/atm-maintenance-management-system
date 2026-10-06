import api from "@/lib/axios";

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
