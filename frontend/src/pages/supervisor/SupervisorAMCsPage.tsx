import { useEffect, useState } from "react";
import { isAxiosError } from "axios";
import {
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Search,
} from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import { SkeletonBlock } from "@/features/dashboard/components/DashboardSkeleton";
import { useSupervisorAMCs } from "@/features/supervisor/hooks/useSupervisorAMCs";
import {
  buildSupervisorAMCListQuery,
  formatSupervisorAMCLabel,
  getSupervisorBusinessMonth,
  isSupervisorAMCResponseConfirmed,
  SUPERVISOR_AMC_STATUSES,
  supervisorAMCATMName,
  supervisorAMCEmployeeName,
} from "@/features/supervisor/supervisorAmc.utils";
import type {
  SupervisorAMCRecord,
  SupervisorAmcStatus,
} from "@/services/supervisor.service";

const PAGE_SIZE = 20;

const formatDate = (value?: string | null) => {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeZone: "Asia/Kolkata",
  }).format(date);
};

const statusVariant = (status: SupervisorAmcStatus) => {
  if (status === "COMPLETED") return "secondary" as const;
  if (status === "OVERDUE") return "destructive" as const;
  return "outline" as const;
};

const getErrorMessage = (error: unknown) =>
  isAxiosError<{ message?: string }>(error)
    ? error.response?.data?.message ||
      "AMC records could not be loaded. Please try again."
    : error instanceof Error
      ? error.message
      : "AMC records could not be loaded. Please try again.";

function AMCSkeleton() {
  return (
    <div className="space-y-3" role="status" aria-label="Loading AMC records">
      {Array.from({ length: 5 }, (_, index) => (
        <SkeletonBlock key={index} className="h-32 rounded-xl" />
      ))}
    </div>
  );
}

function AMCRecordCard({ amc }: { amc: SupervisorAMCRecord }) {
  return (
    <Card className="border-slate-200 shadow-sm transition-shadow hover:shadow-md">
      <CardContent className="flex flex-col gap-4 p-4 sm:p-5 lg:flex-row lg:items-start lg:justify-between">
        <div className="flex min-w-0 gap-3">
          <span className="grid size-10 shrink-0 place-items-center rounded-xl bg-teal-50 text-teal-800">
            <CalendarDays className="size-5" aria-hidden="true" />
          </span>
          <div className="min-w-0">
            <Link
              to={`/supervisor/amc/${amc._id}`}
              className="font-semibold text-slate-900 hover:text-blue-800 focus-visible:rounded-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-600"
            >
              {amc.amcId || "AMC reference unavailable"}
            </Link>
            <p className="mt-1 text-sm text-slate-600">
              Period {amc.month}/{amc.year}
            </p>
            <div className="mt-2">
              <Badge variant={statusVariant(amc.status)}>
                {formatSupervisorAMCLabel(amc.status)}
              </Badge>
            </div>
          </div>
        </div>
        <div className="grid min-w-0 gap-2 border-t border-slate-100 pt-3 text-sm text-slate-600 sm:grid-cols-2 lg:min-w-[26rem] lg:border-0 lg:pt-1">
          <p className="truncate">
            <span className="font-medium text-slate-800">ATM: </span>
            {supervisorAMCATMName(amc.atmId)}
          </p>
          <p className="truncate">
            <span className="font-medium text-slate-800">Employee: </span>
            {supervisorAMCEmployeeName(amc.employeeId)}
          </p>
          <p>
            <span className="font-medium text-slate-800">Visit: </span>
            {formatDate(amc.visitDate)}
          </p>
          <p>
            <span className="font-medium text-slate-800">Due by: </span>
            {formatDate(amc.deadlineDate)}
          </p>
          <Link
            to={`/supervisor/amc/${amc._id}`}
            className={`${buttonVariants({
              variant: "outline",
              size: "sm",
            })} min-h-10 sm:col-span-2 lg:justify-self-end`}
          >
            View AMC details
          </Link>
        </div>
      </CardContent>
    </Card>
  );
}

