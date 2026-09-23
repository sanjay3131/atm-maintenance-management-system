import { BriefcaseBusiness, Monitor, Users, AlertTriangle } from "lucide-react";

import { useDashboardStats } from "@/features/dashboard/hooks/useDashboardStats";
import { useRecentActivity } from "@/features/dashboard/hooks/useRecentActivity";
import JobTrendsChart from "@/features/dashboard/components/JobTrendsChart";
import EmployeePerformance from "@/features/dashboard/components/EmployeePerformance";
import OperationsSummary from "@/features/dashboard/components/OperationsSummary";
export default function AdminDashboardPage() {
  const { data, isLoading, error } = useDashboardStats();

  const { data: activityData, isLoading: isActivityLoading } =
    useRecentActivity();
  if (isLoading) {
    return (
      <div className="p-6">
        <p className="text-sm text-gray-500">Loading dashboard...</p>
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="p-6">
        <div className="rounded-xl border border-red-200 bg-red-50 p-4 text-red-600">
          Failed to load dashboard data.
        </div>
      </div>
    );
  }

  const cards = [
    {
      title: "Total Jobs",
      value: data.jobs.total,
      description: `${data.jobs.pending} pending`,
      icon: BriefcaseBusiness,
    },
    {
      title: "Total ATMs",
      value: data.atms.total,
      description: `${data.atms.active} active`,
      icon: Monitor,
    },
    {
      title: "Employees",
      value: data.employees.total,
      description: `${data.employees.workingToday} working today`,
      icon: Users,
    },
    {
      title: "Open Complaints",
      value: data.complaints.open,
      description: `${data.complaints.criticalOpen} critical`,
      icon: AlertTriangle,
    },
  ];

  return (
    <div className="space-y-6 p-6">
      {/* Header */}

      <div>
        <h1 className="text-2xl font-bold tracking-tight">Dashboard</h1>

        <p className="mt-1 text-sm text-gray-500">
          Overview of your ATM maintenance operations.
        </p>
      </div>

      {/* KPI Cards */}

      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => {
          const Icon = card.icon;

          return (
            <div
              key={card.title}
              className="rounded-xl border bg-white p-5 shadow-sm"
            >
              <div className="flex items-center justify-between">
                <p className="text-sm font-medium text-gray-500">
                  {card.title}
                </p>

                <div className="rounded-lg bg-gray-100 p-2">
                  <Icon className="h-5 w-5 text-gray-600" />
                </div>
              </div>

              <div className="mt-4">
                <p className="text-3xl font-bold tracking-tight">
                  {card.value}
                </p>

                <p className="mt-1 text-sm text-gray-500">{card.description}</p>
              </div>
            </div>
          );
        })}
      </div>

      {/* Job Summary */}

      <div className="grid gap-4 lg:grid-cols-2">
        <div className="rounded-xl border bg-white p-5 shadow-sm">
          <h2 className="font-semibold">Job Status</h2>

          <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="text-sm text-gray-500">Pending</p>
              <p className="mt-1 text-2xl font-bold">{data.jobs.pending}</p>
            </div>

            <div>
              <p className="text-sm text-gray-500">Assigned</p>
              <p className="mt-1 text-2xl font-bold">{data.jobs.assigned}</p>
            </div>

            <div>
              <p className="text-sm text-gray-500">In Progress</p>
              <p className="mt-1 text-2xl font-bold">{data.jobs.inProgress}</p>
            </div>

            <div>
              <p className="text-sm text-gray-500">Completed</p>
              <p className="mt-1 text-2xl font-bold">{data.jobs.completed}</p>
            </div>
          </div>
        </div>

        {/* Complaints */}

        <div className="rounded-xl border bg-white p-5 shadow-sm">
          <h2 className="font-semibold">Complaints</h2>

          <div className="mt-5 grid grid-cols-2 gap-4 sm:grid-cols-4">
            <div>
              <p className="text-sm text-gray-500">Open</p>
              <p className="mt-1 text-2xl font-bold">{data.complaints.open}</p>
            </div>

            <div>
              <p className="text-sm text-gray-500">Assigned</p>
              <p className="mt-1 text-2xl font-bold">
                {data.complaints.assigned}
              </p>
            </div>

            <div>
              <p className="text-sm text-gray-500">In Progress</p>
              <p className="mt-1 text-2xl font-bold">
                {data.complaints.inProgress}
              </p>
            </div>

            <div>
              <p className="text-sm text-gray-500">Resolved</p>
              <p className="mt-1 text-2xl font-bold">
                {data.complaints.resolved}
              </p>
            </div>
          </div>
        </div>
        {/* Job Trends */}
        <JobTrendsChart />

        {/* Employee Performance */}

        <EmployeePerformance />

        {/* Operations Summary */}
        <OperationsSummary />

        {/* Recent Activity */}

        <div className="rounded-xl border bg-white p-5 shadow-sm">
          <div className="flex items-center justify-between">
            <div>
              <h2 className="font-semibold">Recent Activity</h2>

              <p className="mt-1 text-sm text-gray-500">
                Latest jobs and complaints.
              </p>
            </div>
          </div>

          <div className="mt-5">
            {isActivityLoading ? (
              <p className="text-sm text-gray-500">Loading activity...</p>
            ) : !activityData?.activities.length ? (
              <p className="text-sm text-gray-500">No recent activity.</p>
            ) : (
              <div className="divide-y">
                {activityData.activities.map((activity) => (
                  <div
                    key={`${activity.type}-${activity.id}`}
                    className="flex items-center justify-between gap-4 py-4"
                  >
                    <div className="min-w-0">
                      <p className="truncate text-sm font-medium">
                        {activity.title}
                      </p>

                      <p className="mt-1 text-xs text-gray-500">
                        {activity.atmName}
                        {activity.employeeName
                          ? ` • ${activity.employeeName}`
                          : ""}
                      </p>
                    </div>

                    <div className="shrink-0 text-right">
                      <p className="text-xs font-medium">{activity.status}</p>

                      <p className="mt-1 text-xs text-gray-400">
                        {activity.priority}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
