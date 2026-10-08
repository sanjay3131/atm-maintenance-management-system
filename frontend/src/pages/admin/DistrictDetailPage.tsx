import { useState } from "react";
import { isAxiosError } from "axios";
import {
  ArrowLeft,
  ChevronLeft,
  ChevronRight,
  Pencil,
  Plus,
  RefreshCw,
} from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useDistrictATMs } from "@/features/atms/hooks/useDistrictATMs";
import type { ATM } from "@/features/atms/types/atm.types";
import { useDistrictCustomers } from "@/features/customers/hooks/useDistrictCustomers";
import type { DistrictCustomer } from "@/features/customers/services/customer.service";
import { useDistrictEmployees } from "@/features/employees/hooks/useDistrictEmployees";
import type { DistrictEmployee } from "@/services/employee.service";
import { useDistrict } from "@/features/users/hooks/useDistrict";
import { useAllRegionsByDistrict } from "@/features/users/hooks/useAllRegionsByDistrict";
import RegionFormDialog from "@/features/users/components/RegionFormDialog";
import type { Region } from "@/features/users/services/region.service";

const PAGE_SIZE = 10;

function getErrorMessage(error: unknown) {
  if (isAxiosError<{ message?: string }>(error)) {
    return error.response?.data?.message || "The request could not be completed.";
  }
  return error instanceof Error
    ? error.message
    : "The request could not be completed.";
}

function formatATMStatus(status: string) {
  return status.replaceAll("_", " ");
}

