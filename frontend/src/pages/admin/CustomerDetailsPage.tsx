import { useState } from "react";
import { isAxiosError } from "axios";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  MapPin,
  Pencil,
  RefreshCw,
} from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import CustomerEditDialog from "@/features/customers/components/CustomerEditDialog";
import {
  useCustomer,
  useCustomerActiveJobCount,
  useCustomerComplaints,
  useCustomerJobs,
} from "@/features/customers/hooks/useCustomer";
import { useUpdateCustomer } from "@/features/customers/hooks/useAdminCustomers";
import { useBanks } from "@/features/banks/hooks/useBanks";
import type {
  CustomerAssignedATM,
  CustomerComplaint,
  CustomerUpdateData,
} from "@/features/customers/services/customer.service";
import type { Job, JobATM, JobUser } from "@/features/jobs/types/job.types";

const JOB_PAGE_SIZE = 5;
const COMPLAINT_PAGE_SIZE = 5;

function formatValue(value: string | number | null | undefined) {
  return value === null || value === undefined || value === ""
    ? "—"
    : String(value);
}

function formatDate(value?: string | null) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function getRelatedName(value: unknown, field: string) {
  if (typeof value !== "object" || value === null) return "—";
  const displayValue = (value as Record<string, unknown>)[field];
  return typeof displayValue === "string" && displayValue
    ? displayValue
    : "—";
}

function getATMFromJob(job: Job): JobATM | null {
  return job.atmId && typeof job.atmId !== "string" ? job.atmId : null;
}

function getAssignedEmployee(job: Job): JobUser | null {
  return job.assignedEmployeeId &&
    typeof job.assignedEmployeeId !== "string"
    ? job.assignedEmployeeId
    : null;
}

function getComplaintATM(complaint: CustomerComplaint) {
  return complaint.atmId && typeof complaint.atmId !== "string"
    ? complaint.atmId
    : null;
}

function getJobStatusVariant(status: Job["status"]) {
  if (["COMPLETED", "VERIFIED", "APPROVED", "CLOSED"].includes(status)) {
    return "default" as const;
  }
  if (status === "REJECTED") return "destructive" as const;
  return "secondary" as const;
}

function getPriorityVariant(priority: string) {
  return priority.toLowerCase() === "critical" || priority.toLowerCase() === "high"
    ? "destructive" as const
    : "secondary" as const;
}

function DetailRow({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-1 border-b py-3 last:border-b-0 sm:flex-row sm:items-start sm:justify-between sm:gap-4">
      <dt className="text-sm text-muted-foreground">{label}</dt>
      <dd className="wrap-break-word text-sm font-medium sm:max-w-[65%] sm:text-right">
        {value}
      </dd>
    </div>
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

function DetailsSkeleton() {
  return (
    <div className="space-y-6 p-4 sm:p-6" role="status">
      <div className="h-5 w-40 animate-pulse rounded bg-muted" />
      <div className="h-24 animate-pulse rounded-lg border bg-muted/40" />
      <div className="grid gap-4 sm:grid-cols-3">
        {["atms", "jobs", "complaints"].map((section) => (
          <div
            key={section}
            className="h-24 animate-pulse rounded-lg border bg-muted/40"
          />
        ))}
      </div>
      <div className="grid gap-6 lg:grid-cols-2">
        {["overview", "atms", "jobs", "complaints"].map((section) => (
          <div
            key={section}
            className="h-64 animate-pulse rounded-lg border bg-muted/40"
          />
        ))}
      </div>
      <p className="sr-only">Loading customer details...</p>
    </div>
  );
}

function SectionLoading({ label }: { label: string }) {
  return (
    <div className="space-y-3 p-4" role="status">
      {Array.from({ length: 3 }, (_, index) => (
        <div
          key={index}
          className="h-10 animate-pulse rounded bg-muted/50"
        />
      ))}
      <p className="sr-only">Loading {label.toLowerCase()}...</p>
    </div>
  );
}

function SectionPagination({
  page,
  totalPages,
  total,
  onPageChange,
  isFetching,
}: {
  page: number;
  totalPages: number;
  total: number;
  onPageChange: (page: number) => void;
  isFetching: boolean;
}) {
  if (totalPages <= 1) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
      <span className="text-sm text-muted-foreground">{total} total</span>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onPageChange(page - 1)}
          disabled={page <= 1 || isFetching}
        >
          <ChevronLeft />
          Previous
        </Button>
        <span className="text-sm text-muted-foreground">
          Page {page} of {totalPages}
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onPageChange(page + 1)}
          disabled={page >= totalPages || isFetching}
        >
          Next
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}

function notFoundError(error: unknown) {
  return isAxiosError(error) && [400, 404].includes(error.response?.status ?? 0);
}

