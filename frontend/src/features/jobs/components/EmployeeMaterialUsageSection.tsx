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

function formatRecordedAt(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString();
}

function getUsageReadError(error: unknown) {
  if (isAxiosError(error) && error.response?.status === 403) {
    return "This Job is no longer assigned to you, so its material history is unavailable.";
  }
  if (isAxiosError(error) && error.response?.status === 404) {
    return "This Job is no longer available.";
  }
  return "Could not load material history. Check your connection and retry.";
}

function getCreateError(error: unknown) {
  if (isAxiosError<{ message?: string }>(error)) {
    const status = error.response?.status;
    const message = error.response?.data?.message ?? "";

    if (status === 403) {
      return "This Job is no longer assigned to you. Refresh the Job before trying again.";
    }
    if (status === 404) {
      return "The Job or selected Item is no longer available. Refresh and choose an active Item.";
    }
    if (
      status === 400 &&
      message.toLowerCase().includes("job status")
    ) {
      return "This Job is no longer in progress. Refresh the Job to see its current status.";
    }
    if (status === 400) {
      return "Check the selected Item and quantity, then try again.";
    }
  }
  return "Could not record material usage. Check your connection and try again.";
}

export default function EmployeeMaterialUsageSection({
  job,
}: {
  job: Job;
}) {
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

  const confirmRemove = () => {
    if (!usageToRemove || deleteMutation.isPending) return;
    if (!canRecord) {
      setUsageToRemove(null);
      toast.error("Material usage can only be removed while the Job is in progress.");
      return;
    }

    deleteMutation.mutate(
      { jobId: job._id, usageId: usageToRemove._id },
      {
        onSuccess: () => {
          setUsageToRemove(null);
          toast.success("Material usage removed.");
        },
        onError: (error) => {
          if (isAxiosError(error) && error.response?.status === 403) {
            toast.error("This Job is no longer assigned to you.");
          } else if (isAxiosError(error) && error.response?.status === 400) {
            toast.error(
              "Material usage can only be removed while the Job is in progress.",
            );
          } else {
            toast.error("Could not remove material usage. Refresh and try again.");
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
      setValidationError("Select an Item.");
      return;
    }
    if (!Number.isFinite(parsedQuantity) || parsedQuantity <= 0) {
      setValidationError("Quantity must be a finite number greater than zero.");
      return;
    }

    setValidationError("");
    createMutation.mutate(
      { jobId: job._id, itemId, quantity: parsedQuantity },
      {
        onSuccess: () => {
          setItemId("");
          setQuantity("1");
          toast.success("Material usage recorded.");
        },
        onError: (error) => toast.error(getCreateError(error)),
      },
    );
  };

  return (
    <Card className="min-w-0 overflow-hidden">
      <CardHeader className="p-4 sm:p-6">
        <CardTitle>Materials Used</CardTitle>
      </CardHeader>
      <CardContent className="min-w-0 space-y-5 p-4 pt-0 sm:p-6 sm:pt-0">
        {canRecord ? (
          <form
            className="grid min-w-0 gap-3 rounded-lg border p-3 sm:grid-cols-[minmax(0,1fr)_minmax(8rem,0.4fr)_auto] sm:items-end sm:p-4"
            onSubmit={recordMaterial}
          >
            <div className="min-w-0 space-y-2">
              <label
                className="text-sm font-medium"
                htmlFor={`material-item-${job._id}`}
              >
                Active Item
              </label>
              {itemsQuery.isLoading ? (
                <div
                  className="flex h-9 items-center gap-2 rounded-lg border px-3 text-sm text-muted-foreground"
                  role="status"
                >
                  <LoaderCircle className="size-4 animate-spin" />
                  Loading Items...
                </div>
              ) : itemsQuery.isError ? (
                <div className="space-y-2">
                  <p role="alert" className="text-sm text-destructive">
                    Could not load active Items.
                  </p>
                  <Button
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => void itemsQuery.refetch()}
                    disabled={itemsQuery.isFetching}
                  >
                    {itemsQuery.isFetching ? "Retrying..." : "Retry"}
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
                    aria-label="Active Item"
                  >
                    <SelectValue
                      placeholder={
                        (itemsQuery.data?.length ?? 0) > 0
                          ? "Select an Item"
                          : "No active Items available"
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
                  No active Items are available.
                </p>
              )}
            </div>

            <div className="space-y-2">
              <label
                className="text-sm font-medium"
                htmlFor={`material-quantity-${job._id}`}
              >
                Quantity
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
              className="min-h-11 w-full sm:w-auto"
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
              {createMutation.isPending ? "Recording..." : "Add Material"}
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
        ) : (
          <p className="rounded-md bg-muted/40 p-3 text-sm text-muted-foreground">
            New material usage can only be recorded while the Job is in
            progress.
          </p>
        )}

        <section aria-label="Recorded materials" aria-live="polite">
          {usageQuery.isLoading ? (
            <div className="flex items-center gap-2 py-3 text-sm text-muted-foreground" role="status">
              <LoaderCircle className="size-4 animate-spin" />
              Loading material history...
            </div>
          ) : usageQuery.isError ? (
            <div className="space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3">
              <p role="alert" className="text-sm text-destructive">
                {getUsageReadError(usageQuery.error)}
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void usageQuery.refetch()}
                disabled={usageQuery.isFetching}
              >
                {usageQuery.isFetching ? "Retrying..." : "Retry"}
              </Button>
            </div>
          ) : usageEntries.length === 0 ? (
            <p className="rounded-md border border-dashed p-4 text-center text-sm text-muted-foreground">
              No materials have been recorded for this Job.
            </p>
          ) : (
            <ul className="divide-y rounded-md border">
              {usageEntries.map((entry) => {
                const recordedAt = formatRecordedAt(entry.createdAt);
                return (
                  <li
                    key={entry._id}
                    className="flex min-w-0 flex-col gap-2 p-3 sm:flex-row sm:items-center sm:justify-between"
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
                          aria-label={`Remove ${entry.itemNameSnapshot} usage`}
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
          )}
        </section>
      </CardContent>
      <ConfirmMaterialUsageRemovalDialog
        open={Boolean(usageToRemove)}
        itemName={usageToRemove?.itemNameSnapshot ?? "material"}
        isPending={deleteMutation.isPending}
        onOpenChange={(open) => {
          if (!open) setUsageToRemove(null);
        }}
        onConfirm={confirmRemove}
      />
    </Card>
  );
}
