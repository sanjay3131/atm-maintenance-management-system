import { useEffect, useMemo, useState } from "react";
import { isAxiosError } from "axios";
import {
  ArrowLeft,
  Building2,
  ChevronLeft,
  ChevronRight,
  Eye,
  MapPin,
  Pencil,
  RefreshCw,
} from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import BankFormDialog from "@/features/banks/components/BankFormDialog";
import { useBank } from "@/features/banks/hooks/useBank";
import { useCustomers } from "@/features/customers/hooks/useCustomers";
import type { Customer } from "@/features/customers/services/customer.service";
import { useEmployees } from "@/features/employees/hooks/useEmployees";
import type { Employee } from "@/services/employee.service";
import { useJobs } from "@/features/jobs/hooks/useJobs";
import type {
  Job,
  JobATM,
  JobStatus,
  JobWorkType,
} from "@/features/jobs/types/job.types";
import { useATMs } from "@/features/atms/hooks/useATMs";
import type {
  ATM,
  ATMEmployee,
  ATMStatus,
} from "@/features/atms/types/atm.types";

const ALL = "ALL";

type BankTab =
  | "overview"
  | "atms"
  | "districts"
  | "customers"
  | "employees"
  | "jobs";

type JobPriority = "low" | "medium" | "high" | "critical";

const JOB_PAGE_SIZE = 10;
const JOB_STATUSES: JobStatus[] = [
  "PENDING",
  "ASSIGNED",
  "ACCEPTED",
  "IN_PROGRESS",
  "ON_HOLD",
  "COMPLETED",
  "VERIFIED",
  "APPROVED",
  "CLOSED",
  "REJECTED",
];
const JOB_WORK_TYPES: JobWorkType[] = [
  "repair",
  "maintenance",
  "installation",
  "inspection",
  "emergency",
];
const JOB_PRIORITIES: JobPriority[] = ["low", "medium", "high", "critical"];

interface BankCustomerGroup {
  id: string;
  customer?: Customer;
  atms: ATM[];
}

interface BankEmployeeGroup {
  id: string;
  employee?: Employee;
  atms: ATM[];
}

interface DistrictGroup {
  id: string;
  name: string;
  atms: ATM[];
  regions: Map<string, { id: string; name: string; atms: ATM[] }>;
}

function getErrorMessage(error: unknown) {
  if (isAxiosError<{ message?: string }>(error)) {
    return error.response?.data?.message || "The request could not be completed.";
  }
  if (error && typeof error === "object") {
    const apiError = error as {
      message?: string;
      status?: number;
      response?: {
        data?: { message?: string };
        status?: number;
      };
    };
    if (apiError.response?.data?.message) {
      return apiError.response.data.message;
    }
    if (apiError.message) return apiError.message;
  }
  if (typeof error === "string" && error.trim()) return error;
  return error instanceof Error
    ? error.message
    : "The request could not be completed.";
}

function isBankNotFoundError(error: unknown) {
  if (isAxiosError(error)) {
    return error.response?.status === 404 || error.status === 404;
  }
  if (error && typeof error === "object") {
    const apiError = error as {
      message?: string;
      status?: number;
      response?: { status?: number };
    };
    return (
      apiError.response?.status === 404 ||
      apiError.status === 404 ||
      /\b404\b|bank not found/i.test(apiError.message ?? "")
    );
  }
  return typeof error === "string" && /\b404\b|bank not found/i.test(error);
}

function getRelationshipId(
  value: { _id: string } | string | null | undefined,
) {
  return typeof value === "string" ? value : value?._id;
}

function getBankId(atm: ATM) {
  return getRelationshipId(atm.bankId);
}

function getDistrictId(atm: ATM) {
  return getRelationshipId(atm.districtId);
}

function getDistrictName(atm: ATM) {
  return typeof atm.districtId === "object" && atm.districtId
    ? atm.districtId.districtName
    : "District unavailable";
}

function getRegionId(atm: ATM) {
  return getRelationshipId(atm.regionId);
}

function getRegionName(atm: ATM) {
  return typeof atm.regionId === "object" && atm.regionId
    ? atm.regionId.name
    : "Region not assigned";
}

function getEmployeeLabel(atm: ATM) {
  const assignedEmployees = (atm.assignedEmployeeId ?? []).filter(
    (employee): employee is string | ATMEmployee => employee !== null,
  );
  if (assignedEmployees.length === 0) return "Not assigned";

  return assignedEmployees
    .map((employee) => {
      if (typeof employee === "string") return "Assigned employee";
      const name = [employee.userId?.firstName, employee.userId?.lastName]
        .filter(Boolean)
        .join(" ");
      return `${employee.employeeCode || "Employee"}${name ? ` — ${name}` : ""}`;
    })
    .join(", ");
}

function getCustomerId(atm: ATM) {
  return getRelationshipId(atm.customer);
}

function getAssignedEmployeeIds(atm: ATM) {
  return [
    ...new Set(
      (atm.assignedEmployeeId ?? [])
        .map((employee) => getRelationshipId(employee))
        .filter((id): id is string => Boolean(id)),
    ),
  ];
}

function getEmployeeName(employee: Employee) {
  return [employee.userId?.firstName, employee.userId?.lastName]
    .filter(Boolean)
    .join(" ") || "Name unavailable";
}

function formatEmployeeStatus(status: string) {
  return status === "on_leave"
    ? "On Leave"
    : status.charAt(0).toUpperCase() + status.slice(1);
}

function getEmployeeStatusVariant(status: string) {
  if (status === "active") return "secondary" as const;
  if (status === "resigned") return "destructive" as const;
  return "outline" as const;
}

function formatStatus(status: ATMStatus) {
  return status.replaceAll("_", " ");
}

function getStatusVariant(status: ATMStatus) {
  if (status === "ACTIVE") return "default" as const;
  if (status === "REMOVED") return "destructive" as const;
  return "secondary" as const;
}

function getJobATM(job: Job): JobATM | null {
  return typeof job.atmId === "object" ? job.atmId : null;
}

function getJobATMId(job: Job) {
  return typeof job.atmId === "string" ? job.atmId : job.atmId?._id;
}

function getJobEmployeeName(job: Job) {
  if (!job.assignedEmployeeId) return "Unassigned";
  if (typeof job.assignedEmployeeId === "string") return "Unknown Employee";
  const name = [
    job.assignedEmployeeId.firstName,
    job.assignedEmployeeId.lastName,
  ]
    .filter(Boolean)
    .join(" ");
  return name || "Unknown Employee";
}

function formatJobLabel(value: string) {
  return value
    .toLowerCase()
    .split("_")
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatJobDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Not available"
    : date.toLocaleDateString(undefined, {
        year: "numeric",
        month: "short",
        day: "numeric",
      });
}

function getJobStatusVariant(status: JobStatus) {
  if (status === "REJECTED") return "destructive" as const;
  if (status === "PENDING" || status === "ON_HOLD") return "secondary" as const;
  if (status === "CLOSED") return "outline" as const;
  return "default" as const;
}

function getJobPriorityVariant(priority: JobPriority) {
  if (priority === "critical" || priority === "high") {
    return "destructive" as const;
  }
  if (priority === "low") return "secondary" as const;
  return "outline" as const;
}

function getJobStatusCount(
  counts: Partial<Record<JobStatus, number>> | undefined,
  status: JobStatus,
) {
  return counts?.[status] ?? 0;
}

function groupByDistrict(atms: ATM[]) {
  const groups = new Map<string, DistrictGroup>();
  for (const atm of atms) {
    const districtId = getDistrictId(atm);
    if (!districtId) continue;
    let district = groups.get(districtId);
    if (!district) {
      district = {
        id: districtId,
        name: getDistrictName(atm),
        atms: [],
        regions: new Map(),
      };
      groups.set(districtId, district);
    }
    district.atms.push(atm);

    const regionId = getRegionId(atm) ?? "unassigned-region";
    let region = district.regions.get(regionId);
    if (!region) {
      region = {
        id: regionId,
        name: getRegionName(atm),
        atms: [],
      };
      district.regions.set(regionId, region);
    }
    region.atms.push(atm);
  }
  return [...groups.values()].sort((a, b) => a.name.localeCompare(b.name));
}

function BankDetailSkeleton() {
  return (
    <div className="space-y-6 p-6" role="status">
      <div className="h-8 w-56 animate-pulse rounded bg-muted" />
      <div className="h-36 animate-pulse rounded-lg border bg-muted/40" />
      <div className="h-12 animate-pulse rounded-lg bg-muted/40" />
      <div className="h-72 animate-pulse rounded-lg border bg-muted/40" />
      <p className="text-sm text-muted-foreground">Loading bank workspace...</p>
    </div>
  );
}