export default function SupervisorAMCsPage() {
  const currentPeriod = getSupervisorBusinessMonth();
  const [searchInput, setSearchInput] = useState("");
  const [search, setSearch] = useState("");
  const [status, setStatus] = useState<SupervisorAmcStatus | "">("");
  const [month, setMonth] = useState(currentPeriod.month);
  const [year, setYear] = useState(currentPeriod.year);
  const [page, setPage] = useState(1);

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setSearch(searchInput.trim());
      setPage(1);
    }, 250);
    return () => window.clearTimeout(timer);
  }, [searchInput]);

  const amcsQuery = useSupervisorAMCs(buildSupervisorAMCListQuery({
    page,
    limit: PAGE_SIZE,
    month,
    year,
    status,
    search,
  }));
  const freshResult = isSupervisorAMCResponseConfirmed({
    validId: true,
    isFetchedAfterMount: amcsQuery.isFetchedAfterMount,
    isSuccess: amcsQuery.isSuccess,
    isError: amcsQuery.isError,
    isFetching: amcsQuery.isFetching,
  });
  const amcs = freshResult ? amcsQuery.data?.amcs : undefined;
  const pagination = freshResult ? amcsQuery.data?.pagination : undefined;

  const clearFilters = () => {
    setSearchInput("");
    setSearch("");
    setStatus("");
    setMonth(currentPeriod.month);
    setYear(currentPeriod.year);
    setPage(1);
  };

  return (
    <div className="space-y-6">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-end sm:justify-between">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-teal-700">
            Read-only monitoring
          </p>
          <h2 className="mt-1 text-2xl font-bold tracking-tight text-slate-950 sm:text-3xl">
            AMC monitoring
          </h2>
          <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
            Review monthly maintenance records for employees currently
            assigned to you.
          </p>
        </div>
        {pagination && (
          <p className="text-sm font-medium text-slate-600">
            {pagination.total.toLocaleString("en-IN")}{" "}
            {pagination.total === 1 ? "record" : "records"}
          </p>
        )}
      </header>

      <Card>
        <CardContent className="grid gap-3 p-4 sm:grid-cols-2 lg:grid-cols-4">
          <div className="relative sm:col-span-2">
            <Search
              className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400"
              aria-hidden="true"
            />
            <input
              type="search"
              value={searchInput}
              onChange={(event) => {
                setSearchInput(event.target.value);
                setPage(1);
              }}
              placeholder="Search AMC reference"
              aria-label="Search AMC references"
              className="min-h-11 w-full rounded-lg border border-slate-200 bg-white pl-10 pr-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            />
          </div>
          <div>
            <label className="sr-only" htmlFor="supervisor-amc-status">
              Filter by AMC status
            </label>
            <select
              id="supervisor-amc-status"
              value={status}
              onChange={(event) => {
                setStatus(event.target.value as SupervisorAmcStatus | "");
                setPage(1);
              }}
              className="min-h-11 w-full rounded-lg border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
            >
              <option value="">All statuses</option>
              {SUPERVISOR_AMC_STATUSES.map((amcStatus) => (
                <option key={amcStatus} value={amcStatus}>
                  {formatSupervisorAMCLabel(amcStatus)}
                </option>
              ))}
            </select>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <div>
              <label className="sr-only" htmlFor="supervisor-amc-month">
                AMC month
              </label>
              <select
                id="supervisor-amc-month"
                value={month}
                onChange={(event) => {
                  setMonth(Number(event.target.value));
                  setPage(1);
                }}
                className="min-h-11 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              >
                {Array.from({ length: 12 }, (_, index) => index + 1).map(
                  (monthOption) => (
                    <option key={monthOption} value={monthOption}>
                      {new Intl.DateTimeFormat("en-IN", {
                        month: "short",
                      }).format(new Date(2020, monthOption - 1, 1))}
                    </option>
                  ),
                )}
              </select>
            </div>
            <div>
              <label className="sr-only" htmlFor="supervisor-amc-year">
                AMC year
              </label>
              <select
                id="supervisor-amc-year"
                value={year}
                onChange={(event) => {
                  setYear(Number(event.target.value));
                  setPage(1);
                }}
                className="min-h-11 w-full rounded-lg border border-slate-200 bg-white px-2 text-sm outline-none focus:border-blue-500 focus:ring-2 focus:ring-blue-100"
              >
                {[currentPeriod.year, currentPeriod.year - 1].map(
                  (yearOption) => (
                    <option key={yearOption} value={yearOption}>
                      {yearOption}
                    </option>
                  ),
                )}
              </select>
            </div>
          </div>
        </CardContent>
      </Card>

      {amcsQuery.isFetching && <AMCSkeleton />}

      {amcsQuery.isError && (
        <Card className="border-rose-200">
          <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div role="alert">
              <p className="font-semibold text-rose-800">
                Could not load AMC records
              </p>
              <p className="mt-1 text-sm text-slate-600">
                {getErrorMessage(amcsQuery.error)}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => void amcsQuery.refetch()}
              disabled={amcsQuery.isFetching}
              className="min-h-11 shrink-0"
            >
              {amcsQuery.isFetching ? "Retrying..." : "Retry"}
            </Button>
          </CardContent>
        </Card>
      )}

      {amcs && amcs.length > 0 && (
        <section aria-label="Supervisor AMC records" className="space-y-3">
          {amcs.map((amc) => (
            <AMCRecordCard key={amc._id} amc={amc} />
          ))}
        </section>
      )}

      {amcs && amcs.length === 0 && (
        <Card>
          <CardContent className="flex flex-col items-center px-5 py-12 text-center">
            <span className="grid size-12 place-items-center rounded-2xl bg-teal-50 text-teal-700">
              <CalendarDays className="size-6" aria-hidden="true" />
            </span>
            <h3 className="mt-4 text-lg font-semibold text-slate-900">
              No AMC records found
            </h3>
            <p className="mt-1 max-w-md text-sm text-slate-600">
              {search || status
                ? "Try adjusting or clearing your search and status filters."
                : `No AMC records are available for ${month}/${year}.`}
            </p>
            {(search || status) && (
              <Button
                type="button"
                variant="ghost"
                onClick={clearFilters}
                className="mt-3 min-h-11"
              >
                Clear filters
              </Button>
            )}
          </CardContent>
        </Card>
      )}

      {pagination && pagination.totalPages > 1 && (
        <div className="flex flex-col gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:items-center sm:justify-between">
          <p className="text-sm text-slate-600">
            Page {pagination.page} of {pagination.totalPages}
          </p>
          <div className="flex gap-2">
            <Button
              type="button"
              variant="outline"
              onClick={() => setPage(Math.max(1, page - 1))}
              disabled={page <= 1 || amcsQuery.isFetching}
              className="min-h-11 flex-1 sm:flex-none"
            >
              <ChevronLeft aria-hidden="true" />
              Previous
            </Button>
            <Button
              type="button"
              variant="outline"
              onClick={() =>
                setPage(Math.min(pagination.totalPages, page + 1))
              }
              disabled={
                page >= pagination.totalPages || amcsQuery.isFetching
              }
              className="min-h-11 flex-1 sm:flex-none"
            >
              Next
              <ChevronRight aria-hidden="true" />
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
