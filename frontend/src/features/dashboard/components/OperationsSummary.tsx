import {
  Card,
  CardContent,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { SkeletonBlock } from "@/features/dashboard/components/DashboardSkeleton";
import { useBankSummary } from "@/features/dashboard/hooks/useBankSummary";
import { useDistrictSummary } from "@/features/dashboard/hooks/useDistrictSummary";

function SummarySkeleton({ label }: { label: string }) {
  return (
    <div className="space-y-3" role="status" aria-label={`Loading ${label}`}>
      {Array.from({ length: 4 }, (_, index) => (
        <SkeletonBlock key={index} className="h-8 w-full" />
      ))}
    </div>
  );
}

export default function OperationsSummary() {
  const districtQuery = useDistrictSummary();
  const bankQuery = useBankSummary();

  return (
    <div className="grid min-w-0 items-start gap-4 sm:grid-cols-2 lg:grid-cols-1">
      <Card className="h-fit min-w-0 shadow-sm">
        <CardHeader className="p-4 sm:p-5">
          <CardTitle className="text-base">District Summary</CardTitle>
          <p className="text-sm text-muted-foreground">
            ATM distribution across districts.
          </p>
        </CardHeader>
        <CardContent className="p-4 pt-0 sm:p-5 sm:pt-0">
          {districtQuery.isLoading && !districtQuery.data ? (
            <SummarySkeleton label="district summary" />
          ) : districtQuery.isError && !districtQuery.data ? (
            <p className="text-sm text-destructive" role="alert">
              Failed to load districts.
            </p>
          ) : districtQuery.data?.summary.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No district data available.
            </p>
          ) : districtQuery.data ? (
            <div className="min-w-0 overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[500px] text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="p-3 font-medium">District</th>
                    <th className="p-3 font-medium">ATMs</th>
                    <th className="p-3 font-medium">Active</th>
                    <th className="p-3 font-medium">Maintenance</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {districtQuery.data.summary.map((district) => (
                    <tr key={district.districtName}>
                      <td className="p-3 font-medium">
                        {district.districtName}
                      </td>
                      <td className="p-3">{district.atmCount}</td>
                      <td className="p-3">{district.activeATMs}</td>
                      <td className="p-3">{district.maintenanceATMs}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : districtQuery.isLoading ? (
            <div className="space-y-3" role="status" aria-label="Loading districts">
              {Array.from({ length: 4 }, (_, index) => (
                <SkeletonBlock key={index} className="h-8 w-full" />
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Card className="h-fit min-w-0 shadow-sm">
        <CardHeader className="p-4 sm:p-5">
          <CardTitle className="text-base">Bank Summary</CardTitle>
          <p className="text-sm text-muted-foreground">
            ATM distribution by bank.
          </p>
        </CardHeader>
        <CardContent className="p-4 pt-0 sm:p-5 sm:pt-0">
          {bankQuery.isLoading && !bankQuery.data ? (
            <SummarySkeleton label="bank summary" />
          ) : bankQuery.isError && !bankQuery.data ? (
            <p className="text-sm text-destructive" role="alert">
              Failed to load banks.
            </p>
          ) : bankQuery.data?.summary.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              No bank data available.
            </p>
          ) : bankQuery.data ? (
            <div className="min-w-0 overflow-x-auto rounded-lg border">
              <table className="w-full min-w-[500px] text-sm">
                <thead>
                  <tr className="border-b text-left text-muted-foreground">
                    <th className="p-3 font-medium">Bank</th>
                    <th className="p-3 font-medium">Total</th>
                    <th className="p-3 font-medium">Active</th>
                    <th className="p-3 font-medium">Maintenance</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {bankQuery.data.summary.map((bank) => (
                    <tr key={bank.bankName}>
                      <td className="p-3 font-medium">{bank.bankName}</td>
                      <td className="p-3">{bank.totalATMs}</td>
                      <td className="p-3">{bank.activeATMs}</td>
                      <td className="p-3">{bank.maintenanceATMs}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          ) : bankQuery.isLoading ? (
            <div className="space-y-3" role="status" aria-label="Loading banks">
              {Array.from({ length: 4 }, (_, index) => (
                <SkeletonBlock key={index} className="h-8 w-full" />
              ))}
            </div>
          ) : null}
        </CardContent>
      </Card>
    </div>
  );
}
