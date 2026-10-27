import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Download, FileSpreadsheet } from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  downloadCustomerAMCReport,
  downloadCustomerJobReport,
  getCustomerReportSummary,
  getCustomerPortalAMC,
  getCustomerPortalAMCs,
  getCustomerPortalATM,
  getCustomerPortalATMs,
  getCustomerPortalJob,
  getCustomerPortalJobHistory,
  getCustomerPortalJobs,
  getCustomerPortalProfile,
  type CustomerJobReportStatus,
  type CustomerReportFilters,
} from "@/features/customers/services/customerPortal.service";
import type {
  CustomerPortalAMC,
  CustomerPortalATM,
  CustomerPortalHistory,
} from "@/features/customers/services/customerPortal.service";
import type { Job } from "@/features/jobs/types/job.types";
import {
  formatAcSubType,
  formatJobWorkType,
} from "@/features/jobs/utils/jobWorkType.utils";

function dateLabel(value?: string | null) {
  if (!value) return "Not available";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Not available"
    : date.toLocaleDateString();
}

function PageHeading({
  title,
  description,
}: {
  title: string;
  description: string;
}) {
  return (
    <div className="mb-6">
      <h1 className="text-2xl font-semibold tracking-tight">{title}</h1>
      <p className="mt-1 text-sm text-muted-foreground">{description}</p>
    </div>
  );
}

function QueryState({
  loading,
  error,
}: {
  loading: boolean;
  error: boolean;
}) {
  if (loading) {
    return (
      <div role="status" className="rounded-lg border bg-background p-6 text-sm text-muted-foreground">
        Loading your information…
      </div>
    );
  }
  if (error) {
    return (
      <div role="alert" className="rounded-lg border border-destructive/40 bg-background p-6 text-sm text-destructive">
        We could not load this information. Please try again later.
      </div>
    );
  }
  return null;
}

function atmLabel(value: Job["atmId"] | CustomerPortalAMC["atmId"]) {
  if (!value) return "ATM";
  if (typeof value === "string") return value;
  return [value.atmId, value.locationName].filter(Boolean).join(" · ") || "ATM";
}

function RecordCard({
  title,
  description,
  details,
  to,
}: {
  title: string;
  description: string;
  details: string;
  to: string;
}) {
  return (
    <Link to={to} className="block rounded-lg border bg-background p-4 transition hover:border-primary/50 hover:shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <h2 className="font-medium">{title}</h2>
          <p className="mt-1 text-sm text-muted-foreground">{description}</p>
        </div>
        <span className="rounded-full bg-muted px-2.5 py-1 text-xs font-medium">
          {details}
        </span>
      </div>
    </Link>
  );
}

export function CustomerDashboardPage() {
  const profile = useQuery({
    queryKey: ["customer-portal", "profile"],
    queryFn: getCustomerPortalProfile,
  });
  const jobs = useQuery({
    queryKey: ["customer-portal", "jobs", 1],
    queryFn: () => getCustomerPortalJobs(1),
  });
  const amcs = useQuery({
    queryKey: ["customer-portal", "amcs", 1],
    queryFn: () => getCustomerPortalAMCs(1),
  });
  const loading = profile.isLoading || jobs.isLoading || amcs.isLoading;
  const error = profile.isError || jobs.isError || amcs.isError;

  return (
    <>
      <PageHeading
        title={`Welcome${profile.data?.profile.customerName ? `, ${profile.data.profile.customerName}` : ""}`}
        description="A read-only overview of your ATM service information."
      />
      <QueryState loading={loading} error={error} />
      {!loading && !error && (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            {[
              ["Assigned ATMs", profile.data?.totalATMs ?? 0],
              ["Service records", jobs.data?.pagination.total ?? 0],
              ["Completed AMC visits", amcs.data?.pagination.total ?? 0],
            ].map(([label, value]) => (
              <Card key={label}>
                <CardHeader className="pb-2">
                  <CardTitle className="text-sm font-medium text-muted-foreground">
                    {label}
                  </CardTitle>
                </CardHeader>
                <CardContent>
                  <p className="text-3xl font-semibold">{value}</p>
                </CardContent>
              </Card>
            ))}
          </div>
          <Card className="mt-6">
            <CardHeader>
              <CardTitle>Account</CardTitle>
            </CardHeader>
            <CardContent className="grid gap-3 text-sm sm:grid-cols-2">
              <p><span className="text-muted-foreground">Email:</span> {profile.data?.profile.customerEmail || "Not available"}</p>
              <p><span className="text-muted-foreground">Phone:</span> {profile.data?.profile.customerPhone || "Not available"}</p>
              <p><span className="text-muted-foreground">Bank:</span> {profile.data?.profile.bankName || "Not available"}</p>
            </CardContent>
          </Card>
        </>
      )}
    </>
  );
}

