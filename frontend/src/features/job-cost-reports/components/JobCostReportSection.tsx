import { useEffect, useState, type FormEvent } from "react";
import { isAxiosError } from "axios";
import {
  CheckCircle2,
  LoaderCircle,
  RefreshCw,
  Trash2,
} from "lucide-react";
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
import {
  downloadJobCostReport,
} from "../services/jobCostReport.service";
import JobCostReportExcelPreview from "./JobCostReportExcelPreview";
import {
  useInitializeJobCostReport,
  useJobCostReport,
  useRefreshJobCostReportMaterials,
  useUpdateJobCostReport,
} from "../hooks/useJobCostReport";
import type {
  JobCostReport,
  JobCostReportJobSnapshot,
  JobCostReportOverrides,
  JobCostReportServiceVisit,
} from "../types/jobCostReport.types";

const overrideLabels: Array<{
  key: keyof JobCostReportOverrides;
  label: string;
  type?: "date";
}> = [
  { key: "bankName", label: "Bank" },
  { key: "branch", label: "Branch" },
  { key: "complaintDescription", label: "Complaint description" },
  { key: "callLogDate", label: "Call-log date", type: "date" },
  { key: "atmLocationName", label: "ATM location" },
  { key: "atmAddress", label: "ATM address" },
  { key: "assignedTechnicianName", label: "Technician" },
  { key: "workType", label: "Work type" },
];

const emptyVisit = (sequence: number): JobCostReportServiceVisit => ({
  sequence,
  visitDate: null,
  workPerformed: "",
  status: "",
  signOffOrPhotoReference: "",
});

function display(value: string | null | undefined) {
  return value || "Not available";
}

function formatDate(value: string | null | undefined) {
  if (!value) return "Not available";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "Not available" : date.toLocaleString();
}

function dateInputValue(value: string | null | undefined) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  const pad = (part: number) => String(part).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}

function toIsoDate(value: string) {
  return value ? new Date(`${value}T00:00:00.000Z`).toISOString() : null;
}

function errorMessage(error: unknown, fallback: string) {
  if (isAxiosError<{ message?: string }>(error)) {
    return error.response?.data?.message || fallback;
  }
  return error instanceof Error ? error.message : fallback;
}

function SnapshotValue({
  label,
  value,
}: {
  label: string;
  value: string | null | undefined;
}) {
  return (
    <div className="min-w-0 rounded-lg bg-muted/45 p-3">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-sm font-medium">{display(value)}</dd>
    </div>
  );
}

function JobSnapshot({ snapshot }: { snapshot: JobCostReportJobSnapshot }) {
  return (
    <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
      <SnapshotValue label="Job number" value={snapshot.jobNumber || snapshot.jobId} />
      <SnapshotValue label="Complaint number" value={snapshot.complaintNumber} />
      <SnapshotValue label="Status" value={snapshot.currentStatus} />
      <SnapshotValue label="Bank" value={snapshot.bankName} />
      <SnapshotValue label="Branch" value={snapshot.branch} />
      <SnapshotValue label="ATM" value={snapshot.atmId} />
      <SnapshotValue label="Location" value={snapshot.atmLocationName} />
      <SnapshotValue label="Work type" value={snapshot.workType} />
      <SnapshotValue label="Completion date" value={formatDate(snapshot.completionDate)} />
      <SnapshotValue
        label="Technician"
        value={
          snapshot.assignedEmployeeCode
            ? `${display(snapshot.assignedTechnicianName)} (${snapshot.assignedEmployeeCode})`
            : snapshot.assignedTechnicianName
        }
      />
      <SnapshotValue label="Call-log date" value={formatDate(snapshot.callLogDate)} />
      <SnapshotValue label="ATM address" value={snapshot.atmAddress} />
      <div className="sm:col-span-2 xl:col-span-3">
        <SnapshotValue label="Complaint description" value={snapshot.complaintDescription} />
      </div>
      <div className="sm:col-span-2 xl:col-span-3">
        <SnapshotValue label="Employee remarks" value={snapshot.employeeRemarks} />
      </div>
    </div>
  );
}

