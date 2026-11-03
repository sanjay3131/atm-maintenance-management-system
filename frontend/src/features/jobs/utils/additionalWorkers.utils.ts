import type { AdditionalWorkersMutationResponse } from "../services/jobs.service";

export function isValidAdditionalWorkersVersion(
  version: unknown,
): version is number {
  return (
    typeof version === "number" &&
    Number.isSafeInteger(version) &&
    version >= 0
  );
}

export async function runWithAdditionalWorkerMutationLock(
  lock: { current: boolean },
  operation: () => Promise<void>,
): Promise<boolean> {
  if (lock.current) return false;

  lock.current = true;
  try {
    await operation();
    return true;
  } finally {
    lock.current = false;
  }
}

export function hasAuthoritativeAdditionalWorkersResponse(
  response: AdditionalWorkersMutationResponse,
): boolean {
  return (
    Array.isArray(response.additionalWorkers) &&
    isValidAdditionalWorkersVersion(response.version)
  );
}
