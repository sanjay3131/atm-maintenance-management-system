import { useMemo, useState } from "react";
import { isAxiosError } from "axios";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Pencil,
  RefreshCw,
} from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import RegionFormDialog from "@/features/users/components/RegionFormDialog";
import { useDistricts } from "@/features/users/hooks/useDistricts";
import { useRegion } from "@/features/users/hooks/useRegion";
import { useRegionSummaries } from "@/features/users/hooks/useRegionSummaries";
import { useRegionATMs } from "@/features/atms/hooks/useRegionATMs";
import { getATMDisplayId } from "@/features/atms/atmDisplay.utils";
import type {
  ATM,
  ATMEmployee,
} from "@/features/atms/types/atm.types";
import { useRegionCustomers } from "@/features/customers/hooks/useRegionCustomers";
import type { DistrictCustomer } from "@/features/customers/services/customer.service";
import { useRegionEmployees } from "@/features/employees/hooks/useRegionEmployees";
import type { DistrictEmployee } from "@/services/employee.service";
import { useDistrict } from "@/features/users/hooks/useDistrict";
import type { District } from "@/features/users/types/district.types";
import type { RegionSummary } from "@/features/users/services/region.service";

const PAGE_SIZE = 10;
const OBJECT_ID_PATTERN = /^[a-f\d]{24}$/i;

function getErrorMessage(error: unknown) {
  if (isAxiosError<{ message?: string }>(error)) {
    return error.response?.data?.message || "The request could not be completed.";
  }
  return error instanceof Error
    ? error.message
    : "The request could not be completed.";
}

function getRegionBankId(region: { bankId: unknown } | undefined) {
  const bankId = region?.bankId;
  if (typeof bankId === "string") return bankId;
  if (
    typeof bankId === "object" &&
    bankId !== null &&
    "_id" in bankId &&
    typeof bankId._id === "string"
  ) {
    return bankId._id;
  }
  return "";
}

function getDistrictRegionId(district: District | undefined) {
  if (!district) return "";
  return typeof district.regionId === "string"
    ? district.regionId
    : district.regionId?._id ?? "";
}

function getATMEmployees(atm: ATM) {
  return (atm.assignedEmployeeId ?? []).filter(
    (employee): employee is ATMEmployee =>
      employee !== null && typeof employee === "object",
  );
}

function getATMEmployeeName(employee: ATMEmployee) {
  return (
    [employee.userId?.firstName, employee.userId?.lastName]
      .filter(Boolean)
      .join(" ") ||
    employee.employeeCode ||
    "Assigned employee"
  );
}

function getEmployeeName(employee: DistrictEmployee) {
  return (
    [employee.userId?.firstName, employee.userId?.lastName]
      .filter(Boolean)
      .join(" ") || "Name unavailable"
  );
}

function getPagination(
  pagination:
    | { page: number; totalPages: number; total: number }
    | undefined,
  onPageChange: (page: number) => void,
  isFetching: boolean,
) {
  if (!pagination || pagination.totalPages <= 1) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
      <p className="text-sm text-muted-foreground">{pagination.total} total</p>
      <div className="flex items-center gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() => onPageChange(Math.max(1, pagination.page - 1))}
          disabled={pagination.page <= 1 || isFetching}
        >
          <ChevronLeft />
          Previous
        </Button>
        <span className="text-sm text-muted-foreground">
          Page {pagination.page} of {pagination.totalPages}
        </span>
        <Button
          type="button"
          size="sm"
          variant="outline"
          onClick={() =>
            onPageChange(Math.min(pagination.totalPages, pagination.page + 1))
          }
          disabled={pagination.page >= pagination.totalPages || isFetching}
        >
          Next
          <ChevronRight />
        </Button>
      </div>
    </div>
  );
}

function SectionLoading({ label }: { label: string }) {
  return (
    <Card>
      <CardContent className="space-y-3 p-4" role="status">
        {Array.from({ length: 3 }, (_, index) => (
          <div
            key={index}
            className="h-11 animate-pulse rounded bg-muted/50"
          />
        ))}
        <p className="sr-only">Loading {label.toLowerCase()}...</p>
      </CardContent>
    </Card>
  );
}