function OverrideFields({
  overrides,
  onChange,
}: {
  overrides: JobCostReportOverrides;
  onChange: (key: keyof JobCostReportOverrides, value: string, enabled: boolean) => void;
}) {
  return (
    <div className="grid gap-3 sm:grid-cols-2">
      {overrideLabels.map(({ key, label, type }) => {
        const override = overrides[key];
        return (
          <div key={key} className="space-y-2 rounded-lg bg-muted/35 p-3">
            <label className="flex items-center gap-2 text-sm font-medium">
              <input
                type="checkbox"
                checked={override.isOverridden}
                onChange={(event) =>
                  onChange(key, override.value ?? "", event.target.checked)
                }
              />
              Override {label}
            </label>
            <input
              type={type === "date" ? "date" : "text"}
              value={type === "date" ? dateInputValue(override.value) : override.value ?? ""}
              onChange={(event) => onChange(key, event.target.value, override.isOverridden)}
              disabled={!override.isOverridden}
              className="h-9 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50 disabled:opacity-60"
            />
          </div>
        );
      })}
    </div>
  );
}

export default function JobCostReportSection({ jobId }: { jobId: string }) {
  const reportQuery = useJobCostReport(jobId);
  const initializeMutation = useInitializeJobCostReport();
  const updateMutation = useUpdateJobCostReport();
  const refreshMutation = useRefreshJobCostReportMaterials();
  const [form, setForm] = useState<JobCostReport | null>(null);
  const [isRefreshDialogOpen, setIsRefreshDialogOpen] = useState(false);
  const [isConfirming, setIsConfirming] = useState(false);
  const report = form ?? reportQuery.data;
  useEffect(() => {
    if (reportQuery.data && !form) setForm(reportQuery.data);
  }, [form, reportQuery.data]);
  const isMutating =
    updateMutation.isPending ||
    refreshMutation.isPending ||
    initializeMutation.isPending ||
    isConfirming;
  if (reportQuery.isLoading) {
    return (
      <section className="job-cost-report-print space-y-4" aria-label="Job Cost Report">
        <div className="h-40 animate-pulse rounded-xl border bg-muted/40" />
      </section>
    );
  }

  const isMissing = isAxiosError(reportQuery.error) && reportQuery.error.response?.status === 404;
  if (!report && reportQuery.isError && !isMissing) {
    return (
      <section className="job-cost-report-print rounded-xl border border-destructive/30 bg-destructive/5 p-5" aria-label="Job Cost Report">
        <h2 className="font-semibold text-destructive">Job Cost Report unavailable</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {errorMessage(reportQuery.error, "The report could not be loaded.")}
        </p>
        <Button className="mt-4" variant="outline" onClick={() => void reportQuery.refetch()}>
          Retry
        </Button>
      </section>
    );
  }

  if (!report && isMissing) {
    return (
      <section className="job-cost-report-print rounded-xl border bg-card p-5" aria-label="Job Cost Report">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div>
            <h2 className="text-lg font-semibold">Job Cost Report</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Create a draft to capture the job snapshot and historical material costs.
            </p>
          </div>
          <Button
            onClick={() =>
              initializeMutation.mutate(jobId, {
                onSuccess: () => toast.success("Job Cost Report draft created."),
                onError: (error) =>
                  toast.error(errorMessage(error, "Could not create the report.")),
              })
            }
            disabled={initializeMutation.isPending}
          >
            {initializeMutation.isPending && <LoaderCircle className="animate-spin" />}
            Create report draft
          </Button>
        </div>
      </section>
    );
  }

  if (!report) return null;

  const updateField = <K extends keyof JobCostReport["reportFields"]>(
    field: K,
    value: JobCostReport["reportFields"][K],
  ) => {
    setForm((current) =>
      current
        ? { ...current, reportFields: { ...current.reportFields, [field]: value } }
        : current,
    );
  };

  const updateVisit = (
    index: number,
    field: keyof JobCostReportServiceVisit,
    value: string,
  ) => {
    setForm((current) => {
      if (!current) return current;
      const serviceVisits = current.serviceVisits.map((visit, visitIndex) =>
        visitIndex === index
          ? {
              ...visit,
              [field]:
                field === "sequence"
                  ? Number(value)
                  : field === "visitDate"
                    ? toIsoDate(value)
                    : value,
            }
          : visit,
      );
      return { ...current, serviceVisits };
    });
  };

  const confirmAndDownload = async (event: FormEvent) => {
    event.preventDefault();
    if (isMutating) return;
    if (Number(report.reportFields.gstRate) !== 18) {
      toast.error("Confirm & Download requires an exact 18% GST rate.");
      return;
    }
    if (report.materialSnapshotStatus !== "REFRESHED" || report.materialSnapshotFresh !== true) {
      toast.error("Refresh the material snapshot before confirming this report.");
      return;
    }
    const invalidVisit = report.serviceVisits.some(
      (visit) =>
        !Number.isInteger(visit.sequence) ||
        visit.sequence < 1 ||
        report.serviceVisits.filter((candidate) => candidate.sequence === visit.sequence).length > 1,
    );
    if (invalidVisit) {
      toast.error("Service visit sequence numbers must be unique positive integers.");
      return;
    }

    setIsConfirming(true);
    try {
      const savedReport = await updateMutation.mutateAsync({
        jobId,
        patch: {
          expectedDraftRevision: report.draftRevision,
          serviceLaborCost: report.reportFields.serviceLaborCost,
          gstRate: report.reportFields.gstRate,
          bankPurchaseOrderNumber: report.reportFields.bankPurchaseOrderNumber,
          taxInvoiceNumber: report.reportFields.taxInvoiceNumber,
          filingPeriod: report.reportFields.filingPeriod,
          officeBillingStatus: report.reportFields.officeBillingStatus,
          overrides: report.reportFields.overrides,
          serviceVisits: report.serviceVisits,
        },
      });
      setForm(savedReport);

      try {
        const { blob, filename } = await downloadJobCostReport(jobId);
        const url = URL.createObjectURL(blob);
        const link = document.createElement("a");
        link.href = url;
        link.download = filename;
        link.style.display = "none";
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 0);
        toast.success("Job Cost Report saved and download started.");
      } catch {
        toast.error("The report was saved, but the Excel download failed.");
      }
    } catch (error) {
      if (isAxiosError(error) && error.response?.status === 409) {
        toast.error(
          "This report changed elsewhere. Your local edits were preserved; reload before confirming again.",
        );
      } else {
        toast.error(errorMessage(error, "Could not save the report."));
      }
    } finally {
      setIsConfirming(false);
    }
  };

  const refreshMaterials = () => {
    if (isMutating) return;
    const localEditableState = {
      reportFields: {
        ...report.reportFields,
        overrides: { ...report.reportFields.overrides },
      },
      serviceVisits: report.serviceVisits.map((visit) => ({ ...visit })),
    };
    refreshMutation.mutate(
      { jobId, expectedDraftRevision: report.draftRevision },
      {
        onSuccess: (refreshedReport) => {
          setForm({
            ...refreshedReport,
            reportFields: localEditableState.reportFields,
            serviceVisits: localEditableState.serviceVisits,
          });
          setIsRefreshDialogOpen(false);
          toast.success("Historical material snapshot refreshed.");
        },
        onError: (error) => {
          setIsRefreshDialogOpen(false);
          if (isAxiosError(error) && error.response?.status === 409) {
            toast.error(
              "The report or material usage changed. Your local edits were preserved; reload before refreshing.",
            );
            return;
          }
          toast.error(errorMessage(error, "Could not refresh materials."));
        },
      },
    );
  };

  return (
    <section className="job-cost-report-print space-y-5" aria-label="Job Cost Report">
      <div className="flex flex-wrap items-start justify-between gap-4 print:mb-5">
        <div>
          <p className="text-sm text-muted-foreground">Draft report · revision {report.draftRevision}</p>
          <h2 className="mt-1 text-2xl font-semibold tracking-tight">Job Cost Report</h2>
          <p className="mt-1 text-sm text-muted-foreground">
            Historical material costs and editable report details for {display(report.jobSnapshot.jobNumber || report.jobSnapshot.jobId)}.
          </p>
        </div>
        <div className="flex flex-wrap gap-2 print:hidden">
          <Button
            type="button"
            variant="outline"
            disabled={isMutating}
            onClick={() => setIsRefreshDialogOpen(true)}
          >
            <RefreshCw />
            Refresh materials
          </Button>
          <Button type="submit" form={`job-cost-report-form-${jobId}`} disabled={isMutating}>
            {isConfirming && <LoaderCircle className="animate-spin" />}
            {isConfirming ? "Saving & downloading..." : "Confirm & Download Excel"}
          </Button>
        </div>
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Badge variant={report.materialSnapshotFresh ? "default" : "secondary"}>
          {report.materialSnapshotFresh ? "Materials current" : "Materials need refresh"}
        </Badge>
        <span className="text-sm text-muted-foreground">
          Snapshot revision: {report.materialSnapshotRevision.isKnown ? report.materialSnapshotRevision.value : "unknown"}
        </span>
      </div>

      <div className="grid min-w-0 gap-6 lg:grid-cols-2 lg:items-start">
        <div className="min-w-0 space-y-5">
          <Card>
            <CardHeader><CardTitle>Job snapshot</CardTitle></CardHeader>
            <CardContent><JobSnapshot snapshot={report.jobSnapshot} /></CardContent>
          </Card>

          <Card className="print:break-inside-avoid">
            <CardHeader className="flex-row items-start justify-between gap-3">
              <div>
                <CardTitle>Material cost snapshot</CardTitle>
                <p className="mt-1 text-sm text-muted-foreground">
                  Historical usage values only. Current Item prices are not substituted.
                </p>
              </div>
              <span className="text-sm font-medium">Recorded lines: {report.materialSnapshot.length}</span>
            </CardHeader>
            <CardContent>
              {report.materialSnapshot.length === 0 ? (
                <p className="rounded-lg bg-muted/45 p-4 text-sm text-muted-foreground">
                  No historical material usage is captured in this snapshot.
                </p>
              ) : (
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[640px] text-left text-sm">
                    <thead className="border-b text-xs text-muted-foreground">
                      <tr>
                        <th className="px-2 py-2 font-medium">Material</th>
                        <th className="px-2 py-2 font-medium">Quantity</th>
                        <th className="px-2 py-2 font-medium">Unit cost</th>
                        <th className="px-2 py-2 font-medium">Line cost</th>
                        <th className="px-2 py-2 font-medium">Captured</th>
                      </tr>
                    </thead>
                    <tbody>
                      {report.materialSnapshot.map((material) => (
                        <tr key={material.usageId} className="border-b last:border-b-0">
                          <td className="px-2 py-3 font-medium">{material.itemNameSnapshot}</td>
                          <td className="px-2 py-3">{material.quantity} {material.unitSnapshot}</td>
                          <td className="px-2 py-3">{material.unitCostSnapshot}</td>
                          <td className="px-2 py-3">{material.lineCostSnapshot}</td>
                          <td className="px-2 py-3 text-muted-foreground">{formatDate(material.capturedAt)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </CardContent>
          </Card>

      <form id={`job-cost-report-form-${jobId}`} onSubmit={confirmAndDownload} className="space-y-5">
        <Card className="print:break-inside-avoid">
          <CardHeader><CardTitle>Editable report details</CardTitle></CardHeader>
          <CardContent className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {[
              ["serviceLaborCost", "Service labor cost", "text"],
              ["gstRate", "GST rate", "text"],
              ["bankPurchaseOrderNumber", "Bank purchase order", "text"],
              ["taxInvoiceNumber", "Tax invoice number", "text"],
              ["filingPeriod", "Filing period", "text"],
              ["officeBillingStatus", "Office billing status", "text"],
            ].map(([field, label, type]) => (
              <label key={field} className="space-y-2 text-sm font-medium">
                {label}
                <input
                  type={type}
                  value={String(report.reportFields[field as keyof typeof report.reportFields] ?? "")}
                  onChange={(event) =>
                    updateField(
                      field as keyof JobCostReport["reportFields"],
                      event.target.value as never,
                    )
                  }
                  className="h-10 w-full rounded-md border border-input bg-background px-3 font-normal outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                />
              </label>
            ))}
            <div className="sm:col-span-2 lg:col-span-3">
              <p className="mb-3 text-sm font-semibold">Supported source overrides</p>
              <OverrideFields
                overrides={report.reportFields.overrides}
                onChange={(key, value, enabled) =>
                  updateField("overrides", {
                    ...report.reportFields.overrides,
                    [key]: {
                      ...report.reportFields.overrides[key],
                      value: key === "callLogDate" ? toIsoDate(value) : value || null,
                      isOverridden: enabled,
                    },
                  })
                }
              />
            </div>
          </CardContent>
        </Card>

        <Card className="print:break-inside-avoid">
          <CardHeader className="flex-row items-start justify-between gap-3">
            <div>
              <CardTitle>Service visits</CardTitle>
              <p className="mt-1 text-sm text-muted-foreground">Add the visit record details supported by the draft contract.</p>
            </div>
            <Button
              type="button"
              variant="outline"
              className="print:hidden"
              onClick={() =>
                setForm((current) =>
                  current
                    ? { ...current, serviceVisits: [...current.serviceVisits, emptyVisit(current.serviceVisits.length + 1)] }
                    : current,
                )
              }
            >
              Add visit
            </Button>
          </CardHeader>
          <CardContent className="space-y-4">
            {report.serviceVisits.length === 0 && (
              <p className="rounded-lg bg-muted/45 p-4 text-sm text-muted-foreground">No service visits recorded.</p>
            )}
            {report.serviceVisits.map((visit, index) => (
              <div key={visit._id ?? `visit-${index}`} className="grid gap-3 rounded-lg bg-muted/35 p-4 sm:grid-cols-2 lg:grid-cols-5">
                <label className="space-y-2 text-sm font-medium">
                  Sequence
                  <input
                    type="number"
                    min={1}
                    step={1}
                    value={visit.sequence}
                    onChange={(event) => updateVisit(index, "sequence", event.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 font-normal"
                  />
                </label>
                <label className="space-y-2 text-sm font-medium">
                  Visit date
                  <input
                    type="date"
                    value={dateInputValue(visit.visitDate)}
                    onChange={(event) => updateVisit(index, "visitDate", event.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 font-normal"
                  />
                </label>
                <label className="space-y-2 text-sm font-medium">
                  Status
                  <input
                    value={visit.status ?? ""}
                    onChange={(event) => updateVisit(index, "status", event.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 font-normal"
                  />
                </label>
                <label className="space-y-2 text-sm font-medium lg:col-span-2">
                  Work performed
                  <input
                    value={visit.workPerformed ?? ""}
                    onChange={(event) => updateVisit(index, "workPerformed", event.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 font-normal"
                  />
                </label>
                <label className="space-y-2 text-sm font-medium sm:col-span-2 lg:col-span-4">
                  Sign-off or photo reference
                  <input
                    value={visit.signOffOrPhotoReference ?? ""}
                    onChange={(event) => updateVisit(index, "signOffOrPhotoReference", event.target.value)}
                    className="h-9 w-full rounded-md border border-input bg-background px-3 font-normal"
                  />
                </label>
                <Button
                  type="button"
                  variant="destructive"
                  size="icon"
                  className="print:hidden"
                  aria-label={`Remove visit ${visit.sequence}`}
                  onClick={() =>
                    setForm((current) =>
                      current
                        ? { ...current, serviceVisits: current.serviceVisits.filter((_, visitIndex) => visitIndex !== index) }
                        : current,
                    )
                  }
                >
                  <Trash2 />
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
        <div className="flex items-center justify-between gap-3 print:hidden">
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <CheckCircle2 className="size-4" />
            Review the live preview before confirming revision {report.draftRevision}.
          </p>
        </div>
      </form>
        </div>

        <div className="min-w-0 lg:sticky lg:top-4">
          <JobCostReportExcelPreview report={report} />
        </div>
      </div>

      <Dialog open={isRefreshDialogOpen} onOpenChange={setIsRefreshDialogOpen}>
        <DialogContent>
          <DialogTitle>Refresh historical materials?</DialogTitle>
          <DialogDescription className="mt-2">
            This will replace the report&apos;s material snapshot with the current historical usage rows. Editable fields and visits will remain unchanged.
          </DialogDescription>
          <div className="mt-6 flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => setIsRefreshDialogOpen(false)} disabled={refreshMutation.isPending}>
              Cancel
            </Button>
            <Button type="button" onClick={refreshMaterials} disabled={refreshMutation.isPending}>
              {refreshMutation.isPending && <LoaderCircle className="animate-spin" />}
              Refresh snapshot
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </section>
  );
}
