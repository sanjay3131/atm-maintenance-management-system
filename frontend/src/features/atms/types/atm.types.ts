export type ATMStatus = "ACTIVE" | "INACTIVE" | "UNDER_MAINTENANCE" | "REMOVED";

export type InstallationType = "ONSITE" | "OFFSITE";

export interface ATMEmployee {
  _id: string;
  employeeCode?: string;
  userId?: {
    firstName?: string;
    lastName?: string;
  };
}

export interface ATMCustomer {
  _id: string;
  customerName: string;
}

export interface ATMLocation {
  type?: "Point";
  coordinates?: [number, number];
}

export interface SetATMLocationData {
  latitude: number;
  longitude: number;
  accuracy?: number;
}

export interface UpdateATMData {
  bankId: string;
  customerId?: string;
  districtId: string;
  regionId: string;
  locationName: string;
  address: string;
  installationType: InstallationType;
  status: ATMStatus;
  assignedEmployeeId?: string[];
}

export interface ATM {
  _id: string;
  atmId: string;
  locationName: string;
  address: string;
  installationType: InstallationType;
  status: ATMStatus;

  bankId: {
    _id: string;
    bankName: string;
  };

  districtId: {
    _id: string;
    districtName: string;
  };

  regionId: {
    _id: string;
    name: string;
  } | null;

  assignedEmployeeId: Array<string | ATMEmployee>;
  customer?: string | ATMCustomer | null;
  location?: ATMLocation | null;
  locationConfigured?: boolean;
  locationCapturedAt?: string | null;
  locationAccuracy?: number | null;
}
