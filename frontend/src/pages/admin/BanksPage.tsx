import { useState } from "react";
import { isAxiosError } from "axios";
import { Landmark, Pencil, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import BankFormDialog from "@/features/banks/components/BankFormDialog";
import { useDeactivateBank, useUpdateBank } from "@/features/banks/hooks/useBankMutations";
import { useBanks } from "@/features/banks/hooks/useBanks";
import type { Bank } from "@/features/banks/types/bank.types";

const ALL_BANKS = "ALL";

function getErrorMessage(error: unknown) {
  if (isAxiosError<{ message?: string }>(error)) {
    return error.response?.data?.message || "The bank request could not be completed.";
  }
  return error instanceof Error
    ? error.message
    : "The bank request could not be completed.";
}

function BankTableSkeleton() {
  return (
    <Card>
      <CardContent className="space-y-3 p-4" role="status">
        {Array.from({ length: 5 }, (_, index) => (
          <div
            key={index}
            className="h-12 animate-pulse rounded bg-muted/50"
          />
        ))}
        <p className="sr-only">Loading banks...</p>
      </CardContent>
    </Card>
  );
}

export default function BanksPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState(ALL_BANKS);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [bankToEdit, setBankToEdit] = useState<Bank | null>(null);
  const [bankToDeactivate, setBankToDeactivate] = useState<Bank | null>(null);
  const params = {
    ...(search.trim() ? { search: search.trim() } : {}),
    ...(statusFilter !== ALL_BANKS
      ? { isActive: statusFilter === "active" }
      : {}),
  };
  const {
    data: banks = [],
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useBanks(params);
  const deactivateMutation = useDeactivateBank();
  const updateMutation = useUpdateBank();

  const openCreateDialog = () => {
    setBankToEdit(null);
    setDialogOpen(true);
  };

  const openEditDialog = (bank: Bank) => {
    setBankToEdit(bank);
    setDialogOpen(true);
  };

  const closeFormDialog = (open: boolean) => {
    setDialogOpen(open);
    if (!open) setBankToEdit(null);
  };

  const confirmDeactivation = async () => {
    if (!bankToDeactivate) return;
    try {
      await deactivateMutation.mutateAsync(bankToDeactivate._id);
      toast.success("Bank deactivated successfully.");
      setBankToDeactivate(null);
    } catch (mutationError) {
      toast.error(getErrorMessage(mutationError));
    }
  };

  const activateBank = async (bank: Bank) => {
    try {
      await updateMutation.mutateAsync({
        id: bank._id,
        data: { isActive: true },
      });
      toast.success("Bank activated successfully.");
    } catch (mutationError) {
      toast.error(getErrorMessage(mutationError));
    }
  };

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Banks</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Manage bank master information used by ATMs.
          </p>
        </div>
        <Button type="button" onClick={openCreateDialog}>
          <Plus />
          Add Bank
        </Button>
      </div>

      <Card>
        <CardContent className="grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
          <div>
            <label
              htmlFor="bank-search"
              className="mb-2 block text-sm font-medium"
            >
              Search banks
            </label>
            <input
              id="bank-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Bank name or code"
              className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium">Status</label>
            <Select value={statusFilter} onValueChange={(value) => setStatusFilter(value ?? ALL_BANKS)}>
              <SelectTrigger className="w-full">
                <SelectValue placeholder="All banks" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_BANKS}>All banks</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <BankTableSkeleton />
      ) : isError ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-3 p-6">
            <div>
              <p className="font-medium text-destructive">Failed to load banks.</p>
              <p className="mt-1 text-sm text-muted-foreground">
                {getErrorMessage(error)}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => void refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={isFetching ? "animate-spin" : ""} />
              {isFetching ? "Retrying..." : "Retry"}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Bank List</CardTitle>
            <span className="text-sm text-muted-foreground">
              {banks.length} {banks.length === 1 ? "bank" : "banks"}
            </span>
          </CardHeader>
          {banks.length === 0 ? (
            <CardContent className="flex flex-col items-center px-6 py-14 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Landmark className="size-6" />
              </div>
              <h2 className="mt-4 text-lg font-semibold">
                {search.trim() || statusFilter !== ALL_BANKS
                  ? "No matching banks."
                  : "No banks yet."}
              </h2>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                {search.trim() || statusFilter !== ALL_BANKS
                  ? "Try changing the search term or status filter."
                  : "Add a bank to make it available for ATM records."}
              </p>
            </CardContent>
          ) : (
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-190 text-sm">
                  <thead className="border-y bg-muted/40">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">Bank Name</th>
                      <th className="px-4 py-3 text-left font-medium">Bank Code</th>
                      <th className="px-4 py-3 text-left font-medium">Contact</th>
                      <th className="px-4 py-3 text-left font-medium">Status</th>
                      <th className="px-4 py-3 text-right font-medium">Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {banks.map((bank) => (
                      <tr key={bank._id} className="border-b last:border-0">
                        <td className="px-4 py-3 font-medium">
                          {bank.bankName || "Unnamed bank"}
                        </td>
                        <td className="px-4 py-3 font-mono">
                          {bank.bankCode || "—"}
                        </td>
                        <td className="px-4 py-3">
                          {bank.contactEmail || bank.contactPhone ? (
                            <div>
                              {bank.contactEmail && <p>{bank.contactEmail}</p>}
                              {bank.contactPhone && (
                                <p className="text-xs text-muted-foreground">
                                  {bank.contactPhone}
                                </p>
                              )}
                            </div>
                          ) : (
                            "—"
                          )}
                        </td>
                        <td className="px-4 py-3">
                          <Badge variant={bank.isActive ? "secondary" : "outline"}>
                            {bank.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => openEditDialog(bank)}
                            >
                              <Pencil />
                              Edit
                            </Button>
                            {bank.isActive ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="destructive"
                                onClick={() => setBankToDeactivate(bank)}
                                disabled={deactivateMutation.isPending}
                              >
                                Deactivate
                              </Button>
                            ) : (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => void activateBank(bank)}
                                disabled={updateMutation.isPending}
                              >
                                {updateMutation.isPending &&
                                updateMutation.variables?.id === bank._id
                                  ? "Activating..."
                                  : "Activate"}
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          )}
        </Card>
      )}

      <BankFormDialog
        open={dialogOpen}
        bank={bankToEdit}
        onOpenChange={closeFormDialog}
      />

      <Dialog
        open={Boolean(bankToDeactivate)}
        onOpenChange={(open) => {
          if (!deactivateMutation.isPending && !open) {
            setBankToDeactivate(null);
          }
        }}
      >
        <DialogContent>
          <div className="space-y-2">
            <DialogTitle>Deactivate this bank?</DialogTitle>
            <DialogDescription>
              Existing ATMs linked to this bank may prevent deactivation. The
              bank will be marked inactive and will not be permanently deleted.
            </DialogDescription>
          </div>
          {bankToDeactivate && (
            <p className="mt-4 text-sm font-medium">
              {bankToDeactivate.bankName} ({bankToDeactivate.bankCode})
            </p>
          )}
          <div className="mt-6 flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={deactivateMutation.isPending}
              onClick={() => setBankToDeactivate(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={deactivateMutation.isPending}
              onClick={() => void confirmDeactivation()}
            >
              {deactivateMutation.isPending ? "Deactivating..." : "Deactivate"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
