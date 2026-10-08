import { useState } from "react";
import { isAxiosError } from "axios";
import { LoaderCircle, Trash2 } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import ConfirmMaterialUsageRemovalDialog from "./ConfirmMaterialUsageRemovalDialog";
import { useAdminJobMaterialUsage } from "../hooks/useAdminJobMaterialUsage";
import { useDeleteJobMaterialUsage } from "../hooks/useJobMaterialUsage";

const currencyFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function formatCurrency(value: number) {
  return currencyFormatter.format(value);
}

function formatRecordedAt(value?: string) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date.toLocaleString();
}

function getErrorMessage(error: unknown) {
  if (isAxiosError(error) && error.response?.status === 404) {
    return "This Job is no longer available.";
  }
  return "Could not load material usage. Check your connection and retry.";
}

export default function AdminMaterialUsageSection({
  jobId,
}: {
  jobId: string;
}) {
  const [usageToRemove, setUsageToRemove] = useState<{
    _id: string;
    itemNameSnapshot: string;
  } | null>(null);
  const usageQuery = useAdminJobMaterialUsage(jobId);
  const deleteMutation = useDeleteJobMaterialUsage();
  const entries = usageQuery.data ?? [];
  const totalExpense =
    entries.reduce(
      (totalCents, entry) =>
        totalCents + Math.round(entry.lineCostSnapshot * 100),
      0,
    ) / 100;

  const confirmRemove = () => {
    if (!usageToRemove || deleteMutation.isPending) return;

    deleteMutation.mutate(
      { jobId, usageId: usageToRemove._id },
      {
        onSuccess: () => {
          setUsageToRemove(null);
          toast.success("Material usage removed.");
        },
        onError: (error) => {
          if (isAxiosError(error) && error.response?.status === 404) {
            toast.error("This material usage entry is no longer available.");
          } else {
            toast.error("Could not remove material usage. Refresh and try again.");
          }
        },
      },
    );
  };

  return (
    <Card className="min-w-0 overflow-hidden lg:col-span-2">
      <CardHeader className="p-4 sm:p-6">
        <CardTitle>Materials Used</CardTitle>
      </CardHeader>
      <CardContent className="min-w-0 space-y-4 p-4 pt-0 sm:p-6 sm:pt-0">
        {usageQuery.isLoading ? (
          <div
            className="flex items-center gap-2 py-4 text-sm text-muted-foreground"
            role="status"
          >
            <LoaderCircle className="size-4 animate-spin" />
            Loading material usage...
          </div>
        ) : usageQuery.isError ? (
          <div className="space-y-3 rounded-md border border-destructive/30 bg-destructive/5 p-4">
            <p role="alert" className="text-sm text-destructive">
              {getErrorMessage(usageQuery.error)}
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={() => void usageQuery.refetch()}
              disabled={usageQuery.isFetching}
            >
              {usageQuery.isFetching ? "Retrying..." : "Retry"}
            </Button>
          </div>
        ) : entries.length === 0 ? (
          <>
            <p className="rounded-md border border-dashed p-5 text-center text-sm text-muted-foreground">
              No materials have been recorded for this Job.
            </p>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/40 px-4 py-3">
              <span className="font-semibold">Total material expense</span>
              <span className="text-lg font-bold tabular-nums">
                {formatCurrency(totalExpense)}
              </span>
            </div>
          </>
        ) : (
          <>
            <div className="overflow-x-auto rounded-md border">
              <table className="w-full min-w-[42rem] text-left text-sm">
                <thead className="bg-muted/50 text-xs text-muted-foreground">
                  <tr>
                    <th scope="col" className="px-3 py-2.5 font-medium">
                      Item
                    </th>
                    <th scope="col" className="px-3 py-2.5 font-medium">
                      Quantity
                    </th>
                    <th scope="col" className="px-3 py-2.5 font-medium">
                      Unit cost
                    </th>
                    <th scope="col" className="px-3 py-2.5 font-medium">
                      Line cost
                    </th>
                    <th scope="col" className="px-3 py-2.5 font-medium">
                      Recorded
                    </th>
                    <th scope="col" className="px-3 py-2.5 font-medium">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {entries.map((entry) => {
                    const recordedAt = formatRecordedAt(entry.createdAt);
                    return (
                      <tr key={entry._id}>
                        <td className="max-w-56 break-words px-3 py-3 font-medium">
                          {entry.itemNameSnapshot}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3">
                          {entry.quantity} {entry.unitSnapshot}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3">
                          {formatCurrency(entry.unitCostSnapshot)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3">
                          {formatCurrency(entry.lineCostSnapshot)}
                        </td>
                        <td className="whitespace-nowrap px-3 py-3 text-muted-foreground">
                          {recordedAt ? (
                            <time dateTime={entry.createdAt}>
                              {recordedAt}
                            </time>
                          ) : (
                            "Not available"
                          )}
                        </td>
                        <td className="px-3 py-3">
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
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="flex flex-wrap items-center justify-between gap-2 rounded-md bg-muted/40 px-4 py-3">
              <span className="font-semibold">Total material expense</span>
              <span className="text-lg font-bold tabular-nums">
                {formatCurrency(totalExpense)}
              </span>
            </div>
          </>
        )}
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
