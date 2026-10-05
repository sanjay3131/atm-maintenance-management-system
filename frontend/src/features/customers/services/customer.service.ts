import api from "@/lib/axios";

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
