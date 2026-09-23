import { useDistrictSummary } from "@/features/dashboard/hooks/useDistrictSummary";
import { useBankSummary } from "@/features/dashboard/hooks/useBankSummary";

export default function OperationsSummary() {
  const districtQuery = useDistrictSummary();
  const bankQuery = useBankSummary();

  return (
    <div className="grid gap-6 xl:grid-cols-1">
      {/* District Summary */}

      <div className="rounded-xl border bg-white p-5 shadow-sm ">
        <h2 className="font-semibold">District Summary</h2>

        <p className="mt-1 text-sm text-gray-500">
          ATM distribution across districts.
        </p>

        <div className="mt-5 overflow-x-hidden">
          {districtQuery.isLoading ? (
            <p className="text-sm text-gray-500">Loading districts...</p>
          ) : districtQuery.error ? (
            <p className="text-sm text-red-500">Failed to load districts.</p>
          ) : districtQuery.data?.summary.length === 0 ? (
            <p className="text-sm text-gray-500">No district data available.</p>
          ) : (
            <table className="w-full min-w-[500px] text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="pb-3 font-medium">District</th>

                  <th className="pb-3 font-medium">ATMs</th>

                  <th className="pb-3 font-medium">Active</th>

                  <th className="pb-3 font-medium">Maintenance</th>
                </tr>
              </thead>

              <tbody className="divide-y">
                {districtQuery.data?.summary.map((district) => (
                  <tr key={district.districtName}>
                    <td className="py-3 font-medium">
                      {district.districtName}
                    </td>

                    <td className="py-3">{district.atmCount}</td>

                    <td className="py-3">{district.activeATMs}</td>

                    <td className="py-3">{district.maintenanceATMs}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>

      {/* Bank Summary */}

      <div className="rounded-xl border bg-white p-5 shadow-sm">
        <h2 className="font-semibold">Bank Summary</h2>

        <p className="mt-1 text-sm text-gray-500">ATM distribution by bank.</p>

        <div className="mt-5 overflow-x-auto">
          {bankQuery.isLoading ? (
            <p className="text-sm text-gray-500">Loading banks...</p>
          ) : bankQuery.error ? (
            <p className="text-sm text-red-500">Failed to load banks.</p>
          ) : bankQuery.data?.summary.length === 0 ? (
            <p className="text-sm text-gray-500">No bank data available.</p>
          ) : (
            <table className="w-full min-w-[500px] text-sm">
              <thead>
                <tr className="border-b text-left text-gray-500">
                  <th className="pb-3 font-medium">Bank</th>

                  <th className="pb-3 font-medium">Total</th>

                  <th className="pb-3 font-medium">Active</th>

                  <th className="pb-3 font-medium">Maintenance</th>
                </tr>
              </thead>

              <tbody className="divide-y">
                {bankQuery.data?.summary.map((bank) => (
                  <tr key={bank.bankName}>
                    <td className="py-3 font-medium">{bank.bankName}</td>

                    <td className="py-3">{bank.totalATMs}</td>

                    <td className="py-3">{bank.activeATMs}</td>

                    <td className="py-3">{bank.maintenanceATMs}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
    </div>
  );
}
