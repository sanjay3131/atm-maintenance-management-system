import { useEffect, useState } from "react";
import { ChevronLeft, ChevronRight, Plus, Search } from "lucide-react";
import { Link } from "react-router-dom";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import CreateComplaintDialog from "@/features/complaints/components/CreateComplaintDialog";
import { useCustomers } from "@/features/customers/hooks/useCustomers";
import { useATMs } from "@/features/atms/hooks/useATMs";
import {
  ComplaintPriorityBadge,
  ComplaintStatusBadge,
} from "@/features/complaints/components/ComplaintBadges";
import { useAdminComplaints } from "@/features/complaints/hooks/useAdminComplaints";
import type {
  Complaint,
  ComplaintPriority,
  ComplaintStatus,
} from "@/features/complaints/types/complaint.types";

const ALL = "ALL";
const DEFAULT_PAGE_SIZE = 10;
const PAGE_SIZES = [10, 25, 50];

const COMPLAINT_STATUSES: ComplaintStatus[] = [
  "OPEN",
  "ASSIGNED",
  "IN_PROGRESS",
  "RESOLVED",
  "CLOSED",
  "CANCELLED",
];

const COMPLAINT_PRIORITIES: ComplaintPriority[] = [
  "LOW",
  "MEDIUM",
  "HIGH",
  "CRITICAL",
];

