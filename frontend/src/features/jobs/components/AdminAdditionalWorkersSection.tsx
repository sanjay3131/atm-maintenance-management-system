import { useRef, useState, type FormEvent } from "react";
import { isAxiosError } from "axios";
import { LoaderCircle, Pencil, Plus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useAuth } from "@/features/auth/auth-context";
import {
  employeeLanguageClasses,
  useEmployeeLanguage,
} from "@/features/employee-portal/i18n";
import {
  useCreateAdditionalWorker,
  useDeleteAdditionalWorker,
  useUpdateAdditionalWorker,
} from "../hooks/useAdditionalWorkers";
import type { AdditionalWorker, Job } from "../types/job.types";
import {
  type AdminAdditionalWorkerValidationError,
  canManageAdditionalWorkers,
  buildAdminAdditionalWorkerPayload,
  executeAdminAdditionalWorkerMutation,
  getAdminWorkerForEdit,
} from "../utils/adminAdditionalWorkers.utils";
import {
  isValidAdditionalWorkersVersion,
  runWithAdditionalWorkerMutationLock,
} from "../utils/additionalWorkers.utils";

interface AdminAdditionalWorkersSectionProps {
  job: Job;
  readOnly: boolean;
  onRefreshLatest: () => Promise<boolean>;
}

interface WorkerDraft {
  workerType: string;
  quantity: string;
  notes: string;
}

interface WorkerValidationErrors {
  workerType: Extract<
    AdminAdditionalWorkerValidationError,
    "Enter the worker type or name." | "Worker type must be 80 characters or fewer."
  > | "";
  quantity: Extract<
    AdminAdditionalWorkerValidationError,
    "Quantity must be a positive whole number."
  > | "";
  notes: Extract<
    AdminAdditionalWorkerValidationError,
    "Notes must be 300 characters or fewer."
  > | "";
  form: Extract<
    AdminAdditionalWorkerValidationError,
    "Maximum of 20 worker entries reached." |
      "Job version unavailable. Refresh before managing additional workers."
  > | "";
}

const EMPTY_DRAFT: WorkerDraft = {
  workerType: "",
  quantity: "1",
  notes: "",
};

const EMPTY_VALIDATION_ERRORS: WorkerValidationErrors = {
  workerType: "",
  quantity: "",
  notes: "",
  form: "",
};

function getMutationError(
  error: unknown,
  t: ReturnType<typeof useEmployeeLanguage>["t"],
) {
  if (isAxiosError(error)) {
    if (error.response?.status === 404) {
      return t("Job or worker entry no longer exists. Refresh the Job.");
    }
    if (error.response?.status === 400) {
      return t("Check worker type, quantity, and notes, then try again.");
    }
  }
  return t("Could not save worker details. Check your connection and try again.");
}

