import { useState, type FormEvent } from "react";
import { isAxiosError } from "axios";
import { LoaderCircle, PackagePlus, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import ConfirmMaterialUsageRemovalDialog from "./ConfirmMaterialUsageRemovalDialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  useActiveMaterialItems,
  useCreateJobMaterialUsage,
  useDeleteJobMaterialUsage,
  useJobMaterialUsage,
} from "../hooks/useJobMaterialUsage";
import type { Job } from "../types/job.types";
import { getEmployeeMaterialUsageVisibility } from "../utils/employeeJobDetails.utils";
import {
  employeeLanguageClasses,
  useEmployeeLanguage,
} from "@/features/employee-portal/i18n";

function formatRecordedAt(value: string | undefined, language: "ta" | "en") {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? null
    : date.toLocaleString(language === "ta" ? "ta-IN" : undefined);
}

function getUsageReadError(
  error: unknown,
  t: ReturnType<typeof useEmployeeLanguage>["t"],
) {
  if (isAxiosError(error) && error.response?.status === 403) {
    return t("This Job is no longer assigned to you, so its material history is unavailable.");
  }
  if (isAxiosError(error) && error.response?.status === 404) {
    return t("This Job is no longer available.");
  }
  return t("Could not load material history. Check your connection and retry.");
}

function getCreateError(
  error: unknown,
  t: ReturnType<typeof useEmployeeLanguage>["t"],
) {
  if (isAxiosError<{ message?: string }>(error)) {
    const status = error.response?.status;
    const message = error.response?.data?.message ?? "";

    if (status === 403) {
      return t("This Job is no longer assigned to you. Refresh the Job before trying again.");
    }
    if (status === 404) {
      return t("The Job or selected Item is no longer available. Refresh and choose an active Item.");
    }
    if (
      status === 400 &&
      message.toLowerCase().includes("job status")
    ) {
      return t("This Job is no longer in progress. Refresh the Job to see its current status.");
    }
    if (status === 400) {
      return t("Check the selected Item and quantity, then try again.");
    }
  }
  return t("Could not record material usage. Check your connection and try again.");
}

