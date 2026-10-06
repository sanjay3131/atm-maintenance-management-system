export interface District {
  _id: string;
  districtName: string;
  pinCode: string;
  state: string;
  isActive: boolean;
  regions: string[];
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

export type CreateDistrictData = DistrictFormValues;
export type UpdateDistrictData = Partial<DistrictFormValues>;