function getCustomerErrorMessage(error: unknown) {
  if (isAxiosError<{ message?: string }>(error)) {
    return error.response?.data?.message || "The customer request could not be completed.";
  }
  return error instanceof Error
    ? error.message
    : "The customer request could not be completed.";
}

export default function CustomerDetailsPage() {
  const { id = "" } = useParams<{ id: string }>();
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isDeactivateOpen, setIsDeactivateOpen] = useState(false);
  const [jobPage, setJobPage] = useState(1);
  const [complaintPage, setComplaintPage] = useState(1);
  const customerQuery = useCustomer(id);
  const customer = customerQuery.data;
  const relatedCustomerId = customer?._id ?? "";
  const jobsQuery = useCustomerJobs(
    relatedCustomerId,
    jobPage,
    JOB_PAGE_SIZE,
  );
  const complaintsQuery = useCustomerComplaints(
    relatedCustomerId,
    complaintPage,
    COMPLAINT_PAGE_SIZE,
  );
  const openComplaintsQuery = useCustomerComplaints(
    relatedCustomerId,
    1,
    1,
    "OPEN",
  );
  const activeJobsQuery = useCustomerActiveJobCount(relatedCustomerId);
  const { data: banks = [] } = useBanks();
  const updateCustomerMutation = useUpdateCustomer();

  const saveCustomer = async (
    customerId: string,
    updates: CustomerUpdateData,
  ) => {
    try {
      await updateCustomerMutation.mutateAsync({ id: customerId, data: updates });
      toast.success("Customer updated successfully.");
      setIsEditOpen(false);
    } catch (error) {
      toast.error(getCustomerErrorMessage(error));
    }
  };

  const reactivateCustomer = async () => {
    if (!customer) return;
    try {
      await updateCustomerMutation.mutateAsync({
        id: customer._id,
        data: { isActive: true },
      });
      toast.success("Customer reactivated successfully.");
    } catch (error) {
      toast.error(getCustomerErrorMessage(error));
    }
  };

  const deactivateCustomer = async () => {
    if (!customer) return;
    try {
      await updateCustomerMutation.mutateAsync({
        id: customer._id,
        data: { isActive: false },
      });
      toast.success("Customer deactivated successfully.");
      setIsDeactivateOpen(false);
    } catch (error) {
      toast.error(getCustomerErrorMessage(error));
    }
  };

  if (customerQuery.isLoading) return <DetailsSkeleton />;

  if (customerQuery.isError || !customer) {
    const notFound = notFoundError(customerQuery.error);
    return (
      <div className="space-y-4 p-4 sm:p-6">
        <Link
          to="/admin/customers"
          className="inline-flex items-center gap-2 text-sm font-medium text-muted-foreground hover:text-foreground"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to Customers
        </Link>
        <Card>
          <CardContent className="flex flex-col items-start gap-3 p-6">
            <h1 className="font-semibold text-destructive">
              {notFound ? "Customer not found" : "Unable to load customer."}
            </h1>
            {!notFound && (
              <p className="text-sm text-muted-foreground">
                The customer could not be loaded. Please try again.
              </p>
            )}
            {!notFound && (
              <Button
                type="button"
                variant="outline"
                onClick={() => void customerQuery.refetch()}
                disabled={customerQuery.isFetching}
              >
                <RefreshCw />
                {customerQuery.isFetching ? "Retrying..." : "Retry"}
              </Button>
            )}
          </CardContent>
        </Card>
      </div>
    );
  }

  const assignedATMs = customer.atmIds ?? [];
  const districtNames = (customer.districtIds ?? [])
    .map((district) => district.districtName)
    .filter(Boolean)
    .join(", ");

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <nav aria-label="Breadcrumb" className="text-sm text-muted-foreground">
        <Link to="/admin/customers" className="hover:text-foreground">
          Customers
        </Link>
        <span className="mx-2">/</span>
        <span className="font-medium text-foreground">
          {customer.customerName || "Customer"}
        </span>
      </nav>

      <Card>
        <CardContent className="flex flex-wrap items-start justify-between gap-4 p-5">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-3">
              <h1 className="wrap-break-word text-2xl font-bold">
                {formatValue(customer.customerName)}
              </h1>
              <Badge
                className={
                  customer.isActive
                    ? "bg-green-100 text-green-700"
                    : "bg-muted text-muted-foreground"
                }
              >
                {customer.isActive ? "Active" : "Inactive"}
              </Badge>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
              <span>{formatValue(customer.bankName)}</span>
              <span>{formatValue(customer.customerEmail)}</span>
              <span>{formatValue(customer.customerPhone)}</span>
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setIsEditOpen(true)}
            >
              <Pencil />
              Edit
            </Button>
            {customer.isActive ? (
              <Button
                type="button"
                variant="destructive"
                onClick={() => setIsDeactivateOpen(true)}
              >
                Deactivate
              </Button>
            ) : (
              <Button
                type="button"
                variant="outline"
                onClick={() => void reactivateCustomer()}
                disabled={updateCustomerMutation.isPending}
              >
                {updateCustomerMutation.isPending
                  ? "Reactivating..."
                  : "Reactivate"}
              </Button>
            )}
          </div>
        </CardContent>
      </Card>

      <div className="grid gap-4 sm:grid-cols-3">
        <SummaryCard
          label="Assigned ATMs"
          value={customer.linkedATMCount}
        />
        <SummaryCard
          label="Active Jobs"
          value={activeJobsQuery.count}
        />
        <SummaryCard
          label="Open Complaints"
          value={openComplaintsQuery.data?.pagination.total}
        />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle>Overview</CardTitle>
          </CardHeader>
          <CardContent>
            <dl>
              <DetailRow
                label="Customer name"
                value={formatValue(customer.customerName)}
              />
              <DetailRow
                label="Email"
                value={formatValue(customer.customerEmail)}
              />
              <DetailRow
                label="Phone"
                value={formatValue(customer.customerPhone)}
              />
              <DetailRow label="Bank" value={formatValue(customer.bankName)} />
              <DetailRow
                label="Districts"
                value={formatValue(districtNames)}
              />
              <DetailRow
                label="Status"
                value={customer.isActive ? "Active" : "Inactive"}
              />
              <DetailRow
                label="Created"
                value={formatDate(customer.createdAt)}
              />
              <DetailRow
                label="Updated"
                value={formatDate(customer.updatedAt)}
              />
            </dl>
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Assigned ATMs</CardTitle>
            <Badge variant="secondary">{customer.linkedATMCount}</Badge>
          </CardHeader>
          <CardContent className="p-0">
            {assignedATMs.length === 0 ? (
              <p className="px-6 py-8 text-center text-sm text-muted-foreground">
                No ATMs are assigned to this customer.
              </p>
            ) : (
              <div className="divide-y">
                {assignedATMs.map((atm: CustomerAssignedATM) => (
                  <div
                    key={atm._id}
                    className="flex flex-wrap items-start justify-between gap-3 p-4"
                  >
                    <div className="min-w-0 space-y-1">
                      <Link
                        to={`/admin/atms/${atm._id}`}
                        className="font-medium text-primary hover:underline"
                      >
                        {formatValue(atm.atmId)}
                      </Link>
                      <p className="text-sm text-muted-foreground">
                        {formatValue(atm.locationName)} ·{" "}
                        {formatValue(getRelatedName(atm.bankId, "bankName"))}
                      </p>
                      <p className="flex items-start gap-1 text-sm text-muted-foreground">
                        <MapPin className="mt-0.5 h-4 w-4 shrink-0" />
                        <span>{formatValue(atm.address)}</span>
                      </p>
                      <p className="text-xs text-muted-foreground">
                        District: {formatValue(getRelatedName(atm.districtId, "districtName"))}
                        {" · "}
                        Region: {formatValue(getRelatedName(atm.regionId, "name"))}
                        {" · "}
                        Installation: {formatValue(atm.installationType)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      {atm.status && (
                        <Badge variant={atm.status === "ACTIVE" ? "default" : "secondary"}>
                          {atm.status.replaceAll("_", " ")}
                        </Badge>
                      )}
                      <Link
                        to={`/admin/atms/${atm._id}`}
                        className="inline-flex h-7 items-center justify-center rounded-lg border border-border bg-background px-2.5 text-xs font-medium hover:bg-muted"
                      >
                        View
                      </Link>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Jobs</CardTitle>
            {jobsQuery.data && (
              <Badge variant="secondary">{jobsQuery.data.pagination.total}</Badge>
            )}
          </CardHeader>
          <CardContent className="p-0">
            {jobsQuery.isLoading ? (
              <SectionLoading label="Jobs" />
            ) : jobsQuery.isError ? (
              <div className="flex flex-col items-start gap-2 p-5">
                <p className="text-sm text-destructive">
                  Unable to load customer jobs.
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void jobsQuery.refetch()}
                  disabled={jobsQuery.isFetching}
                >
                  Retry
                </Button>
              </div>
            ) : jobsQuery.data?.jobs.length ? (
              <>
                <div className="divide-y">
                  {jobsQuery.data.jobs.map((job: Job) => {
                    const atm = getATMFromJob(job);
                    const employee = getAssignedEmployee(job);
                    return (
                      <div
                        key={job._id}
                        className="flex flex-wrap items-start justify-between gap-3 p-4"
                      >
                        <div className="min-w-0 space-y-1">
                          <Link
                            to={`/admin/jobs/${job._id}`}
                            className="font-medium text-primary hover:underline"
                          >
                            {formatValue(job.jobNumber || job.jobId)}
                          </Link>
                          <p className="text-sm">{formatValue(job.title)}</p>
                          <p className="text-xs text-muted-foreground">
                            ATM: {formatValue(atm?.atmId)}
                            {" · "}
                            {formatValue(job.workType)}
                            {" · "}
                            Assigned:{" "}
                            {formatValue(
                              [employee?.firstName, employee?.lastName]
                                .filter(Boolean)
                                .join(" "),
                            )}
                          </p>
                          <p className="text-xs text-muted-foreground">
                            Created: {formatDate(job.createdAt)}
                          </p>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <Badge variant={getJobStatusVariant(job.status)}>
                            {job.status.replaceAll("_", " ")}
                          </Badge>
                          <Badge variant={getPriorityVariant(job.priority)}>
                            {job.priority}
                          </Badge>
                        </div>
                      </div>
                    );
                  })}
                </div>
                <SectionPagination
                  page={jobsQuery.data.pagination.page}
                  totalPages={jobsQuery.data.pagination.totalPages}
                  total={jobsQuery.data.pagination.total}
                  onPageChange={setJobPage}
                  isFetching={jobsQuery.isFetching}
                />
              </>
            ) : (
              <p className="px-6 py-8 text-center text-sm text-muted-foreground">
                No jobs found for this customer.
              </p>
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Complaints</CardTitle>
            {complaintsQuery.data && (
              <Badge variant="secondary">
                {complaintsQuery.data.pagination.total}
              </Badge>
            )}
          </CardHeader>
          <CardContent className="p-0">
            {complaintsQuery.isLoading ? (
              <SectionLoading label="Complaints" />
            ) : complaintsQuery.isError ? (
              <div className="flex flex-col items-start gap-2 p-5">
                <p className="text-sm text-destructive">
                  Unable to load complaint history.
                </p>
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => void complaintsQuery.refetch()}
                  disabled={complaintsQuery.isFetching}
                >
                  Retry
                </Button>
              </div>
            ) : complaintsQuery.data?.complaints.length ? (
              <>
                <div className="divide-y">
                  {complaintsQuery.data.complaints.map(
                    (complaint: CustomerComplaint) => {
                      const atm = getComplaintATM(complaint);
                      return (
                        <div
                          key={complaint._id}
                          className="flex flex-wrap items-start justify-between gap-3 p-4"
                        >
                          <div className="min-w-0 space-y-1">
                            <p className="font-medium">
                              {formatValue(complaint.complaintNumber)}
                            </p>
                            <p className="text-sm">{formatValue(complaint.title)}</p>
                            <p className="text-xs text-muted-foreground">
                              ATM: {formatValue(atm?.atmId)}
                              {" · "}
                              Created:{" "}
                              {formatDate(complaint.createdAt || complaint.reportedAt)}
                            </p>
                          </div>
                          <div className="flex flex-wrap gap-2">
                            <Badge
                              variant={complaint.status === "OPEN" ? "destructive" : "secondary"}
                            >
                              {complaint.status.replaceAll("_", " ")}
                            </Badge>
                            <Badge variant={getPriorityVariant(complaint.priority)}>
                              {complaint.priority}
                            </Badge>
                          </div>
                        </div>
                      );
                    },
                  )}
                </div>
                <SectionPagination
                  page={complaintsQuery.data.pagination.page}
                  totalPages={complaintsQuery.data.pagination.totalPages}
                  total={complaintsQuery.data.pagination.total}
                  onPageChange={setComplaintPage}
                  isFetching={complaintsQuery.isFetching}
                />
              </>
            ) : (
              <p className="px-6 py-8 text-center text-sm text-muted-foreground">
                Complaint history will appear here.
              </p>
            )}
          </CardContent>
        </Card>
      </div>

      <CustomerEditDialog
        open={isEditOpen}
        customer={customer}
        banks={banks}
        isSaving={updateCustomerMutation.isPending}
        onOpenChange={setIsEditOpen}
        onSave={saveCustomer}
      />

      <Dialog
        open={isDeactivateOpen}
        onOpenChange={(open) => {
          if (!updateCustomerMutation.isPending) setIsDeactivateOpen(open);
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
          <p className="mt-4 text-sm font-medium">
            {customer.customerName} ({customer.customerEmail})
          </p>
          <div className="mt-6 flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={updateCustomerMutation.isPending}
              onClick={() => setIsDeactivateOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              variant="destructive"
              disabled={updateCustomerMutation.isPending}
              onClick={() => void deactivateCustomer()}
            >
              {updateCustomerMutation.isPending
                ? "Deactivating..."
                : "Deactivate"}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
