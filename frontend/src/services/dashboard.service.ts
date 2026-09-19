import api from "@/lib/axios";

export interface DashboardStats {
  jobs: {
    total: number;
    today: number;
    thisWeek: number;
    thisMonth: number;
    pending: number;
    assigned: number;
    inProgress: number;
    completed: number;
    verified: number;
    approved: number;
    closed: number;
    rejected: number;
    onHold: number;
    byPriority: Record<string, number>;
    byWorkType: Record<string, number>;
    completionRate: number;
  };

  employees: {
    total: number;
    active: number;
    inactive: number;
    onLeave: number;
    workingToday: number;
    withPendingJobs: number;
  };

  atms: {
    total: number;
    active: number;
    inactive: number;
    underMaintenance: number;
    byDistrict: Array<{
      districtId: string;
      districtName: string;
      count: number;
    }>;
    byBank: Array<{
      bankId: string;
      bankName: string;
      count: number;
    }>;
    byInstallationType: Record<string, number>;
  };

  complaints: {
    total: number;
    today: number;
    open: number;
    assigned: number;
    inProgress: number;
    resolved: number;
    closed: number;
    criticalOpen: number;
    highOpen: number;
    byPriority: Record<string, number>;
  };

  customers: {
    total: number;
    active: number;
  };
}

export interface RecentActivity {
  type: "job" | "complaint";
  id: string;
  title: string;
  status: string;
  identifier: string;
  atmName: string;
  atmId: string;
  employeeName: string | null;
  createdBy: string;
  timestamp: string;
  priority: string;
}

export interface EmployeePerformance {
  employeeId: string;
  name: string;
  employeeCode?: string;
  totalJobs: number;
  completedJobs: number;
  approvedJobs: number;
  rejectedJobs: number;
  completionRate: number;
  avgCompletionTimeHours: number;
}

export interface DistrictSummary {
  districtName: string;
  pinCode?: string;
  state?: string;
  isActive: boolean;
  atmCount: number;
  regionCount: number;
  activeATMs: number;
  maintenanceATMs: number;
}

export interface BankSummary {
  bankName: string;
  totalATMs: number;
  activeATMs: number;
  inactiveATMs: number;
  maintenanceATMs: number;
  onsiteATMs: number;
  offsiteATMs: number;
}

export interface JobTrend {
  date: string;
  label: string;
  created: number;
  completed: number;
}

export const getDashboardStats = async (): Promise<DashboardStats> => {
  const response = await api.get("/dashboard/stats");

  return response.data.data;
};

export const getRecentActivity = async (
  limit = 20,
): Promise<{ activities: RecentActivity[] }> => {
  const response = await api.get("/dashboard/recent-activity", {
    params: { limit },
  });

  return response.data.data;
};

export const getEmployeePerformance = async (
  period: "week" | "month" | "year" = "month",
): Promise<{
  performance: EmployeePerformance[];
  period: string;
}> => {
  const response = await api.get("/dashboard/employee-performance", {
    params: { period },
  });

  return response.data.data;
};

export const getDistrictSummary = async (): Promise<{
  summary: DistrictSummary[];
}> => {
  const response = await api.get("/dashboard/district-summary");

  return response.data.data;
};

export const getBankSummary = async (): Promise<{
  summary: BankSummary[];
}> => {
  const response = await api.get("/dashboard/bank-summary");

  return response.data.data;
};

export const getJobTrends = async (
  period: "week" | "month" | "year" = "week",
): Promise<{
  trends: JobTrend[];
  period: string;
}> => {
  const response = await api.get("/dashboard/job-trends", {
    params: { period },
  });

  return response.data.data;
};
