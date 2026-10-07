import { useEffect, useState } from "react";
import { isAxiosError } from "axios";
import {
  ChevronLeft,
  ChevronRight,
  Plus,
  Search,
  UserRound,
} from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
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
import { useBanks } from "@/features/banks/hooks/useBanks";
import CustomerEditDialog from "@/features/customers/components/CustomerEditDialog";
import {
  useAdminCustomers,
  useUpdateCustomer,
} from "@/features/customers/hooks/useAdminCustomers";
import type {
  CustomerListItem,
  CustomerUpdateData,
} from "@/features/customers/services/customer.service";
import CreateUserWizard from "@/features/users/components/CreateUserWizard";

const ALL = "ALL";
const PAGE_SIZE = 10;

type StatusFilter = typeof ALL | "active" | "inactive";

function getCustomerErrorMessage(error: unknown) {
  if (isAxiosError<{ message?: string }>(error)) {
    return (
      error.response?.data?.message ||
      "The customer request could not be completed."
    );
  }
  return "The customer request could not be completed.";
}

function CustomerTableSkeleton() {
  return (
    <Card>
      <CardContent className="space-y-3 p-4" role="status">
        {Array.from({ length: 5 }, (_, index) => (
          <div
            key={index}
            className="h-12 animate-pulse rounded bg-muted/50"
          />
        ))}
        <p className="sr-only">Loading customers...</p>
      </CardContent>
    </Card>
  );
}

function SummaryCard({
  label,
  value,
}: {
  label: string;
  value: number | undefined;
}) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-2 text-2xl font-semibold">{value ?? "—"}</p>
      </CardContent>
    </Card>
  );
}

