const asObject = (value) =>
  value && typeof value.toObject === "function" ? value.toObject() : value;

const stringOrNull = (value) => {
  if (value === undefined || value === null || value === "") return null;
  return String(value);
};

const dateOrNull = (value) => {
  if (value === undefined || value === null || value === "") return null;
  const date = value instanceof Date ? new Date(value) : new Date(String(value));
  return Number.isNaN(date.getTime()) ? null : date;
};

const idOrNull = (value) => {
  const record = asObject(value);
  if (record === undefined || record === null || record === "") return null;
  return String(record._id ?? record);
};

const joinName = (person) => {
  const record = asObject(person);
  if (!record || typeof record !== "object") return null;
  const name = [record.firstName, record.lastName].filter(Boolean).join(" ").trim();
  return name || null;
};

const getBankName = (atm, customer) => {
  const bank = asObject(atm?.bankId);
  return (
    stringOrNull(bank?.bankName) ??
    stringOrNull(asObject(customer)?.bankName)
  );
};

const getComplaintDescription = (complaint, job) => {
  const complaintRecord = asObject(complaint);
  const jobRecord = asObject(job);
  return (
    stringOrNull(complaintRecord?.description) ??
    stringOrNull(complaintRecord?.title) ??
    stringOrNull(jobRecord?.description) ??
    stringOrNull(jobRecord?.title)
  );
};

const getComplaintNumber = (complaint, job) => {
  const complaintRecord = asObject(complaint);
  const jobRecord = asObject(job);
  return (
    stringOrNull(complaintRecord?.complaintNumber) ??
    stringOrNull(jobRecord?.jobNumber) ??
    stringOrNull(jobRecord?.jobId) ??
    idOrNull(jobRecord?._id)
  );
};

export const mapJobToCostReportSource = (input) => {
  const job = asObject(input);
  if (!job || typeof job !== "object") {
    throw new TypeError("A Job object is required");
  }

  const complaint = asObject(job.complaintId);
  const atm = asObject(job.atmId);
  const customer = asObject(job.customerId);
  const assignedEmployee = asObject(job.assignedEmployeeId);
  const assignedTechnicianName = joinName(assignedEmployee);
  const materialUsageRevision = job.materialUsageRevision;
  const hasKnownMaterialRevision =
    Number.isInteger(materialUsageRevision) && materialUsageRevision >= 0;

  return {
    jobSnapshot: {
      jobId: stringOrNull(job.jobId) ?? idOrNull(job._id),
      jobNumber: stringOrNull(job.jobNumber),
      complaintNumber: getComplaintNumber(complaint, job),
      callLogDate: dateOrNull(complaint?.reportedAt) ?? dateOrNull(job.createdAt),
      bankName: getBankName(atm, customer),
      branch: null,
      atmId: stringOrNull(atm?.atmId),
      atmLocationName: stringOrNull(atm?.locationName),
      atmAddress: stringOrNull(atm?.address),
      complaintDescription: getComplaintDescription(complaint, job),
      currentStatus: stringOrNull(job.status),
      assignedTechnicianName,
      assignedEmployeeCode: stringOrNull(assignedEmployee?.employeeCode),
      workType: stringOrNull(job.workType),
      completionDate: dateOrNull(job.completedAt),
      employeeRemarks: stringOrNull(job.employeeRemarks),
    },
    sourceRevisions: {
      materialUsageRevision: {
        value: hasKnownMaterialRevision ? materialUsageRevision : null,
        isKnown: hasKnownMaterialRevision,
      },
      jobUpdatedAt: dateOrNull(job.updatedAt),
      complaintUpdatedAt: dateOrNull(complaint?.updatedAt),
    },
  };
};
