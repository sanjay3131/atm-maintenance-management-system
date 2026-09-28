export type ATMStatus = "ACTIVE" | "INACTIVE" | "UNDER_MAINTENANCE" | "REMOVED";

export type InstallationType = "ONSITE" | "OFFSITE";

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

  assignedEmployeeId: string[];
}