export function CustomerATMsPage() {
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ["customer-portal", "atms", page],
    queryFn: () => getCustomerPortalATMs(page),
  });
  return (
    <>
      <PageHeading title="Your ATMs" description="Currently assigned ATM locations." />
      <QueryState loading={query.isLoading} error={query.isError} />
      {query.data && (
        <div className="grid gap-3 md:grid-cols-2">
          {query.data.atms.map((atm) => (
            <ATMCard key={atm._id} atm={atm} />
          ))}
          {query.data.atms.length === 0 && <EmptyState>No ATMs are currently assigned to your account.</EmptyState>}
          <PageControls
            page={page}
            totalPages={query.data.pagination.totalPages}
            onPageChange={setPage}
          />
        </div>
      )}
    </>
  );
}

function ATMCard({ atm }: { atm: CustomerPortalATM }) {
  return (
    <RecordCard
      title={`${atm.atmId}${atm.locationName ? ` · ${atm.locationName}` : ""}`}
      description={[atm.address, atm.bank, atm.district].filter(Boolean).join(" · ") || "Location details unavailable"}
      details={atm.status || "Status unavailable"}
      to={`/customer/atms/${atm._id}`}
    />
  );
}

export function CustomerATMDetailsPage() {
  const { atmId = "" } = useParams();
  const query = useQuery({
    queryKey: ["customer-portal", "atm", atmId],
    queryFn: () => getCustomerPortalATM(atmId),
    enabled: Boolean(atmId),
  });
  return (
    <>
      <PageHeading title="ATM details" description="Details for a currently assigned ATM." />
      <QueryState loading={query.isLoading} error={query.isError} />
      {query.data && (
        <Card>
          <CardHeader><CardTitle>{query.data.atmId}</CardTitle></CardHeader>
          <CardContent className="grid gap-4 text-sm sm:grid-cols-2">
            <Detail label="Location" value={query.data.locationName} />
            <Detail label="Address" value={query.data.address} />
            <Detail label="Bank" value={query.data.bank} />
            <Detail label="District" value={query.data.district} />
            <Detail label="Region" value={query.data.region} />
            <Detail label="Status" value={query.data.status} />
            <Detail label="Installation" value={query.data.installationType} />
          </CardContent>
        </Card>
      )}
    </>
  );
}

export function CustomerJobsPage() {
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ["customer-portal", "jobs", page],
    queryFn: () => getCustomerPortalJobs(page),
  });
  return (
    <>
      <PageHeading title="Service history" description="Approved and completed work for your ownership period." />
      <QueryState loading={query.isLoading} error={query.isError} />
      {query.data && (
        <div className="space-y-3">
          {query.data.jobs.map((job) => (
            <RecordCard
              key={job._id}
              title={job.jobNumber || job.jobId}
              description={`${job.title} · ${atmLabel(job.atmId)}`}
              details={job.status}
              to={`/customer/jobs/${job._id}`}
            />
          ))}
          {query.data.jobs.length === 0 && <EmptyState>No customer-visible service records are available.</EmptyState>}
          <PageControls
            page={page}
            totalPages={query.data.pagination.totalPages}
            onPageChange={setPage}
          />
        </div>
      )}
    </>
  );
}