export default function CustomersPage() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState<StatusFilter>(ALL);
  const [bankCode, setBankCode] = useState(ALL);
  const [page, setPage] = useState(1);
  const [showCreateWizard, setShowCreateWizard] = useState(false);
  const [customerToEdit, setCustomerToEdit] =
    useState<CustomerListItem | null>(null);
  const [customerToDeactivate, setCustomerToDeactivate] =
    useState<CustomerListItem | null>(null);
  const [customerToReactivate, setCustomerToReactivate] =
    useState<CustomerListItem | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [search]);

  const {
    data,
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useAdminCustomers({
    page,
    limit: PAGE_SIZE,
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
    ...(status !== ALL ? { status } : {}),
    ...(bankCode !== ALL ? { bankName: bankCode } : {}),
  });
  const {
    data: banks = [],
    isLoading: isBanksLoading,
    isError: isBanksError,
  } = useBanks();
  const updateMutation = useUpdateCustomer();

  const hasActiveFilters =
    Boolean(search.trim()) || status !== ALL || bankCode !== ALL;
  const totalPages = Math.max(data?.pagination.totalPages ?? 0, 1);

  const clearFilters = () => {
    setSearch("");
    setDebouncedSearch("");
    setStatus(ALL);
    setBankCode(ALL);
    setPage(1);
  };

  const saveCustomer = async (id: string, updates: CustomerUpdateData) => {
    try {
      await updateMutation.mutateAsync({ id, data: updates });
      toast.success("Customer updated successfully.");
      setCustomerToEdit(null);
    } catch (mutationError) {
      toast.error(getCustomerErrorMessage(mutationError));
    }
  };

  const confirmDeactivation = async () => {
    if (!customerToDeactivate) return;
    try {
      await updateMutation.mutateAsync({
        id: customerToDeactivate._id,
        data: { isActive: false },
      });
      toast.success("Customer deactivated successfully.");
      setCustomerToDeactivate(null);
      if (
        status === "active" &&
        page > 1 &&
        data?.customers.length === 1
      ) {
        setPage((currentPage) => Math.max(currentPage - 1, 1));
      }
    } catch (mutationError) {
      toast.error(getCustomerErrorMessage(mutationError));
    }
  };

  const confirmReactivation = async () => {
    if (!customerToReactivate) return;
    try {
      await updateMutation.mutateAsync({
        id: customerToReactivate._id,
        data: { isActive: true },
      });
      toast.success("Customer reactivated successfully.");
      setCustomerToReactivate(null);
    } catch (mutationError) {
      toast.error(getCustomerErrorMessage(mutationError));
    }
  };

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Customers</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Manage customers and their assigned ATMs
          </p>
        </div>
        <Button type="button" onClick={() => setShowCreateWizard(true)}>
          <Plus />
          Create Customer
        </Button>
      </div>

      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard label="Total Customers" value={data?.summary.total} />
        <SummaryCard label="Active Customers" value={data?.summary.active} />
        <SummaryCard label="Inactive Customers" value={data?.summary.inactive} />
      </div>

      <Card>
        <CardContent className="grid gap-4 p-4 sm:grid-cols-2 lg:grid-cols-[minmax(0,1fr)_12rem_16rem]">
          <div>
            <label
              htmlFor="customer-search"
              className="mb-2 block text-sm font-medium"
            >
              Search customers
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />
              <input
                id="customer-search"
                type="search"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="Search customers..."
                className="h-9 w-full rounded-lg border border-input bg-transparent py-2 pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium">Status</label>
            <Select
              value={status}
              onValueChange={(value) => {
                setStatus((value as StatusFilter | null) ?? ALL);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium">Bank</label>
            <Select
              value={bankCode}
              onValueChange={(value) => {
                setBankCode(value ?? ALL);
                setPage(1);
              }}
              disabled={isBanksLoading || isBanksError}
            >
              <SelectTrigger className="w-full">
                <SelectValue
                  placeholder={
                    isBanksLoading
                      ? "Loading banks..."
                      : isBanksError
                        ? "Bank list unavailable"
                        : "All banks"
                  }>
                  {bankCode === ALL
                    ? "All"
                    : banks.find((bank) => bank.bankCode === bankCode)?.bankName ??
                      "All"}
                </SelectValue>
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All</SelectItem>
                {banks.map((bank) => (
                  <SelectItem key={bank._id} value={bank.bankCode}>
                    {bank.bankName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isBanksError && (
              <p className="mt-1 text-xs text-destructive">
                Bank options could not be loaded.
              </p>
            )}
          </div>
        </CardContent>
      </Card>

      {isLoading && !data ? (
        <CustomerTableSkeleton />
      ) : isError && !data ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-3 p-6">
            <div>
              <p className="font-medium text-destructive">
                Failed to load customers.
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Please try again.
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => void refetch()}
              disabled={isFetching}
            >
              {isFetching ? "Retrying..." : "Retry"}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardContent className="p-0">
            {data?.customers.length ? (
              <div className="overflow-x-auto">
                <table className="w-full min-w-[880px] text-sm">
                  <thead className="border-b bg-muted/40">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">
                        Customer
                      </th>
                      <th className="px-4 py-3 text-left font-medium">Phone</th>
                      <th className="px-4 py-3 text-left font-medium">Bank</th>
                      <th className="px-4 py-3 text-left font-medium">ATMs</th>
                      <th className="px-4 py-3 text-left font-medium">Status</th>
                      <th className="px-4 py-3 text-right font-medium">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {data.customers.map((customer) => (
                      <tr
                        key={customer._id}
                        className="border-b last:border-b-0"
                      >
                        <td className="px-4 py-3">
                          <p className="font-medium">{customer.customerName}</p>
                          <p className="mt-1 text-xs text-muted-foreground">
                            {customer.customerEmail}
                          </p>
                        </td>
                        <td className="px-4 py-3">{customer.customerPhone}</td>
                        <td className="px-4 py-3">
                          {customer.bankName || "—"}
                        </td>
                        <td className="px-4 py-3">
                          {customer.linkedATMCount}
                        </td>
                        <td className="px-4 py-3">
                          <Badge
                            className={
                              customer.isActive
                                ? "bg-green-100 text-green-700"
                                : "bg-muted text-muted-foreground"
                            }
                          >
                            {customer.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            <Link
                              to={`/admin/customers/${customer._id}`}
                              className="inline-flex h-7 items-center justify-center rounded-lg border border-border bg-background px-2.5 text-xs font-medium hover:bg-muted"
                            >
                              View
                            </Link>
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => setCustomerToEdit(customer)}
                            >
                              Edit
                            </Button>
                            {customer.isActive ? (
                              <Button
                                type="button"
                                size="sm"
                                variant="destructive"
                                onClick={() =>
                                  setCustomerToDeactivate(customer)
                                }
                                disabled={updateMutation.isPending}
                              >
                                Deactivate
                              </Button>
                            ) : (
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() =>
                                  setCustomerToReactivate(customer)
                                }
                                disabled={updateMutation.isPending}
                              >
                                Reactivate
                              </Button>
                            )}
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            ) : (
              <div className="flex flex-col items-center px-6 py-12 text-center">
                <UserRound className="h-8 w-8 text-muted-foreground" />
                <p className="mt-3 font-medium">No customers found</p>
                {hasActiveFilters && (
                  <>
                    <p className="mt-1 text-sm text-muted-foreground">
                      Try changing your search or filters.
                    </p>
                    <Button
                      type="button"
                      variant="outline"
                      className="mt-4"
                      onClick={clearFilters}
                    >
                      Clear filters
                    </Button>
                  </>
                )}
              </div>
            )}
          </CardContent>
          {data && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
              <p className="text-sm text-muted-foreground">
                {data.pagination.total} total customers
                {isFetching && (
                  <span className="ml-2" role="status">
                    Updating...
                  </span>
                )}
              </p>
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground">
                  Page {data.pagination.page} of {totalPages}
                </span>
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  aria-label="Previous page"
                  onClick={() => setPage((currentPage) => currentPage - 1)}
                  disabled={page <= 1 || isFetching}
                >
                  <ChevronLeft />
                </Button>
                <Button
                  type="button"
                  size="icon"
                  variant="outline"
                  aria-label="Next page"
                  onClick={() => setPage((currentPage) => currentPage + 1)}
                  disabled={page >= totalPages || isFetching}
                >
                  <ChevronRight />
                </Button>
              </div>
            </div>
          )}
        </Card>
      )}

      <Dialog
        open={showCreateWizard}
        onOpenChange={setShowCreateWizard}
      >
        <DialogContent className="max-h-[90vh] max-w-3xl overflow-y-auto">
          <DialogTitle className="sr-only">Create a customer</DialogTitle>
          <DialogDescription className="sr-only">
            Create a user account and select the customer role.
          </DialogDescription>
          <CreateUserWizard onClose={() => setShowCreateWizard(false)} />
        </DialogContent>
      </Dialog>

      <CustomerEditDialog
        open={Boolean(customerToEdit)}
        customer={customerToEdit}
        banks={banks}
        isSaving={updateMutation.isPending}
        onOpenChange={(open) => {
          if (!open) setCustomerToEdit(null);
        }}
        onSave={saveCustomer}
      />

      <Dialog
        open={Boolean(customerToDeactivate)}
        onOpenChange={(open) => {
          if (!updateMutation.isPending && !open) {
            setCustomerToDeactivate(null);
          }
        }}
      >
        <DialogContent>
          <div className="space-y-2">
            <DialogTitle>Deactivate this customer?</DialogTitle>
            <DialogDescription>
              This marks the customer inactive without deleting the customer
              profile or changing its ATM assignments.
            </DialogDescription>
          </div>
          {customerToDeactivate && (
            <p className="mt-4 text-sm font-medium">
              {customerToDeactivate.customerName} (
              {customerToDeactivate.customerEmail})
            </p>
          )}
          <div className="mt-6 flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={updateMutation.isPending}
              onClick={() => setCustomerToDeactivate(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={updateMutation.isPending}
              onClick={() => void confirmDeactivation()}
            >
              {updateMutation.isPending
                ? "Deactivating..."
                : "Deactivate"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={Boolean(customerToReactivate)}
        onOpenChange={(open) => {
          if (!updateMutation.isPending && !open) {
            setCustomerToReactivate(null);
          }
        }}
      >
        <DialogContent>
          <div className="space-y-2">
            <DialogTitle>Reactivate this customer?</DialogTitle>
            <DialogDescription>
              This will mark the customer account as active.
            </DialogDescription>
          </div>
          {customerToReactivate && (
            <p className="mt-4 text-sm font-medium">
              {customerToReactivate.customerName} (
              {customerToReactivate.customerEmail})
            </p>
          )}
          <div className="mt-6 flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={updateMutation.isPending}
              onClick={() => setCustomerToReactivate(null)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              disabled={updateMutation.isPending}
              onClick={() => void confirmReactivation()}
            >
              {updateMutation.isPending ? "Reactivating..." : "Reactivate"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
