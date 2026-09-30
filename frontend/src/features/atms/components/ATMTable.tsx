import type { ATM } from "../types/atm.types";
import { Link } from "react-router-dom";

interface ATMTableProps {
  atms: ATM[];
  emptyMessage?: string;
}

export default function ATMTable({
  atms,
  emptyMessage = "No ATMs found.",
}: ATMTableProps) {
  return (
    <div className="overflow-x-auto rounded-lg border">
      <table className="w-full text-sm">
        <thead className="border-b bg-muted/50">
          <tr>
            <th className="px-4 py-3 text-left font-medium">ATM ID</th>
            <th className="px-4 py-3 text-left font-medium">Location</th>
            <th className="px-4 py-3 text-left font-medium">Bank</th>
            <th className="px-4 py-3 text-left font-medium">District</th>
            <th className="px-4 py-3 text-left font-medium">Region</th>
            <th className="px-4 py-3 text-left font-medium">Status</th>
          </tr>
        </thead>
        <tbody>
          {atms.length === 0 ? (
            <tr>
              <td
                colSpan={6}
                className="px-4 py-12 text-center text-sm text-muted-foreground"
              >
                {emptyMessage}
              </td>
            </tr>
          ) : (
            atms.map((atm) => (
              <tr key={atm._id} className="border-b">
                <td className="px-4 py-3 font-medium">
                  <Link
                    to={`/admin/atms/${atm._id}`}
                    className="text-primary underline-offset-4 hover:underline"
                  >
                    {atm.atmId}
                  </Link>
                </td>

                <td className="px-4 py-3">
                  <div>{atm.locationName}</div>
                  <div className="text-xs text-muted-foreground">
                    {atm.address}
                  </div>
                </td>

                <td className="px-4 py-3">
                  {atm.bankId?.bankName || "Not assigned"}
                </td>

                <td className="px-4 py-3">
                  {atm.districtId?.districtName || "Not assigned"}
                </td>

                <td className="px-4 py-3">
                  {atm.regionId?.name || "Not assigned"}
                </td>

                <td className="px-4 py-3">{atm.status}</td>
              </tr>
            ))
          )}
        </tbody>
      </table>
    </div>
  );
}