function SectionError({
  label,
  error,
  isFetching,
  onRetry,
}: {
  label: string;
  error: unknown;
  isFetching: boolean;
  onRetry: () => void;
}) {
  return (
    <Card>
      <CardContent className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-medium text-destructive">
            Failed to load {label.toLowerCase()}.
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {getErrorMessage(error)}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={onRetry}
          disabled={isFetching}
        >
          <RefreshCw className={isFetching ? "animate-spin" : ""} />
          {isFetching ? "Retrying..." : "Retry"}
        </Button>
      </CardContent>
    </Card>
  );
}

function SectionEmpty({ children }: { children: string }) {
  return (
    <p className="px-5 py-10 text-center text-sm text-muted-foreground">
      {children}
    </p>
  );
}

function getATMStatusVariant(status: ATM["status"]) {
  if (status === "ACTIVE") return "secondary" as const;
  if (status === "REMOVED") return "destructive" as const;
  return "outline" as const;
}

function getEntityStatusVariant(status: string) {
  if (status === "active") return "secondary" as const;
  if (status === "resigned") return "destructive" as const;
  return "outline" as const;
}

function getSummaryCounts(summary: RegionSummary | undefined) {
  return [
    { label: "Districts", value: summary?.counts.districts },
    { label: "ATMs", value: summary?.counts.atms },
    { label: "Employees", value: summary?.counts.employees },
    { label: "Customers", value: summary?.counts.customers },
  ];
}

