import { useEmployeePerformance } from "@/features/dashboard/hooks/useEmployeePerformance";

export default function EmployeePerformance() {
  const { data, isLoading, error } = useEmployeePerformance();

  if (isLoading) {
    return (
      <div className="rounded-xl border bg-white p-5 shadow-sm">
        <h2 className="font-semibold">Employee Performance</h2>

        <div className="mt-5 h-48 animate-pulse rounded-lg bg-gray-100" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border bg-white p-5 shadow-sm">
        <h2 className="font-semibold">Employee Performance</h2>

        <p className="mt-4 text-sm text-red-500">
          Failed to load employee performance.
        </p>
      </div>
    );
  }

  return (
    <div className="rounded-xl border bg-white p-5 shadow-sm">
      <div className="mb-5">
        <h2 className="font-semibold">Employee Performance</h2>

        <p className="mt-1 text-sm text-gray-500">
          Performance for this month.
        </p>
      </div>

      {data.performance.length === 0 ? (
        <p className="text-sm text-gray-500">
          No employee performance data available.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full min-w-[700px] text-sm">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <th className="pb-3 font-medium">Employee</th>

                <th className="pb-3 font-medium">Jobs</th>

                <th className="pb-3 font-medium">Completed</th>

                <th className="pb-3 font-medium">Approved</th>

                <th className="pb-3 font-medium">Rejected</th>

                <th className="pb-3 font-medium">Completion</th>
              </tr>
            </thead>

            <tbody className="divide-y">
              {data.performance.map((employee) => (
                <tr key={employee.employeeId}>
                  <td className="py-4">
                    <div>
                      <p className="font-medium">{employee.name}</p>

                      {employee.employeeCode && (
                        <p className="text-xs text-gray-500">
                          {employee.employeeCode}
                        </p>
                      )}
                    </div>
                  </td>

                  <td className="py-4">{employee.totalJobs}</td>

                  <td className="py-4">{employee.completedJobs}</td>

                  <td className="py-4">{employee.approvedJobs}</td>

                  <td className="py-4">{employee.rejectedJobs}</td>

                  <td className="py-4 font-medium">
                    {employee.completionRate}%
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
