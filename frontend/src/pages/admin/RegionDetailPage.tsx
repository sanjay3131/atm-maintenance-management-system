import { useState } from "react";
import { isAxiosError } from "axios";
import {
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
import { useRegionATMs } from "@/features/atms/hooks/useRegionATMs";
import type { ATM } from "@/features/atms/types/atm.types";
import { useRegionCustomers } from "@/features/customers/hooks/useRegionCustomers";
import type { DistrictCustomer } from "@/features/customers/services/customer.service";
import { useRegionEmployees } from "@/features/employees/hooks/useRegionEmployees";
import type { DistrictEmployee } from "@/services/employee.service";
import { useRegion } from "@/features/users/hooks/useRegion";
import type { Region } from "@/features/users/services/region.service";
import RegionFormDialog from "@/features/users/components/RegionFormDialog";

const PAGE_SIZE = 10;

function getErrorMessage(error: unknown) {
  if (isAxiosError<{ message?: string }>(error)) {
    return error.response?.data?.message || "The request could not be completed.";
  }
  return error instanceof Error
    ? error.message
    : "The request could not be completed.";
}

function getDistrictId(region: Region) {
  return typeof region.districtId === "string"
    ? region.districtId
    : region.districtId._id;
}

function getATMEmployee(atm: ATM) {
  return (atm.assignedEmployeeId ?? []).find(
    (employee) => employee && typeof employee !== "string",
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

export default function RegionDetailPage() {
  const navigate = useNavigate();
  const { districtId = "", regionId = "" } = useParams<{
    districtId: string;
    regionId: string;
  }>();
  const [atmPage, setATMPage] = useState(1);
  const [employeePage, setEmployeePage] = useState(1);
  const [customerPage, setCustomerPage] = useState(1);
  const [regionDialogOpen, setRegionDialogOpen] = useState(false);

  const regionQuery = useRegion(regionId);
  const regionMatchesDistrict =
    regionQuery.data !== undefined &&
    getDistrictId(regionQuery.data).toLowerCase() === districtId.toLowerCase();
  const scopedRegionId = regionMatchesDistrict ? regionId : "";

  const atmsQuery = useRegionATMs(scopedRegionId, atmPage, PAGE_SIZE);
  const employeesQuery = useRegionEmployees(
    scopedRegionId,
    employeePage,
    PAGE_SIZE,
  );
  const customersQuery = useRegionCustomers(
    scopedRegionId,
    customerPage,
    PAGE_SIZE,
  );

  const atms = atmsQuery.data?.atms ?? [];
  const employees = employeesQuery.data?.employees ?? [];
  const customers = customersQuery.data?.customers ?? [];

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <nav aria-label="Geographic hierarchy" className="text-sm">
        <ol className="flex flex-wrap items-center gap-2 text-muted-foreground">
          <li>
            <Link
              className="underline-offset-4 hover:text-foreground hover:underline"
              to="/admin/districts"
            >
              Districts
            </Link>
          </li>
          <li aria-hidden="true">›</li>
          <li>
            <Link
              className="underline-offset-4 hover:text-foreground hover:underline"
              to={
                regionQuery.data
                  ? `/admin/districts/${getDistrictId(regionQuery.data)}`
                  : `/admin/districts/${districtId}`
              }
            >
              {regionQuery.data &&
              typeof regionQuery.data.districtId !== "string"
                ? regionQuery.data.districtId.districtName
                : "District"}
            </Link>
          </li>
          <li aria-hidden="true">›</li>
          <li aria-current="page" className="text-foreground">
            {regionQuery.data?.name ?? "Region"}
          </li>
        </ol>
      </nav>

      {regionQuery.isLoading ? (
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
      ) : regionQuery.data ? (
        <Card>
          <CardContent className="flex flex-wrap items-start justify-between gap-4 p-5 sm:p-6">
            <div>
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-2xl font-bold">{regionQuery.data.name}</h1>
                <Badge
                  variant={regionQuery.data.isActive ? "secondary" : "outline"}
                >
                  {regionQuery.data.isActive ? "Active" : "Inactive"}
                </Badge>
              </div>
              <div className="mt-3 space-y-1 text-sm text-muted-foreground">
                {regionQuery.data.code && <p>Code: {regionQuery.data.code}</p>}
                {regionQuery.data.description && (
                  <p>Description: {regionQuery.data.description}</p>
                )}
              </div>
            </div>
            {regionMatchesDistrict && (
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

      {regionMatchesDistrict && regionQuery.data && (
        <RegionFormDialog
          open={regionDialogOpen}
          districtId={districtId}
          region={regionQuery.data}
          onOpenChange={setRegionDialogOpen}
          onSaved={(updatedRegion) => {
            if (!updatedRegion.isActive) {
              navigate(`/admin/districts/${districtId}`);
            }
          }}
        />
      )}

      {regionQuery.data && !regionMatchesDistrict ? (
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
      ) : regionMatchesDistrict ? (
        <>
          <div className="grid gap-4 sm:grid-cols-3">
            {[
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

          <section className="space-y-3" aria-labelledby="region-atms-heading">
            <h2 id="region-atms-heading" className="text-xl font-semibold">
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
                  <CardTitle>Region ATMs</CardTitle>
                  <span className="text-sm text-muted-foreground">
                    {atmsQuery.data?.pagination.total ?? 0} total
                  </span>
                </CardHeader>
                {atms.length === 0 ? (
                  <SectionEmpty>
                    No ATMs are assigned to this region yet.
                  </SectionEmpty>
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
                                Assigned Employee
                              </th>
                              <th className="px-4 py-3 text-left font-medium">
                                Status
                              </th>
                            </tr>
                          </thead>
                          <tbody>
                            {atms.map((atm) => {
                              const employee = getATMEmployee(atm);
                              const employeeName =
                                employee && typeof employee !== "string"
                                  ? [
                                      employee.userId?.firstName,
                                      employee.userId?.lastName,
                                    ]
                                      .filter(Boolean)
                                      .join(" ")
                                  : "";
                              return (
                                <tr
                                  key={atm._id}
                                  className="border-b last:border-0"
                                >
                                  <td className="px-4 py-3">
                                    <p className="font-medium">{atm.atmId}</p>
                                    <p className="text-xs text-muted-foreground">
                                      {atm.locationName ||
                                        "Location unavailable"}
                                    </p>
                                  </td>
                                  <td className="px-4 py-3">
                                    {atm.bankId?.bankName || "Unavailable"}
                                  </td>
                                  <td className="px-4 py-3">
                                    {employee
                                      ? employeeName || "Assigned employee"
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
                      setATMPage,
                      atmsQuery.isFetching,
                    )}
                  </>
                )}
              </Card>
            )}
          </section>

          <section
            className="space-y-3"
            aria-labelledby="region-employees-heading"
          >
            <h2 id="region-employees-heading" className="text-xl font-semibold">
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
                  <CardTitle>Employees Assigned to Region ATMs</CardTitle>
                  <span className="text-sm text-muted-foreground">
                    {employeesQuery.data?.pagination.total ?? 0} total
                  </span>
                </CardHeader>
                {employees.length === 0 ? (
                  <SectionEmpty>
                    No employees are currently associated with this region.
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
                                Assigned ATMs
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
                                    variant={getEntityStatusVariant(
                                      employee.status,
                                    )}
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
            className="space-y-3"
            aria-labelledby="region-customers-heading"
          >
            <h2 id="region-customers-heading" className="text-xl font-semibold">
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
                  <CardTitle>Customers Linked to Region ATMs</CardTitle>
                  <span className="text-sm text-muted-foreground">
                    {customersQuery.data?.pagination.total ?? 0} total
                  </span>
                </CardHeader>
                {customers.length === 0 ? (
                  <SectionEmpty>
                    No customers are currently associated with this region.
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
                                      customer.isActive
                                        ? "secondary"
                                        : "outline"
                                    }
                                  >
                                    {customer.isActive
                                      ? "Active"
                                      : "Inactive"}
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
        </>
      ) : null}
    </div>
  );
}
