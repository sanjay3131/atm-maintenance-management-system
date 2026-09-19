import { useDashboardStats } from "@/features/dashboard/hooks/useDashboardStats";

export default function AdminDashboardPage() {
  const { data, isLoading, error } = useDashboardStats();

  if (isLoading) {
    return <div className="p-6">Loading dashboard...</div>;
  }

  if (error) {
    return <div className="p-6 text-red-500">Failed to load dashboard</div>;
  }

  return (
    <div className="p-6 space-y-6">
      <h1 className="text-3xl font-bold">Admin Dashboard</h1>

      <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="rounded-xl border p-4">
          <p className="text-sm text-gray-500">Total Jobs</p>

          <h2 className="text-3xl font-bold">{data?.jobs.total}</h2>
        </div>

        <div className="rounded-xl border p-4">
          <p className="text-sm text-gray-500">Pending Jobs</p>

          <h2 className="text-3xl font-bold">{data?.jobs.pending}</h2>
        </div>

        <div className="rounded-xl border p-4">
          <p className="text-sm text-gray-500">Employees</p>

          <h2 className="text-3xl font-bold">{data?.employees.total}</h2>
        </div>

        <div className="rounded-xl border p-4">
          <p className="text-sm text-gray-500">Total ATMs</p>

          <h2 className="text-3xl font-bold">{data?.atms.total}</h2>
        </div>
      </div>

      <div className="rounded-xl border p-6">
        <h2 className="mb-4 text-xl font-semibold">Complaints</h2>

        <div className="grid grid-cols-2 gap-4 md:grid-cols-4">
          <div>
            <p className="text-sm text-gray-500">Open</p>
            <p className="text-2xl font-bold">{data?.complaints.open}</p>
          </div>

          <div>
            <p className="text-sm text-gray-500">Resolved</p>
            <p className="text-2xl font-bold">{data?.complaints.resolved}</p>
          </div>

          <div>
            <p className="text-sm text-gray-500">Critical</p>
            <p className="text-2xl font-bold">
              {data?.complaints.criticalOpen}
            </p>
          </div>

          <div>
            <p className="text-sm text-gray-500">Today</p>
            <p className="text-2xl font-bold">{data?.complaints.today}</p>
          </div>
        </div>
      </div>
    </div>
  );
}