function getATMEmployees(atm: ATM) {
  return (atm.assignedEmployeeId ?? []).filter(
    (employee): employee is DistrictEmployee =>
      employee !== null && typeof employee !== "string",
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
  pagination: { page: number; totalPages: number; total: number } | undefined,
  onPageChange: (page: number) => void,
  isFetching: boolean,
) {
  if (!pagination || pagination.totalPages <= 1) return null;
  return (
    <div className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
      <p className="text-sm text-muted-foreground">
        {pagination.total} total
      </p>
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
          disabled={
            pagination.page >= pagination.totalPages || isFetching
          }
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

export default function DistrictDetailPage() {
  const navigate = useNavigate();
  const { districtId = "" } = useParams<{ districtId: string }>();
  const [atmPage, setATMPage] = useState(1);
  const [employeePage, setEmployeePage] = useState(1);
  const [customerPage, setCustomerPage] = useState(1);
  const [regionDialogOpen, setRegionDialogOpen] = useState(false);
  const [selectedRegion, setSelectedRegion] = useState<Region | null>(null);

  const districtQuery = useDistrict(districtId);
  const regionsQuery = useAllRegionsByDistrict(districtId);
  const atmsQuery = useDistrictATMs(districtId, atmPage, PAGE_SIZE);
  const employeesQuery = useDistrictEmployees(
    districtId,
    employeePage,
    PAGE_SIZE,
  );
  const customersQuery = useDistrictCustomers(
    districtId,
    customerPage,
    PAGE_SIZE,
  );

  const atms = atmsQuery.data?.atms ?? [];
  const employees = employeesQuery.data?.employees ?? [];
  const customers = customersQuery.data?.customers ?? [];
  const regions = regionsQuery.data ?? [];

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <Button
        type="button"
        variant="ghost"
        className="-ml-3"
        onClick={() => navigate("/admin/districts")}
      >
        <ArrowLeft />
        Back to Districts
      </Button>

      {districtQuery.isLoading ? (
        <Card>
          <CardContent className="space-y-3 p-6" role="status">
            <div className="h-7 w-52 animate-pulse rounded bg-muted" />
            <div className="h-4 w-48 animate-pulse rounded bg-muted/70" />
            <p className="sr-only">Loading district details...</p>
          </CardContent>
        </Card>
      ) : districtQuery.isError ? (
        <SectionError
          label="District details"
          error={districtQuery.error}
          isFetching={districtQuery.isFetching}
          onRetry={() => void districtQuery.refetch()}
        />
      ) : districtQuery.data ? (
        <Card id="district-overview" className="scroll-mt-16">
          <CardContent className="flex flex-wrap items-start justify-between gap-4 p-5 sm:p-6">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-2xl font-bold">
                  {districtQuery.data.districtName} District
                </h1>
                <Badge
                  variant={
                    districtQuery.data.isActive ? "secondary" : "outline"
                  }
                >
                  {districtQuery.data.isActive ? "Active" : "Inactive"}
                </Badge>
              </div>
              <p className="mt-2 text-sm text-muted-foreground">
                {districtQuery.data.pinCode} • {districtQuery.data.state}
              </p>
            </div>
          </CardContent>
        </Card>
      ) : null}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          {
            label: "Regions",
            value: regionsQuery.data?.length,
            isLoading: regionsQuery.isLoading,
          },
          {
            label: "ATMs",
            value: atmsQuery.data?.summary.total,
            isLoading: atmsQuery.isLoading,
          },
          {
            label: "Employees",
            value: employeesQuery.data?.summary.total,
            isLoading: employeesQuery.isLoading,
          },
          {
            label: "Customers",
            value: customersQuery.data?.summary.total,
            isLoading: customersQuery.isLoading,
          },
        ].map(({ label, value, isLoading }) => (
          <Card key={label}>
            <CardContent className="p-5">
              <p className="text-sm text-muted-foreground">{label}</p>
              {isLoading ? (
                <div
                  className="mt-2 h-9 w-16 animate-pulse rounded bg-muted"
                  role="status"
                  aria-label={`Loading ${label.toLowerCase()} count`}
                />
              ) : (
                <p className="mt-2 text-3xl font-semibold">
                  {value ?? "—"}
                </p>
              )}
            </CardContent>
          </Card>
        ))}
      </div>

      <nav
        aria-label="District sections"
        className="sticky top-0 z-20 -mx-4 flex gap-2 overflow-x-auto border-b bg-background px-4 py-2 sm:-mx-6 sm:px-6"
      >
        {[
          ["Overview", "district-overview"],
          ["Regions", "district-regions-heading"],
          ["ATMs", "district-atms-heading"],
          ["Employees", "district-employees-heading"],
          ["Customers", "district-customers-heading"],
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
        aria-labelledby="district-regions-heading"
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h2
            id="district-regions-heading"
            className="scroll-mt-16 text-xl font-semibold"
          >
            Regions
          </h2>
          <Button
            type="button"
            onClick={() => {
              setSelectedRegion(null);
              setRegionDialogOpen(true);
            }}
            disabled={!districtId}
          >
            <Plus />
            Create Region
          </Button>
        </div>
        {regionsQuery.isLoading ? (
          <SectionLoading label="Regions" />
        ) : regionsQuery.isError ? (
          <SectionError
            label="Regions"
            error={regionsQuery.error}
            isFetching={regionsQuery.isFetching}
            onRetry={() => void regionsQuery.refetch()}
          />
        ) : (
          <Card>
            {regions.length === 0 ? (
              <SectionEmpty>No regions configured for this district.</SectionEmpty>
            ) : (
              <CardContent className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
                {regions.map((region) => (
                  <div
                    key={region._id}
                    className="flex flex-col justify-between gap-4 rounded-lg border p-4"
                  >
                    <div className="flex flex-wrap items-start justify-between gap-2">
                      <div>
                        <h3 className="font-medium">
                          <Link
                            className="rounded-sm underline-offset-4 hover:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                            to={`/admin/districts/${districtId}/regions/${region._id}`}
                          >
                            {region.name}
                          </Link>
                        </h3>
                        {region.code && (
                          <p className="mt-1 text-xs text-muted-foreground">
                            {region.code}
                          </p>
                        )}
                      </div>
                      <Badge
                        variant={region.isActive ? "secondary" : "outline"}
                      >
                        {region.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                    {region.description && (
                      <p className="mt-3 text-sm text-muted-foreground">
                        {region.description}
                      </p>
                    )}
                    <div className="flex justify-end gap-2">
                      <Link
                        className="inline-flex h-7 items-center justify-center rounded-lg border border-border bg-background px-2.5 text-[0.8rem] font-medium whitespace-nowrap hover:bg-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                        to={`/admin/districts/${districtId}/regions/${region._id}`}
                      >
                        Open
                      </Link>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setSelectedRegion(region);
                          setRegionDialogOpen(true);
                        }}
                      >
                        <Pencil />
                        Edit
                      </Button>
                    </div>
                  </div>
                ))}
              </CardContent>
            )}
          </Card>
        )}
      </section>

      <RegionFormDialog
        open={regionDialogOpen}
        districtId={districtId}
        region={selectedRegion}
        onOpenChange={setRegionDialogOpen}
      />

      <section
        className="scroll-mt-16 space-y-3"
        aria-labelledby="district-atms-heading"
      >
        <h2
          id="district-atms-heading"
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
              <CardTitle>District ATMs</CardTitle>
              <span className="text-sm text-muted-foreground">
                {atmsQuery.data?.pagination.total ?? 0} total
              </span>
            </CardHeader>
            {atms.length === 0 ? (
              <SectionEmpty>No ATMs found for this district.</SectionEmpty>
            ) : (
              <>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-160 text-sm">
                      <thead className="border-y bg-muted/40">
                        <tr>
                          <th className="px-4 py-3 text-left font-medium">
                            ATM
                          </th>
                          <th className="px-4 py-3 text-left font-medium">
                            Bank
                          </th>
                          <th className="px-4 py-3 text-left font-medium">
                            Region
                          </th>
                          <th className="px-4 py-3 text-left font-medium">
                            Assigned Employees
                          </th>
                          <th className="px-4 py-3 text-left font-medium">
                            Status
                          </th>
                        </tr>
                      </thead>
                      <tbody>
                        {atms.map((atm) => {
                          const employees = getATMEmployees(atm);
                          return (
                            <tr key={atm._id} className="border-b last:border-0">
                              <td className="px-4 py-3">
                                <p className="font-medium">{atm.atmId}</p>
                                <p className="text-xs text-muted-foreground">
                                  {atm.locationName || "Location unavailable"}
                                </p>
                              </td>
                              <td className="px-4 py-3">
                                {atm.bankId?.bankName || "Unavailable"}
                              </td>
                              <td className="px-4 py-3">
                                {atm.regionId?.name || "Not assigned"}
                              </td>
                              <td className="px-4 py-3">
                                {employees.length > 0
                                  ? employees
                                      .map(
                                        (employee) =>
                                          [
                                            employee.userId?.firstName,
                                            employee.userId?.lastName,
                                          ]
                                            .filter(Boolean)
                                            .join(" ") ||
                                          employee.employeeCode ||
                                          "Assigned employee",
                                      )
                                      .join(", ")
                                  : "Not assigned"}
                              </td>
                              <td className="px-4 py-3">
                                <Badge variant={getATMStatusVariant(atm.status)}>
                                  {formatATMStatus(atm.status)}
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
                  setATMPage,
                  atmsQuery.isFetching,
                )}
              </>
            )}
          </Card>
        )}
      </section>

      <section
        className="scroll-mt-16 space-y-3"
        aria-labelledby="district-employees-heading"
      >
        <h2
          id="district-employees-heading"
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
              <CardTitle>Employees Assigned to District ATMs</CardTitle>
              <span className="text-sm text-muted-foreground">
                {employeesQuery.data?.pagination.total ?? 0} total
              </span>
            </CardHeader>
            {employees.length === 0 ? (
              <SectionEmpty>
                No employees are assigned to ATMs in this district.
              </SectionEmpty>
            ) : (
              <>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-140 text-sm">
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
                              {getEmployeeName(employee)}
                            </td>
                            <td className="px-4 py-3 font-mono">
                              {employee.employeeCode}
                            </td>
                            <td className="px-4 py-3">
                              <Badge
                                variant={getEntityStatusVariant(employee.status)}
                              >
                                {employee.status.replaceAll("_", " ")}
                              </Badge>
                            </td>
                            <td className="px-4 py-3 text-right">
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
                  setEmployeePage,
                  employeesQuery.isFetching,
                )}
              </>
            )}
          </Card>
        )}
      </section>

      <section
        className="scroll-mt-16 space-y-3"
        aria-labelledby="district-customers-heading"
      >
        <h2
          id="district-customers-heading"
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
              <CardTitle>Customers Linked to District ATMs</CardTitle>
              <span className="text-sm text-muted-foreground">
                {customersQuery.data?.pagination.total ?? 0} total
              </span>
            </CardHeader>
            {customers.length === 0 ? (
              <SectionEmpty>
                No customers are linked to ATMs in this district.
              </SectionEmpty>
            ) : (
              <>
                <CardContent className="p-0">
                  <div className="overflow-x-auto">
                    <table className="w-full min-w-160 text-sm">
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
                              {customer.customerName}
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
                                  customer.isActive ? "secondary" : "outline"
                                }
                              >
                                {customer.isActive ? "Active" : "Inactive"}
                              </Badge>
                            </td>
                            <td className="px-4 py-3 text-right">
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
                  setCustomerPage,
                  customersQuery.isFetching,
                )}
              </>
            )}
          </Card>
        )}
      </section>
    </div>
  );
}