export function CustomerJobDetailsPage() {
  const { jobId = "" } = useParams();
  const job = useQuery({
    queryKey: ["customer-portal", "job", jobId],
    queryFn: () => getCustomerPortalJob(jobId),
    enabled: Boolean(jobId),
  });
  const history = useQuery({
    queryKey: ["customer-portal", "job-history", jobId],
    queryFn: () => getCustomerPortalJobHistory(jobId),
    enabled: Boolean(jobId),
  });
  return (
    <>
      <PageHeading title="Service record" description="Customer-visible service details and history." />
      <QueryState loading={job.isLoading || history.isLoading} error={job.isError || history.isError} />
      {job.data && (
        <div className="space-y-5">
          <Card>
            <CardHeader><CardTitle>{job.data.jobNumber || job.data.jobId}</CardTitle></CardHeader>
            <CardContent className="grid gap-4 text-sm sm:grid-cols-2">
              <Detail label="Work" value={job.data.title} />
              <Detail label="ATM" value={atmLabel(job.data.atmId)} />
              <Detail label="Status" value={job.data.status} />
              <Detail
                label="Work type"
                value={formatJobWorkType(job.data.workType)}
              />
              {job.data.workType === "ac" && (
                <Detail
                  label="AC sub-type"
                  value={formatAcSubType(job.data.acSubType)}
                />
              )}
              <Detail label="Created" value={dateLabel(job.data.createdAt)} />
              <Detail label="Completed" value={dateLabel(job.data.completedAt)} />
              {job.data.description && <Detail label="Description" value={job.data.description} />}
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>History</CardTitle></CardHeader>
            <CardContent>
              {history.data?.length ? (
                <ol className="space-y-4">
                  {history.data.map((entry: CustomerPortalHistory) => (
                    <li key={entry._id} className="border-l-2 pl-4">
                      <p className="font-medium">{entry.action.replaceAll("_", " ")}</p>
                      <p className="text-sm text-muted-foreground">
                        {[entry.fromStatus, entry.toStatus].filter(Boolean).join(" → ") || dateLabel(entry.performedAt)}
                      </p>
                    </li>
                  ))}
                </ol>
              ) : (
                <p className="text-sm text-muted-foreground">No customer-visible history entries.</p>
              )}
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}

export function CustomerAMCsPage() {
  const [page, setPage] = useState(1);
  const query = useQuery({
    queryKey: ["customer-portal", "amcs", page],
    queryFn: () => getCustomerPortalAMCs(page),
  });
  return (
    <>
      <PageHeading title="AMC records" description="Completed maintenance visits belonging to your ownership period." />
      <QueryState loading={query.isLoading} error={query.isError} />
      {query.data && (
        <div className="space-y-3">
          {query.data.amcs.map((amc) => (
            <RecordCard
              key={amc._id}
              title={amc.amcId}
              description={`${atmLabel(amc.atmId)} · ${new Date(amc.year, amc.month - 1).toLocaleDateString(undefined, { month: "long", year: "numeric" })}`}
              details={amc.status}
              to={`/customer/amcs/${amc._id}`}
            />
          ))}
          {query.data.amcs.length === 0 && <EmptyState>No completed AMC records are available.</EmptyState>}
          <PageControls
            page={page}
            totalPages={query.data.pagination.totalPages}
            onPageChange={setPage}
          />
        </div>
      )}
    </>
  );
}

export function CustomerAMCDetailsPage() {
  const { amcId = "" } = useParams();
  const query = useQuery({
    queryKey: ["customer-portal", "amc", amcId],
    queryFn: () => getCustomerPortalAMC(amcId),
    enabled: Boolean(amcId),
  });
  return (
    <>
      <PageHeading title="AMC details" description="Completed maintenance details." />
      <QueryState loading={query.isLoading} error={query.isError} />
      {query.data && (
        <div className="space-y-5">
          <Card>
            <CardHeader><CardTitle>{query.data.amcId}</CardTitle></CardHeader>
            <CardContent className="grid gap-4 text-sm sm:grid-cols-2">
              <Detail label="ATM" value={atmLabel(query.data.atmId)} />
              <Detail label="Period" value={`${query.data.month}/${query.data.year}`} />
              <Detail label="Status" value={query.data.status} />
              <Detail label="Visit date" value={dateLabel(query.data.visitDate)} />
              <Detail label="Completed" value={dateLabel(query.data.completedAt)} />
              <Detail label="Checklist completed" value={query.data.checklistCompleted ? "Yes" : "No"} />
            </CardContent>
          </Card>
          <Card>
            <CardHeader><CardTitle>Maintenance checklist</CardTitle></CardHeader>
            <CardContent className="space-y-3">
              {(query.data.checklist ?? []).map((item, index) => (
                <div key={`${item.item}-${index}`} className="flex flex-wrap justify-between gap-2 border-b pb-3 text-sm last:border-0">
                  <span className="font-medium">{item.item}</span>
                  <span className="text-muted-foreground">{item.response}{item.remarks ? ` · ${item.remarks}` : ""}</span>
                </div>
              ))}
              {!query.data.checklist?.length && <p className="text-sm text-muted-foreground">No checklist details available.</p>}
            </CardContent>
          </Card>
        </div>
      )}
    </>
  );
}

export function CustomerReportsPage() {
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [jobStatus, setJobStatus] = useState<CustomerJobReportStatus | "">("");
  const [downloading, setDownloading] = useState<"jobs" | "amcs" | null>(null);
  const [downloadMessage, setDownloadMessage] = useState("");
  const hasBothDates = Boolean(fromDate && toDate);
  const hasNoDates = !fromDate && !toDate;
  const dateOrderValid = !hasBothDates || fromDate <= toDate;
  const filtersValid = (hasBothDates || hasNoDates) && dateOrderValid;
  const filters: CustomerReportFilters = {
    ...(hasBothDates ? { fromDate, toDate } : {}),
    ...(jobStatus ? { jobStatus } : {}),
  };
  const summary = useQuery({
    queryKey: ["customer-portal", "report-summary", filters],
    queryFn: () => getCustomerReportSummary(filters),
    enabled: filtersValid,
  });

  const download = async (report: "jobs" | "amcs") => {
    setDownloadMessage("");
    setDownloading(report);
    try {
      const result =
        report === "jobs"
          ? await downloadCustomerJobReport(filters)
          : await downloadCustomerAMCReport(filters);
      const objectUrl = URL.createObjectURL(result.blob);
      const anchor = document.createElement("a");
      anchor.href = objectUrl;
      anchor.download = result.filename;
      anchor.style.display = "none";
      document.body.append(anchor);
      anchor.click();
      anchor.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectUrl), 0);
      setDownloadMessage(
        report === "jobs"
          ? "Job History workbook downloaded."
          : "Completed AMC workbook downloaded.",
      );
    } catch {
      setDownloadMessage(
        "The report could not be downloaded. Please review the filters and try again.",
      );
    } finally {
      setDownloading(null);
    }
  };

  return (
    <>
      <PageHeading
        title="Reports"
        description="Review customer-scoped maintenance totals and download Excel reports."
      />
      <Card>
        <CardHeader>
          <CardTitle>Report filters</CardTitle>
        </CardHeader>
        <CardContent className="grid gap-4 sm:grid-cols-3">
          <label className="grid gap-2 text-sm font-medium">
            From date
            <input
              aria-label="From date"
              type="date"
              value={fromDate}
              onChange={(event) => setFromDate(event.target.value)}
              className="h-10 min-w-0 rounded-md border bg-background px-3 font-normal"
            />
          </label>
          <label className="grid gap-2 text-sm font-medium">
            To date
            <input
              aria-label="To date"
              type="date"
              value={toDate}
              onChange={(event) => setToDate(event.target.value)}
              className="h-10 min-w-0 rounded-md border bg-background px-3 font-normal"
            />
          </label>
          <label className="grid gap-2 text-sm font-medium">
            Job status (summary and job report)
            <select
              aria-label="Job status"
              value={jobStatus}
              onChange={(event) =>
                setJobStatus(
                  event.target.value as CustomerJobReportStatus | "",
                )
              }
              className="h-10 rounded-md border bg-background px-3 font-normal"
            >
              <option value="">All customer-visible statuses</option>
              <option value="VERIFIED">Verified</option>
              <option value="APPROVED">Approved</option>
              <option value="CLOSED">Closed</option>
            </select>
          </label>
        </CardContent>
        {!filtersValid && (
          <p className="px-6 pb-5 text-sm text-destructive" role="alert">
            Choose both dates, and make sure the start date is not after the end date.
          </p>
        )}
      </Card>

      <div className="mt-5">
        <QueryState loading={filtersValid && summary.isLoading} error={summary.isError} />
        {filtersValid && summary.data && (
          <>
            <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
              <ReportMetric label="Visible job records" value={summary.data.totalJobs} />
              <ReportMetric label="Closed jobs" value={summary.data.closedJobs} />
              <ReportMetric label="Closed-job rate" value={`${summary.data.completionRate}%`} />
              <ReportMetric label="Completed AMC visits" value={summary.data.completedAMCs} />
            </div>
            <Card className="mt-5">
              <CardHeader>
                <CardTitle>Job status counts</CardTitle>
              </CardHeader>
              <CardContent className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
                {(["VERIFIED", "APPROVED", "CLOSED"] as const).map((status) => (
                  <div key={status} className="rounded-md border bg-muted/30 p-3">
                    <p className="text-muted-foreground">{status}</p>
                    <p className="mt-1 text-xl font-semibold">
                      {summary.data.jobsByStatus[status]}
                    </p>
                  </div>
                ))}
              </CardContent>
            </Card>
          </>
        )}
      </div>

      <Card className="mt-5">
        <CardHeader>
          <CardTitle>Download reports</CardTitle>
          <p className="text-sm text-muted-foreground">
            Workbooks contain only your customer-visible jobs and completed AMC records.
          </p>
        </CardHeader>
        <CardContent className="flex flex-col gap-3 sm:flex-row">
          <button
            type="button"
            disabled={!filtersValid || downloading !== null}
            onClick={() => void download("jobs")}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50"
          >
            <FileSpreadsheet className="size-4" aria-hidden="true" />
            {downloading === "jobs" ? "Preparing workbook…" : "Download Job History Excel"}
            {downloading !== "jobs" && <Download className="size-4" aria-hidden="true" />}
          </button>
          <button
            type="button"
            disabled={!filtersValid || downloading !== null}
            onClick={() => void download("amcs")}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border bg-background px-4 text-sm font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
          >
            <FileSpreadsheet className="size-4" aria-hidden="true" />
            {downloading === "amcs" ? "Preparing workbook…" : "Download Completed AMC Excel"}
            {downloading !== "amcs" && <Download className="size-4" aria-hidden="true" />}
          </button>
        </CardContent>
        {downloadMessage && (
          <p
            role={downloadMessage.startsWith("The report") ? "alert" : "status"}
            className={`px-6 pb-5 text-sm ${
              downloadMessage.startsWith("The report")
                ? "text-destructive"
                : "text-emerald-700"
            }`}
          >
            {downloadMessage}
          </p>
        )}
      </Card>
    </>
  );
}

function ReportMetric({ label, value }: { label: string; value: number | string }) {
  return (
    <Card>
      <CardHeader className="pb-2">
        <CardTitle className="text-sm font-medium text-muted-foreground">
          {label}
        </CardTitle>
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-semibold">{value}</p>
      </CardContent>
    </Card>
  );
}

function Detail({ label, value }: { label: string; value?: string | null }) {
  return (
    <div>
      <p className="text-muted-foreground">{label}</p>
      <p className="mt-1 font-medium">{value || "Not available"}</p>
    </div>
  );
}

function EmptyState({ children }: { children: string }) {
  return <div className="rounded-lg border border-dashed bg-background p-8 text-center text-sm text-muted-foreground">{children}</div>;
}

function PageControls({
  page,
  totalPages,
  onPageChange,
}: {
  page: number;
  totalPages: number;
  onPageChange: (page: number) => void;
}) {
  if (totalPages < 2) return null;
  return (
    <div className="flex items-center justify-between gap-3 pt-2">
      <button
        type="button"
        disabled={page <= 1}
        onClick={() => onPageChange(page - 1)}
        className="rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-50"
      >
        Previous
      </button>
      <span className="text-sm text-muted-foreground">
        Page {page} of {totalPages}
      </span>
      <button
        type="button"
        disabled={page >= totalPages}
        onClick={() => onPageChange(page + 1)}
        className="rounded-md border bg-background px-3 py-2 text-sm disabled:opacity-50"
      >
        Next
      </button>
    </div>
  );
}
