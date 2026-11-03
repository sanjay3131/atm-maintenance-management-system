import type { AdditionalWorker } from "../types/job.types";
import { isValidAdditionalWorkersVersion } from "./additionalWorkers.utils.ts";

export interface AdminAdditionalWorkerDraft {
  workerType: string;
  quantity: string;
  notes: string;
}

export type AdminAdditionalWorkerValidationError =
  | "Enter the worker type or name."
  | "Worker type must be 80 characters or fewer."
  | "Quantity must be a positive whole number."
  | "Notes must be 300 characters or fewer."
  | "Maximum of 20 worker entries reached."
  | "Job version unavailable. Refresh before managing additional workers.";

export type AdminAdditionalWorkerPayload =
  | {
      workerType: string;
      quantity: number;
      notes?: string;
      expectedVersion: number;
    }
  | {
      workerType: string;
      quantity: number;
      notes: string;
      expectedVersion: number;
    };

type AdminWorkerUpdateVariables = {
  jobId: string;
  workerId: string;
  workerType: string;
  quantity: number;
  notes: string;
  expectedVersion: number;
};

interface AdminWorkerDeleteVariables {
  jobId: string;
  workerId: string;
  expectedVersion: number;
}

interface AdminWorkerMutationActions<TResponse> {
  create: (variables: {
    jobId: string;
    workerType: string;
    quantity: number;
    notes?: string;
    expectedVersion: number;
  }) => Promise<TResponse>;
  update: (variables: AdminWorkerUpdateVariables) => Promise<TResponse>;
  delete: (variables: AdminWorkerDeleteVariables) => Promise<TResponse>;
}

export function executeAdminAdditionalWorkerMutation<TResponse>({
  action,
  jobId,
  workerId,
  payload,
  expectedVersion,
  mutations,
}: {
  action: "create" | "update" | "delete";
  jobId: string;
  workerId?: string;
  payload?: AdminAdditionalWorkerPayload;
  expectedVersion: number;
  mutations: AdminWorkerMutationActions<TResponse>;
}) {
  if (action === "delete") {
    if (!workerId) throw new Error("Worker ID is required for deletion");
    return mutations.delete({ jobId, workerId, expectedVersion });
  }
  if (!payload) throw new Error("Worker details are required");
  if (action === "update") {
    if (!workerId) throw new Error("Worker ID is required for update");
    return mutations.update({
      jobId,
      workerId,
      ...payload,
      notes: payload.notes ?? "",
    });
  }
  return mutations.create({ jobId, ...payload });
}

export function canManageAdditionalWorkers(
  userType: string | undefined,
  readOnly: boolean,
) {
  return (
    !readOnly &&
    (userType === "admin" || userType === "superAdmin")
  );
}

export function buildAdminAdditionalWorkerPayload(
  draft: AdminAdditionalWorkerDraft,
  expectedVersion: unknown,
  existingCount: number,
  isCreate: boolean,
):
  | { success: true; payload: AdminAdditionalWorkerPayload }
  | { success: false; error: AdminAdditionalWorkerValidationError } {
  if (!isValidAdditionalWorkersVersion(expectedVersion)) {
    return {
      success: false,
      error:
        "Job version unavailable. Refresh before managing additional workers.",
    };
  }

  const workerType = draft.workerType.trim();
  const notes = draft.notes.trim();
  const quantity = Number(draft.quantity);
  if (!workerType) {
    return { success: false, error: "Enter the worker type or name." };
  }
  if (workerType.length > 80) {
    return {
      success: false,
      error: "Worker type must be 80 characters or fewer.",
    };
  }
  if (!Number.isSafeInteger(quantity) || quantity <= 0) {
    return {
      success: false,
      error: "Quantity must be a positive whole number.",
    };
  }
  if (notes.length > 300) {
    return { success: false, error: "Notes must be 300 characters or fewer." };
  }
  if (isCreate && existingCount >= 20) {
    return {
      success: false,
      error: "Maximum of 20 worker entries reached.",
    };
  }

  return {
    success: true,
    payload: {
      workerType,
      quantity,
      ...(notes ? { notes } : {}),
      expectedVersion,
    },
  };
}

export function getAdminWorkerForEdit(
  workers: AdditionalWorker[],
  workerId: string,
) {
  return workers.find((worker) => worker._id === workerId) ?? null;
}
