export type PhotoUploadQueueStatus =
  | "idle"
  | "uploading"
  | "uploaded"
  | "failed"
  | "verification"
  | "finalization-pending";

export type PhotoUploadQueueOutcome = "uploaded" | "finalization-pending";

export interface PhotoUploadQueueResult<T> {
  uploadedCount: number;
  finalizationPendingCount: number;
  failure: { photo: T; error: unknown } | null;
}

export function getEligiblePhotoUploads<T extends { id: string }>(
  photos: readonly T[],
  statuses: Readonly<Record<string, PhotoUploadQueueStatus | undefined>>,
) {
  return photos.filter(
    (photo) =>
      statuses[photo.id] !== "uploaded" &&
      statuses[photo.id] !== "uploading" &&
      statuses[photo.id] !== "verification" &&
      statuses[photo.id] !== "finalization-pending",
  );
}

export async function processPhotoUploadQueue<T>({
  photos,
  getSavedCount,
  requiredCount,
  processPhoto,
}: {
  photos: readonly T[];
  getSavedCount: () => number;
  requiredCount: number;
  processPhoto: (photo: T) => Promise<PhotoUploadQueueOutcome>;
}): Promise<PhotoUploadQueueResult<T>> {
  const result: PhotoUploadQueueResult<T> = {
    uploadedCount: 0,
    finalizationPendingCount: 0,
    failure: null,
  };

  for (const photo of photos) {
    if (getSavedCount() >= requiredCount) break;

    try {
      const outcome = await processPhoto(photo);
      if (outcome === "uploaded") {
        result.uploadedCount += 1;
      } else {
        result.finalizationPendingCount += 1;
      }
    } catch (error) {
      result.failure = { photo, error };
      break;
    }
  }

  return result;
}

export async function withPhotoUploadLock<T>(
  lock: { current: boolean },
  setLoading: (loading: boolean) => void,
  operation: () => Promise<T>,
): Promise<T | undefined> {
  if (lock.current) return undefined;

  lock.current = true;
  try {
    setLoading(true);
    return await operation();
  } finally {
    lock.current = false;
    setLoading(false);
  }
}
