import { useEffect, useState } from "react";
import {
  CategoryScale,
  Chart as ChartJS,
  Legend,
  LineElement,
  LinearScale,
  PointElement,
  Tooltip,
} from "chart.js";
import { motion, useReducedMotion } from "motion/react";
import { Line } from "react-chartjs-2";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { SkeletonBlock } from "@/features/dashboard/components/DashboardSkeleton";
import { useJobTrends } from "@/features/dashboard/hooks/useJobTrends";

ChartJS.register(
  CategoryScale,
  LinearScale,
  PointElement,
  LineElement,
  Tooltip,
  Legend,
);

interface ChartColors {
  created: string;
  completed: string;
  foreground: string;
  mutedForeground: string;
  border: string;
  card: string;
}

function readChartColors(): ChartColors {
  const styles = getComputedStyle(document.documentElement);
  const isDark =
    document.documentElement.classList.contains("dark") ||
    document.body.classList.contains("dark");

  return {
    created: isDark ? "#60a5fa" : "#1d4ed8",
    completed: isDark ? "#2dd4bf" : "#0f766e",
    foreground: styles.getPropertyValue("--foreground").trim(),
    mutedForeground: styles.getPropertyValue("--muted-foreground").trim(),
    border: styles.getPropertyValue("--border").trim(),
    card: styles.getPropertyValue("--card").trim(),
  };
}

export default function JobTrendsChart() {
  const { data, isLoading } = useJobTrends();
  const reducedMotion = useReducedMotion();
  const [colors, setColors] = useState(readChartColors);

  useEffect(() => {
    const updateColors = () => setColors(readChartColors());
    const observer = new MutationObserver(updateColors);
    const observedElements = [document.documentElement, document.body];
    observedElements.forEach((element) =>
      observer.observe(element, {
        attributes: true,
        attributeFilter: ["class", "style"],
      }),
    );
    return () => observer.disconnect();
  }, []);

  if (isLoading && !data) {
    return (
      <Card className="min-w-0 self-start shadow-sm">
        <CardHeader className="p-4 sm:p-5">
          <CardTitle className="text-base">Job Trends</CardTitle>
          <SkeletonBlock className="mt-2 h-3 w-3/4" />
        </CardHeader>
        <CardContent className="p-4 pt-0 sm:p-5 sm:pt-0">
          <SkeletonBlock className="h-64 w-full sm:h-72" />
        </CardContent>
      </Card>
    );
  }

  if (!data) {
    return (
      <Card className="min-w-0 self-start shadow-sm">
        <CardHeader className="p-4 sm:p-5">
          <CardTitle className="text-base">Job Trends</CardTitle>
        </CardHeader>
        <CardContent className="p-4 pt-0 sm:p-5 sm:pt-0">
          <p className="text-sm text-destructive" role="alert">
            Failed to load job trends.
          </p>
        </CardContent>
      </Card>
    );
  }

  return (
    <motion.div
      initial={reducedMotion ? false : { opacity: 0, y: 8 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.28 }}
      className="min-w-0 self-start"
    >
      <Card className="h-fit min-w-0 self-start shadow-sm">
        <CardHeader className="p-4 sm:p-5">
          <CardTitle className="text-base">Job Trends</CardTitle>
          <p className="text-sm text-muted-foreground">
            Jobs created vs completed this week.
          </p>
        </CardHeader>
        <CardContent className="p-4 pt-0 sm:p-5 sm:pt-0">
          {data.trends.length === 0 ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              No job trend data available for this period.
            </p>
          ) : (
            <div
              role="img"
              aria-label={`Jobs created versus completed this week: ${data.trends
                .map(
                  (item) =>
                    `${item.label}: ${item.created} created, ${item.completed} completed`,
                )
                .join("; ")}.`}
              className="relative h-64 min-h-0 w-full min-w-0 sm:h-72"
            >
              <Line
                data={{
                  labels: data.trends.map((item) => item.label),
                  datasets: [
                    {
                      label: "Created",
                      data: data.trends.map((item) => item.created),
                      borderColor: colors.created,
                      pointBackgroundColor: colors.created,
                      pointBorderColor: colors.card,
                      pointHoverRadius: 5,
                      pointStyle: "circle",
                      borderWidth: 2,
                      tension: 0.3,
                    },
                    {
                      label: "Completed",
                      data: data.trends.map((item) => item.completed),
                      borderColor: colors.completed,
                      pointBackgroundColor: colors.completed,
                      pointBorderColor: colors.card,
                      pointHoverRadius: 5,
                      pointStyle: "rectRot",
                      borderDash: [5, 4],
                      borderWidth: 2,
                      tension: 0.3,
                    },
                  ],
                }}
                options={{
                  responsive: true,
                  maintainAspectRatio: false,
                  interaction: { mode: "index", intersect: false },
                  animation: reducedMotion ? false : undefined,
                  plugins: {
                    legend: {
                      position: "top",
                      align: "start",
                      labels: {
                        color: colors.foreground,
                        usePointStyle: true,
                        boxWidth: 8,
                        padding: 16,
                      },
                    },
                  },
                  scales: {
                    x: {
                      grid: { display: false, color: colors.border },
                      border: { color: colors.border },
                      ticks: {
                        color: colors.mutedForeground,
                        maxRotation: 0,
                        autoSkip: true,
                      },
                    },
                    y: {
                      beginAtZero: true,
                      grid: { color: colors.border },
                      border: { color: colors.border },
                      ticks: { color: colors.mutedForeground, precision: 0 },
                    },
                  },
                }}
              />
            </div>
          )}
        </CardContent>
      </Card>
    </motion.div>
  );
}
