import { useState } from "react";
import { CalendarCheck, ChevronLeft, ChevronRight, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  ADMIN_AMC_STATUSES,
  formatAdminAMCStatus,
  getAdminAMCErrorMessage,
  getAdminAMCListState,
  isValidAMCGenerationPeriod,
} from "@/features/amc/amcAdmin.utils";
import {
  useAdminAMCs,
  useGenerateAdminAMCs,
} from "@/features/amc/hooks/useAdminAMCs";
import type { AMCStatus, AdminAMCRecord } from "@/services/amc.service";

const PAGE_SIZE = 20;

function displayDate(value?: string | null) {
  if (!value) return "Not available";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Not available"
    : date.toLocaleDateString("en-IN", {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
}

function populatedName(
  value:
    | { firstName?: string; lastName?: string; customerName?: string; bankName?: string }
    | string
    | null
    | undefined,
) {
  if (!value || typeof value === "string") return "Not available";
  return (
    value.customerName ||
    value.bankName ||
    [value.firstName, value.lastName].filter(Boolean).join(" ") ||
    "Not available"
  );
}

function atmReference(amc: AdminAMCRecord) {
  return typeof amc.atmId === "object" && amc.atmId !== null ? amc.atmId : null;
}

function statusVariant(status: AMCStatus) {
  if (status === "COMPLETED") return "default" as const;
  if (status === "OVERDUE") return "destructive" as const;
  if (status === "PENDING") return "secondary" as const;
  return "outline" as const;
}

export default function AmcPage() {
  const today = new Date();
  const [month, setMonth] = useState(today.getMonth() + 1);
  const [year, setYear] = useState(today.getFullYear());
  const [status, setStatus] = useState<AMCStatus | "">("");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(1);
  const [generationResult, setGenerationResult] = useState<{
    created: number;
    skipped: number;
    errors: Array<{ atmId?: string; employee?: string; error: string }>;
  } | null>(null);
  const listQuery = useAdminAMCs({
    page,
    limit: PAGE_SIZE,
    month,
    year,
    ...(status ? { status } : {}),
    ...(search.trim() ? { search: search.trim() } : {}),
  });
  const generateMutation = useGenerateAdminAMCs();
  const amcs = listQuery.data?.amcs ?? [];
  const pagination = listQuery.data?.pagination;
  const listState = getAdminAMCListState({
    isLoading: listQuery.isLoading,
    isError: listQuery.isError,
    amcs,
  });
  const canGenerate = isValidAMCGenerationPeriod(month, year);

  const updatePeriod = (nextMonth: number, nextYear: number) => {
    setMonth(nextMonth);
    setYear(nextYear);
    setPage(1);
  };

  const generateRecords = async () => {
    if (!canGenerate || generateMutation.isPending) return;
    const confirmed = window.confirm(
      `Generate AMC records for ${month}/${year}? This processes all active eligible ATMs with an assigned AMC-responsible employee. Existing ATM/month records will be skipped.`,
    );
    if (!confirmed) return;
    setGenerationResult(null);
    try {
      const result = await generateMutation.mutateAsync({ month, year });
      setGenerationResult(result);
      toast.success(`AMC generation finished: ${result.created} created, ${result.skipped} skipped.`);
    } catch (error) {
      toast.error(getAdminAMCErrorMessage(error));
    }
  };

  return (
    <main className="space-y-5 p-4 sm:space-y-6 sm:p-6">
      <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <CalendarCheck className="size-6 text-primary" aria-hidden="true" />
            <h1 className="text-2xl font-bold sm:text-3xl">AMC Management</h1>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Review monthly AMC records and configure responsibility from each ATM.
          </p>
        </div>
        <Button
          type="button"
          onClick={() => void generateRecords()}
          disabled={!canGenerate || generateMutation.isPending}
        >
          {generateMutation.isPending ? "Generating..." : `Generate AMC for ${month}/${year}`}
        </Button>
      </header>

      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <label htmlFor="admin-amc-month" className="mb-1 block text-sm font-medium">Month</label>
            <select
              id="admin-amc-month"
              value={month}
              onChange={(event) => updatePeriod(Number(event.target.value), year)}
              className="h-11 w-full rounded-lg border border-input bg-background px-3"
            >
              {Array.from({ length: 12 }, (_, index) => index + 1).map((value) => (
                <option key={value} value={value}>
                  {new Date(2020, value - 1, 1).toLocaleString("en-IN", { month: "long" })}
                </option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="admin-amc-year" className="mb-1 block text-sm font-medium">Year</label>
            <select
              id="admin-amc-year"
              value={year}
              onChange={(event) => updatePeriod(month, Number(event.target.value))}
              className="h-11 w-full rounded-lg border border-input bg-background px-3"
            >
              {Array.from({ length: 11 }, (_, index) => today.getFullYear() - 5 + index).map((value) => (
                <option key={value} value={value}>{value}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="admin-amc-status" className="mb-1 block text-sm font-medium">Status</label>
            <select
              id="admin-amc-status"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value as AMCStatus | "");
                setPage(1);
              }}
              className="h-11 w-full rounded-lg border border-input bg-background px-3"
            >
              <option value="">All statuses</option>
              {ADMIN_AMC_STATUSES.map((value) => (
                <option key={value} value={value}>{formatAdminAMCStatus(value)}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="admin-amc-search" className="mb-1 block text-sm font-medium">Search AMC ID</label>
            <input
              id="admin-amc-search"
              type="search"
              value={search}
              onChange={(event) => {
                setSearch(event.target.value);
                setPage(1);
              }}
              placeholder="AMC-YYYY-MM-NNN"
              className="h-11 w-full rounded-lg border border-input bg-background px-3"
            />
          </div>
        </CardContent>
      </Card>

      {generationResult && (
        <Card>
          <CardContent className="space-y-2 p-4" role="status">
            <p className="font-medium">Generation finished: {generationResult.created} created, {generationResult.skipped} skipped.</p>
            {generationResult.errors.length > 0 && (
              <div className="text-sm text-muted-foreground">
                {generationResult.errors.length} record(s) could not be generated. Review ATM responsibility and employee eligibility, then retry if appropriate.
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {listState === "loading" && (
        <div className="space-y-3" role="status">
          <div className="h-28 animate-pulse rounded-lg border bg-muted/40" />
          <div className="h-28 animate-pulse rounded-lg border bg-muted/40" />
          <span className="sr-only">Loading AMC records...</span>
        </div>
      )}

      {listState === "error" && (
        <Card>
          <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div role="alert">
              <p className="font-medium text-destructive">Could not load AMC records.</p>
              <p className="mt-1 text-sm text-muted-foreground">{getAdminAMCErrorMessage(listQuery.error)}</p>
            </div>
            <Button type="button" variant="outline" onClick={() => void listQuery.refetch()} disabled={listQuery.isFetching}>
              <RefreshCw className={listQuery.isFetching ? "animate-spin" : ""} aria-hidden="true" />
              {listQuery.isFetching ? "Retrying..." : "Retry"}
            </Button>
          </CardContent>
        </Card>
      )}

      {listState === "empty" && (
        <Card>
          <CardContent className="p-8 text-center">
            <p className="font-medium">No AMC records match these filters.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Assign an eligible AMC responsible employee from an ATM Details page before generating records.
            </p>
          </CardContent>
        </Card>
      )}

      {listState === "ready" && (
        <section aria-label="AMC records" className="space-y-3">
          {amcs.map((amc) => {
            const atm = atmReference(amc);
            return (
              <Card key={amc._id}>
                <CardHeader className="flex flex-col gap-3 pb-3 sm:flex-row sm:items-start sm:justify-between">
                  <div>
                    <p className="text-xs font-medium text-muted-foreground">{amc.amcId}</p>
                    <CardTitle className="mt-1 text-base">
                      <Link
                        to={`/admin/amc/${encodeURIComponent(amc._id)}`}
                        className="underline-offset-4 hover:underline focus-visible:underline"
                      >
                        {atm?.atmId || "ATM unavailable"}
                        <span className="sr-only"> — inspect AMC details</span>
                      </Link>
                    </CardTitle>
                    {atm?.locationName && <p className="mt-1 text-sm text-muted-foreground">{atm.locationName}</p>}
                    <Link
                      to={`/admin/amc/${encodeURIComponent(amc._id)}`}
                      className="mt-2 inline-flex min-h-11 items-center text-sm font-medium text-primary hover:underline"
                    >
                      Inspect AMC work and evidence
                    </Link>
                  </div>
                  <Badge variant={statusVariant(amc.status)}>{formatAdminAMCStatus(amc.status)}</Badge>
                </CardHeader>
                <CardContent className="grid gap-4 border-t pt-4 sm:grid-cols-2 lg:grid-cols-4">
                  <Detail label="Bank" value={populatedName(amc.bankId)} />
                  <Detail label="Customer" value={populatedName(amc.customerId)} />
                  <Detail label="AMC period" value={`${amc.month}/${amc.year}`} />
                  <Detail label="Responsible employee" value={populatedName(amc.employeeId)} />
                  <Detail label="Deadline" value={displayDate(amc.deadlineDate)} />
                  <Detail label="Visit date" value={displayDate(amc.visitDate)} />
                  <Detail label="Completion date" value={displayDate(amc.completedAt)} />
                  <Detail label="Generated" value={displayDate(amc.generatedAt ?? amc.createdAt)} />
                  {atm?._id && (
                    <div className="sm:col-span-2 lg:col-span-4">
                      <Link
                        to={`/admin/atms/${atm._id}`}
                        className="inline-flex min-h-11 items-center rounded-md border px-4 text-sm font-medium hover:bg-muted"
                      >
                        Manage ATM assignment and AMC responsibility
                      </Link>
                    </div>
                  )}
                </CardContent>
              </Card>
            );
          })}
        </section>
      )}

      {pagination && pagination.totalPages > 1 && (
        <div className="flex items-center justify-between border-t pt-4">
          <p className="text-sm text-muted-foreground">Page {pagination.page} of {pagination.totalPages} · {pagination.total} records</p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={() => setPage((value) => Math.max(1, value - 1))}
              disabled={page <= 1 || listQuery.isFetching}
            >
              <ChevronLeft aria-hidden="true" /> Previous
            </Button>
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={() => setPage((value) => Math.min(pagination.totalPages, value + 1))}
              disabled={page >= pagination.totalPages || listQuery.isFetching}
            >
              Next <ChevronRight aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}
    </main>
  );
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="break-words text-sm font-medium">{value}</p>
    </div>
  );
}
