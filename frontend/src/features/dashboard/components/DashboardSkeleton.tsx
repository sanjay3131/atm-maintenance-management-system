import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";

export function SkeletonBlock({ className = "" }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={`animate-pulse rounded-md bg-muted ${className}`}
    />
  );
}

export function DashboardCardSkeleton({
  title,
  kind = "summary",
  className = "",
}: {
  title: string;
  kind?: "summary" | "chart" | "table" | "activity";
  className?: string;
}) {
  return (
    <Card className={`min-w-0 ${className}`}>
      <CardHeader className="p-4 sm:p-5">
        <CardTitle className="text-base">{title}</CardTitle>
        <SkeletonBlock className="mt-2 h-3 w-3/4" />
      </CardHeader>
      <CardContent className="space-y-3 px-4 pb-4 sm:px-5 sm:pb-5">
        {kind === "chart" ? (
          <SkeletonBlock className="h-64 w-full sm:h-72" />
        ) : kind === "table" ? (
          <>
            <SkeletonBlock className="h-10 w-full" />
            {Array.from({ length: 4 }, (_, index) => (
              <SkeletonBlock key={index} className="h-8 w-full" />
            ))}
          </>
        ) : kind === "activity" ? (
          Array.from({ length: 4 }, (_, index) => (
            <div key={index} className="space-y-2 border-b pb-3 last:border-0">
              <SkeletonBlock className="h-4 w-2/3" />
              <SkeletonBlock className="h-3 w-1/2" />
            </div>
          ))
        ) : (
          <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            {Array.from({ length: 4 }, (_, index) => (
              <div key={index} className="space-y-2">
                <SkeletonBlock className="h-3 w-2/3" />
                <SkeletonBlock className="h-7 w-1/2" />
              </div>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function DashboardLoadingSkeleton() {
  return (
    <div
      className="min-w-0 space-y-6 p-4 sm:p-6 lg:p-8"
      role="status"
      aria-label="Loading dashboard"
    >
      <div className="space-y-2">
        <SkeletonBlock className="h-8 w-44" />
        <SkeletonBlock className="h-4 w-72 max-w-full" />
      </div>
      <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {Array.from({ length: 4 }, (_, index) => (
          <Card key={index} className="min-w-0 p-5">
            <SkeletonBlock className="h-4 w-2/3" />
            <SkeletonBlock className="mt-5 h-9 w-1/2" />
            <SkeletonBlock className="mt-2 h-4 w-3/4" />
          </Card>
        ))}
      </div>
      <div className="grid min-w-0 items-start gap-4 md:grid-cols-2 lg:grid-cols-4">
        <div className="grid min-w-0 gap-4 sm:grid-cols-2 md:col-span-2 lg:col-span-4">
          <DashboardCardSkeleton title="Job Status" />
          <DashboardCardSkeleton title="Complaints" />
        </div>
        <DashboardCardSkeleton
          title="Job Trends"
          kind="chart"
          className="md:col-span-1 lg:col-span-4"
        />
        <DashboardCardSkeleton
          title="Employee Performance"
          kind="table"
          className="md:col-span-1 lg:col-span-4"
        />
        <div className="grid min-w-0 gap-4 sm:grid-cols-2 md:col-span-2 lg:col-span-2">
          <DashboardCardSkeleton title="District Summary" kind="table" />
          <DashboardCardSkeleton title="Bank Summary" kind="table" />
        </div>
        <DashboardCardSkeleton
          title="Recent Activity"
          kind="activity"
          className="md:col-span-2 lg:col-span-2"
        />
      </div>
      <span className="sr-only">Loading dashboard data...</span>
    </div>
  );
}
