export interface BankActor {
  _id: string;
  firstName?: string;
  lastName?: string;
}

export interface Bank {
  _id: string;
  bankName: string;
  bankCode: string;
  contactEmail?: string;
  contactPhone?: string;
  address?: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
  createdBy?: BankActor | string;
  updatedBy?: BankActor | string;
}

export interface GetBanksParams {
  search?: string;
  isActive?: boolean;
}

export interface CreateBankData {
  bankName: string;
  bankCode: string;
  contactEmail?: string;
  contactPhone?: string;
  address?: string;
}

export type UpdateBankData = Partial<CreateBankData> & {
  isActive?: boolean;
};

export interface BankFormValues extends CreateBankData {
  contactEmail: string;
  contactPhone: string;
  address: string;
}
