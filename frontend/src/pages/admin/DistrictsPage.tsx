import { useMemo, useState } from "react";
import { isAxiosError } from "axios";
import { Building2, Pencil, Plus, RefreshCw } from "lucide-react";
import { Link } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import DistrictFormDialog from "@/features/users/components/DistrictFormDialog";
import { useDistrictGeographicSummaries } from "@/features/users/hooks/useDistrictGeographicSummaries";
import { useDistricts } from "@/features/users/hooks/useDistricts";
import type { District } from "@/features/users/types/district.types";

const ALL_DISTRICTS = "ALL";

function getErrorMessage(error: unknown) {
  if (isAxiosError<{ message?: string }>(error)) {
    return (
      error.response?.data?.message ||
      "The district request could not be completed."
    );
  }
  return error instanceof Error
    ? error.message
    : "The district request could not be completed.";
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "—"
    : date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
}

function DistrictTableSkeleton() {
  return (
    <Card>
      <CardContent className="space-y-3 p-4" role="status">
        {Array.from({ length: 5 }, (_, index) => (
          <div
            key={index}
            className="h-12 animate-pulse rounded bg-muted/50"
          />
        ))}
        <p className="sr-only">Loading districts...</p>
      </CardContent>
    </Card>
  );
}

export default function DistrictsPage() {
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState(ALL_DISTRICTS);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [districtToEdit, setDistrictToEdit] = useState<District | null>(null);
  const {
    data: districts = [],
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useDistricts();
  const geographicSummaryQuery = useDistrictGeographicSummaries();
  const geographicSummaries = useMemo(
    () =>
      new Map(
        (geographicSummaryQuery.data ?? []).map((summary) => [
          summary.districtId,
          summary,
        ]),
      ),
    [geographicSummaryQuery.data],
  );

  const filteredDistricts = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return districts.filter((district) => {
      const matchesSearch =
        !normalizedSearch ||
        [district.districtName, district.pinCode, district.state].some(
          (value) => value.toLowerCase().includes(normalizedSearch),
        );
      const matchesStatus =
        statusFilter === ALL_DISTRICTS ||
        (district.isActive ? "active" : "inactive") === statusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [districts, search, statusFilter]);

  const openCreateDialog = () => {
    setDistrictToEdit(null);
    setDialogOpen(true);
  };

  const openEditDialog = (district: District) => {
    setDistrictToEdit(district);
    setDialogOpen(true);
  };

  const closeFormDialog = (open: boolean) => {
    setDialogOpen(open);
    if (!open) setDistrictToEdit(null);
  };

  const hasFilters =
    Boolean(search.trim()) || statusFilter !== ALL_DISTRICTS;

  return (
    <div className="space-y-6 p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Districts</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Manage districts used by ATM locations.
          </p>
        </div>
        <Button type="button" onClick={openCreateDialog}>
          <Plus />
          Add District
        </Button>
      </div>

      <Card>
        <CardContent className="grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_12rem]">
          <div>
            <label
              htmlFor="district-search"
              className="mb-2 block text-sm font-medium"
            >
              Search districts
            </label>
            <input
              id="district-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="District name, PIN code, or state"
              className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>
          <div>
            <label
              htmlFor="district-status"
              className="mb-2 block text-sm font-medium"
            >
              Status
            </label>
            <Select
              value={statusFilter}
              onValueChange={(value) =>
                setStatusFilter(value ?? ALL_DISTRICTS)
              }
            >
              <SelectTrigger id="district-status" className="w-full">
                <SelectValue placeholder="All districts" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_DISTRICTS}>All districts</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {geographicSummaryQuery.isError && (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="text-sm text-destructive">
              Geographic counts could not be loaded.{" "}
              {getErrorMessage(geographicSummaryQuery.error)}
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={() => void geographicSummaryQuery.refetch()}
              disabled={geographicSummaryQuery.isFetching}
            >
              <RefreshCw
                className={
                  geographicSummaryQuery.isFetching ? "animate-spin" : ""
                }
              />
              {geographicSummaryQuery.isFetching
                ? "Retrying..."
                : "Retry counts"}
            </Button>
          </CardContent>
        </Card>
      )}

      {isLoading ? (
        <DistrictTableSkeleton />
      ) : isError ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-3 p-6">
            <div>
              <p className="font-medium text-destructive">
                Failed to load districts.
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {getErrorMessage(error)}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => void refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={isFetching ? "animate-spin" : ""} />
              {isFetching ? "Retrying..." : "Retry"}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>District List</CardTitle>
            <span className="text-sm text-muted-foreground">
              {filteredDistricts.length}{" "}
              {filteredDistricts.length === 1 ? "district" : "districts"}
            </span>
          </CardHeader>
          {filteredDistricts.length === 0 ? (
            <CardContent className="flex flex-col items-center px-6 py-14 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Building2 className="size-6" />
              </div>
              <h2 className="mt-4 text-lg font-semibold">
                {hasFilters ? "No matching districts." : "No districts yet."}
              </h2>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                {hasFilters
                  ? "Try changing the search term or status filter."
                  : "Add a district to make it available for ATM records."}
              </p>
            </CardContent>
          ) : (
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-260 text-sm">
                  <thead className="border-y bg-muted/40">
                    <tr>
                      <th className="px-4 py-3 text-left font-medium">
                        District
                      </th>
                      <th className="px-4 py-3 text-left font-medium">
                        PIN Code
                      </th>
                      <th className="px-4 py-3 text-left font-medium">State</th>
                      <th className="px-4 py-3 text-left font-medium">
                        Status
                      </th>
                      <th className="px-4 py-3 text-left font-medium">
                        Active Regions
                      </th>
                      <th className="px-4 py-3 text-right font-medium">
                        ATMs
                      </th>
                      <th className="px-4 py-3 text-right font-medium">
                        Employees
                      </th>
                      <th className="px-4 py-3 text-right font-medium">
                        Customers
                      </th>
                      <th className="px-4 py-3 text-left font-medium">
                        Created
                      </th>
                      <th className="px-4 py-3 text-right font-medium">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {filteredDistricts.map((district) => (
                      <tr key={district._id} className="border-b last:border-0">
                        <td className="px-4 py-3 font-medium">
                          <Link
                            to={`/admin/districts/${district._id}`}
                            className="text-primary underline-offset-4 hover:underline"
                          >
                            {district.districtName}
                          </Link>
                        </td>
                        <td className="px-4 py-3 font-mono">
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
                        <td className="px-4 py-3">
                          {geographicSummaryQuery.isLoading
                            ? "Loading..."
                            : geographicSummaryQuery.isError
                              ? "Unavailable"
                              : `${geographicSummaries.get(district._id)?.regions ?? 0} active`}
                        </td>
                        {(["atms", "employees", "customers"] as const).map(
                          (key) => (
                            <td
                              key={key}
                              className="px-4 py-3 text-right tabular-nums"
                            >
                              {geographicSummaryQuery.isLoading
                                ? "—"
                                : geographicSummaryQuery.isError
                                  ? "Unavailable"
                                  : (geographicSummaries.get(district._id)?.[
                                      key
                                    ] ?? 0)}
                            </td>
                          ),
                        )}
                        <td className="whitespace-nowrap px-4 py-3">
                          {formatDate(district.createdAt)}
                        </td>
                        <td className="px-4 py-3 text-right">
                          <Button
                            type="button"
                            size="sm"
                            variant="outline"
                            onClick={() => openEditDialog(district)}
                          >
                            <Pencil />
                            Edit
                          </Button>
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

      <DistrictFormDialog
        open={dialogOpen}
        district={districtToEdit}
        onOpenChange={closeFormDialog}
      />
    </div>
  );
}
