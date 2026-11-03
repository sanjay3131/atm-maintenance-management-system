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
  isValidAdditionalWorkersVersion,
  runWithAdditionalWorkerMutationLock,
} from "../utils/additionalWorkers.utils";

interface EmployeeAdditionalWorkersSectionProps {
  job: Job;
  onRefreshLatest: () => Promise<boolean>;
}

interface WorkerDraft {
  workerType: string;
  quantity: string;
  notes: string;
}

const EMPTY_DRAFT: WorkerDraft = {
  workerType: "",
  quantity: "1",
  notes: "",
};

function getWorkerMutationError(
  error: unknown,
  t: ReturnType<typeof useEmployeeLanguage>["t"],
) {
  if (isAxiosError(error)) {
    const status = error.response?.status;
    if (status === 403) {
      return t(
        "This Job is no longer assigned to you or cannot be changed in its current status. Refresh the Job.",
      );
    }
    if (status === 404) {
      return t("Job or worker entry no longer exists. Refresh the Job.");
    }
    if (status === 400) {
      return t("Check worker type, quantity, and notes, then try again.");
    }
  }
  return t("Could not save worker details. Check your connection and try again.");
}

export default function EmployeeAdditionalWorkersSection({
  job,
  onRefreshLatest,
}: EmployeeAdditionalWorkersSectionProps) {
  const { t, language } = useEmployeeLanguage();
  const { user } = useAuth();
  const createMutation = useCreateAdditionalWorker();
  const updateMutation = useUpdateAdditionalWorker();
  const deleteMutation = useDeleteAdditionalWorker();
  const mutationLock = useRef(false);
  const [formMode, setFormMode] = useState<"create" | "edit" | null>(null);
  const [editingWorkerId, setEditingWorkerId] = useState<string | null>(null);
  const [draft, setDraft] = useState<WorkerDraft>(EMPTY_DRAFT);
  const [validationError, setValidationError] = useState("");
  const [requestError, setRequestError] = useState("");
  const [requiresRefresh, setRequiresRefresh] = useState(false);
  const [refreshPending, setRefreshPending] = useState(false);
  const [workerToRemove, setWorkerToRemove] =
    useState<AdditionalWorker | null>(null);

  const workers = job.additionalWorkers ?? [];
  const assignedEmployeeId =
    typeof job.assignedEmployeeId === "string"
      ? job.assignedEmployeeId
      : job.assignedEmployeeId?._id;
  const canEdit =
    job.status === "IN_PROGRESS" &&
    user?.userType === "employee" &&
    assignedEmployeeId === user._id;
  const hasValidVersion = isValidAdditionalWorkersVersion(job.__v);
  const mutationPending =
    createMutation.isPending ||
    updateMutation.isPending ||
    deleteMutation.isPending;

  const startCreate = () => {
    if (!canEdit || !hasValidVersion || mutationPending) return;
    setFormMode("create");
    setEditingWorkerId(null);
    setDraft(EMPTY_DRAFT);
    setValidationError("");
    setRequestError("");
  };

  const startEdit = (worker: AdditionalWorker) => {
    if (!canEdit || !hasValidVersion || mutationPending) return;
    setFormMode("edit");
    setEditingWorkerId(worker._id);
    setDraft({
      workerType: worker.workerType,
      quantity: String(worker.quantity),
      notes: worker.notes ?? "",
    });
    setValidationError("");
    setRequestError("");
  };

  const closeForm = () => {
    if (mutationPending) return;
    setFormMode(null);
    setEditingWorkerId(null);
    setDraft(EMPTY_DRAFT);
    setValidationError("");
    setRequestError("");
    setRequiresRefresh(false);
  };

  const refreshLatest = async () => {
    if (refreshPending) return;
    setRefreshPending(true);
    try {
      const refreshed = await onRefreshLatest();
      if (refreshed) {
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
      !hasValidVersion ||
      requiresRefresh ||
      mutationPending ||
      mutationLock.current
    ) {
      return;
    }

    const workerType = draft.workerType.trim();
    const quantity = Number(draft.quantity);
    const notes = draft.notes.trim();
    if (!workerType) {
      setValidationError(t("Enter the worker type or name."));
      return;
    }
    if (formMode === "create" && workers.length >= 20) {
      setValidationError(t("Maximum of 20 worker entries reached."));
      return;
    }
    if (workerType.length > 80) {
      setValidationError(t("Worker type must be 80 characters or fewer."));
      return;
    }
    if (!Number.isSafeInteger(quantity) || quantity <= 0) {
      setValidationError(t("Quantity must be a positive whole number."));
      return;
    }
    if (notes.length > 300) {
      setValidationError(t("Notes must be 300 characters or fewer."));
      return;
    }

    setValidationError("");
    setRequestError("");
    const expectedVersion = job.__v;
    if (!isValidAdditionalWorkersVersion(expectedVersion)) return;

    void runWithAdditionalWorkerMutationLock(mutationLock, async () => {
      try {
        if (formMode === "edit" && editingWorkerId) {
          await updateMutation.mutateAsync({
            jobId: job._id,
            workerId: editingWorkerId,
            workerType,
            quantity,
            notes,
            expectedVersion,
          });
          toast.success(t("Worker updated."));
        } else {
          await createMutation.mutateAsync({
            jobId: job._id,
            workerType,
            quantity,
            ...(notes ? { notes } : {}),
            expectedVersion,
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
          setRequestError(getWorkerMutationError(error, t));
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
        await deleteMutation.mutateAsync({
          jobId: job._id,
          workerId: workerToRemove._id,
          expectedVersion,
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
          setRequestError(getWorkerMutationError(error, t));
        }
      }
    });
  };

  return (
    <Card className="min-w-0 overflow-hidden border-0 shadow-none">
      <CardHeader
        className={employeeLanguageClasses(
          language,
          "p-4 pb-3 sm:p-5 sm:pb-3",
          "p-3 pb-2 sm:p-4 sm:pb-2",
        )}
      >
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div className="min-w-0">
            <CardTitle>{t("Additional Workers")}</CardTitle>
            <p className="mt-1 text-sm text-muted-foreground">
              {t("External workers who accompanied you on this Job.")}
            </p>
          </div>
          <span className="shrink-0 text-sm tabular-nums text-muted-foreground">
            {workers.length}/20
          </span>
        </div>
      </CardHeader>
      <CardContent
        className={employeeLanguageClasses(
          language,
          "min-w-0 space-y-3 p-4 pt-0 sm:p-5 sm:pt-0",
          "min-w-0 space-y-3 p-3 pt-0 sm:p-4 sm:pt-0",
        )}
      >
        {canEdit && !hasValidVersion && (
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

        {!canEdit && (
          <p className="text-sm text-muted-foreground">
            {t(
              "Additional workers can only be changed on an assigned Job in progress.",
            )}
          </p>
        )}

        {requiresRefresh && (
          <div className="space-y-2 rounded-md border border-amber-500/30 p-3">
            <p className="text-sm" role="alert">
              {t(
                "This Job changed elsewhere. Refresh the latest data before saving again. Your draft has been kept.",
              )}
            </p>
            {requestError &&
              requestError !==
                t(
                  "This Job changed elsewhere. Refresh the latest data before saving again. Your draft has been kept.",
                ) && (
                <p className="text-sm text-destructive" role="alert">
                  {requestError}
                </p>
              )}
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
          <p className="text-sm text-destructive" role="alert">
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
                className={`flex min-w-0 flex-col gap-2 py-3 first:pt-2 last:pb-2 sm:flex-row sm:items-start sm:justify-between ${employeeLanguageClasses(language, "", "sm:items-start")}`}
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
              className="min-h-11 w-full sm:w-auto"
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
                htmlFor={`additional-worker-type-${job._id}`}
              >
                {t("Worker type / name")}
              </label>
              <input
                id={`additional-worker-type-${job._id}`}
                value={draft.workerType}
                maxLength={80}
                autoComplete="off"
                onChange={(event) => {
                  setDraft((current) => ({
                    ...current,
                    workerType: event.target.value,
                  }));
                  setValidationError("");
                  if (!requiresRefresh) setRequestError("");
                }}
                disabled={!canEdit || mutationPending}
                aria-invalid={Boolean(validationError)}
                className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
              />
            </div>
            <div className="space-y-2">
              <label
                className="text-sm font-medium"
                htmlFor={`additional-worker-quantity-${job._id}`}
              >
                {t("Quantity")}
              </label>
              <input
                id={`additional-worker-quantity-${job._id}`}
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
                  setValidationError("");
                  if (!requiresRefresh) setRequestError("");
                }}
                disabled={!canEdit || mutationPending}
                aria-invalid={Boolean(validationError)}
                className="h-11 w-full rounded-lg border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
              />
            </div>
            <div className="space-y-2">
              <label
                className="text-sm font-medium"
                htmlFor={`additional-worker-notes-${job._id}`}
              >
                {t("Notes (optional)")}
              </label>
              <textarea
                id={`additional-worker-notes-${job._id}`}
                value={draft.notes}
                maxLength={300}
                rows={3}
                onChange={(event) => {
                  setDraft((current) => ({
                    ...current,
                    notes: event.target.value,
                  }));
                  setValidationError("");
                  if (!requiresRefresh) setRequestError("");
                }}
                disabled={!canEdit || mutationPending}
                className="min-h-20 w-full resize-y rounded-lg border border-input bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
              />
            </div>
            {validationError && (
              <p className="text-sm text-destructive" role="alert">
                {validationError}
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
            <p className="text-sm text-destructive" role="alert">
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
