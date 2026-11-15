export interface District {
  _id: string;
  bankId?: string;
  districtName: string;
  pinCode: string;
  state: string;
  isActive: boolean;
  regionId: string | {
    _id: string;
    name: string;
    bankId: string | { _id: string; bankName: string; bankCode: string };
    isActive?: boolean;
  };
  createdBy: string;
  updatedBy?: string;
  createdAt: string;
  updatedAt: string;
  __v?: number;
}

export interface DistrictGeographicSummary {
  districtId: string;
  regions: number;
  atms: number;
  employees: number;
  customers: number;
}

export interface DistrictFormValues {
  districtName: string;
  pinCode: string;
  state: string;
  isActive: boolean;
}

export type CreateDistrictData = DistrictFormValues & { regionId: string };
export type UpdateDistrictData = Partial<DistrictFormValues>;