export default function AdminAdditionalWorkersSection({
  job,
  readOnly,
  onRefreshLatest,
}: AdminAdditionalWorkersSectionProps) {
  const { t, language } = useEmployeeLanguage();
  const { user } = useAuth();
  const createMutation = useCreateAdditionalWorker();
  const updateMutation = useUpdateAdditionalWorker();
  const deleteMutation = useDeleteAdditionalWorker();
  const mutationLock = useRef(false);
  const [formMode, setFormMode] = useState<"create" | "edit" | null>(null);
  const [editingWorkerId, setEditingWorkerId] = useState<string | null>(null);
  const [draft, setDraft] = useState<WorkerDraft>(EMPTY_DRAFT);
  const [validationErrors, setValidationErrors] =
    useState<WorkerValidationErrors>(EMPTY_VALIDATION_ERRORS);
  const [requestError, setRequestError] = useState("");
  const [requiresRefresh, setRequiresRefresh] = useState(false);
  const [refreshPending, setRefreshPending] = useState(false);
  const [workerToRemove, setWorkerToRemove] =
    useState<AdditionalWorker | null>(null);

  const workers = job.additionalWorkers ?? [];
  const canEdit = canManageAdditionalWorkers(user?.userType, readOnly);
  const hasValidVersion = isValidAdditionalWorkersVersion(job.__v);
  const mutationPending =
    createMutation.isPending ||
    updateMutation.isPending ||
    deleteMutation.isPending;

  const startCreate = () => {
    if (!canEdit || !hasValidVersion || mutationPending || workers.length >= 20) {
      return;
    }
    setFormMode("create");
    setEditingWorkerId(null);
    setDraft(EMPTY_DRAFT);
    setValidationErrors(EMPTY_VALIDATION_ERRORS);
    setRequestError("");
  };

  const startEdit = (worker: AdditionalWorker) => {
    if (!canEdit || !hasValidVersion || mutationPending) return;
    const currentWorker = getAdminWorkerForEdit(workers, worker._id);
    if (!currentWorker) return;
    setFormMode("edit");
    setEditingWorkerId(currentWorker._id);
    setDraft({
      workerType: currentWorker.workerType,
      quantity: String(currentWorker.quantity),
      notes: currentWorker.notes ?? "",
    });
    setValidationErrors(EMPTY_VALIDATION_ERRORS);
    setRequestError("");
  };

  const closeForm = () => {
    if (mutationPending) return;
    setFormMode(null);
    setEditingWorkerId(null);
    setDraft(EMPTY_DRAFT);
    setValidationErrors(EMPTY_VALIDATION_ERRORS);
    setRequestError("");
    setRequiresRefresh(false);
  };

  const refreshLatest = async () => {
    if (refreshPending) return;
    setRefreshPending(true);
    try {
      if (await onRefreshLatest()) {
        setRequiresRefresh(false);
        setRequestError("");
      } else {
        setRequestError(
          t("Could not refresh the latest Job data. Your draft is still here."),
        );
      }
    } catch {
      setRequestError(
        t("Could not refresh the latest Job data. Your draft is still here."),
      );
    } finally {
      setRefreshPending(false);
    }
  };

  const submitWorker = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (
      !canEdit ||
      requiresRefresh ||
      mutationPending ||
      mutationLock.current
    ) {
      return;
    }

    const result = buildAdminAdditionalWorkerPayload(
      draft,
      job.__v,
      workers.length,
      formMode === "create",
    );
    if (!result.success) {
      const error = result.error;
      setValidationErrors({
        ...EMPTY_VALIDATION_ERRORS,
        ...(error === "Enter the worker type or name." ||
        error === "Worker type must be 80 characters or fewer."
          ? { workerType: error }
          : error === "Quantity must be a positive whole number."
            ? { quantity: error }
            : error === "Notes must be 300 characters or fewer."
              ? { notes: error }
              : { form: error }),
      });
      return;
    }

    const expectedVersion = result.payload.expectedVersion;
    setValidationErrors(EMPTY_VALIDATION_ERRORS);
    setRequestError("");
    void runWithAdditionalWorkerMutationLock(mutationLock, async () => {
      try {
        if (formMode === "edit" && editingWorkerId) {
          await executeAdminAdditionalWorkerMutation({
            action: "update",
            jobId: job._id,
            workerId: editingWorkerId,
            payload: result.payload,
            expectedVersion,
            mutations: {
              create: (variables) => createMutation.mutateAsync(variables),
              update: (variables) => updateMutation.mutateAsync(variables),
              delete: (variables) => deleteMutation.mutateAsync(variables),
            },
          });
          toast.success(t("Worker updated."));
        } else {
          await executeAdminAdditionalWorkerMutation({
            action: "create",
            jobId: job._id,
            payload: result.payload,
            expectedVersion,
            mutations: {
              create: (variables) => createMutation.mutateAsync(variables),
              update: (variables) => updateMutation.mutateAsync(variables),
              delete: (variables) => deleteMutation.mutateAsync(variables),
            },
          });
          toast.success(t("Worker added."));
        }
        setFormMode(null);
        setEditingWorkerId(null);
        setDraft(EMPTY_DRAFT);
        setRequiresRefresh(false);
      } catch (error) {
        if (isAxiosError(error) && error.response?.status === 409) {
          setRequiresRefresh(true);
          setRequestError(
            t(
              "This Job changed elsewhere. Refresh the latest data before saving again. Your draft has been kept.",
            ),
          );
        } else {
          setRequestError(getMutationError(error, t));
        }
      }
    });
  };

  const confirmRemove = () => {
    if (
      !workerToRemove ||
      !canEdit ||
      !hasValidVersion ||
      requiresRefresh ||
      mutationPending ||
      mutationLock.current
    ) {
      return;
    }

    const expectedVersion = job.__v;
    if (!isValidAdditionalWorkersVersion(expectedVersion)) return;
    void runWithAdditionalWorkerMutationLock(mutationLock, async () => {
      try {
        await executeAdminAdditionalWorkerMutation({
          action: "delete",
          jobId: job._id,
          workerId: workerToRemove._id,
          expectedVersion,
          mutations: {
            create: (variables) => createMutation.mutateAsync(variables),
            update: (variables) => updateMutation.mutateAsync(variables),
            delete: (variables) => deleteMutation.mutateAsync(variables),
          },
        });
        setWorkerToRemove(null);
        setRequiresRefresh(false);
        toast.success(t("Worker removed."));
      } catch (error) {
        if (isAxiosError(error) && error.response?.status === 409) {
          setRequiresRefresh(true);
          setRequestError(
            t(
              "This Job changed elsewhere. Refresh the latest data before saving again. Your draft has been kept.",
            ),
          );
          setWorkerToRemove(null);
        } else {
          setRequestError(getMutationError(error, t));
        }
      }
    });
  };

  return (
    <Card className="min-w-0 overflow-hidden lg:col-span-2">
      <CardHeader className="p-4 sm:p-6">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle>{t("Additional Workers")}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("External workers who accompanied you on this Job.")}
            </p>
            <p className="mt-1 text-xs text-muted-foreground">
              {t("Worker entries are separate from materials and job costs.")}
            </p>
          </div>
          <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
            {workers.length}/20
          </span>
        </div>
      </CardHeader>
      <CardContent className="min-w-0 space-y-4 p-4 pt-0 sm:p-6 sm:pt-0">
        {!hasValidVersion && canEdit && (
          <div className="space-y-2 rounded-md border border-amber-500/30 p-3">
            <p className="text-sm" role="alert">
              {t(
                "Job version unavailable. Refresh before managing additional workers.",
              )}
            </p>
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={() => void refreshLatest()}
              disabled={refreshPending}
            >
              {refreshPending && <LoaderCircle className="animate-spin" />}
              {refreshPending ? t("Refreshing...") : t("Refresh Job")}
            </Button>
          </div>
        )}

        {requiresRefresh && (
          <div className="space-y-2 rounded-md border border-amber-500/30 p-3">
            <p className="text-sm" role="alert">
              {requestError ||
                t(
                  "This Job changed elsewhere. Refresh the latest data before saving again. Your draft has been kept.",
                )}
            </p>
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={() => void refreshLatest()}
              disabled={refreshPending}
            >
              {refreshPending && <LoaderCircle className="animate-spin" />}
              {refreshPending ? t("Refreshing...") : t("Refresh Job")}
            </Button>
          </div>
        )}

        {requestError && !requiresRefresh && (
          <p role="alert" className="text-sm text-destructive">
            {requestError}
          </p>
        )}

        {workers.length === 0 ? (
          <p className="py-2 text-sm text-muted-foreground">
            {t("No additional workers have been recorded.")}
          </p>
        ) : (
          <ul className="divide-y border-y border-border">
            {workers.map((worker) => (
              <li
                key={worker._id}
                className={employeeLanguageClasses(
                  language,
                  "flex min-w-0 flex-col gap-2 py-3 first:pt-2 last:pb-2 sm:flex-row sm:items-start sm:justify-between",
                  "flex min-w-0 flex-col gap-2 py-3 first:pt-2 last:pb-2 sm:flex-row sm:items-start sm:justify-between",
                )}
              >
                <div className="min-w-0 space-y-1">
                  <p className="break-words text-sm font-medium [overflow-wrap:anywhere]">
                    {worker.workerType}
                  </p>
                  <p className="text-sm text-muted-foreground">
                    {t("Quantity")}: {worker.quantity}
                  </p>
                  {worker.notes && (
                    <p className="break-words text-sm text-muted-foreground [overflow-wrap:anywhere]">
                      {t("Notes")}: {worker.notes}
                    </p>
                  )}
                </div>
                {canEdit && (
                  <div className="flex shrink-0 items-center gap-1">
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-11"
                      aria-label={t("Edit {workerType}", {
                        workerType: worker.workerType,
                      })}
                      onClick={() => startEdit(worker)}
                      disabled={
                        !hasValidVersion || mutationPending || requiresRefresh
                      }
                    >
                      <Pencil aria-hidden="true" />
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      size="icon"
                      className="size-11 text-destructive"
                      aria-label={t("Remove {workerType}", {
                        workerType: worker.workerType,
                      })}
                      onClick={() => setWorkerToRemove(worker)}
                      disabled={
                        !hasValidVersion || mutationPending || requiresRefresh
                      }
                    >
                      <Trash2 aria-hidden="true" />
                    </Button>
                  </div>
                )}
              </li>
            ))}
          </ul>
        )}

        {canEdit && workers.length >= 20 && (
          <p className="text-sm text-muted-foreground">
            {t("Maximum of 20 worker entries reached.")}
          </p>
        )}

        {canEdit &&
          workers.length < 20 &&
          formMode === null &&
          !requiresRefresh && (
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={startCreate}
              disabled={!hasValidVersion || mutationPending}
            >
              <Plus aria-hidden="true" />
              {t("Add worker")}
            </Button>
          )}

        {formMode && (
          <form
            className="space-y-4 rounded-lg border border-border p-3 sm:p-4"
            onSubmit={submitWorker}
          >
            <h3 className="text-sm font-semibold">
              {formMode === "edit" ? t("Edit worker") : t("Add worker")}
            </h3>
            <div className="space-y-2">
              <label
                className="text-sm font-medium"
                htmlFor={`admin-additional-worker-type-${job._id}`}
              >
                {t("Worker type / name")}
              </label>
              <input
                id={`admin-additional-worker-type-${job._id}`}
                aria-describedby={
                  validationErrors.workerType
                    ? `admin-additional-worker-type-error-${job._id}`
                    : undefined
                }
                value={draft.workerType}
                maxLength={80}
                autoComplete="off"
                onChange={(event) => {
                  setDraft((current) => ({
                    ...current,
                    workerType: event.target.value,
                  }));
                  setValidationErrors((current) => ({
                    ...current,
                    workerType: "",
                    form: "",
                  }));
                  if (!requiresRefresh) setRequestError("");
                }}
                disabled={!canEdit || mutationPending}
                aria-invalid={Boolean(validationErrors.workerType) || undefined}
                className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
              />
            </div>
            {validationErrors.workerType && (
              <p
                id={`admin-additional-worker-type-error-${job._id}`}
                role="alert"
                className="text-sm text-destructive"
              >
                {t(validationErrors.workerType)}
              </p>
            )}
            <div className="space-y-2">
              <label
                className="text-sm font-medium"
                htmlFor={`admin-additional-worker-quantity-${job._id}`}
              >
                {t("Quantity")}
              </label>
              <input
                id={`admin-additional-worker-quantity-${job._id}`}
                aria-describedby={
                  validationErrors.quantity
                    ? `admin-additional-worker-quantity-error-${job._id}`
                    : undefined
                }
                type="number"
                min="1"
                step="1"
                inputMode="numeric"
                value={draft.quantity}
                onChange={(event) => {
                  setDraft((current) => ({
                    ...current,
                    quantity: event.target.value,
                  }));
                  setValidationErrors((current) => ({
                    ...current,
                    quantity: "",
                    form: "",
                  }));
                  if (!requiresRefresh) setRequestError("");
                }}
                disabled={!canEdit || mutationPending}
                aria-invalid={Boolean(validationErrors.quantity) || undefined}
                className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
              />
            </div>
            {validationErrors.quantity && (
              <p
                id={`admin-additional-worker-quantity-error-${job._id}`}
                role="alert"
                className="text-sm text-destructive"
              >
                {t(validationErrors.quantity)}
              </p>
            )}
            <div className="space-y-2">
              <label
                className="text-sm font-medium"
                htmlFor={`admin-additional-worker-notes-${job._id}`}
              >
                {t("Notes (optional)")}
              </label>
              <textarea
                id={`admin-additional-worker-notes-${job._id}`}
                aria-describedby={
                  validationErrors.notes
                    ? `admin-additional-worker-notes-error-${job._id}`
                    : undefined
                }
                value={draft.notes}
                maxLength={300}
                rows={3}
                onChange={(event) => {
                  setDraft((current) => ({
                    ...current,
                    notes: event.target.value,
                  }));
                  setValidationErrors((current) => ({
                    ...current,
                    notes: "",
                    form: "",
                  }));
                  if (!requiresRefresh) setRequestError("");
                }}
                disabled={!canEdit || mutationPending}
                aria-invalid={Boolean(validationErrors.notes) || undefined}
                className="min-h-20 w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
              />
            </div>
            {validationErrors.notes && (
              <p
                id={`admin-additional-worker-notes-error-${job._id}`}
                role="alert"
                className="text-sm text-destructive"
              >
                {t(validationErrors.notes)}
              </p>
            )}
            {validationErrors.form && (
              <p role="alert" className="text-sm text-destructive">
                {t(validationErrors.form)}
              </p>
            )}
            <div className="flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                onClick={closeForm}
                disabled={mutationPending}
              >
                {t("Cancel")}
              </Button>
              <Button
                type="submit"
                className="min-h-11"
                disabled={
                  !canEdit ||
                  !hasValidVersion ||
                  requiresRefresh ||
                  (formMode === "create" && workers.length >= 20) ||
                  mutationPending
                }
              >
                {mutationPending && <LoaderCircle className="animate-spin" />}
                {mutationPending
                  ? t("Saving...")
                  : formMode === "edit"
                    ? t("Update worker")
                    : t("Add worker entry")}
              </Button>
            </div>
          </form>
        )}
      </CardContent>

      <Dialog
        open={Boolean(workerToRemove)}
        onOpenChange={(open) => {
          if (!open && !mutationPending) setWorkerToRemove(null);
        }}
      >
        <DialogContent>
          <DialogTitle>{t("Remove additional worker?")}</DialogTitle>
          <DialogDescription className="mt-2">
            {t("Remove {workerType} from this Job? This cannot be undone.", {
              workerType: workerToRemove?.workerType ?? "",
            })}
          </DialogDescription>
          {requestError && (
            <p role="alert" className="text-sm text-destructive">
              {requestError}
            </p>
          )}
          <div className="mt-6 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={() => setWorkerToRemove(null)}
              disabled={mutationPending}
            >
              {t("Keep worker")}
            </Button>
            <Button
              type="button"
              variant="destructive"
              className="min-h-11"
              onClick={confirmRemove}
              disabled={
                !canEdit ||
                !hasValidVersion ||
                requiresRefresh ||
                mutationPending
              }
            >
              {deleteMutation.isPending && (
                <LoaderCircle className="animate-spin" />
              )}
              {t("Remove worker")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