export default function EmployeeMaterialUsageSection({
  job,
}: {
  job: Job;
}) {
  const { t, language } = useEmployeeLanguage();
  const canRecord = job.status === "IN_PROGRESS";
  const [itemId, setItemId] = useState("");
  const [quantity, setQuantity] = useState("1");
  const [validationError, setValidationError] = useState("");
  const [usageToRemove, setUsageToRemove] = useState<{
    _id: string;
    itemNameSnapshot: string;
  } | null>(null);
  const usageQuery = useJobMaterialUsage(job._id);
  const itemsQuery = useActiveMaterialItems(canRecord);
  const createMutation = useCreateJobMaterialUsage();
  const deleteMutation = useDeleteJobMaterialUsage();
  const usageEntries = usageQuery.data ?? [];
  const selectedItem = itemsQuery.data?.find((item) => item._id === itemId);
  const { showUsage } = getEmployeeMaterialUsageVisibility(
    job.status,
    usageEntries.length,
  );

  const confirmRemove = () => {
    if (!usageToRemove || deleteMutation.isPending) return;
    if (!canRecord) {
      setUsageToRemove(null);
      toast.error(t("Material usage can only be removed while the Job is in progress."));
      return;
    }

    deleteMutation.mutate(
      { jobId: job._id, usageId: usageToRemove._id },
      {
        onSuccess: () => {
          setUsageToRemove(null);
          toast.success(t("Material usage removed."));
        },
        onError: (error) => {
          if (isAxiosError(error) && error.response?.status === 403) {
            toast.error(t("This Job is no longer assigned to you."));
          } else if (isAxiosError(error) && error.response?.status === 400) {
            toast.error(
              t("Material usage can only be removed while the Job is in progress."),
            );
          } else {
            toast.error(t("Could not remove material usage. Refresh and try again."));
          }
        },
      },
    );
  };

  const recordMaterial = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!canRecord || createMutation.isPending) return;

    const parsedQuantity = Number(quantity);
    if (!itemId) {
      setValidationError(t("Select an Item."));
      return;
    }
    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
      setValidationError(t("Quantity must be a finite number greater than zero."));
      return;
    }

    setValidationError("");
    createMutation.mutate(
      { jobId: job._id, itemId, quantity: parsedQuantity },
      {
        onSuccess: () => {
          setItemId("");
          setQuantity("1");
          toast.success(t("Material usage recorded."));
        },
        onError: (error) => toast.error(getCreateError(error, t)),
      },
    );
  };

  return (
    <>
      {canRecord && (
        <Card className="min-w-0 overflow-hidden">
          <CardHeader className={employeeLanguageClasses(language, "p-4 sm:p-6", "p-3 sm:p-4")}>
            <CardTitle>{t("Record materials used")}</CardTitle>
          </CardHeader>
          <CardContent className={employeeLanguageClasses(language, "min-w-0 space-y-5 p-4 pt-0 sm:p-6 sm:pt-0", "min-w-0 space-y-4 p-3 pt-0 sm:p-4 sm:pt-0")}>
            <form
              className={`grid min-w-0 gap-3 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(8rem,0.4fr)_auto] sm:items-end sm:p-4 ${employeeLanguageClasses(language, "", "sm:grid-cols-1")}`}
              onSubmit={recordMaterial}
            >
              <div className="min-w-0 space-y-2">
                <label
                  className="break-words text-sm font-medium leading-5"
                  htmlFor={`material-item-${job._id}`}
                >
                  {t("Active Item")}
                </label>
                {itemsQuery.isLoading ? (
                  <div
                    className="flex h-9 items-center gap-2 rounded-lg border px-3 text-sm text-muted-foreground"
                    role="status"
                  >
                    <LoaderCircle className="size-4 animate-spin" />
                    {t("Loading Items...")}
                  </div>
                ) : itemsQuery.isError ? (
                  <div className="space-y-2">
                    <p role="alert" className="text-sm text-destructive">
                      {t("Could not load active Items.")}
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      onClick={() => void itemsQuery.refetch()}
                      disabled={itemsQuery.isFetching}
                    >
                      {itemsQuery.isFetching ? t("Retrying...") : t("Retry")}
                    </Button>
                  </div>
                ) : (
                  <Select
                    value={itemId}
                    onValueChange={(value) => {
                      setItemId(value ?? "");
                      setValidationError("");
                    }}
                    disabled={
                      createMutation.isPending ||
                      (itemsQuery.data?.length ?? 0) === 0
                    }
                  >
                    <SelectTrigger
                      id={`material-item-${job._id}`}
                      className="min-h-11 w-full"
                      aria-label={t("Active Item")}
                    >
                      <SelectValue
                        placeholder={
                          (itemsQuery.data?.length ?? 0) > 0
                            ? t("Select an Item")
                            : t("No active Items available")
                        }
                      >
                        {selectedItem
                          ? `${selectedItem.itemName} (${selectedItem.unit})`
                          : undefined}
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {(itemsQuery.data ?? []).map((item) => (
                        <SelectItem key={item._id} value={item._id}>
                          {item.itemName} ({item.unit})
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {itemsQuery.isSuccess && itemsQuery.data.length === 0 && (
                  <p className="text-sm text-muted-foreground">
                    {t("No active Items are available.")}
                  </p>
                )}
              </div>

              <div className="space-y-2">
                <label
                  className="text-sm font-medium"
                  htmlFor={`material-quantity-${job._id}`}
                >
                  {t("Quantity")}
                </label>
                <input
                  id={`material-quantity-${job._id}`}
                  type="number"
                  min="0"
                  step="any"
                  inputMode="decimal"
                  value={quantity}
                  onChange={(event) => {
                    setQuantity(event.target.value);
                    setValidationError("");
                  }}
                  disabled={createMutation.isPending}
                  aria-invalid={Boolean(validationError)}
                  className="h-11 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-50"
                />
              </div>

              <Button
                type="submit"
                className={employeeLanguageClasses(language, "min-h-11 w-full sm:w-auto", "min-h-11 h-auto w-full whitespace-normal py-3 leading-5 sm:w-auto")}
                disabled={
                  createMutation.isPending ||
                  itemsQuery.isLoading ||
                  itemsQuery.isError ||
                  (itemsQuery.data?.length ?? 0) === 0
                }
              >
                {createMutation.isPending ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <PackagePlus />
                )}
                {createMutation.isPending ? t("Recording...") : t("Add Material")}
              </Button>
              {validationError && (
                <p
                  className="text-sm text-destructive sm:col-span-3"
                  role="alert"
                >
                  {validationError}
                </p>
              )}
            </form>
          </CardContent>
        </Card>
      )}

      {usageQuery.isLoading && !canRecord && (
        <div
          className="flex items-center gap-2 py-3 text-sm text-muted-foreground"
          role="status"
        >
          <LoaderCircle className="size-4 animate-spin" />
          {t("Loading material history...")}
        </div>
      )}
      {usageQuery.isError && (
        <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
          <p role="alert" className="text-sm text-destructive">
            {getUsageReadError(usageQuery.error, t)}
          </p>
          <Button
            type="button"
            variant="outline"
            size="sm"
            onClick={() => void usageQuery.refetch()}
            disabled={usageQuery.isFetching}
          >
            {usageQuery.isFetching ? t("Retrying...") : t("Retry")}
          </Button>
        </div>
      )}
      {showUsage && (
        <Card className="min-w-0 overflow-hidden">
          <CardHeader className={employeeLanguageClasses(language, "p-4 sm:p-6", "p-3 sm:p-4")}>
            <CardTitle>{t("Materials Used")}</CardTitle>
          </CardHeader>
          <CardContent className={employeeLanguageClasses(language, "min-w-0 p-4 pt-0 sm:p-6 sm:pt-0", "min-w-0 p-3 pt-0 sm:p-4 sm:pt-0")}>
            <section aria-label={t("Recorded materials")} aria-live="polite">
              <ul className="divide-y rounded-md border">
                {usageEntries.map((entry) => {
                  const recordedAt = formatRecordedAt(entry.createdAt, language);
                  return (
                    <li
                      key={entry._id}
                      className={`flex min-w-0 flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between ${employeeLanguageClasses(language, "", "sm:items-start")}`}
                    >
                      <p className="min-w-0 break-words text-sm font-medium">
                        {entry.itemNameSnapshot}
                      </p>
                      <div className="flex shrink-0 flex-wrap items-center gap-x-3 gap-y-1 text-sm text-muted-foreground">
                        <span>
                          {entry.quantity} {entry.unitSnapshot}
                        </span>
                        {recordedAt && (
                          <time dateTime={entry.createdAt}>{recordedAt}</time>
                        )}
                        {canRecord && (
                          <Button
                            type="button"
                            variant="ghost"
                            size="icon"
                            aria-label={t("Remove {item} usage", { item: entry.itemNameSnapshot })}
                            onClick={() =>
                              setUsageToRemove({
                                _id: entry._id,
                                itemNameSnapshot: entry.itemNameSnapshot,
                              })
                            }
                            disabled={deleteMutation.isPending}
                          >
                            <Trash2 />
                          </Button>
                        )}
                      </div>
                    </li>
                  );
                })}
              </ul>
            </section>
          </CardContent>
          <ConfirmMaterialUsageRemovalDialog
            open={Boolean(usageToRemove)}
            itemName={usageToRemove?.itemNameSnapshot ?? t("material")}
            isPending={deleteMutation.isPending}
            onOpenChange={(open) => {
              if (!open) setUsageToRemove(null);
            }}
            onConfirm={confirmRemove}
          />
        </Card>
      )}
    </>
  );
}
