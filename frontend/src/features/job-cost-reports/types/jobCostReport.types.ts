export type JobCostReportOverrideValue = {
  value: string | null;
  isOverridden: boolean;
};

export type JobCostReportOverrides = {
  bankName: JobCostReportOverrideValue;
  branch: JobCostReportOverrideValue;
  complaintDescription: JobCostReportOverrideValue;
  callLogDate: JobCostReportOverrideValue;
  atmLocationName: JobCostReportOverrideValue;
  atmAddress: JobCostReportOverrideValue;
  assignedTechnicianName: JobCostReportOverrideValue;
  workType: JobCostReportOverrideValue;
};

export interface JobCostReportJobSnapshot {
  jobId: string;
  jobNumber: string | null;
  complaintNumber: string | null;
  callLogDate: string | null;
  bankName: string | null;
  branch: string | null;
  atmId: string | null;
  atmLocationName: string | null;
  atmAddress: string | null;
  complaintDescription: string | null;
  currentStatus: string | null;
  assignedTechnicianName: string | null;
  assignedEmployeeCode: string | null;
  workType: string | null;
  completionDate: string | null;
  employeeRemarks: string | null;
}

export interface JobCostReportFields {
  serviceLaborCost: string;
  gstRate: string;
  bankPurchaseOrderNumber: string;
  taxInvoiceNumber: string;
  filingPeriod: string;
  officeBillingStatus: string;
  overrides: JobCostReportOverrides;
}

export interface JobCostReportServiceVisit {
  _id?: string;
  sequence: number;
  visitDate: string | null;
  workPerformed: string | null;
  status: string | null;
  signOffOrPhotoReference: string | null;
}

export interface JobCostReportMaterialSnapshot {
  usageId: string;
  itemId: string | null;
  itemNameSnapshot: string;
  quantity: number;
  unitSnapshot: string;
  unitCostSnapshot: string;
  lineCostSnapshot: string;
  capturedAt: string;
}

export interface JobCostReportRevision {
  value: number | null;
  isKnown: boolean;
}

export interface JobCostReport {
  _id: string;
  jobId: string;
  draftRevision: number;
  status: "DRAFT";
  jobSnapshot: JobCostReportJobSnapshot;
  reportFields: JobCostReportFields;
  serviceVisits: JobCostReportServiceVisit[];
  materialSnapshot: JobCostReportMaterialSnapshot[];
  materialSnapshotStatus: "NOT_REFRESHED" | "REFRESHED";
  materialSnapshotRevision: JobCostReportRevision;
  sourceRevisions: {
    materialUsageRevision: JobCostReportRevision;
    jobUpdatedAt: string | null;
    complaintUpdatedAt: string | null;
  };
  createdAt: string;
  updatedAt: string;
  materialSnapshotFresh?: boolean;
}

export type JobCostReportPatch = {
  expectedDraftRevision: number;
  serviceLaborCost?: string;
  gstRate?: string;
  bankPurchaseOrderNumber?: string;
  taxInvoiceNumber?: string;
  filingPeriod?: string;
  officeBillingStatus?: string;
  overrides?: Partial<JobCostReportOverrides>;
  serviceVisits?: JobCostReportServiceVisit[];
};