export default function RegionDetailPage() {
  const navigate = useNavigate();
  const { districtId, regionId = "" } = useParams<{
    districtId: string;
    regionId: string;
  }>();
  const isLegacyRoute = Boolean(districtId);
  const isValidRegionId = OBJECT_ID_PATTERN.test(regionId);
  const isValidDistrictId =
    !isLegacyRoute || OBJECT_ID_PATTERN.test(districtId ?? "");
  const [pageState, setPageState] = useState({
    regionId,
    atm: 1,
    employee: 1,
    customer: 1,
  });
  const pages =
    pageState.regionId === regionId
      ? pageState
      : { regionId, atm: 1, employee: 1, customer: 1 };
  const updatePage = (
    key: "atm" | "employee" | "customer",
    page: number,
  ) => {
    setPageState((current) => ({
      ...(current.regionId === regionId
        ? current
        : { regionId, atm: 1, employee: 1, customer: 1 }),
      [key]: page,
    }));
  };
  const [regionDialogOpen, setRegionDialogOpen] = useState(false);

  const regionQuery = useRegion(isValidRegionId ? regionId : "");
  const districtQuery = useDistrict(
    isLegacyRoute && isValidDistrictId ? districtId ?? "" : "",
  );
  const region = regionQuery.data;
  const bankId = getRegionBankId(region);
  const districtMatchesRegion =
    !isLegacyRoute ||
    (districtQuery.data !== undefined &&
      getDistrictRegionId(districtQuery.data).toLowerCase() ===
        regionId.toLowerCase());
  const canLoadRegionData =
    isValidRegionId &&
    region !== undefined &&
    (!isLegacyRoute || districtMatchesRegion);
  const summaryParams = useMemo(
    () => (bankId ? { bankId } : {}),
    [bankId],
  );
  const summaryQuery = useRegionSummaries(
    summaryParams,
    canLoadRegionData,
  );
  const regionSummary = summaryQuery.data?.find(
    (item) => item.regionId.toLowerCase() === regionId.toLowerCase(),
  );
  const districtsQuery = useDistricts(
    canLoadRegionData,
    canLoadRegionData ? regionId : undefined,
  );
  const atmsQuery = useRegionATMs(
    canLoadRegionData ? regionId : "",
    pages.atm,
    PAGE_SIZE,
  );
  const employeesQuery = useRegionEmployees(
    canLoadRegionData ? regionId : "",
    pages.employee,
    PAGE_SIZE,
  );
  const customersQuery = useRegionCustomers(
    canLoadRegionData ? regionId : "",
    pages.customer,
    PAGE_SIZE,
  );

  const districts = districtsQuery.data ?? [];
  const atms = atmsQuery.data?.atms ?? [];
  const employees = employeesQuery.data?.employees ?? [];
  const customers = customersQuery.data?.customers ?? [];

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <Button
        type="button"
        variant="ghost"
        className="-ml-3"
        onClick={() =>
          navigate(
            isLegacyRoute && districtId
              ? `/admin/districts/${districtId}`
              : "/admin/regions",
          )
        }
      >
        <ArrowLeft />
        {isLegacyRoute ? "Back to District" : "Back to Regions"}
      </Button>

      {!isValidRegionId ? (
        <Card>
          <CardContent className="p-5">
            <p className="font-medium text-destructive">Invalid region ID.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Open a region from the Regions list and try again.
            </p>
          </CardContent>
        </Card>
      ) : regionQuery.isLoading ? (
        <Card>
          <CardContent className="space-y-3 p-6" role="status">
            <div className="h-7 w-52 animate-pulse rounded bg-muted" />
            <div className="h-4 w-48 animate-pulse rounded bg-muted/70" />
            <p className="sr-only">Loading region details...</p>
          </CardContent>
        </Card>
      ) : regionQuery.isError ? (
        <SectionError
          label="Region details"
          error={regionQuery.error}
          isFetching={regionQuery.isFetching}
          onRetry={() => void regionQuery.refetch()}
        />
      ) : region ? (
        <Card
          id="region-overview"
          className="scroll-mt-16"
          aria-labelledby="region-title"
        >
          <CardContent className="flex flex-wrap items-start justify-between gap-4 p-5 sm:p-6">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 id="region-title" className="text-2xl font-bold">
                  {region.name}
                </h1>
                <Badge variant={region.isActive ? "secondary" : "outline"}>
                  {region.isActive ? "Active" : "Inactive"}
                </Badge>
              </div>
              <div className="mt-3 space-y-1 text-sm text-muted-foreground">
                <p>
                  {region.code ? `Code: ${region.code}` : "No region code"}
                </p>
                <p>
                  Bank:{" "}
                  {typeof region.bankId === "object" && region.bankId
                    ? `${region.bankId.bankName}${region.bankId.bankCode ? ` (${region.bankId.bankCode})` : ""}`
                    : "Unmapped"}
                </p>
                {region.description && <p>{region.description}</p>}
              </div>
            </div>
            {canLoadRegionData && (
              <Button
                type="button"
                variant="outline"
                onClick={() => setRegionDialogOpen(true)}
              >
                <Pencil />
                Edit Region
              </Button>
            )}
          </CardContent>
        </Card>
      ) : null}

      {region && isLegacyRoute && districtQuery.isLoading && (
        <SectionLoading label="District relationship" />
      )}
      {region && isLegacyRoute && !isValidDistrictId && (
        <Card>
          <CardContent className="p-5">
            <p className="font-medium text-destructive">Invalid district ID.</p>
            <p className="mt-1 text-sm text-muted-foreground">
              Open the region from a valid district or from the Regions list.
            </p>
          </CardContent>
        </Card>
      )}
      {region && isLegacyRoute && districtQuery.isError && (
        <SectionError
          label="District relationship"
          error={districtQuery.error}
          isFetching={districtQuery.isFetching}
          onRetry={() => void districtQuery.refetch()}
        />
      )}
      {region &&
        isLegacyRoute &&
        districtQuery.data &&
        !districtMatchesRegion && (
          <Card>
            <CardContent className="p-5">
              <p className="font-medium text-destructive">
                This region does not belong to the selected district.
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                Region data is not shown under this district.
              </p>
            </CardContent>
          </Card>
        )}

      {canLoadRegionData && region && (
        <>
          {regionDialogOpen && (
            <RegionFormDialog
              open={regionDialogOpen}
              bankId={bankId}
              region={region}
              onOpenChange={setRegionDialogOpen}
              onSaved={(updatedRegion) => {
                if (!updatedRegion.isActive) navigate("/admin/regions");
              }}
            />
          )}

          <div className="grid gap-4 grid-cols-2 xl:grid-cols-4">
            {getSummaryCounts(regionSummary).map(({ label, value }) => (
              <Card key={label}>
                <CardContent className="p-4 sm:p-5">
                  <p className="text-sm text-muted-foreground">{label}</p>
                  {summaryQuery.isLoading ? (
                    <div
                      className="mt-2 h-9 w-16 animate-pulse rounded bg-muted"
                      role="status"
                      aria-label={`Loading ${label.toLowerCase()} count`}
                    />
                  ) : (
                    <p className="mt-2 text-2xl font-semibold tabular-nums">
                      {summaryQuery.isError ? "—" : value ?? "—"}
                    </p>
                  )}
                </CardContent>
              </Card>
            ))}
          </div>

          {(summaryQuery.isError ||
            (summaryQuery.isSuccess && !regionSummary)) && (
            <SectionError
              label="Region summary counts"
              error={
                summaryQuery.error ??
                new Error("The summary endpoint returned no record for this region.")
              }
              isFetching={summaryQuery.isFetching}
              onRetry={() => void summaryQuery.refetch()}
            />
          )}

          <nav
            aria-label="Region sections"
            className="sticky top-0 z-20 -mx-4 flex gap-2 overflow-x-auto border-b bg-background px-4 py-2 sm:-mx-6 sm:px-6"
          >
            {[
              ["Overview", "region-overview"],
              ["Districts", "region-districts-heading"],
              ["ATMs", "region-atms-heading"],
              ["Employees", "region-employees-heading"],
              ["Customers", "region-customers-heading"],
            ].map(([label, target]) => (
              <a
                key={target}
                href={`#${target}`}
                className="shrink-0 rounded-md px-3 py-2 text-sm font-medium text-muted-foreground hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {label}
              </a>
            ))}
          </nav>

          <section
            className="scroll-mt-16 space-y-3"
            aria-labelledby="region-districts-heading"
          >
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2
                id="region-districts-heading"
                className="scroll-mt-16 text-xl font-semibold"
              >
                Districts
              </h2>
              <span className="text-sm text-muted-foreground">
                {regionSummary?.counts.districts ?? "—"} total
              </span>
            </div>
            {districtsQuery.isLoading ? (
              <SectionLoading label="Districts" />
            ) : districtsQuery.isError ? (
              <SectionError
                label="Districts"
                error={districtsQuery.error}
                isFetching={districtsQuery.isFetching}
                onRetry={() => void districtsQuery.refetch()}
              />
            ) : (
              <Card>
                {districts.length === 0 ? (
                  <SectionEmpty>No districts belong to this region.</SectionEmpty>
                ) : (
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-[620px] text-sm">
                        <thead className="border-y bg-muted/40">
                          <tr>
                            <th className="px-4 py-3 text-left font-medium">
                              District
                            </th>
                            <th className="px-4 py-3 text-left font-medium">
                              PIN Code
                            </th>
                            <th className="px-4 py-3 text-left font-medium">
                              State
                            </th>
                            <th className="px-4 py-3 text-left font-medium">
                              Status
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {districts.map((district) => (
                            <tr
                              key={district._id}
                              className="border-b last:border-0"
                            >
                              <td className="px-4 py-3 font-medium">
                                <Link
                                  to={`/admin/districts/${district._id}`}
                                  className="text-primary underline-offset-4 hover:underline"
                                >
                                  {district.districtName}
                                </Link>
                              </td>
                              <td className="px-4 py-3 tabular-nums">
                                {district.pinCode}
                              </td>
                              <td className="px-4 py-3">{district.state}</td>
                              <td className="px-4 py-3">
                                <Badge
                                  variant={
                                    district.isActive ? "secondary" : "outline"
                                  }
                                >
                                  {district.isActive ? "Active" : "Inactive"}
                                </Badge>
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
          </section>

          <section
            className="scroll-mt-16 space-y-3"
            aria-labelledby="region-atms-heading"
          >
            <h2
              id="region-atms-heading"
              className="scroll-mt-16 text-xl font-semibold"
            >
              ATMs
            </h2>
            {atmsQuery.isLoading ? (
              <SectionLoading label="ATMs" />
            ) : atmsQuery.isError ? (
              <SectionError
                label="ATMs"
                error={atmsQuery.error}
                isFetching={atmsQuery.isFetching}
                onRetry={() => void atmsQuery.refetch()}
              />
            ) : (
              <Card>
                <CardHeader className="flex-row items-center justify-between">
                  <CardTitle>ATMs in this region</CardTitle>
                  <span className="text-sm text-muted-foreground">
                    {atmsQuery.data?.pagination.total ?? 0} total
                  </span>
                </CardHeader>
                {atms.length === 0 ? (
                  <SectionEmpty>No ATMs belong to this region.</SectionEmpty>
                ) : (
                  <>
                    <CardContent className="p-0">
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[760px] text-sm">
                          <thead className="border-y bg-muted/40">
                            <tr>
                              <th className="px-4 py-3 text-left font-medium">
                                ATM
                              </th>
                              <th className="px-4 py-3 text-left font-medium">
                                District
                              </th>
                              <th className="px-4 py-3 text-left font-medium">
                                Assigned employees
                              </th>
                              <th className="px-4 py-3 text-left font-medium">
                                Status
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {atms.map((atm) => {
                              const assignedEmployees = getATMEmployees(atm);
                              return (
                                <tr
                                  key={atm._id}
                                  className="border-b last:border-0"
                                >
                                  <td className="px-4 py-3">
                                    <Link
                                      to={`/admin/atms/${atm._id}`}
                                      className="font-medium text-primary underline-offset-4 hover:underline"
                                    >
                                      {getATMDisplayId(atm)}
                                    </Link>
                                    <p className="mt-1 text-xs text-muted-foreground">
                                      {atm.locationName ||
                                        "Location unavailable"}
                                    </p>
                                  </td>
                                  <td className="px-4 py-3">
                                    {atm.districtId ? (
                                      <Link
                                        to={`/admin/districts/${atm.districtId._id}`}
                                        className="text-primary underline-offset-4 hover:underline"
                                      >
                                        {atm.districtId.districtName}
                                      </Link>
                                    ) : (
                                      "Unavailable"
                                    )}
                                  </td>
                                  <td className="px-4 py-3">
                                    {assignedEmployees.length
                                      ? assignedEmployees
                                          .map(getATMEmployeeName)
                                          .join(", ")
                                      : "Not assigned"}
                                  </td>
                                  <td className="px-4 py-3">
                                    <Badge
                                      variant={getATMStatusVariant(atm.status)}
                                    >
                                      {atm.status.replaceAll("_", " ")}
                                    </Badge>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                    {getPagination(
                      atmsQuery.data?.pagination,
                      (page) => updatePage("atm", page),
                      atmsQuery.isFetching,
                    )}
                  </>
                )}
              </Card>
            )}
          </section>

          <section
            className="scroll-mt-16 space-y-3"
            aria-labelledby="region-employees-heading"
          >
            <h2
              id="region-employees-heading"
              className="scroll-mt-16 text-xl font-semibold"
            >
              Employees
            </h2>
            {employeesQuery.isLoading ? (
              <SectionLoading label="Employees" />
            ) : employeesQuery.isError ? (
              <SectionError
                label="Employees"
                error={employeesQuery.error}
                isFetching={employeesQuery.isFetching}
                onRetry={() => void employeesQuery.refetch()}
              />
            ) : (
              <Card>
                <CardHeader className="flex-row items-center justify-between">
                  <CardTitle>Employees assigned to region ATMs</CardTitle>
                  <span className="text-sm text-muted-foreground">
                    {employeesQuery.data?.pagination.total ?? 0} total
                  </span>
                </CardHeader>
                {employees.length === 0 ? (
                  <SectionEmpty>
                    No employees are assigned to ATMs in this region.
                  </SectionEmpty>
                ) : (
                  <>
                    <CardContent className="p-0">
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[660px] text-sm">
                          <thead className="border-y bg-muted/40">
                            <tr>
                              <th className="px-4 py-3 text-left font-medium">
                                Employee
                              </th>
                              <th className="px-4 py-3 text-left font-medium">
                                Code
                              </th>
                              <th className="px-4 py-3 text-left font-medium">
                                Status
                              </th>
                              <th className="px-4 py-3 text-right font-medium">
                                Linked ATMs
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {employees.map((employee) => (
                              <tr
                                key={employee._id}
                                className="border-b last:border-0"
                              >
                                <td className="px-4 py-3 font-medium">
                                  <Link
                                    to={`/admin/employees/${employee._id}`}
                                    className="text-primary underline-offset-4 hover:underline"
                                  >
                                    {getEmployeeName(employee)}
                                  </Link>
                                </td>
                                <td className="px-4 py-3 font-mono">
                                  {employee.employeeCode}
                                </td>
                                <td className="px-4 py-3">
                                  <Badge
                                    variant={getEntityStatusVariant(
                                      employee.status,
                                    )}
                                  >
                                    {employee.status.replaceAll("_", " ")}
                                  </Badge>
                                </td>
                                <td className="px-4 py-3 text-right tabular-nums">
                                  {employee.linkedATMCount}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                    {getPagination(
                      employeesQuery.data?.pagination,
                      (page) => updatePage("employee", page),
                      employeesQuery.isFetching,
                    )}
                  </>
                )}
              </Card>
            )}
          </section>

          <section
            className="scroll-mt-16 space-y-3"
            aria-labelledby="region-customers-heading"
          >
            <h2
              id="region-customers-heading"
              className="scroll-mt-16 text-xl font-semibold"
            >
              Customers
            </h2>
            {customersQuery.isLoading ? (
              <SectionLoading label="Customers" />
            ) : customersQuery.isError ? (
              <SectionError
                label="Customers"
                error={customersQuery.error}
                isFetching={customersQuery.isFetching}
                onRetry={() => void customersQuery.refetch()}
              />
            ) : (
              <Card>
                <CardHeader className="flex-row items-center justify-between">
                  <CardTitle>Customers linked to region ATMs</CardTitle>
                  <span className="text-sm text-muted-foreground">
                    {customersQuery.data?.pagination.total ?? 0} total
                  </span>
                </CardHeader>
                {customers.length === 0 ? (
                  <SectionEmpty>
                    No customers are linked to ATMs in this region.
                  </SectionEmpty>
                ) : (
                  <>
                    <CardContent className="p-0">
                      <div className="overflow-x-auto">
                        <table className="w-full min-w-[720px] text-sm">
                          <thead className="border-y bg-muted/40">
                            <tr>
                              <th className="px-4 py-3 text-left font-medium">
                                Customer
                              </th>
                              <th className="px-4 py-3 text-left font-medium">
                                Contact
                              </th>
                              <th className="px-4 py-3 text-left font-medium">
                                Status
                              </th>
                              <th className="px-4 py-3 text-right font-medium">
                                Linked ATMs
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {customers.map((customer: DistrictCustomer) => (
                              <tr
                                key={customer._id}
                                className="border-b last:border-0"
                              >
                                <td className="px-4 py-3 font-medium">
                                  <Link
                                    to={`/admin/customers/${customer._id}`}
                                    className="text-primary underline-offset-4 hover:underline"
                                  >
                                    {customer.customerName}
                                  </Link>
                                </td>
                                <td className="px-4 py-3">
                                  <p>{customer.customerEmail}</p>
                                  <p className="text-xs text-muted-foreground">
                                    {customer.customerPhone}
                                  </p>
                                </td>
                                <td className="px-4 py-3">
                                  <Badge
                                    variant={
                                      customer.isActive
                                        ? "secondary"
                                        : "outline"
                                    }
                                  >
                                    {customer.isActive ? "Active" : "Inactive"}
                                  </Badge>
                                </td>
                                <td className="px-4 py-3 text-right tabular-nums">
                                  {customer.linkedATMCount}
                                </td>
                              </tr>
                            ))}
                          </tbody>
                        </table>
                      </div>
                    </CardContent>
                    {getPagination(
                      customersQuery.data?.pagination,
                      (page) => updatePage("customer", page),
                      customersQuery.isFetching,
                    )}
                  </>
                )}
              </Card>
            )}
          </section>
        </>
      )}
    </div>
  );
}
