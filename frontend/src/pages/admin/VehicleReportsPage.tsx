import { useState } from "react";
import { isAxiosError } from "axios";
import { Download, FileSpreadsheet } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useVehicles } from "@/features/vehicles/hooks/useVehicles";
import { useEmployeeOptions } from "@/features/employees/hooks/useEmployeeOptions";
import { downloadVehicleMileageExport } from "@/services/vehicle.service";

const controlClass =
  "h-10 w-full rounded-md border border-input bg-background px-3 text-sm focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring";

function saveBlob(blob: Blob, filename: string) {
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  anchor.click();
  URL.revokeObjectURL(url);
}

export default function VehicleReportsPage() {
  const [fromDate, setFromDate] = useState("");
  const [toDate, setToDate] = useState("");
  const [vehicleId, setVehicleId] = useState("");
  const [employeeId, setEmployeeId] = useState("");
  const [exporting, setExporting] = useState<"vehicle" | "employee" | null>(
    null,
  );
  const vehiclesQuery = useVehicles({ page: 1, limit: 100 });
  const employeesQuery = useEmployeeOptions("", 1);

  const exportReport = async (reportType: "vehicle" | "employee") => {
    if (!fromDate || !toDate || fromDate > toDate) {
      toast.error("Choose a valid start and end date.");
      return;
    }
    setExporting(reportType);
    try {
      const result = await downloadVehicleMileageExport({
        reportType,
        fromDate,
        toDate,
        id:
          reportType === "vehicle"
            ? vehicleId || undefined
            : employeeId || undefined,
      });
      saveBlob(result.blob, result.filename);
      toast.success("Excel report downloaded.");
    } catch (error) {
      const message = isAxiosError<{ message?: string }>(error)
        ? error.response?.data?.message || "The report could not be generated."
        : "The report could not be generated.";
      toast.error(message);
    } finally {
      setExporting(null);
    }
  };

  return (
    <main className="space-y-5 p-4 sm:p-6">
      <header>
        <p className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Reporting
        </p>
        <h1 className="mt-1 text-2xl font-semibold">Mileage exports</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Completed sessions only · dates use Asia/Kolkata.
        </p>
      </header>
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2">
            <FileSpreadsheet className="size-5" /> Excel reports
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <label className="space-y-1 text-sm font-medium">
              From date
              <input
                type="date"
                required
                className={controlClass}
                value={fromDate}
                onChange={(event) => setFromDate(event.target.value)}
              />
            </label>
            <label className="space-y-1 text-sm font-medium">
              To date
              <input
                type="date"
                required
                className={controlClass}
                value={toDate}
                onChange={(event) => setToDate(event.target.value)}
              />
            </label>
            <label className="space-y-1 text-sm font-medium">
              Vehicle filter (optional)
              <select
                className={controlClass}
                value={vehicleId}
                onChange={(event) => setVehicleId(event.target.value)}
              >
                <option value="">All bikes</option>
                {(vehiclesQuery.data?.vehicles ?? []).map((vehicle) => (
                  <option value={vehicle._id} key={vehicle._id}>
                    {vehicle.registrationNumber}
                  </option>
                ))}
              </select>
            </label>
            <label className="space-y-1 text-sm font-medium">
              Employee filter (optional)
              <select
                className={controlClass}
                value={employeeId}
                onChange={(event) => setEmployeeId(event.target.value)}
              >
                <option value="">All employees</option>
                {(employeesQuery.data?.employees ?? []).map((employee) => (
                  <option value={employee._id} key={employee._id}>
                    {employee.firstName} {employee.lastName} ·{" "}
                    {employee.employeeCode}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="flex flex-wrap gap-2 border-t pt-4">
            <Button
              disabled={exporting !== null}
              onClick={() => void exportReport("vehicle")}
            >
              <Download />{" "}
              {exporting === "vehicle" ? "Preparing…" : "Export vehicle-wise"}
            </Button>
            <Button
              variant="outline"
              disabled={exporting !== null}
              onClick={() => void exportReport("employee")}
            >
              <Download />{" "}
              {exporting === "employee" ? "Preparing…" : "Export employee-wise"}
            </Button>
          </div>
          <p className="text-xs text-muted-foreground">
            Exports include complete filtered totals and use the employee and
            vehicle identity saved on each session. Configured date-range and
            row limits are enforced by the server.
          </p>
        </CardContent>
      </Card>
    </main>
  );
}
