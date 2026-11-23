import { useEffect, useMemo, useState } from "react";
import { isAxiosError } from "axios";
import { Building2, Pencil, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
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
import { useBanks } from "@/features/banks/hooks/useBanks";
import RegionFormDialog from "@/features/users/components/RegionFormDialog";
import { useRegionSummaries } from "@/features/users/hooks/useRegionSummaries";
import { useUpdateRegion } from "@/features/users/hooks/useRegionMutations";
import type {
  Region,
  RegionSummary,
  RegionSummaryParams,
} from "@/features/users/services/region.service";

const ALL = "ALL";
type StatusFilter = typeof ALL | "active" | "inactive";

function getErrorMessage(error: unknown) {
  if (isAxiosError<{ message?: string }>(error)) {
    return error.response?.data?.message ?? "The region request could not be completed.";
  }
  return error instanceof Error
    ? error.message
    : "The region request could not be completed.";
}

function RegionTableSkeleton() {
  return (
    <Card>
      <CardContent className="space-y-3 p-4" role="status">
        {Array.from({ length: 5 }, (_, index) => (
          <div
            key={index}
            className="h-12 animate-pulse rounded bg-muted/50"
          />
        ))}
        <p className="sr-only">Loading regions...</p>
      </CardContent>
    </Card>
  );
}

function getRegionForEdit(region: RegionSummary): Region {
  return {
    _id: region.regionId,
    name: region.name,
    code: region.code ?? undefined,
    description: region.description,
    isActive: region.isActive,
    bankId: region.bank?.id ?? "",
  };
}

export default function RegionsPage() {
  const [search, setSearch] = useState("");
  const [debouncedSearch, setDebouncedSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState<StatusFilter>(ALL);
  const [bankId, setBankId] = useState(ALL);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedRegion, setSelectedRegion] = useState<Region | null>(null);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedSearch(search.trim());
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [search]);

  const {
    data: banks = [],
    isLoading: banksLoading,
    isError: banksError,
    error: banksQueryError,
    refetch: refetchBanks,
    isFetching: banksFetching,
  } = useBanks();
  const selectedBank = banks.find((bank) => bank._id === bankId);
  const updateRegion = useUpdateRegion(
    bankId === ALL ? "" : bankId,
  );

  const summaryParams = useMemo<RegionSummaryParams>(
    () => ({
      ...(debouncedSearch ? { search: debouncedSearch } : {}),
      ...(statusFilter !== ALL
        ? { status: statusFilter }
        : {}),
      ...(bankId !== ALL ? { bankId } : {}),
    }),
    [bankId, debouncedSearch, statusFilter],
  );
  const regionsQuery = useRegionSummaries(summaryParams);
  const regions = regionsQuery.data ?? [];
  const hasFilters =
    Boolean(search.trim()) || statusFilter !== ALL || bankId !== ALL;

  const clearFilters = () => {
    setSearch("");
    setDebouncedSearch("");
    setStatusFilter(ALL);
    setBankId(ALL);
  };

  const openCreate = () => {
    setSelectedRegion(null);
    setDialogOpen(true);
  };

  const openEdit = (region: RegionSummary) => {
    setSelectedRegion(getRegionForEdit(region));
    setDialogOpen(true);
  };

  const closeFormDialog = (open: boolean) => {
    setDialogOpen(open);
    if (!open) setSelectedRegion(null);
  };

  const toggleActive = async (region: RegionSummary) => {
    try {
      await updateRegion.mutateAsync({
        regionId: region.regionId,
        data: { isActive: !region.isActive },
      });
      toast.success(`Region ${region.isActive ? "deactivated" : "activated"}.`);
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Regions</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Manage regions across banks and review their geographic coverage.
          </p>
        </div>
        <Button
          type="button"
          onClick={openCreate}
          disabled={!selectedBank?.isActive}
          title={
            selectedBank?.isActive
              ? "Add a region to this bank"
              : "Select an active bank to add a region"
          }
        >
          <Plus />
          Add Region
        </Button>
      </header>

      <Card>
        <CardContent className="grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_12rem_16rem]">
          <div>
            <label
              htmlFor="region-search"
              className="mb-2 block text-sm font-medium"
            >
              Search regions
            </label>
            <input
              id="region-search"
              type="search"
              value={search}
              onChange={(event) => setSearch(event.target.value)}
              placeholder="Region name or code"
              className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
          </div>
          <div>
            <label
              htmlFor="region-status"
              className="mb-2 block text-sm font-medium"
            >
              Status
            </label>
            <Select
              value={statusFilter}
              onValueChange={(value) => setStatusFilter(value ?? ALL)}
            >
              <SelectTrigger id="region-status" className="w-full">
                <SelectValue placeholder="All regions" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All regions</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div>
            <label
              htmlFor="region-bank"
              className="mb-2 block text-sm font-medium"
            >
              Bank
            </label>
            <Select
              value={bankId}
              onValueChange={(value) => setBankId(value ?? ALL)}
              disabled={banksLoading || banksError}
            >
              <SelectTrigger id="region-bank" className="w-full">
                <SelectValue
                  placeholder={banksLoading ? "Loading banks..." : "All banks"}
                />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL}>All banks</SelectItem>
                {banks.map((bank) => (
                  <SelectItem key={bank._id} value={bank._id}>
                    {bank.bankName} ({bank.bankCode})
                    {bank.isActive ? "" : " — inactive"}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {banksError && (
        <Card>
          <CardContent className="flex flex-wrap items-center justify-between gap-3 p-4">
            <p className="text-sm text-destructive">
              Banks could not be loaded. {getErrorMessage(banksQueryError)}
            </p>
            <Button
              type="button"
              variant="outline"
              onClick={() => void refetchBanks()}
              disabled={banksFetching}
            >
              <RefreshCw className={banksFetching ? "animate-spin" : ""} />
              {banksFetching ? "Retrying..." : "Retry banks"}
            </Button>
          </CardContent>
        </Card>
      )}

      {regionsQuery.isLoading ? (
        <RegionTableSkeleton />
      ) : regionsQuery.isError ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-3 p-6">
            <div>
              <p className="font-medium text-destructive">
                Failed to load regions.
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {getErrorMessage(regionsQuery.error)}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => void regionsQuery.refetch()}
              disabled={regionsQuery.isFetching}
            >
              <RefreshCw
                className={regionsQuery.isFetching ? "animate-spin" : ""}
              />
              {regionsQuery.isFetching ? "Retrying..." : "Retry"}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="flex-row items-center justify-between gap-3">
            <CardTitle>Region List</CardTitle>
            <div className="flex items-center gap-3">
              {regionsQuery.isFetching && (
                <span className="text-sm text-muted-foreground" role="status">
                  Updating...
                </span>
              )}
              <span className="text-sm text-muted-foreground">
                {regions.length} {regions.length === 1 ? "region" : "regions"}
              </span>
            </div>
          </CardHeader>
          {regions.length === 0 ? (
            <CardContent className="flex flex-col items-center px-6 py-14 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Building2 className="size-6" />
              </div>
              <h2 className="mt-4 text-lg font-semibold">
                {hasFilters ? "No matching regions." : "No regions yet."}
              </h2>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                {hasFilters
                  ? "Try changing the search term or filters."
                  : "Select an active bank to add its first region."}
              </p>
              {hasFilters && (
                <Button
                  type="button"
                  variant="outline"
                  className="mt-4"
                  onClick={clearFilters}
                >
                  Clear filters
                </Button>
              )}
            </CardContent>
          ) : (
            <>
              <CardContent className="hidden p-0 sm:block">
                <div className="overflow-x-auto">
                  <table className="w-full min-w-[880px] text-sm">
                    <thead className="border-y bg-muted/40">
                      <tr>
                        <th className="px-4 py-3 text-left font-medium">
                          Region
                        </th>
                        <th className="px-4 py-3 text-left font-medium">
                          Bank
                        </th>
                        <th className="px-4 py-3 text-right font-medium">
                          Districts
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
                          Status
                        </th>
                        <th className="px-4 py-3 text-right font-medium">
                          Actions
                        </th>
                      </tr>
                    </thead>
                    <tbody>
                      {regions.map((region) => (
                        <tr
                          key={region.regionId}
                          className="border-b last:border-0"
                        >
                          <td className="px-4 py-3">
                            <Link
                              to={`/admin/regions/${region.regionId}`}
                              className="font-medium text-primary underline-offset-4 hover:underline"
                            >
                              {region.name}
                            </Link>
                            <p className="mt-1 text-xs text-muted-foreground">
                              {region.code || "No code"}
                            </p>
                          </td>
                          <td className="px-4 py-3">
                            {region.bank?.name ?? "Unmapped"}
                            {region.bank?.code && (
                              <p className="mt-1 text-xs text-muted-foreground">
                                {region.bank.code}
                              </p>
                            )}
                          </td>
                          {(
                            [
                              ["districts", region.counts.districts],
                              ["atms", region.counts.atms],
                              ["employees", region.counts.employees],
                              ["customers", region.counts.customers],
                            ] as const
                          ).map(([key, count]) => (
                            <td
                              key={key}
                              className="px-4 py-3 text-right tabular-nums"
                            >
                              {count}
                            </td>
                          ))}
                          <td className="px-4 py-3">
                            <Badge
                              variant={region.isActive ? "secondary" : "outline"}
                            >
                              {region.isActive ? "Active" : "Inactive"}
                            </Badge>
                          </td>
                          <td className="px-4 py-3 text-right">
                            <div className="flex justify-end gap-2">
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                onClick={() => openEdit(region)}
                              >
                                <Pencil />
                                Edit
                              </Button>
                              <Button
                                type="button"
                                size="sm"
                                variant="outline"
                                disabled={updateRegion.isPending}
                                onClick={() => void toggleActive(region)}
                              >
                                {region.isActive ? "Deactivate" : "Activate"}
                              </Button>
                            </div>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </CardContent>
              <CardContent className="space-y-3 p-4 sm:hidden">
                {regions.map((region) => (
                  <article
                    key={region.regionId}
                    className="space-y-3 rounded-lg border p-4"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="min-w-0">
                        <Link
                          to={`/admin/regions/${region.regionId}`}
                          className="font-medium text-primary underline-offset-4 hover:underline"
                        >
                          {region.name}
                        </Link>
                        <p className="mt-1 text-sm text-muted-foreground">
                          {region.code || "No code"}
                        </p>
                      </div>
                      <Badge
                        variant={region.isActive ? "secondary" : "outline"}
                      >
                        {region.isActive ? "Active" : "Inactive"}
                      </Badge>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      Bank: {region.bank?.name ?? "Unmapped"}
                      {region.bank?.code ? ` (${region.bank.code})` : ""}
                    </p>
                    <dl className="grid grid-cols-2 gap-x-4 gap-y-2 text-sm">
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">Districts</dt>
                        <dd className="tabular-nums">{region.counts.districts}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">ATMs</dt>
                        <dd className="tabular-nums">{region.counts.atms}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">Employees</dt>
                        <dd className="tabular-nums">{region.counts.employees}</dd>
                      </div>
                      <div className="flex justify-between gap-2">
                        <dt className="text-muted-foreground">Customers</dt>
                        <dd className="tabular-nums">{region.counts.customers}</dd>
                      </div>
                    </dl>
                    <div className="flex flex-wrap justify-end gap-2">
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => openEdit(region)}
                      >
                        <Pencil />
                        Edit
                      </Button>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        disabled={updateRegion.isPending}
                        onClick={() => void toggleActive(region)}
                      >
                        {region.isActive ? "Deactivate" : "Activate"}
                      </Button>
                    </div>
                  </article>
                ))}
              </CardContent>
            </>
          )}
        </Card>
      )}

      <RegionFormDialog
        open={dialogOpen}
        bankId={
          selectedRegion
            ? typeof selectedRegion.bankId === "string"
              ? selectedRegion.bankId
              : selectedRegion.bankId._id
            : bankId === ALL
              ? ""
              : bankId
        }
        region={selectedRegion}
        onOpenChange={closeFormDialog}
      />
    </div>
  );
}
