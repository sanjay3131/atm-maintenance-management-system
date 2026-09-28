import type { ATM } from "../types/atm.types";

interface ATMTableProps {
  atms: ATM[];
}

export default function ATMTable({ atms }: ATMTableProps) {
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
          {atms.map((atm) => (
            <tr key={atm._id} className="border-b">
              <td className="px-4 py-3 font-medium">{atm.atmId}</td>

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
          ))}
        </tbody>
      </table>
    </div>
  );
}
