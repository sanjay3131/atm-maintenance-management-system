import { useState } from "react";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  ClipboardCheck,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useMyAMC } from "@/features/amc/hooks/useMyAMC";
import {
  AMC_STATUSES,
  formatAMCStatus,
  getAMCErrorMessage,
  getAMCTaskListState,
} from "@/features/amc/amcExecution.utils";
import type { AMCStatus, EmployeeAMCRecord } from "@/services/amc.service";

const PAGE_SIZE = 10;

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

function atmDetails(amc: EmployeeAMCRecord) {
  return typeof amc.atmId === "object" && amc.atmId !== null
    ? amc.atmId
    : null;
}

function statusVariant(status: AMCStatus) {
  if (status === "COMPLETED") return "default" as const;
  if (status === "OVERDUE") return "destructive" as const;
  if (status === "PENDING") return "secondary" as const;
  return "outline" as const;
}

export default function EmployeeAMCsPage() {
  const currentDate = new Date();
  const [month, setMonth] = useState(currentDate.getMonth() + 1);
  const [year, setYear] = useState(currentDate.getFullYear());
  const [status, setStatus] = useState<AMCStatus | "">("");
  const [page, setPage] = useState(1);
  const query = useMyAMC(month, year, {
    page,
    limit: PAGE_SIZE,
    ...(status ? { status } : {}),
  });
  const amcs = query.data?.amcs ?? [];
  const pagination = query.data?.pagination;
  const listState = getAMCTaskListState({
    isLoading: query.isLoading,
    isError: query.isError,
    amcs,
  });

  return (
    <main className="space-y-5 p-4 sm:space-y-6 sm:p-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <ClipboardCheck className="size-6 text-primary" aria-hidden="true" />
            <h1 className="text-2xl font-bold sm:text-3xl">My AMC Visits</h1>
          </div>
          <p className="mt-2 text-sm text-muted-foreground">
            Monthly maintenance tasks assigned to you.
          </p>
        </div>
        <p className="text-sm text-muted-foreground">
          {pagination?.total ?? 0} assigned for this period
        </p>
      </header>

      <section className="grid gap-3 sm:grid-cols-3">
        <div>
          <label htmlFor="employee-amc-month" className="mb-2 block text-sm font-medium">
            Month
          </label>
          <select
            id="employee-amc-month"
            value={month}
            onChange={(event) => {
              setMonth(Number(event.target.value));
              setPage(1);
            }}
            className="h-12 w-full rounded-lg border border-input bg-background px-3 text-base"
          >
            {Array.from({ length: 12 }, (_, index) => index + 1).map((value) => (
              <option key={value} value={value}>
                {new Date(2020, value - 1, 1).toLocaleString("en-IN", {
                  month: "long",
                })}
              </option>
            ))}
          </select>
        </div>
        <div>
          <label htmlFor="employee-amc-year" className="mb-2 block text-sm font-medium">
            Year
          </label>
          <select
            id="employee-amc-year"
            value={year}
            onChange={(event) => {
              setYear(Number(event.target.value));
              setPage(1);
            }}
            className="h-12 w-full rounded-lg border border-input bg-background px-3 text-base"
          >
            {Array.from({ length: 6 }, (_, index) => currentDate.getFullYear() - index).map(
              (value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ),
            )}
          </select>
        </div>
        <div>
          <label htmlFor="employee-amc-status" className="mb-2 block text-sm font-medium">
            Status
          </label>
          <select
            id="employee-amc-status"
            value={status}
            onChange={(event) => {
              setStatus(event.target.value as AMCStatus | "");
              setPage(1);
            }}
            className="h-12 w-full rounded-lg border border-input bg-background px-3 text-base"
          >
            <option value="">All statuses</option>
            {AMC_STATUSES.map((value) => (
              <option key={value} value={value}>
                {formatAMCStatus(value)}
              </option>
            ))}
          </select>
        </div>
      </section>

      {listState === "loading" && (
        <div className="grid gap-4 md:grid-cols-2" role="status">
          {Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="h-48 animate-pulse rounded-lg border bg-muted/40" />
          ))}
          <span className="sr-only">Loading AMC visits...</span>
        </div>
      )}

      {listState === "error" && (
        <Card className="border-destructive/30">
          <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div role="alert">
              <p className="font-medium text-destructive">Could not load AMC visits.</p>
              <p className="mt-1 text-sm text-muted-foreground">{getAMCErrorMessage(query.error)}</p>
            </div>
            <Button type="button" variant="outline" onClick={() => void query.refetch()} disabled={query.isFetching}>
              {query.isFetching ? "Retrying..." : "Retry"}
            </Button>
          </CardContent>
        </Card>
      )}

      {listState === "empty" && (
        <Card>
          <CardContent className="p-8 text-center">
            <CalendarDays className="mx-auto size-8 text-muted-foreground" aria-hidden="true" />
            <p className="mt-3 font-medium">
              {status ? `No AMC visits with status ${formatAMCStatus(status)}.` : "No AMC visits for this period."}
            </p>
            <p className="mt-1 text-sm text-muted-foreground">
              Assigned monthly visits will appear here.
            </p>
          </CardContent>
        </Card>
      )}

      {listState === "ready" && (
        <>
          <section aria-label="AMC visit tasks" className="grid gap-4 md:grid-cols-2">
            {amcs.map((amc) => {
              const atm = atmDetails(amc);
              return (
                <Card key={amc._id}>
                  <CardHeader className="space-y-3 pb-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div>
                        <p className="text-xs font-medium text-muted-foreground">{amc.amcId}</p>
                        <CardTitle className="mt-1 text-base">
                          {atm?.atmId || "ATM unavailable"}
                        </CardTitle>
                        {(atm?.locationName || atm?.address) && (
                          <p className="mt-1 text-sm text-muted-foreground">
                            {atm.locationName || atm.address}
                          </p>
                        )}
                      </div>
                      <Badge variant={statusVariant(amc.status)}>
                        {formatAMCStatus(amc.status)}
                      </Badge>
                    </div>
                  </CardHeader>
                  <CardContent className="space-y-4">
                    <div className="grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <p className="text-xs text-muted-foreground">Period</p>
                        <p className="font-medium">{amc.month}/{amc.year}</p>
                      </div>
                      <div>
                        <p className="text-xs text-muted-foreground">Deadline</p>
                        <p className="font-medium">{displayDate(amc.deadlineDate)}</p>
                      </div>
                      {amc.completedAt && (
                        <div>
                          <p className="text-xs text-muted-foreground">Completed</p>
                          <p className="font-medium">{displayDate(amc.completedAt)}</p>
                        </div>
                      )}
                    </div>
                    <Link
                      to={`/employee/amcs/${amc._id}`}
                      className="inline-flex min-h-11 w-full items-center justify-center rounded-lg bg-primary px-4 text-sm font-medium text-primary-foreground transition-colors hover:bg-primary/80 focus-visible:outline-none focus-visible:ring-3 focus-visible:ring-ring/50"
                    >
                        {amc.status === "COMPLETED" ? "View visit" : "Open visit"}
                    </Link>
                  </CardContent>
                </Card>
              );
            })}
          </section>
          {pagination && pagination.totalPages > 1 && (
            <div className="flex items-center justify-between border-t pt-4">
              <p className="text-sm text-muted-foreground">
                Page {pagination.page} of {pagination.totalPages}
              </p>
              <div className="flex gap-2">
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  onClick={() => setPage((value) => Math.max(1, value - 1))}
                  disabled={page <= 1 || query.isFetching}
                >
                  <ChevronLeft aria-hidden="true" /> Previous
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  onClick={() => setPage((value) => Math.min(pagination.totalPages, value + 1))}
                  disabled={page >= pagination.totalPages || query.isFetching}
                >
                  Next <ChevronRight aria-hidden="true" />
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </main>
  );
}
