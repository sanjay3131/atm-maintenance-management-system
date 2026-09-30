import { useATMs } from "@/features/atms/hooks/useATMs";
import ATMTable from "@/features/atms/components/ATMTable";
import CreateATMForm from "@/features/atms/components/CreateATMForm";
import { useDistricts } from "@/features/users/hooks/useDistricts";
import { useRegionsByDistrict } from "@/features/users/hooks/useRegionsByDistrict";
import { Button } from "@/components/ui/button";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useMemo, useState } from "react";

const ALL_FILTER_VALUE = "ALL";

type StatusFilter =
  | typeof ALL_FILTER_VALUE
  | "ACTIVE"
  | "INACTIVE"
  | "UNDER_MAINTENANCE"
  | "REMOVED";

export default function AtmsPage() {
  const {
    data: atms = [],
    isLoading,
    isError,
    refetch,
    isFetching,
  } = useATMs();
  const { data: districts = [], isLoading: isDistrictsLoading } =
    useDistricts();
  const [showCreateForm, setShowCreateForm] = useState(false);
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] =
    useState<StatusFilter>(ALL_FILTER_VALUE);
  const [districtFilter, setDistrictFilter] = useState(ALL_FILTER_VALUE);
  const [regionFilter, setRegionFilter] = useState(ALL_FILTER_VALUE);

  const { data: regions = [], isLoading: isRegionsLoading } =
    useRegionsByDistrict(
      districtFilter === ALL_FILTER_VALUE ? "" : districtFilter,
    );

  const filteredATMs = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();

    return atms.filter((atm) => {
      const matchesSearch = normalizedSearch
        ? [atm.atmId, atm.locationName, atm.address].some((value) =>
            value.toLowerCase().includes(normalizedSearch),
          )
        : true;
      const matchesStatus =
        statusFilter === ALL_FILTER_VALUE || atm.status === statusFilter;
      const matchesDistrict =
        districtFilter === ALL_FILTER_VALUE ||
        atm.districtId?._id === districtFilter;
      const matchesRegion =
        regionFilter === ALL_FILTER_VALUE || atm.regionId?._id === regionFilter;

      return matchesSearch && matchesStatus && matchesDistrict && matchesRegion;
    });
  }, [atms, districtFilter, regionFilter, search, statusFilter]);

  const hasActiveFilters =
    Boolean(search.trim()) ||
    statusFilter !== ALL_FILTER_VALUE ||
    districtFilter !== ALL_FILTER_VALUE ||
    regionFilter !== ALL_FILTER_VALUE;

  const clearFilters = () => {
    setSearch("");
    setStatusFilter(ALL_FILTER_VALUE);
    setDistrictFilter(ALL_FILTER_VALUE);
    setRegionFilter(ALL_FILTER_VALUE);
  };

  if (isLoading) {
    return (
      <div className="p-6" role="status">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="mt-6 h-40 animate-pulse rounded-lg border bg-muted/40" />
        <p className="mt-3 text-sm text-muted-foreground">Loading ATMs...</p>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="p-6">
        <h1 className="text-2xl font-bold">ATM Management</h1>
        <div className="mt-6 rounded-lg border border-destructive/30 bg-destructive/5 p-6">
          <p className="font-medium text-destructive">Failed to load ATMs.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            Please try again.
          </p>
          <Button
            type="button"
            variant="outline"
            className="mt-4"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            {isFetching ? "Retrying..." : "Retry"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">ATM Management</h1>
          <p className="mt-2 text-gray-500">
            Showing {filteredATMs.length} of {atms.length} ATMs
          </p>
        </div>
        <Button type="button" onClick={() => setShowCreateForm(true)}>
          Create ATM
        </Button>
      </div>

      <div className="mt-6 grid gap-4 rounded-lg border bg-card p-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="md:col-span-2 lg:col-span-1">
          <label
            htmlFor="atm-search"
            className="mb-2 block text-sm font-medium"
          >
            Search ATMs
          </label>
          <input
            id="atm-search"
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="ID, location, or address"
            className="h-8 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none transition-colors placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
          />
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium">Status</label>
          <Select
            value={statusFilter}
            onValueChange={(value) =>
              setStatusFilter(
                (value as StatusFilter | null) ?? ALL_FILTER_VALUE,
              )
            }
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="All statuses" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_FILTER_VALUE}>All</SelectItem>
              <SelectItem value="ACTIVE">ACTIVE</SelectItem>
              <SelectItem value="INACTIVE">INACTIVE</SelectItem>
              <SelectItem value="UNDER_MAINTENANCE">
                UNDER MAINTENANCE
              </SelectItem>
              <SelectItem value="REMOVED">REMOVED</SelectItem>
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium">District</label>
          <Select
            value={districtFilter}
            onValueChange={(value) => {
              setDistrictFilter(value ?? ALL_FILTER_VALUE);
              setRegionFilter(ALL_FILTER_VALUE);
            }}
            disabled={isDistrictsLoading}
          >
            <SelectTrigger className="w-full">
              <SelectValue placeholder="All districts">
                {districtFilter === ALL_FILTER_VALUE
                  ? "All"
                  : districts.find(
                      (district) => district._id === districtFilter,
                    )?.districtName}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_FILTER_VALUE}>All</SelectItem>
              {districts.map((district) => (
                <SelectItem key={district._id} value={district._id}>
                  {district.districtName}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div>
          <label className="mb-2 block text-sm font-medium">Region</label>
          <Select
            value={regionFilter}
            onValueChange={(value) =>
              setRegionFilter(value ?? ALL_FILTER_VALUE)
            }
            disabled={districtFilter === ALL_FILTER_VALUE || isRegionsLoading}
          >
            <SelectTrigger className="w-full">
              <SelectValue
                placeholder={
                  districtFilter === ALL_FILTER_VALUE
                    ? "Select district first"
                    : isRegionsLoading
                      ? "Loading regions..."
                      : "All regions"
                }
              >
                {regionFilter === ALL_FILTER_VALUE
                  ? "All"
                  : regions.find((region) => region._id === regionFilter)?.name}
              </SelectValue>
            </SelectTrigger>
            <SelectContent>
              <SelectItem value={ALL_FILTER_VALUE}>All</SelectItem>
              {regions.map((region) => (
                <SelectItem key={region._id} value={region._id}>
                  {region.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>

        <div className="flex items-end md:col-span-2 lg:col-span-4">
          <Button
            type="button"
            variant="outline"
            onClick={clearFilters}
            disabled={!hasActiveFilters}
          >
            Clear filters
          </Button>
        </div>
      </div>

      {showCreateForm && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4 backdrop-blur-sm">
          <div className="max-h-[90vh] w-full max-w-2xl overflow-y-auto rounded-xl bg-background p-6 shadow-xl scrollbar-width:none [&::-webkit-scrollbar]:hidden">
            {" "}
            <div className="sticky top-0 z-20 -mx-6 -mt-6 mb-6 flex items-center justify-between border-b bg-background px-6 py-4">
              {" "}
              <h2 className="text-xl font-semibold">Create ATM</h2>
              <button
                type="button"
                onClick={() => setShowCreateForm(false)}
                className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <CreateATMForm onClose={() => setShowCreateForm(false)} />
          </div>
        </div>
      )}
      <div className="mt-6">
        <ATMTable
          atms={filteredATMs}
          emptyMessage={
            atms.length === 0 ? "No ATMs found." : "No matching ATMs found."
          }
        />
      </div>
    </div>
  );
}
