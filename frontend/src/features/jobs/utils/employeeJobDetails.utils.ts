import type { Job, JobPhoto, JobStatus } from "../types/job.types";

export const EMPLOYEE_REQUIRED_PHOTOS_PER_TYPE = 3;

export function getEmployeeJobDetailsScreen(status: JobStatus) {
  if (status === "ASSIGNED") return "assigned" as const;
  if (status === "ACCEPTED" || status === "ON_HOLD") {
    return "accepted" as const;
  }
  if (status === "IN_PROGRESS") return "in-progress" as const;
  if (
    status === "COMPLETED" ||
    status === "VERIFIED" ||
    status === "APPROVED" ||
    status === "CLOSED"
  ) {
    return "completed" as const;
  }
  return "other" as const;
}

function getValidPhotoCount(
  photos: Array<JobPhoto | null> | undefined,
  photoType: "before" | "after",
) {
  return (photos ?? []).filter(
    (photo) =>
      photo?.photoType === photoType &&
      typeof photo.url === "string" &&
      photo.url.length > 0,
  ).length;
}

export function getEmployeeFieldworkProgress(
  job: Pick<Job, "beforePhotos" | "afterPhotos">,
) {
  const before = Math.min(
    EMPLOYEE_REQUIRED_PHOTOS_PER_TYPE,
    getValidPhotoCount(job.beforePhotos, "before"),
  );
  const after = Math.min(
    EMPLOYEE_REQUIRED_PHOTOS_PER_TYPE,
    getValidPhotoCount(job.afterPhotos, "after"),
  );
  const uploaded = before + after;
  const required = EMPLOYEE_REQUIRED_PHOTOS_PER_TYPE * 2;

  return {
    before,
    after,
    uploaded,
    required,
    percent: Math.round((uploaded / required) * 100),
  };
}

export function canLoadEmployeeMaterialUsage(status: JobStatus) {
  return status !== "PENDING" && status !== "ASSIGNED";
}

export function getEmployeeMaterialUsageVisibility(
  status: JobStatus,
  usageCount: number,
) {
  return {
    canRecord: status === "IN_PROGRESS",
    showUsage:
      canLoadEmployeeMaterialUsage(status) &&
      Number.isFinite(usageCount) &&
      usageCount > 0,
  };
}
