import {
  Chart as ChartJS,
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
} from "chart.js";

import { Line } from "react-chartjs-2";

import { useJobTrends } from "@/features/dashboard/hooks/useJobTrends";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
);

export default function JobTrendsChart() {
  const { data, isLoading, error } = useJobTrends();

  if (isLoading) {
    return (
      <div className="rounded-xl border bg-white p-5 shadow-sm">
        <h2 className="font-semibold">Job Trends</h2>

        <div className="mt-6 h-64 animate-pulse rounded-lg bg-gray-100" />
      </div>
    );
  }

  if (error || !data) {
    return (
      <div className="rounded-xl border bg-white p-5 shadow-sm">
        <h2 className="font-semibold">Job Trends</h2>

        <p className="mt-4 text-sm text-red-500">Failed to load job trends.</p>
      </div>
    );
  }

  const chartData = {
    labels: data.trends.map((item) => item.label),

    datasets: [
      {
        label: "Created",
        data: data.trends.map((item) => item.created),
        tension: 0.3,
      },
      {
        label: "Completed",
        data: data.trends.map((item) => item.completed),
        tension: 0.3,
      },
    ],
  };

  return (
    <div className="rounded-xl border bg-white p-5 shadow-sm">
      <div className="mb-5">
        <h2 className="font-semibold">Job Trends</h2>

        <p className="mt-1 text-sm text-gray-500">
          Jobs created vs completed this week.
        </p>
      </div>

      <div className="h-72">
        <Line
          data={chartData}
          options={{
            responsive: true,
            maintainAspectRatio: false,
            plugins: {
              legend: {
                position: "top",
              },
            },
          }}
        />
      </div>
    </div>
  );
}