function formatLabel(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatDate(value?: string | null) {
  if (!value) return "Not available";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Not available"
    : date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
}

function getDateBoundary(value: string, endOfDay: boolean) {
  if (!value) return undefined;
  const [year, month, day] = value.split("-").map(Number);
  return new Date(
    year,
    month - 1,
    day,
    endOfDay ? 23 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 59 : 0,
    endOfDay ? 999 : 0,
  ).toISOString();
}

function getATMLabel(atm: Complaint["atmId"]) {
  if (!atm || typeof atm !== "object") return "ATM details unavailable";
  if (atm.atmId) {
    return atm.atmId;
  }
  return atm.locationName
    ? atm.locationName
    : "ATM details unavailable";
}

function getCustomerLabel(customer: Complaint["customerId"]) {
  if (!customer) return "No customer linked";
  if (typeof customer !== "object") return "Customer details unavailable";
  return customer.customerName
    ? customer.customerName
    : "Customer details unavailable";
}

function ComplaintListSkeleton() {
  return (
    <Card>
      <CardContent className="space-y-3 p-4" role="status">
        {Array.from({ length: 6 }, (_, index) => (
          <div
            key={index}
            className="h-12 animate-pulse rounded bg-muted/50"
          />
        ))}
        <p className="sr-only">Loading complaints...</p>
      </CardContent>
    </Card>
  );
}

function StatCard({ label, value }: { label: string; value?: number }) {
  return (
    <Card>
      <CardContent className="p-4">
        <p className="text-sm text-muted-foreground">{label}</p>
        <p className="mt-2 text-2xl font-semibold">{value ?? "—"}</p>
      </CardContent>
    </Card>
  );
}

export default function ComplaintsPage() {
  const [isCreateDialogOpen, setIsCreateDialogOpen] = useState(false);
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [status, setStatus] = useState<ComplaintStatus | typeof ALL>(ALL);
  const [priority, setPriority] = useState<ComplaintPriority | typeof ALL>(ALL);
  const [customerId, setCustomerId] = useState(ALL);
  const [atmId, setAtmId] = useState(ALL);
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [page, setPage] = useState(1);
  const [limit, setLimit] = useState(DEFAULT_PAGE_SIZE);

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
    isFetching,
    refetch,
  } = useAdminComplaints({
    page,
    limit,
    ...(debouncedSearch ? { search: debouncedSearch } : {}),
    ...(status !== ALL ? { status } : {}),
    ...(priority !== ALL ? { priority } : {}),
    ...(customerId !== ALL ? { customerId } : {}),
    ...(atmId !== ALL ? { atmId } : {}),
    ...(fromDate
      ? { fromDate: getDateBoundary(fromDate, false) }
      : {}),
    ...(toDate ? { toDate: getDateBoundary(toDate, true) } : {}),
  });
  const {
    data: customers = [],
    isLoading: isLoadingCustomers,
    isError: isCustomersError,
  } = useCustomers();
  const {
    data: atms = [],
    isLoading: isLoadingATMs,
    isError: isATMsError,
  } = useATMs();

  const complaints = data?.complaints ?? [];
  const hasActiveFilters =
    Boolean(search.trim()) ||
    status !== ALL ||
    priority !== ALL ||
    customerId !== ALL ||
    atmId !== ALL ||
    Boolean(fromDate) ||
    Boolean(toDate);

  const clearFilters = () => {
    setSearch("");
    setDebouncedSearch("");
    setStatus(ALL);
    setPriority(ALL);
    setCustomerId(ALL);
    setAtmId(ALL);
    setFromDate("");
    setToDate("");
    setPage(1);
  };
  const handleComplaintCreated = () => {
    setIsCreateDialogOpen(false);
    setSearch("");
    setDebouncedSearch("");
    setStatus(ALL);
    setPriority(ALL);
    setCustomerId(ALL);
    setAtmId(ALL);
    setFromDate("");
    setToDate("");
    setPage(1);
  };

  if (isLoading && !data) {
    return (
      <div className="space-y-6 p-6" role="status">
        <div>
          <div className="h-8 w-44 animate-pulse rounded bg-muted" />
          <div className="mt-2 h-4 w-72 animate-pulse rounded bg-muted" />
        </div>
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="h-24 animate-pulse rounded-lg bg-muted" />
          ))}
        </div>
        <ComplaintListSkeleton />
      </div>
    );
  }

  if (isError && !data) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold">Complaints</h1>
        <div className="mt-6 max-w-2xl rounded-lg border border-destructive/30 bg-destructive/5 p-6">
          <p className="font-medium text-destructive">
            Failed to load complaints.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            Please try again.
          </p>
          <Button
            type="button"
            variant="outline"
            className="mt-4"
            onClick={() => void refetch()}
            disabled={isFetching}
          >
            {isFetching ? "Retrying..." : "Retry"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-6 p-6">
      <div>
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h1 className="text-2xl font-bold">Complaints</h1>
            <p className="mt-2 text-sm text-muted-foreground">
              Review and track reported ATM complaints.
            </p>
          </div>
          <Button
            type="button"
            onClick={() => setIsCreateDialogOpen(true)}
          >
            <Plus />
            Create Complaint
          </Button>
        </div>
      </div>

      <CreateComplaintDialog
        open={isCreateDialogOpen}
        onOpenChange={setIsCreateDialogOpen}
        onCreated={handleComplaintCreated}
      />

      <section aria-label="Complaint statistics">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          <StatCard label="Total complaints" value={data?.stats.total} />
          <StatCard
            label="Open"
            value={data?.stats.statusCounts.OPEN ?? 0}
          />
          <StatCard
            label="Assigned"
            value={data?.stats.statusCounts.ASSIGNED ?? 0}
          />
          <StatCard
            label="In progress"
            value={data?.stats.statusCounts.IN_PROGRESS ?? 0}
          />
          <StatCard
            label="Resolved"
            value={data?.stats.statusCounts.RESOLVED ?? 0}
          />
          <StatCard
            label="Closed"
            value={data?.stats.statusCounts.CLOSED ?? 0}
          />
          <StatCard
            label="Cancelled"
            value={data?.stats.statusCounts.CANCELLED ?? 0}
          />
        </div>
        <p className="mt-2 text-xs text-muted-foreground">
          Statistics are global and are not changed by the list filters.
        </p>
      </section>

      <Card>
        <CardContent className="grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-4">
          <div className="sm:col-span-2">
            <label
              htmlFor="complaint-search"
              className="mb-2 block text-sm font-medium"
            >
              Search complaints
            </label>
            <div className="relative">
              <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground" />
              <input
                id="complaint-search"
                type="search"
                value={search}
                onChange={(event) => {
                  setSearch(event.target.value);
                  setPage(1);
                }}
                placeholder="Complaint number, title, or reporter"
                className="h-9 w-full rounded-lg border border-input bg-transparent pl-9 pr-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            </div>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium">Status</label>
            <Select
              value={status}
              items={[
                { value: ALL, label: "All statuses" },
                ...COMPLAINT_STATUSES.map((value) => ({
                  value,
                  label: formatLabel(value),
                })),
              ]}
              onValueChange={(value) => {
                setStatus((value as ComplaintStatus | null) ?? ALL);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="All statuses" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All statuses</SelectItem>
                {COMPLAINT_STATUSES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {formatLabel(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium">Priority</label>
            <Select
              value={priority}
              items={[
                { value: ALL, label: "All priorities" },
                ...COMPLAINT_PRIORITIES.map((value) => ({
                  value,
                  label: formatLabel(value),
                })),
              ]}
              onValueChange={(value) => {
                setPriority((value as ComplaintPriority | null) ?? ALL);
                setPage(1);
              }}
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="All priorities" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All priorities</SelectItem>
                {COMPLAINT_PRIORITIES.map((value) => (
                  <SelectItem key={value} value={value}>
                    {formatLabel(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium">Customer</label>
            <Select
              value={customerId}
              items={[
                { value: ALL, label: "All customers" },
                ...customers.map((customer) => ({
                  value: customer._id,
                  label:
                    customer.customerName?.trim() ||
                    customer.customerEmail?.trim() ||
                    "Customer details unavailable",
                })),
              ]}
              onValueChange={(value) => {
                setCustomerId(value ?? ALL);
                setPage(1);
              }}
              disabled={isLoadingCustomers || isCustomersError}
            >
              <SelectTrigger className="w-full">
                <SelectValue
                  placeholder={
                    isLoadingCustomers
                      ? "Loading customers..."
                      : isCustomersError
                        ? "Customer list unavailable"
                        : "All customers"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All customers</SelectItem>
                {customers.map((customer) => (
                  <SelectItem key={customer._id} value={customer._id}>
                    {customer.customerName}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isCustomersError && (
              <p className="mt-1 text-xs text-destructive">
                Customer filter options could not be loaded.
              </p>
            )}
          </div>

          <div>
            <label className="mb-2 block text-sm font-medium">ATM</label>
            <Select
              value={atmId}
              items={[
                { value: ALL, label: "All ATMs" },
                ...atms.map((atm) => ({
                  value: atm._id,
                  label:
                    [atm.atmId, atm.locationName]
                      .filter(Boolean)
                      .join(" — ") || "ATM details unavailable",
                })),
              ]}
              onValueChange={(value) => {
                setAtmId(value ?? ALL);
                setPage(1);
              }}
              disabled={isLoadingATMs || isATMsError}
            >
              <SelectTrigger className="w-full">
                <SelectValue
                  placeholder={
                    isLoadingATMs
                      ? "Loading ATMs..."
                      : isATMsError
                        ? "ATM list unavailable"
                        : "All ATMs"
                  }
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All ATMs</SelectItem>
                {atms.map((atm) => (
                  <SelectItem key={atm._id} value={atm._id}>
                    {atm.atmId}
                    {atm.locationName ? ` — ${atm.locationName}` : ""}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            {isATMsError && (
              <p className="mt-1 text-xs text-destructive">
                ATM filter options could not be loaded.
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="complaint-from-date"
              className="mb-2 block text-sm font-medium"
            >
              From date
            </label>
            <input
              id="complaint-from-date"
              type="date"
              value={fromDate}
              onChange={(event) => {
                setFromDate(event.target.value);
                setPage(1);
              }}
              className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>

          <div>
            <label
              htmlFor="complaint-to-date"
              className="mb-2 block text-sm font-medium"
            >
              To date
            </label>
            <input
              id="complaint-to-date"
              type="date"
              value={toDate}
              onChange={(event) => {
                setToDate(event.target.value);
                setPage(1);
              }}
              className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>

          {hasActiveFilters && (
            <div className="flex items-end">
              <Button
                type="button"
                variant="outline"
                onClick={clearFilters}
                className="w-full sm:w-auto"
              >
                Clear filters
              </Button>
            </div>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardContent className="p-0">
          {isError && data && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-b border-destructive/30 bg-destructive/5 px-4 py-3">
              <p className="text-sm text-destructive">
                Could not refresh complaints. Showing the last loaded results.
              </p>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => void refetch()}
                disabled={isFetching}
              >
                Retry
              </Button>
            </div>
          )}
          {isLoading && data ? (
            <ComplaintListSkeleton />
          ) : complaints.length === 0 ? (
            <div className="px-6 py-12 text-center">
              <p className="font-medium">
                {hasActiveFilters
                  ? "No complaints match these filters."
                  : "No complaints found"}
              </p>
              {hasActiveFilters && (
                <Button
                  type="button"
                  variant="outline"
                  className="mt-4"
                  onClick={clearFilters}
                >
                  Clear filters
                </Button>
              )}
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full min-w-[920px] text-sm">
                <thead className="border-b bg-muted/40">
                  <tr>
                    <th className="px-4 py-3 text-left font-medium">
                      Complaint
                    </th>
                    <th className="px-4 py-3 text-left font-medium">
                      Customer
                    </th>
                    <th className="px-4 py-3 text-left font-medium">ATM</th>
                    <th className="px-4 py-3 text-left font-medium">
                      Priority
                    </th>
                    <th className="px-4 py-3 text-left font-medium">Status</th>
                    <th className="px-4 py-3 text-left font-medium">
                      Reported
                    </th>
                    <th className="px-4 py-3 text-right font-medium">
                      Actions
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {complaints.map((complaint) => (
                    <tr
                      key={complaint._id}
                      className="border-b last:border-0"
                    >
                      <td className="min-w-56 px-4 py-3">
                        <p className="font-medium">
                          {complaint.complaintNumber}
                        </p>
                        <p className="mt-1 text-muted-foreground">
                          {complaint.title}
                        </p>
                      </td>
                      <td className="px-4 py-3">
                        {getCustomerLabel(complaint.customerId)}
                      </td>
                      <td className="px-4 py-3">
                        {getATMLabel(complaint.atmId)}
                      </td>
                      <td className="px-4 py-3">
                        {complaint.priority ? (
                          <ComplaintPriorityBadge
                            priority={complaint.priority}
                          />
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="px-4 py-3">
                        {complaint.status ? (
                          <ComplaintStatusBadge status={complaint.status} />
                        ) : (
                          "—"
                        )}
                      </td>
                      <td className="whitespace-nowrap px-4 py-3">
                        {formatDate(complaint.reportedAt)}
                      </td>
                      <td className="px-4 py-3 text-right">
                        <Link
                          to={`/admin/complaints/${complaint._id}`}
                          className={buttonVariants({
                            variant: "outline",
                            size: "sm",
                          })}
                        >
                            View
                        </Link>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {data && (
            <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
              <div className="flex flex-wrap items-center gap-3 text-sm text-muted-foreground">
                <span>
                  {data.pagination.total} total complaints
                  {isFetching && (
                    <span className="ml-2" role="status">
                      Updating...
                    </span>
                  )}
                </span>
                <label className="flex items-center gap-2">
                  Rows
                  <select
                    value={limit}
                    onChange={(event) => {
                      setLimit(Number(event.target.value));
                      setPage(1);
                    }}
                    className="h-8 rounded-md border border-input bg-background px-2 text-foreground"
                  >
                    {PAGE_SIZES.map((size) => (
                      <option key={size} value={size}>
                        {size}
                      </option>
                    ))}
                  </select>
                </label>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm text-muted-foreground">
                  Page {data.pagination.page} of{" "}
                  {Math.max(data.pagination.totalPages, 1)}
                </span>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Previous page"
                  onClick={() => setPage((current) => Math.max(1, current - 1))}
                  disabled={!data.pagination.hasPrev || isFetching}
                >
                  <ChevronLeft />
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Next page"
                  onClick={() => setPage((current) => current + 1)}
                  disabled={!data.pagination.hasNext || isFetching}
                >
                  <ChevronRight />
                </Button>
              </div>
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