function ATMTableSkeleton() {
  return (
    <Card>
      <CardContent className="space-y-3 p-4" role="status">
        {Array.from({ length: 5 }, (_, index) => (
          <div
            key={index}
            className="h-12 animate-pulse rounded bg-muted/50"
          />
        ))}
        <p className="sr-only">Loading ATMs...</p>
      </CardContent>
    </Card>
  );
}

function ATMRows({
  atms,
  emptyMessage,
}: {
  atms: ATM[];
  emptyMessage: string;
}) {
  const navigate = useNavigate();

  if (atms.length === 0) {
    return (
      <div className="px-4 py-8 text-center text-sm text-muted-foreground">
        {emptyMessage}
      </div>
    );
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full min-w-190 text-sm">
        <thead className="border-y bg-muted/40">
          <tr>
            <th className="px-4 py-3 text-left font-medium">ATM ID</th>
            <th className="px-4 py-3 text-left font-medium">Location</th>
            <th className="px-4 py-3 text-left font-medium">District</th>
            <th className="px-4 py-3 text-left font-medium">Region</th>
            <th className="px-4 py-3 text-left font-medium">
              Assigned Employee
            </th>
            <th className="px-4 py-3 text-left font-medium">Status</th>
            <th className="px-4 py-3 text-right font-medium">Actions</th>
          </tr>
        </thead>
        <tbody>
          {atms.map((atm) => (
            <tr key={atm._id} className="border-b last:border-0">
              <td className="px-4 py-3 font-medium">{atm.atmId || "—"}</td>
              <td className="px-4 py-3">
                <p>{atm.locationName || "Location unavailable"}</p>
                <p className="text-xs text-muted-foreground">
                  {atm.address || "Address unavailable"}
                </p>
              </td>
              <td className="px-4 py-3">{getDistrictName(atm)}</td>
              <td className="px-4 py-3">{getRegionName(atm)}</td>
              <td className="px-4 py-3">{getEmployeeLabel(atm)}</td>
              <td className="px-4 py-3">
                <Badge variant={getStatusVariant(atm.status)}>
                  {formatStatus(atm.status)}
                </Badge>
              </td>
              <td className="px-4 py-3 text-right">
                <Button
                  type="button"
                  size="sm"
                  variant="outline"
                  onClick={() => navigate(`/admin/atms/${atm._id}`)}
                >
                  View
                </Button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export default function BankDetailPage() {
  const navigate = useNavigate();
  const { bankId = "" } = useParams<{ bankId: string }>();
  const [activeTab, setActiveTab] = useState<BankTab>("overview");
  const [editDialogOpen, setEditDialogOpen] = useState(false);
  const [selectedCustomer, setSelectedCustomer] =
    useState<BankCustomerGroup | null>(null);
  const [selectedEmployee, setSelectedEmployee] =
    useState<BankEmployeeGroup | null>(null);
  const [search, setSearch] = useState("");
  const [customerSearch, setCustomerSearch] = useState("");
  const [customerStatusFilter, setCustomerStatusFilter] = useState(ALL);
  const [employeeSearch, setEmployeeSearch] = useState("");
  const [employeeStatusFilter, setEmployeeStatusFilter] = useState(ALL);
  const [jobSearch, setJobSearch] = useState("");
  const [debouncedJobSearch, setDebouncedJobSearch] = useState("");
  const [jobStatusFilter, setJobStatusFilter] =
    useState<JobStatus | typeof ALL>(ALL);
  const [jobWorkTypeFilter, setJobWorkTypeFilter] =
    useState<JobWorkType | typeof ALL>(ALL);
  const [jobPriorityFilter, setJobPriorityFilter] =
    useState<JobPriority | typeof ALL>(ALL);
  const [jobDistrictFilter, setJobDistrictFilter] = useState(ALL);
  const [jobRegionFilter, setJobRegionFilter] = useState(ALL);
  const [jobPage, setJobPage] = useState(1);
  const [statusFilter, setStatusFilter] = useState(ALL);
  const [districtFilter, setDistrictFilter] = useState(ALL);
  const [regionFilter, setRegionFilter] = useState(ALL);
  const {
    data: bank,
    isLoading: bankLoading,
    isError: bankError,
    error: bankLoadError,
    refetch: refetchBank,
    isFetching: bankFetching,
  } = useBank(bankId);
  const {
    data: allATMs = [],
    isLoading: atmsLoading,
    isError: atmsError,
    error: atmsLoadError,
    refetch: refetchATMs,
    isFetching: atmsFetching,
  } = useATMs();
  const {
    data: customers = [],
    isLoading: customersLoading,
    isError: customersError,
    error: customersLoadError,
    refetch: refetchCustomers,
    isFetching: customersFetching,
  } = useCustomers(activeTab === "customers");
  const {
    data: employees = [],
    isLoading: employeesLoading,
    isError: employeesError,
    error: employeesLoadError,
    refetch: refetchEmployees,
    isFetching: employeesFetching,
  } = useEmployees(activeTab === "employees");

  const bankATMs = useMemo(
    () => allATMs.filter((atm) => getBankId(atm) === bankId),
    [allATMs, bankId],
  );
  const districtGroups = useMemo(() => groupByDistrict(bankATMs), [bankATMs]);
  const customerGroups = useMemo(() => {
    const customersById = new Map(
      customers.map((customer) => [customer._id, customer]),
    );
    const groups = new Map<string, BankCustomerGroup>();

    for (const atm of bankATMs) {
      const customerId = getCustomerId(atm);
      if (!customerId) continue;

      let group = groups.get(customerId);
      if (!group) {
        group = {
          id: customerId,
          customer: customersById.get(customerId),
          atms: [],
        };
        groups.set(customerId, group);
      }
      group.atms.push(atm);
    }

    return [...groups.values()].sort((a, b) =>
      (a.customer?.customerName ?? "Unresolved customer").localeCompare(
        b.customer?.customerName ?? "Unresolved customer",
      ),
    );
  }, [bankATMs, customers]);
  const filteredCustomerGroups = useMemo(() => {
    const normalizedSearch = customerSearch.trim().toLowerCase();
    return customerGroups.filter(({ customer }) => {
      if (!customer) return true;
      const matchesSearch =
        !normalizedSearch ||
        [
          customer.customerName,
          customer.customerEmail,
          customer.customerPhone,
        ].some((value) => value?.toLowerCase().includes(normalizedSearch));
      const matchesStatus =
        customerStatusFilter === ALL ||
        (customer.isActive ? "ACTIVE" : "INACTIVE") === customerStatusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [customerGroups, customerSearch, customerStatusFilter]);
  const filteredResolvedCustomerCount = filteredCustomerGroups.filter(
    ({ customer }) => customer,
  ).length;
  const hasCustomerFilters =
    Boolean(customerSearch.trim()) || customerStatusFilter !== ALL;
  const unresolvedCustomerGroups = customerGroups.filter(
    ({ customer }) => !customer,
  );
  const unresolvedCustomerAtms = unresolvedCustomerGroups.reduce(
    (count, group) => count + group.atms.length,
    0,
  );
  const unresolvedCustomerAtmsWithoutId = bankATMs.filter(
    (atm) => !getCustomerId(atm),
  );
  const activeCustomers = customerGroups.filter(
    ({ customer }) => customer?.isActive,
  ).length;
  const inactiveCustomers = customerGroups.filter(
    ({ customer }) => customer && !customer.isActive,
  ).length;
  const totalLinkedCustomerATMs = customerGroups.reduce(
    (count, group) => count + group.atms.length,
    0,
  );
  const employeeGroups = useMemo(() => {
    const employeesById = new Map(
      employees.map((employee) => [employee._id, employee]),
    );
    const groups = new Map<string, BankEmployeeGroup>();

    for (const atm of bankATMs) {
      for (const employeeId of getAssignedEmployeeIds(atm)) {
        let group = groups.get(employeeId);
        if (!group) {
          group = {
            id: employeeId,
            employee: employeesById.get(employeeId),
            atms: [],
          };
          groups.set(employeeId, group);
        }
        if (!group.atms.some((assignedATM) => assignedATM._id === atm._id)) {
          group.atms.push(atm);
        }
      }
    }

    return [...groups.values()].sort((a, b) =>
      (a.employee ? getEmployeeName(a.employee) : "Unresolved employee").localeCompare(
        b.employee ? getEmployeeName(b.employee) : "Unresolved employee",
      ),
    );
  }, [bankATMs, employees]);
  const unassignedEmployeeATMs = bankATMs.filter(
    (atm) => (atm.assignedEmployeeId ?? []).length === 0,
  );
  const assignedEmployeeATMsWithoutId = bankATMs.filter((atm) => {
    const assigned = atm.assignedEmployeeId ?? [];
    return assigned.length > 0 && getAssignedEmployeeIds(atm).length === 0;
  });
  const unresolvedEmployeeGroups = employeeGroups.filter(
    ({ employee }) => !employee,
  );
  const unresolvedEmployeeATMs = unresolvedEmployeeGroups.reduce(
    (count, group) => count + group.atms.length,
    0,
  );
  const filteredEmployeeGroups = useMemo(() => {
    const normalizedSearch = employeeSearch.trim().toLowerCase();
    return employeeGroups.filter(({ employee }) => {
      if (!employee) return true;
      const name = getEmployeeName(employee);
      const matchesSearch =
        !normalizedSearch ||
        [
          name,
          employee.employeeCode,
          employee.userId?.email,
          employee.designation,
          employee.department,
        ].some((value) => value?.toLowerCase().includes(normalizedSearch));
      const matchesStatus =
        employeeStatusFilter === ALL ||
        employee.status === employeeStatusFilter;
      return matchesSearch && matchesStatus;
    });
  }, [employeeGroups, employeeSearch, employeeStatusFilter]);
  const filteredResolvedEmployeeCount = filteredEmployeeGroups.filter(
    ({ employee }) => employee,
  ).length;
  const hasEmployeeFilters =
    Boolean(employeeSearch.trim()) || employeeStatusFilter !== ALL;
  const activeEmployees = employeeGroups.filter(
    ({ employee }) => employee?.status === "active",
  ).length;
  const inactiveEmployees = employeeGroups.filter(
    ({ employee }) => employee && employee.status !== "active",
  ).length;
  const totalAssignedEmployeeATMs = bankATMs.filter(
    (atm) => (atm.assignedEmployeeId ?? []).length > 0,
  ).length;
  const selectedDistrictATMs = useMemo(
    () =>
      districtFilter === ALL
        ? []
        : bankATMs.filter((atm) => getDistrictId(atm) === districtFilter),
    [bankATMs, districtFilter],
  );
  const regionOptions = useMemo(() => {
    const regions = new Map<string, string>();
    for (const atm of selectedDistrictATMs) {
      const id = getRegionId(atm);
      if (id) regions.set(id, getRegionName(atm));
    }
    return [...regions.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [selectedDistrictATMs]);
  const filteredATMs = useMemo(() => {
    const normalizedSearch = search.trim().toLowerCase();
    return bankATMs.filter((atm) => {
      const matchesSearch =
        !normalizedSearch ||
        [atm.atmId, atm.locationName, atm.address].some((value) =>
          value?.toLowerCase().includes(normalizedSearch),
        );
      const matchesStatus =
        statusFilter === ALL || atm.status === statusFilter;
      const matchesDistrict =
        districtFilter === ALL || getDistrictId(atm) === districtFilter;
      const matchesRegion =
        regionFilter === ALL || getRegionId(atm) === regionFilter;
      return (
        matchesSearch && matchesStatus && matchesDistrict && matchesRegion
      );
    });
  }, [bankATMs, districtFilter, regionFilter, search, statusFilter]);
  const selectedJobDistrictATMs = useMemo(
    () =>
      jobDistrictFilter === ALL
        ? []
        : bankATMs.filter((atm) => getDistrictId(atm) === jobDistrictFilter),
    [bankATMs, jobDistrictFilter],
  );
  const jobRegionOptions = useMemo(() => {
    const regions = new Map<string, string>();
    for (const atm of selectedJobDistrictATMs) {
      const id = getRegionId(atm);
      if (id) regions.set(id, getRegionName(atm));
    }
    return [...regions.entries()].sort((a, b) => a[1].localeCompare(b[1]));
  }, [selectedJobDistrictATMs]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      setDebouncedJobSearch(jobSearch.trim());
    }, 300);
    return () => window.clearTimeout(timeout);
  }, [jobSearch]);

  const {
    data: jobsData,
    isLoading: jobsLoading,
    isError: jobsError,
    error: jobsLoadError,
    refetch: refetchJobs,
    isFetching: jobsFetching,
  } = useJobs(
    {
      page: jobPage,
      limit: JOB_PAGE_SIZE,
      bankId,
      ...(debouncedJobSearch ? { search: debouncedJobSearch } : {}),
      ...(jobStatusFilter !== ALL ? { status: jobStatusFilter } : {}),
      ...(jobWorkTypeFilter !== ALL ? { workType: jobWorkTypeFilter } : {}),
      ...(jobPriorityFilter !== ALL ? { priority: jobPriorityFilter } : {}),
      ...(jobDistrictFilter !== ALL ? { districtId: jobDistrictFilter } : {}),
      ...(jobRegionFilter !== ALL ? { regionId: jobRegionFilter } : {}),
    },
    activeTab === "jobs",
  );
  const jobs = jobsData?.jobs ?? [];
  const jobsPagination = jobsData?.pagination;
  const jobStatusCounts = jobsData?.statusCounts;
  const totalBankJobs = Object.values(jobStatusCounts ?? {}).reduce(
    (total, count) => total + (count ?? 0),
    0,
  );
  const hasJobFilters =
    Boolean(jobSearch.trim()) ||
    jobStatusFilter !== ALL ||
    jobWorkTypeFilter !== ALL ||
    jobPriorityFilter !== ALL ||
    jobDistrictFilter !== ALL ||
    jobRegionFilter !== ALL;

  if (bankLoading) return <BankDetailSkeleton />;

  if (bankError || !bank) {
    const notFound = isBankNotFoundError(bankLoadError);
    return (
      <div className="space-y-6 p-6">
        <Button variant="ghost" onClick={() => navigate("/admin/banks")}>
          <ArrowLeft />
          Back to Banks
        </Button>
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="p-6">
            <h1 className="font-semibold text-destructive">
              {notFound
                ? "Bank not found"
                : "Bank not found or details unavailable"}
            </h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {notFound
                ? "This bank may have been removed or the link may be invalid."
                : `This bank may not exist, or its details could not be loaded. ${getErrorMessage(bankLoadError)}`}
            </p>
            <Button
              type="button"
              variant="outline"
              className="mt-4"
              onClick={() => void refetchBank()}
              disabled={bankFetching}
            >
              <RefreshCw className={bankFetching ? "animate-spin" : ""} />
              {bankFetching ? "Retrying..." : "Retry"}
            </Button>
          </CardContent>
        </Card>
      </div>
    );
  }

  const openEditDialog = () => setEditDialogOpen(true);
  const closeEditDialog = (open: boolean) => setEditDialogOpen(open);
  const activeATMs = bankATMs.filter((atm) => atm.status === "ACTIVE").length;
  const inactiveATMs = bankATMs.filter((atm) => atm.status === "INACTIVE").length;
  const otherStatusATMs = bankATMs.length - activeATMs - inactiveATMs;

  return (
    <div className="space-y-6 p-6">
      <Button
        type="button"
        variant="ghost"
        className="-ml-3"
        onClick={() => navigate("/admin/banks")}
      >
        <ArrowLeft />
        Back to Banks
      </Button>

      <Card>
        <CardContent className="flex flex-wrap items-start justify-between gap-5 p-6">
          <div className="flex min-w-0 items-start gap-4">
            <div className="flex size-12 shrink-0 items-center justify-center rounded-full bg-primary/10 text-primary">
              <Building2 className="size-6" />
            </div>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-2xl font-bold">{bank.bankName}</h1>
                <Badge variant={bank.isActive ? "secondary" : "outline"}>
                  {bank.isActive ? "Active" : "Inactive"}
                </Badge>
              </div>
              <p className="mt-1 text-sm text-muted-foreground">
                Bank Code: <span className="font-mono">{bank.bankCode}</span>
              </p>
              <div className="mt-3 flex flex-wrap gap-x-5 gap-y-1 text-sm text-muted-foreground">
                {bank.contactEmail && <span>{bank.contactEmail}</span>}
                {bank.contactPhone && <span>{bank.contactPhone}</span>}
                {bank.address && (
                  <span className="flex items-start gap-1">
                    <MapPin className="mt-0.5 size-4 shrink-0" />
                    {bank.address}
                  </span>
                )}
                {!bank.contactEmail && !bank.contactPhone && !bank.address && (
                  <span>Contact information not provided</span>
                )}
              </div>
            </div>
          </div>
          <Button type="button" variant="outline" onClick={openEditDialog}>
            <Pencil />
            Edit Bank
          </Button>
        </CardContent>
      </Card>

      {atmsError ? (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-medium text-destructive">
                Failed to load bank ATMs.
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {getErrorMessage(atmsLoadError)}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => void refetchATMs()}
              disabled={atmsFetching}
            >
              <RefreshCw className={atmsFetching ? "animate-spin" : ""} />
              {atmsFetching ? "Retrying..." : "Retry"}
            </Button>
          </CardContent>
        </Card>
      ) : null}

      <div className="flex flex-wrap gap-2 border-b" role="tablist" aria-label="Bank workspace">
        {(
          [
            ["overview", "Overview"],
            ["atms", "ATMs"],
            ["districts", "Districts"],
            ["customers", "Customers"],
            ["employees", "Employees"],
            ["jobs", "Jobs"],
          ] as const
        ).map(([tab, label]) => (
          <button
            key={tab}
            id={`bank-tab-${tab}`}
            type="button"
            role="tab"
            aria-selected={activeTab === tab}
            aria-controls={`bank-panel-${tab}`}
            onClick={() => setActiveTab(tab)}
            className={`border-b-2 px-4 py-2.5 text-sm font-medium transition-colors ${
              activeTab === tab
                ? "border-primary text-foreground"
                : "border-transparent text-muted-foreground hover:text-foreground"
            }`}
          >
            {label}
          </button>
        ))}
      </div>

      <section
        id={`bank-panel-${activeTab}`}
        role="tabpanel"
        aria-labelledby={`bank-tab-${activeTab}`}
        className="space-y-5"
      >
        {activeTab === "overview" &&
          (atmsLoading ? (
            <div className="grid gap-4 sm:grid-cols-3">
              {["total", "active", "inactive"].map((key) => (
                <div
                  key={key}
                  className="h-28 animate-pulse rounded-lg border bg-muted/40"
                />
              ))}
              <p className="sr-only">Loading bank ATM summary...</p>
            </div>
          ) : atmsError ? null : (
            <>
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {[
                  ["Total ATMs", bankATMs.length],
                  ["Active ATMs", activeATMs],
                  ["Inactive ATMs", inactiveATMs],
                  ["Other statuses", otherStatusATMs],
                ].map(([label, count]) => (
                  <Card key={label}>
                    <CardContent className="p-5">
                      <p className="text-sm text-muted-foreground">{label}</p>
                      <p className="mt-2 text-3xl font-semibold">{count}</p>
                    </CardContent>
                  </Card>
                ))}
              </div>
              <Card>
                <CardHeader>
                  <CardTitle>ATM Distribution by District</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  {districtGroups.length === 0 ? (
                    <p className="px-5 py-8 text-center text-sm text-muted-foreground">
                      No district-linked ATMs are associated with this bank.
                    </p>
                  ) : (
                    <div className="overflow-x-auto">
                      <table className="w-full text-sm">
                        <thead className="border-y bg-muted/40">
                          <tr>
                            <th className="px-5 py-3 text-left font-medium">
                              District
                            </th>
                            <th className="px-5 py-3 text-right font-medium">
                              ATM Count
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {districtGroups.map((district) => (
                            <tr
                              key={district.id}
                              className="border-b last:border-0"
                            >
                              <td className="px-5 py-3">{district.name}</td>
                              <td className="px-5 py-3 text-right font-medium">
                                {district.atms.length}
                              </td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  )}
                </CardContent>
              </Card>
            </>
          ))}

        {activeTab === "atms" && (
          <>
            <Card>
              <CardContent className="grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-4">
                <div>
                  <label
                    htmlFor="bank-atm-search"
                    className="mb-2 block text-sm font-medium"
                  >
                    Search ATMs
                  </label>
                  <input
                    id="bank-atm-search"
                    type="search"
                    value={search}
                    onChange={(event) => setSearch(event.target.value)}
                    placeholder="ATM ID, location, or address"
                    className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                  />
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium">
                    Status
                  </label>
                  <Select
                    value={statusFilter}
                    onValueChange={(value) => setStatusFilter(value ?? ALL)}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="All statuses" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>All statuses</SelectItem>
                      {(
                        [
                          "ACTIVE",
                          "INACTIVE",
                          "UNDER_MAINTENANCE",
                          "REMOVED",
                        ] as const
                      ).map((status) => (
                        <SelectItem key={status} value={status}>
                          {formatStatus(status)}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium">
                    District
                  </label>
                  <Select
                    value={districtFilter}
                    onValueChange={(value) => {
                      setDistrictFilter(value ?? ALL);
                      setRegionFilter(ALL);
                    }}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue placeholder="All districts" />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>All districts</SelectItem>
                      {districtGroups.map((district) => (
                        <SelectItem key={district.id} value={district.id}>
                          {district.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div>
                  <label className="mb-2 block text-sm font-medium">
                    Region
                  </label>
                  <Select
                    value={regionFilter}
                    onValueChange={(value) => setRegionFilter(value ?? ALL)}
                    disabled={districtFilter === ALL}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue
                        placeholder={
                          districtFilter === ALL
                            ? "Select a district first"
                            : "All regions"
                        }
                      />
                    </SelectTrigger>
                    <SelectContent>
                      <SelectItem value={ALL}>All regions</SelectItem>
                      {regionOptions.map(([id, name]) => (
                        <SelectItem key={id} value={id}>
                          {name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
                <div className="flex items-end sm:col-span-2 xl:col-span-4">
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setSearch("");
                      setStatusFilter(ALL);
                      setDistrictFilter(ALL);
                      setRegionFilter(ALL);
                    }}
                    disabled={
                      !search &&
                      statusFilter === ALL &&
                      districtFilter === ALL &&
                      regionFilter === ALL
                    }
                  >
                    Clear filters
                  </Button>
                  <span className="ml-auto self-center text-sm text-muted-foreground">
                    Showing {filteredATMs.length} of {bankATMs.length} ATMs
                  </span>
                </div>
              </CardContent>
            </Card>
            {atmsLoading ? (
              <ATMTableSkeleton />
            ) : atmsError ? null : (
              <Card>
                <CardHeader>
                  <CardTitle>Bank ATMs</CardTitle>
                </CardHeader>
                <CardContent className="p-0">
                  <ATMRows
                    atms={filteredATMs}
                    emptyMessage={
                      search.trim() ||
                      statusFilter !== ALL ||
                      districtFilter !== ALL ||
                      regionFilter !== ALL
                        ? "No ATMs match the selected filters."
                        : "No ATMs are associated with this bank."
                    }
                  />
                </CardContent>
              </Card>
            )}
          </>
        )}

        {activeTab === "districts" &&
          (atmsLoading ? (
            <ATMTableSkeleton />
          ) : atmsError ? null : districtGroups.length === 0 ? (
            <Card>
              <CardContent className="px-6 py-12 text-center text-sm text-muted-foreground">
                No district-linked ATMs are associated with this bank.
              </CardContent>
            </Card>
          ) : (
            <div className="space-y-4">
              {districtGroups.map((district) => (
                <Card key={district.id}>
                  <CardContent className="p-0">
                    <details>
                      <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-5 py-4 [&::-webkit-details-marker]:hidden">
                        <span className="font-semibold">{district.name}</span>
                        <Badge variant="secondary">
                          {district.atms.length}{" "}
                          {district.atms.length === 1 ? "ATM" : "ATMs"}
                        </Badge>
                      </summary>
                      <div className="space-y-3 border-t bg-muted/10 p-4 sm:p-5">
                        {[...district.regions.values()]
                          .sort((a, b) => a.name.localeCompare(b.name))
                          .map((region) => (
                            <details
                              key={region.id}
                              className="rounded-lg border bg-background"
                            >
                              <summary className="flex cursor-pointer list-none flex-wrap items-center justify-between gap-3 px-4 py-3 [&::-webkit-details-marker]:hidden">
                                <span className="font-medium">
                                  {region.name}
                                </span>
                                <Badge variant="outline">
                                  {region.atms.length}{" "}
                                  {region.atms.length === 1 ? "ATM" : "ATMs"}
                                </Badge>
                              </summary>
                              <div className="border-t">
                                <ATMRows
                                  atms={[...region.atms].sort((a, b) =>
                                    a.atmId.localeCompare(b.atmId),
                                  )}
                                  emptyMessage="No ATMs in this region."
                                />
                              </div>
                            </details>
                          ))}
                      </div>
                    </details>
                  </CardContent>
                </Card>
              ))}
            </div>
          ))}

        {activeTab === "customers" && (
          <>
            {atmsLoading || customersLoading ? (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {["customers", "active", "inactive", "linked-atms"].map(
                  (key) => (
                    <div
                      key={key}
                      className="h-28 animate-pulse rounded-lg border bg-muted/40"
                    />
                  ),
                )}
                <p className="sr-only">Loading bank customers...</p>
              </div>
            ) : customersError ? (
              <Card className="border-destructive/30 bg-destructive/5">
                <CardContent className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium text-destructive">
                      Failed to load customers.
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {getErrorMessage(customersLoadError)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void refetchCustomers()}
                    disabled={customersFetching}
                  >
                    <RefreshCw
                      className={customersFetching ? "animate-spin" : ""}
                    />
                    {customersFetching ? "Retrying..." : "Retry"}
                  </Button>
                </CardContent>
              </Card>
            ) : atmsError ? null : (
              <>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  {[
                    ["Total Customers", customerGroups.filter(({ customer }) => customer).length],
                    ["Active Customers", activeCustomers],
                    ["Inactive Customers", inactiveCustomers],
                    ["Bank ATMs linked to Customers", totalLinkedCustomerATMs],
                  ].map(([label, count]) => (
                    <Card key={label}>
                      <CardContent className="p-5">
                        <p className="text-sm text-muted-foreground">{label}</p>
                        <p className="mt-2 text-3xl font-semibold">{count}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                {(unresolvedCustomerGroups.length > 0 ||
                  unresolvedCustomerAtmsWithoutId.length > 0) && (
                  <Card className="border-amber-500/40 bg-amber-500/5">
                    <CardContent className="flex flex-wrap items-center gap-2 p-4 text-sm">
                      <Badge variant="outline">Unresolved customer</Badge>
                      <span>
                        {unresolvedCustomerGroups.length} customer reference
                        {unresolvedCustomerGroups.length === 1 ? "" : "s"}{" "}
                        across {unresolvedCustomerAtms} ATM(s) could not be
                        matched to the customer directory
                        {unresolvedCustomerAtmsWithoutId.length > 0 &&
                          `; ${unresolvedCustomerAtmsWithoutId.length} ATM(s) have no populated customer reference ID`}
                        .
                      </span>
                    </CardContent>
                  </Card>
                )}

                <Card>
                  <CardContent className="grid gap-4 p-4 sm:grid-cols-2">
                    <div>
                      <label
                        htmlFor="bank-customer-search"
                        className="mb-2 block text-sm font-medium"
                      >
                        Search Customers
                      </label>
                      <input
                        id="bank-customer-search"
                        type="search"
                        value={customerSearch}
                        onChange={(event) =>
                          setCustomerSearch(event.target.value)
                        }
                        placeholder="Name, email, or phone"
                        className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="bank-customer-status"
                        className="mb-2 block text-sm font-medium"
                      >
                        Status
                      </label>
                      <Select
                        value={customerStatusFilter}
                        onValueChange={(value) =>
                          setCustomerStatusFilter(value ?? ALL)
                        }
                      >
                        <SelectTrigger
                          id="bank-customer-status"
                          className="w-full"
                        >
                          <SelectValue placeholder="All statuses" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={ALL}>All statuses</SelectItem>
                          <SelectItem value="ACTIVE">Active</SelectItem>
                          <SelectItem value="INACTIVE">Inactive</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-end sm:col-span-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setCustomerSearch("");
                          setCustomerStatusFilter(ALL);
                        }}
                        disabled={!customerSearch && customerStatusFilter === ALL}
                      >
                        Clear filters
                      </Button>
                      <span className="ml-auto self-center text-sm text-muted-foreground">
                        Showing{" "}
                        {filteredResolvedCustomerCount}{" "}
                        of{" "}
                        {customerGroups.filter(({ customer }) => customer)
                          .length}{" "}
                        customers
                      </span>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Bank Customers</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-190 text-sm">
                        <thead className="border-y bg-muted/40">
                          <tr>
                            <th className="px-4 py-3 text-left font-medium">
                              Customer
                            </th>
                            <th className="px-4 py-3 text-left font-medium">
                              Email
                            </th>
                            <th className="px-4 py-3 text-left font-medium">
                              Phone
                            </th>
                            <th className="px-4 py-3 text-left font-medium">
                              Status
                            </th>
                            <th className="px-4 py-3 text-right font-medium">
                              ATMs at this Bank
                            </th>
                            <th className="px-4 py-3 text-right font-medium">
                              Actions
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredCustomerGroups.map((group) => (
                            <tr key={group.id} className="border-b last:border-0">
                              <td className="px-4 py-3 font-medium">
                                {group.customer?.customerName ??
                                  "Unresolved customer"}
                                {!group.customer && (
                                  <Badge
                                    variant="outline"
                                    className="ml-2 border-amber-500/50 text-amber-700"
                                  >
                                    Unresolved
                                  </Badge>
                                )}
                              </td>
                              <td className="px-4 py-3">
                                {group.customer?.customerEmail ?? "—"}
                              </td>
                              <td className="px-4 py-3">
                                {group.customer?.customerPhone ?? "—"}
                              </td>
                              <td className="px-4 py-3">
                                {group.customer ? (
                                  <Badge
                                    variant={
                                      group.customer.isActive
                                        ? "secondary"
                                        : "outline"
                                    }
                                  >
                                    {group.customer.isActive
                                      ? "Active"
                                      : "Inactive"}
                                  </Badge>
                                ) : (
                                  "Unavailable"
                                )}
                              </td>
                              <td className="px-4 py-3 text-right font-medium">
                                {group.atms.length}
                              </td>
                              <td className="px-4 py-3 text-right">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  aria-label={`View ${group.customer?.customerName ?? "unresolved customer"} details`}
                                  onClick={() => setSelectedCustomer(group)}
                                >
                                  <Eye />
                                  View
                                </Button>
                              </td>
                            </tr>
                          ))}
                          {unresolvedCustomerAtmsWithoutId.length > 0 && (
                            <tr className="border-b last:border-0">
                              <td className="px-4 py-3 font-medium">
                                Customer reference unavailable
                                <Badge
                                  variant="outline"
                                  className="ml-2 border-amber-500/50 text-amber-700"
                                >
                                  Unresolved
                                </Badge>
                              </td>
                              <td className="px-4 py-3">—</td>
                              <td className="px-4 py-3">—</td>
                              <td className="px-4 py-3">Unavailable</td>
                              <td className="px-4 py-3 text-right font-medium">
                                {unresolvedCustomerAtmsWithoutId.length}
                              </td>
                              <td className="px-4 py-3 text-right">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  aria-label="View ATMs with unavailable customer references"
                                  onClick={() =>
                                    setSelectedCustomer({
                                      id: "unavailable-reference",
                                      atms: unresolvedCustomerAtmsWithoutId,
                                    })
                                  }
                                >
                                  <Eye />
                                  View
                                </Button>
                              </td>
                            </tr>
                          )}
                          {filteredResolvedCustomerCount === 0 &&
                            (hasCustomerFilters ||
                              (customerGroups.length === 0 &&
                                unresolvedCustomerAtmsWithoutId.length ===
                                  0)) && (
                              <tr>
                                <td
                                  colSpan={6}
                                  className="px-4 py-8 text-center text-sm text-muted-foreground"
                                >
                                  {hasCustomerFilters
                                    ? "No customers match the selected filters."
                                    : "No customers are associated with this bank's ATMs."}
                                </td>
                              </tr>
                            )}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </>
        )}

        {activeTab === "employees" && (
          <>
            {atmsLoading || employeesLoading ? (
              <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                {["employees", "active", "inactive", "assigned-atms"].map(
                  (key) => (
                    <div
                      key={key}
                      className="h-28 animate-pulse rounded-lg border bg-muted/40"
                    />
                  ),
                )}
                <p className="sr-only">Loading bank employees...</p>
              </div>
            ) : employeesError ? (
              <Card className="border-destructive/30 bg-destructive/5">
                <CardContent className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium text-destructive">
                      Failed to load employees.
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {getErrorMessage(employeesLoadError)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void refetchEmployees()}
                    disabled={employeesFetching}
                  >
                    <RefreshCw
                      className={employeesFetching ? "animate-spin" : ""}
                    />
                    {employeesFetching ? "Retrying..." : "Retry"}
                  </Button>
                </CardContent>
              </Card>
            ) : atmsError ? null : (
              <>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
                  {[
                    ["Total Employees", employeeGroups.filter(({ employee }) => employee).length],
                    ["Active Employees", activeEmployees],
                    ["Inactive Employees", inactiveEmployees],
                    ["Total Assigned ATMs", totalAssignedEmployeeATMs],
                  ].map(([label, count]) => (
                    <Card key={label}>
                      <CardContent className="p-5">
                        <p className="text-sm text-muted-foreground">{label}</p>
                        <p className="mt-2 text-3xl font-semibold">{count}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                {(unassignedEmployeeATMs.length > 0 ||
                  unresolvedEmployeeGroups.length > 0 ||
                  assignedEmployeeATMsWithoutId.length > 0) && (
                  <Card className="border-amber-500/40 bg-amber-500/5">
                    <CardContent className="flex flex-wrap items-center gap-2 p-4 text-sm">
                      {unassignedEmployeeATMs.length > 0 && (
                        <span>
                          {unassignedEmployeeATMs.length} unassigned ATM(s).
                        </span>
                      )}
                      {(unresolvedEmployeeGroups.length > 0 ||
                        assignedEmployeeATMsWithoutId.length > 0) && (
                        <>
                          <Badge
                            variant="outline"
                            className="border-amber-500/50 text-amber-700"
                          >
                            Unresolved employee
                          </Badge>
                          <span>
                            {unresolvedEmployeeGroups.length} Employee
                            reference(s) across {unresolvedEmployeeATMs} ATM(s)
                            could not be matched to the employee directory
                            {assignedEmployeeATMsWithoutId.length > 0 &&
                              `; ${assignedEmployeeATMsWithoutId.length} ATM(s) have an assignment without a resolvable Employee ID`}
                            .
                          </span>
                        </>
                      )}
                    </CardContent>
                  </Card>
                )}

                <Card>
                  <CardContent className="grid gap-4 p-4 sm:grid-cols-2">
                    <div>
                      <label
                        htmlFor="bank-employee-search"
                        className="mb-2 block text-sm font-medium"
                      >
                        Search Employees
                      </label>
                      <input
                        id="bank-employee-search"
                        type="search"
                        value={employeeSearch}
                        onChange={(event) =>
                          setEmployeeSearch(event.target.value)
                        }
                        placeholder="Name, code, email, designation, or department"
                        className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                      />
                    </div>
                    <div>
                      <label
                        htmlFor="bank-employee-status"
                        className="mb-2 block text-sm font-medium"
                      >
                        Status
                      </label>
                      <Select
                        value={employeeStatusFilter}
                        onValueChange={(value) =>
                          setEmployeeStatusFilter(value ?? ALL)
                        }
                      >
                        <SelectTrigger
                          id="bank-employee-status"
                          className="w-full"
                        >
                          <SelectValue placeholder="All statuses" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={ALL}>All statuses</SelectItem>
                          <SelectItem value="active">Active</SelectItem>
                          <SelectItem value="inactive">Inactive</SelectItem>
                          <SelectItem value="on_leave">On Leave</SelectItem>
                          <SelectItem value="resigned">Resigned</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-end sm:col-span-2">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setEmployeeSearch("");
                          setEmployeeStatusFilter(ALL);
                        }}
                        disabled={
                          !employeeSearch &&
                          employeeStatusFilter === ALL
                        }
                      >
                        Clear filters
                      </Button>
                      <span className="ml-auto self-center text-sm text-muted-foreground">
                        Showing {filteredResolvedEmployeeCount} of{" "}
                        {employeeGroups.filter(({ employee }) => employee)
                          .length}{" "}
                        employees
                      </span>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <CardTitle>Bank Employees</CardTitle>
                  </CardHeader>
                  <CardContent className="p-0">
                    <div className="overflow-x-auto">
                      <table className="w-full min-w-210 text-sm">
                        <thead className="border-y bg-muted/40">
                          <tr>
                            <th className="px-4 py-3 text-left font-medium">
                              Employee
                            </th>
                            <th className="px-4 py-3 text-left font-medium">
                              Employee Code
                            </th>
                            <th className="px-4 py-3 text-left font-medium">
                              Designation
                            </th>
                            <th className="px-4 py-3 text-left font-medium">
                              Department
                            </th>
                            <th className="px-4 py-3 text-left font-medium">
                              Status
                            </th>
                            <th className="px-4 py-3 text-right font-medium">
                              ATMs at this Bank
                            </th>
                            <th className="px-4 py-3 text-right font-medium">
                              Actions
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {filteredEmployeeGroups.map((group) => {
                            const employee = group.employee;
                            const accountStatus = employee?.userId?.status;
                            const statusesDiffer =
                              Boolean(accountStatus) &&
                              accountStatus !== employee?.status;

                            return (
                              <tr key={group.id} className="border-b last:border-0">
                                <td className="px-4 py-3 font-medium">
                                  {employee
                                    ? getEmployeeName(employee)
                                    : "Unresolved employee"}
                                  {!employee && (
                                    <Badge
                                      variant="outline"
                                      className="ml-2 border-amber-500/50 text-amber-700"
                                    >
                                      Unresolved
                                    </Badge>
                                  )}
                                  {employee?.userId?.email && (
                                    <p className="text-xs font-normal text-muted-foreground">
                                      {employee.userId.email}
                                    </p>
                                  )}
                                </td>
                                <td className="px-4 py-3">
                                  {employee?.employeeCode ?? "—"}
                                </td>
                                <td className="px-4 py-3">
                                  {employee?.designation ?? "—"}
                                </td>
                                <td className="px-4 py-3">
                                  {employee?.department ?? "—"}
                                </td>
                                <td className="px-4 py-3">
                                  {employee ? (
                                    <div className="flex flex-wrap gap-1.5">
                                      <Badge
                                        variant={getEmployeeStatusVariant(
                                          employee.status,
                                        )}
                                      >
                                        {formatEmployeeStatus(employee.status)}
                                      </Badge>
                                      {statusesDiffer && (
                                        <Badge
                                          variant={getEmployeeStatusVariant(
                                            accountStatus!,
                                          )}
                                        >
                                          Account:{" "}
                                          {formatEmployeeStatus(accountStatus!)}
                                        </Badge>
                                      )}
                                    </div>
                                  ) : (
                                    "Unavailable"
                                  )}
                                </td>
                                <td className="px-4 py-3 text-right font-medium">
                                  {group.atms.length}
                                </td>
                                <td className="px-4 py-3 text-right">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    aria-label={`View ${employee ? getEmployeeName(employee) : "unresolved employee"} details`}
                                    onClick={() => setSelectedEmployee(group)}
                                  >
                                    <Eye />
                                    View
                                  </Button>
                                </td>
                              </tr>
                            );
                          })}
                          {assignedEmployeeATMsWithoutId.length > 0 && (
                            <tr className="border-b last:border-0">
                              <td className="px-4 py-3 font-medium">
                                Employee reference unavailable
                                <Badge
                                  variant="outline"
                                  className="ml-2 border-amber-500/50 text-amber-700"
                                >
                                  Unresolved
                                </Badge>
                              </td>
                              <td className="px-4 py-3">—</td>
                              <td className="px-4 py-3">—</td>
                              <td className="px-4 py-3">—</td>
                              <td className="px-4 py-3">Unavailable</td>
                              <td className="px-4 py-3 text-right font-medium">
                                {assignedEmployeeATMsWithoutId.length}
                              </td>
                              <td className="px-4 py-3 text-right">
                                <Button
                                  type="button"
                                  size="sm"
                                  variant="outline"
                                  aria-label="View ATMs with unavailable employee references"
                                  onClick={() =>
                                    setSelectedEmployee({
                                      id: "unavailable-reference",
                                      atms: assignedEmployeeATMsWithoutId,
                                    })
                                  }
                                >
                                  <Eye />
                                  View
                                </Button>
                              </td>
                            </tr>
                          )}
                          {filteredResolvedEmployeeCount === 0 &&
                            (hasEmployeeFilters ||
                              (employeeGroups.length === 0 &&
                                assignedEmployeeATMsWithoutId.length ===
                                  0)) && (
                              <tr>
                                <td
                                  colSpan={7}
                                  className="px-4 py-8 text-center text-sm text-muted-foreground"
                                >
                                  {hasEmployeeFilters
                                    ? "No employees match the selected filters."
                                    : "No employees are assigned to this bank's ATMs."}
                                </td>
                              </tr>
                            )}
                        </tbody>
                      </table>
                    </div>
                  </CardContent>
                </Card>
              </>
            )}
          </>
        )}

        {activeTab === "jobs" && (
          <>
            {jobsLoading ? (
              <div className="space-y-5" role="status">
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {Array.from({ length: 6 }, (_, index) => (
                    <div
                      key={index}
                      className="h-28 animate-pulse rounded-lg border bg-muted/40"
                    />
                  ))}
                </div>
                <ATMTableSkeleton />
                <p className="sr-only">Loading bank jobs...</p>
              </div>
            ) : jobsError ? (
              <Card className="border-destructive/30 bg-destructive/5">
                <CardContent className="flex flex-col items-start gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <p className="font-medium text-destructive">
                      Failed to load bank jobs.
                    </p>
                    <p className="mt-1 text-sm text-muted-foreground">
                      {getErrorMessage(jobsLoadError)}
                    </p>
                  </div>
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => void refetchJobs()}
                    disabled={jobsFetching}
                  >
                    <RefreshCw
                      className={jobsFetching ? "animate-spin" : ""}
                    />
                    {jobsFetching ? "Retrying..." : "Retry"}
                  </Button>
                </CardContent>
              </Card>
            ) : (
              <>
                <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
                  {[
                    ["Total Jobs", totalBankJobs],
                    [
                      "Pending / Assigned",
                      getJobStatusCount(jobStatusCounts, "PENDING") +
                        getJobStatusCount(jobStatusCounts, "ASSIGNED"),
                    ],
                    [
                      "In Progress",
                      getJobStatusCount(jobStatusCounts, "IN_PROGRESS"),
                    ],
                    [
                      "Completed",
                      getJobStatusCount(jobStatusCounts, "COMPLETED"),
                    ],
                    [
                      "Verified / Approved",
                      getJobStatusCount(jobStatusCounts, "VERIFIED") +
                        getJobStatusCount(jobStatusCounts, "APPROVED"),
                    ],
                    ["Closed", getJobStatusCount(jobStatusCounts, "CLOSED")],
                  ].map(([label, count]) => (
                    <Card key={label}>
                      <CardContent className="p-5">
                        <p className="text-sm text-muted-foreground">{label}</p>
                        <p className="mt-2 text-3xl font-semibold">{count}</p>
                      </CardContent>
                    </Card>
                  ))}
                </div>

                <Card>
                  <CardContent className="flex flex-wrap gap-x-6 gap-y-2 p-4 text-sm">
                    <span>
                      Accepted:{" "}
                      <strong>
                        {getJobStatusCount(jobStatusCounts, "ACCEPTED")}
                      </strong>
                    </span>
                    <span>
                      On Hold:{" "}
                      <strong>
                        {getJobStatusCount(jobStatusCounts, "ON_HOLD")}
                      </strong>
                    </span>
                    <span>
                      Rejected:{" "}
                      <strong>
                        {getJobStatusCount(jobStatusCounts, "REJECTED")}
                      </strong>
                    </span>
                  </CardContent>
                </Card>

                <Card>
                  <CardContent className="grid gap-4 p-4 sm:grid-cols-2 xl:grid-cols-3">
                    <div className="sm:col-span-2 xl:col-span-1">
                      <label
                        htmlFor="bank-job-search"
                        className="mb-2 block text-sm font-medium"
                      >
                        Search Jobs
                      </label>
                      <input
                        id="bank-job-search"
                        type="search"
                        value={jobSearch}
                        onChange={(event) => {
                          setJobSearch(event.target.value);
                          setJobPage(1);
                        }}
                        placeholder="Job ID or title"
                        className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                      />
                      <p className="mt-1 text-xs text-muted-foreground">
                        Search matches Job ID and title.
                      </p>
                    </div>
                    <div>
                      <label
                        htmlFor="bank-job-status"
                        className="mb-2 block text-sm font-medium"
                      >
                        Status
                      </label>
                      <Select
                        value={jobStatusFilter}
                        onValueChange={(value) => {
                          setJobStatusFilter(
                            (value as JobStatus | null) ?? ALL,
                          );
                          setJobPage(1);
                        }}
                      >
                        <SelectTrigger
                          id="bank-job-status"
                          className="w-full"
                        >
                          <SelectValue placeholder="All statuses" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={ALL}>All statuses</SelectItem>
                          {JOB_STATUSES.map((status) => (
                            <SelectItem key={status} value={status}>
                              {formatJobLabel(status)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label
                        htmlFor="bank-job-work-type"
                        className="mb-2 block text-sm font-medium"
                      >
                        Work Type
                      </label>
                      <Select
                        value={jobWorkTypeFilter}
                        onValueChange={(value) => {
                          setJobWorkTypeFilter(
                            (value as JobWorkType | null) ?? ALL,
                          );
                          setJobPage(1);
                        }}
                      >
                        <SelectTrigger
                          id="bank-job-work-type"
                          className="w-full"
                        >
                          <SelectValue placeholder="All work types" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={ALL}>All work types</SelectItem>
                          {JOB_WORK_TYPES.map((workType) => (
                            <SelectItem key={workType} value={workType}>
                              {formatJobLabel(workType)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label
                        htmlFor="bank-job-priority"
                        className="mb-2 block text-sm font-medium"
                      >
                        Priority
                      </label>
                      <Select
                        value={jobPriorityFilter}
                        onValueChange={(value) => {
                          setJobPriorityFilter(
                            (value as JobPriority | null) ?? ALL,
                          );
                          setJobPage(1);
                        }}
                      >
                        <SelectTrigger
                          id="bank-job-priority"
                          className="w-full"
                        >
                          <SelectValue placeholder="All priorities" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={ALL}>All priorities</SelectItem>
                          {JOB_PRIORITIES.map((priority) => (
                            <SelectItem key={priority} value={priority}>
                              {formatJobLabel(priority)}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label
                        htmlFor="bank-job-district"
                        className="mb-2 block text-sm font-medium"
                      >
                        District
                      </label>
                      <Select
                        value={jobDistrictFilter}
                        onValueChange={(value) => {
                          setJobDistrictFilter(value ?? ALL);
                          setJobRegionFilter(ALL);
                          setJobPage(1);
                        }}
                      >
                        <SelectTrigger
                          id="bank-job-district"
                          className="w-full"
                        >
                          <SelectValue placeholder="All districts" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={ALL}>All districts</SelectItem>
                          {districtGroups.map((district) => (
                            <SelectItem key={district.id} value={district.id}>
                              {district.name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div>
                      <label
                        htmlFor="bank-job-region"
                        className="mb-2 block text-sm font-medium"
                      >
                        Region
                      </label>
                      <Select
                        value={jobRegionFilter}
                        onValueChange={(value) => {
                          setJobRegionFilter(value ?? ALL);
                          setJobPage(1);
                        }}
                        disabled={jobDistrictFilter === ALL}
                      >
                        <SelectTrigger id="bank-job-region" className="w-full">
                          <SelectValue
                            placeholder={
                              jobDistrictFilter === ALL
                                ? "Select a district first"
                                : "All regions"
                            }
                          />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value={ALL}>All regions</SelectItem>
                          {jobRegionOptions.map(([id, name]) => (
                            <SelectItem key={id} value={id}>
                              {name}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </div>
                    <div className="flex items-end sm:col-span-2 xl:col-span-3">
                      <Button
                        type="button"
                        variant="outline"
                        onClick={() => {
                          setJobSearch("");
                          setDebouncedJobSearch("");
                          setJobStatusFilter(ALL);
                          setJobWorkTypeFilter(ALL);
                          setJobPriorityFilter(ALL);
                          setJobDistrictFilter(ALL);
                          setJobRegionFilter(ALL);
                          setJobPage(1);
                        }}
                        disabled={!hasJobFilters}
                      >
                        Clear filters
                      </Button>
                      <span className="ml-auto self-center text-sm text-muted-foreground">
                        {jobsPagination?.total ?? 0} matching jobs
                      </span>
                    </div>
                  </CardContent>
                </Card>

                <Card>
                  <CardHeader>
                    <div className="flex flex-wrap items-center justify-between gap-3">
                      <CardTitle>Bank Jobs</CardTitle>
                      {jobsPagination && jobsPagination.totalPages > 0 && (
                        <p className="text-sm text-muted-foreground">
                          Page {jobsPagination.page} of{" "}
                          {jobsPagination.totalPages}
                        </p>
                      )}
                    </div>
                  </CardHeader>
                  <CardContent>
                    <div className="overflow-x-auto rounded-lg border">
                      <table className="w-full min-w-280 text-sm">
                        <thead className="border-b bg-muted/50">
                          <tr>
                            <th className="px-4 py-3 text-left font-medium">
                              Job Number
                            </th>
                            <th className="px-4 py-3 text-left font-medium">
                              ATM ID
                            </th>
                            <th className="px-4 py-3 text-left font-medium">
                              Location
                            </th>
                            <th className="px-4 py-3 text-left font-medium">
                              District
                            </th>
                            <th className="px-4 py-3 text-left font-medium">
                              Region
                            </th>
                            <th className="px-4 py-3 text-left font-medium">
                              Employee
                            </th>
                            <th className="px-4 py-3 text-left font-medium">
                              Work Type
                            </th>
                            <th className="px-4 py-3 text-left font-medium">
                              Priority
                            </th>
                            <th className="px-4 py-3 text-left font-medium">
                              Status
                            </th>
                            <th className="px-4 py-3 text-left font-medium">
                              Created Date
                            </th>
                            <th className="px-4 py-3 text-right font-medium">
                              View
                            </th>
                          </tr>
                        </thead>
                        <tbody>
                          {jobs.map((job) => {
                            const jobATMId = getJobATMId(job);
                            const atm = bankATMs.find(
                              (bankATM) => bankATM._id === jobATMId,
                            );
                            const populatedATM = getJobATM(job);
                            return (
                              <tr key={job._id} className="border-b last:border-0">
                                <td className="whitespace-nowrap px-4 py-3 font-medium">
                                  {job.jobNumber || job.jobId}
                                </td>
                                <td className="whitespace-nowrap px-4 py-3">
                                  {atm?.atmId ?? "Unknown ATM"}
                                </td>
                                <td className="min-w-40 px-4 py-3">
                                  {atm?.locationName ??
                                    populatedATM?.locationName ??
                                    "Location unavailable"}
                                </td>
                                <td className="px-4 py-3">
                                  {atm
                                    ? getDistrictName(atm)
                                    : "Unknown District"}
                                </td>
                                <td className="px-4 py-3">
                                  {atm ? getRegionName(atm) : "Unknown Region"}
                                </td>
                                <td className="px-4 py-3">
                                  {getJobEmployeeName(job)}
                                </td>
                                <td className="whitespace-nowrap px-4 py-3">
                                  {formatJobLabel(job.workType)}
                                </td>
                                <td className="px-4 py-3">
                                  <Badge
                                    variant={getJobPriorityVariant(job.priority)}
                                  >
                                    {formatJobLabel(job.priority)}
                                  </Badge>
                                </td>
                                <td className="px-4 py-3">
                                  <Badge
                                    variant={getJobStatusVariant(job.status)}
                                  >
                                    {formatJobLabel(job.status)}
                                  </Badge>
                                </td>
                                <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                                  {formatJobDate(job.createdAt)}
                                </td>
                                <td className="px-4 py-3 text-right">
                                  <Button
                                    type="button"
                                    size="sm"
                                    variant="outline"
                                    aria-label={`View job ${job.jobNumber || job.jobId}`}
                                    onClick={() =>
                                      navigate(`/admin/jobs/${job._id}`)
                                    }
                                  >
                                    View
                                  </Button>
                                </td>
                              </tr>
                            );
                          })}
                          {jobs.length === 0 && (
                            <tr>
                              <td
                                colSpan={11}
                                className="px-4 py-12 text-center text-sm text-muted-foreground"
                              >
                                {jobPage > 1 &&
                                jobPage >
                                  (jobsPagination?.totalPages ?? 0) ? (
                                  <div className="space-y-3">
                                    <p>
                                      This page is no longer available. Return
                                      to the first page to refresh the results.
                                    </p>
                                    <Button
                                      type="button"
                                      size="sm"
                                      variant="outline"
                                      onClick={() => setJobPage(1)}
                                    >
                                      Go to first page
                                    </Button>
                                  </div>
                                ) : totalBankJobs === 0 ? (
                                  "No jobs exist for this bank."
                                ) : (
                                  "No jobs match the selected filters."
                                )}
                              </td>
                            </tr>
                          )}
                        </tbody>
                      </table>
                    </div>

                    {jobsPagination && jobsPagination.totalPages > 1 && (
                      <div className="mt-4 flex items-center justify-between gap-4">
                        <p className="text-sm text-muted-foreground">
                          {jobsPagination.total} matching jobs
                        </p>
                        <div className="flex items-center gap-2">
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setJobPage((current) => Math.max(1, current - 1))
                            }
                            disabled={jobPage <= 1 || jobsFetching}
                          >
                            <ChevronLeft />
                            Previous
                          </Button>
                          <Button
                            type="button"
                            variant="outline"
                            size="sm"
                            onClick={() =>
                              setJobPage((current) =>
                                Math.min(
                                  jobsPagination.totalPages,
                                  current + 1,
                                ),
                              )
                            }
                            disabled={
                              jobPage >= jobsPagination.totalPages ||
                              jobsFetching
                            }
                          >
                            Next
                            <ChevronRight />
                          </Button>
                        </div>
                      </div>
                    )}
                  </CardContent>
                </Card>
              </>
            )}
          </>
        )}
      </section>

      <Dialog
        open={selectedCustomer !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedCustomer(null);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogTitle>
            {selectedCustomer?.customer?.customerName ??
              (selectedCustomer?.id === "unavailable-reference"
                ? "Customer reference unavailable"
                : "Unresolved customer")}
          </DialogTitle>
          <DialogDescription>
            Read-only customer information and ATMs linked to this bank.
          </DialogDescription>
          <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <p>
              <span className="text-muted-foreground">Email: </span>
              {selectedCustomer?.customer?.customerEmail ?? "Unavailable"}
            </p>
            <p>
              <span className="text-muted-foreground">Phone: </span>
              {selectedCustomer?.customer?.customerPhone ?? "Unavailable"}
            </p>
            <p>
              <span className="text-muted-foreground">Status: </span>
              {selectedCustomer?.customer
                ? selectedCustomer.customer.isActive
                  ? "Active"
                  : "Inactive"
                : "Unavailable"}
            </p>
            <p>
              <span className="text-muted-foreground">ATMs at this bank: </span>
              {selectedCustomer?.atms.length ?? 0}
            </p>
          </div>
          {!selectedCustomer?.customer && (
            <p className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-muted-foreground">
              {selectedCustomer?.id === "unavailable-reference"
                ? "The ATM API did not return a customer reference ID for these ATMs, so no customer record can be identified."
                : "The customer record could not be matched to the customer directory. No customer details are available."}
            </p>
          )}
          <div className="mt-5 space-y-2">
            <h3 className="text-sm font-semibold">ATMs at this bank</h3>
            {(selectedCustomer?.atms ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No linked ATMs are available.
              </p>
            ) : (
              <ul className="divide-y rounded-md border">
                {[...(selectedCustomer?.atms ?? [])]
                  .sort((a, b) => a.atmId.localeCompare(b.atmId))
                  .map((atm) => (
                    <li
                      key={atm._id}
                      className="flex flex-wrap items-center justify-between gap-3 p-3"
                    >
                      <div>
                        <p className="font-medium">{atm.atmId}</p>
                        <p className="text-xs text-muted-foreground">
                          {atm.locationName}
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setSelectedCustomer(null);
                          navigate(`/admin/atms/${atm._id}`);
                        }}
                      >
                        View ATM
                      </Button>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <Dialog
        open={selectedEmployee !== null}
        onOpenChange={(open) => {
          if (!open) setSelectedEmployee(null);
        }}
      >
        <DialogContent className="max-h-[90vh] overflow-y-auto">
          <DialogTitle>
            {selectedEmployee?.employee
              ? getEmployeeName(selectedEmployee.employee)
              : selectedEmployee?.id === "unavailable-reference"
                ? "Employee reference unavailable"
                : "Unresolved employee"}
          </DialogTitle>
          <DialogDescription>
            Read-only employee information and ATMs assigned at this bank.
          </DialogDescription>
          <div className="mt-4 grid gap-3 text-sm sm:grid-cols-2">
            <p>
              <span className="text-muted-foreground">Employee code: </span>
              {selectedEmployee?.employee?.employeeCode ?? "Unavailable"}
            </p>
            <p>
              <span className="text-muted-foreground">Email: </span>
              {selectedEmployee?.employee?.userId?.email ?? "Unavailable"}
            </p>
            <p>
              <span className="text-muted-foreground">Phone: </span>
              {selectedEmployee?.employee?.userId?.phoneNumber ?? "Unavailable"}
            </p>
            <p>
              <span className="text-muted-foreground">Designation: </span>
              {selectedEmployee?.employee?.designation ?? "Unavailable"}
            </p>
            <p>
              <span className="text-muted-foreground">Department: </span>
              {selectedEmployee?.employee?.department ?? "Unavailable"}
            </p>
            <p>
              <span className="text-muted-foreground">
                Employment status:{" "}
              </span>
              {selectedEmployee?.employee
                ? formatEmployeeStatus(selectedEmployee.employee.status)
                : "Unavailable"}
            </p>
            {selectedEmployee?.employee?.userId?.status &&
              selectedEmployee.employee.userId.status !==
                selectedEmployee.employee.status && (
                <p>
                  <span className="text-muted-foreground">
                    Account status:{" "}
                  </span>
                  {formatEmployeeStatus(
                    selectedEmployee.employee.userId.status,
                  )}
                </p>
              )}
            <p>
              <span className="text-muted-foreground">
                ATMs at this bank:{" "}
              </span>
              {selectedEmployee?.atms.length ?? 0}
            </p>
          </div>
          {!selectedEmployee?.employee && (
            <p className="mt-3 rounded-md border border-amber-500/40 bg-amber-500/5 p-3 text-sm text-muted-foreground">
              {selectedEmployee?.id === "unavailable-reference"
                ? "The ATM API did not return an Employee reference ID for these ATMs, so no Employee record can be identified."
                : "The assigned Employee ID could not be matched to the employee directory. No employee details are available."}
            </p>
          )}
          <div className="mt-5 space-y-2">
            <h3 className="text-sm font-semibold">ATMs at this bank</h3>
            {(selectedEmployee?.atms ?? []).length === 0 ? (
              <p className="text-sm text-muted-foreground">
                No assigned ATMs are available.
              </p>
            ) : (
              <ul className="divide-y rounded-md border">
                {[...(selectedEmployee?.atms ?? [])]
                  .sort((a, b) => a.atmId.localeCompare(b.atmId))
                  .map((atm) => (
                    <li
                      key={atm._id}
                      className="flex flex-wrap items-center justify-between gap-3 p-3"
                    >
                      <div>
                        <p className="font-medium">{atm.atmId}</p>
                        <p className="text-xs text-muted-foreground">
                          {atm.locationName}
                        </p>
                      </div>
                      <Button
                        type="button"
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setSelectedEmployee(null);
                          navigate(`/admin/atms/${atm._id}`);
                        }}
                      >
                        View ATM
                      </Button>
                    </li>
                  ))}
              </ul>
            )}
          </div>
        </DialogContent>
      </Dialog>

      <BankFormDialog
        open={editDialogOpen}
        bank={bank}
        onOpenChange={closeEditDialog}
      />
    </div>
  );
}
