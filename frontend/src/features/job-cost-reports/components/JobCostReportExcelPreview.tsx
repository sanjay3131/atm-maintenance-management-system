import type { JobCostReport } from "../types/jobCostReport.types";

const MIN_VISIT_SLOTS = 3;
const MIN_MATERIAL_SLOTS = 4;

const display = (value: string | number | null | undefined) =>
  value === null || value === undefined || value === "" ? "" : String(value);

const formatDate = (value: string | null | undefined) => {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? ""
    : date.toLocaleDateString("en-IN", {
        day: "2-digit",
        month: "2-digit",
        year: "numeric",
      });
};

const money = (value: number) =>
  Number.isFinite(value) ? value.toFixed(2) : "0.00";

const numeric = (value: string | number | null | undefined) => {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
};

function effectiveSnapshotValue(
  report: JobCostReport,
  field: keyof JobCostReport["reportFields"]["overrides"],
) {
  const override = report.reportFields.overrides[field];
  if (override.isOverridden) return override.value;
  return report.jobSnapshot[field];
}

function SectionHeading({ children }: { children: string }) {
  return (
    <div className="border-y-2 border-slate-700 bg-slate-100 px-2 py-2 text-sm font-bold text-slate-900">
      {children}
    </div>
  );
}

export default function JobCostReportExcelPreview({
  report,
}: {
  report: JobCostReport;
}) {
  const visitSlots = Math.max(MIN_VISIT_SLOTS, report.serviceVisits.length);
  const materialSlots = Math.max(
    MIN_MATERIAL_SLOTS,
    report.materialSnapshot.length,
  );
  const materialTotal = report.materialSnapshot.reduce(
    (total, material) => total + numeric(material.lineCostSnapshot),
    0,
  );
  const laborCost = numeric(report.reportFields.serviceLaborCost);
  const subtotal = materialTotal + laborCost;
  const gstRate = numeric(report.reportFields.gstRate);
  const gstAmount = gstRate === 18 ? subtotal * 0.18 : 0;
  const finalAmount = subtotal + gstAmount;
  const visits = [...report.serviceVisits].sort(
    (left, right) => left.sequence - right.sequence,
  );
  const materials = report.materialSnapshot;
  const atmLocation = [
    display(report.jobSnapshot.atmId),
    display(effectiveSnapshotValue(report, "atmLocationName")),
  ]
    .filter(Boolean)
    .join(" — ");

  return (
    <div className="min-w-0 rounded-lg border border-slate-400 bg-slate-50 p-2 text-[11px] text-slate-900 shadow-sm sm:p-3">
      <div className="overflow-hidden border-2 border-slate-700 bg-white">
        <div className="border-b-2 border-slate-700 px-3 py-3 text-center text-base font-bold tracking-wide">
          SENTHUR PAPERS AND ENGINEERING - WORK ORDER SUMMARY
        </div>

        <SectionHeading>1. COMPLAINT &amp; CALL DETAILS</SectionHeading>
        <table className="w-full table-fixed border-collapse">
          <tbody>
            <tr>
              <th className="w-[18%] border border-slate-300 p-1 text-left font-semibold">
                Call ID / Complaint No:
              </th>
              <td className="w-[32%] border border-slate-300 p-1">
                {display(report.jobSnapshot.complaintNumber)}
              </td>
              <th className="w-[18%] border border-slate-300 p-1 text-left font-semibold">
                Call Log Date:
              </th>
              <td className="w-[32%] border border-slate-300 p-1">
                {formatDate(effectiveSnapshotValue(report, "callLogDate"))}
              </td>
            </tr>
            <tr>
              <th className="border border-slate-300 p-1 text-left font-semibold">
                Bank Name &amp; Branch:
              </th>
              <td className="border border-slate-300 p-1" colSpan={1}>
                {[effectiveSnapshotValue(report, "bankName"), effectiveSnapshotValue(report, "branch")]
                  .filter(Boolean)
                  .join(" — ")}
              </td>
              <th className="border border-slate-300 p-1 text-left font-semibold">
                ATM ID / Location:
              </th>
              <td className="border border-slate-300 p-1">{atmLocation}</td>
            </tr>
            <tr>
              <th className="border border-slate-300 p-1 text-left font-semibold">
                Nature of Complaint:
              </th>
              <td className="border border-slate-300 p-1">
                {display(effectiveSnapshotValue(report, "complaintDescription"))}
              </td>
              <th className="border border-slate-300 p-1 text-left font-semibold">
                Current Status:
              </th>
              <td className="border border-slate-300 p-1">
                {display(report.jobSnapshot.currentStatus)}
              </td>
            </tr>
            <tr>
              <th className="border border-slate-300 p-1 text-left font-semibold">
                Assigned Technician:
              </th>
              <td className="border border-slate-300 p-1">
                {display(effectiveSnapshotValue(report, "assignedTechnicianName"))}
              </td>
              <th className="border border-slate-300 p-1 text-left font-semibold">
                Work Type:
              </th>
              <td className="border border-slate-300 p-1">
                {display(effectiveSnapshotValue(report, "workType"))}
              </td>
            </tr>
          </tbody>
        </table>

        <SectionHeading>2. SERVICE VISITS LOG (MULTIPLE VISITS)</SectionHeading>
        <table className="w-full table-fixed border-collapse">
          <thead>
            <tr className="bg-slate-100">
              <th className="w-[8%] border border-slate-300 p-1">Visit ID</th>
              <th className="w-[14%] border border-slate-300 p-1">Visit Date</th>
              <th className="w-[44%] border border-slate-300 p-1">Work Done / Actions Taken</th>
              <th className="w-[15%] border border-slate-300 p-1">Status</th>
              <th className="w-[19%] border border-slate-300 p-1">Sign-off / Photo</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: visitSlots }, (_, index) => {
              const visit = visits[index];
              return (
                <tr key={visit?._id ?? `preview-visit-${index}`}>
                  <td className="border border-slate-300 p-1 text-center">
                    {display(visit?.sequence)}
                  </td>
                  <td className="border border-slate-300 p-1">
                    {formatDate(visit?.visitDate)}
                  </td>
                  <td className="break-words border border-slate-300 p-1">
                    {display(visit?.workPerformed)}
                  </td>
                  <td className="break-words border border-slate-300 p-1">
                    {display(visit?.status)}
                  </td>
                  <td className="break-words border border-slate-300 p-1">
                    {display(visit?.signOffOrPhotoReference)}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <SectionHeading>3. MATERIALS CONSUMED LOG (MULTIPLE MATERIALS)</SectionHeading>
        <table className="w-full table-fixed border-collapse">
          <thead>
            <tr className="bg-slate-100">
              <th className="w-[10%] border border-slate-300 p-1">Material ID</th>
              <th className="w-[30%] border border-slate-300 p-1">Material Name &amp; Specification</th>
              <th className="w-[16%] border border-slate-300 p-1">Qty / Unit</th>
              <th className="w-[16%] border border-slate-300 p-1">Unit Rate (INR)</th>
              <th className="w-[16%] border border-slate-300 p-1">Total Amount (INR)</th>
              <th className="w-[12%] border border-slate-300 p-1">Billing Status</th>
            </tr>
          </thead>
          <tbody>
            {Array.from({ length: materialSlots }, (_, index) => {
              const material = materials[index];
              return (
                <tr key={material?.usageId ?? `preview-material-${index}`}>
                  <td className="border border-slate-300 p-1 text-center">
                    {material ? index + 1 : ""}
                  </td>
                  <td className="break-words border border-slate-300 p-1">
                    {display(material?.itemNameSnapshot)}
                  </td>
                  <td className="break-words border border-slate-300 p-1">
                    {material
                      ? `${material.quantity} ${material.unitSnapshot}`
                      : ""}
                  </td>
                  <td className="border border-slate-300 p-1 text-right">
                    {material ? money(numeric(material.unitCostSnapshot)) : ""}
                  </td>
                  <td className="border border-slate-300 p-1 text-right">
                    {material ? money(numeric(material.lineCostSnapshot)) : ""}
                  </td>
                  <td className="border border-slate-300 p-1">
                    {material ? "" : ""}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>

        <SectionHeading>4. OFFICE BILLING &amp; TAX VERIFICATION (FOR INVOICING)</SectionHeading>
        <table className="w-full table-fixed border-collapse">
          <tbody>
            <tr>
              <th className="w-[45%] border border-slate-300 p-1 text-left font-semibold">
                Total Material Cost:
              </th>
              <td className="w-[15%] border border-slate-300 p-1 text-right">
                {money(materialTotal)}
              </td>
              <th className="w-[25%] border border-slate-300 p-1 text-left font-semibold">
                Bank Purchase Order (PO) #:
              </th>
              <td className="w-[15%] border border-slate-300 p-1">
                {display(report.reportFields.bankPurchaseOrderNumber)}
              </td>
            </tr>
            <tr>
              <th className="border border-slate-300 p-1 text-left font-semibold">
                Total Service Labor Cost:
              </th>
              <td className="border border-slate-300 p-1 text-right">{money(laborCost)}</td>
              <th className="border border-slate-300 p-1 text-left font-semibold">
                Our Tax Invoice No:
              </th>
              <td className="border border-slate-300 p-1">
                {display(report.reportFields.taxInvoiceNumber)}
              </td>
            </tr>
            <tr>
              <th className="border border-slate-300 p-1 text-left font-semibold">
                Subtotal (Material + Labor):
              </th>
              <td className="border border-slate-300 p-1 text-right">{money(subtotal)}</td>
              <th className="border border-slate-300 p-1 text-left font-semibold">
                GST Rate Applied:
              </th>
              <td className="border border-slate-300 p-1">
                {gstRate.toFixed(2)}%
              </td>
            </tr>
            <tr>
              <th className="border border-slate-300 p-1 text-left font-semibold">
                GST Tax Amount:
              </th>
              <td className="border border-slate-300 p-1 text-right">{money(gstAmount)}</td>
              <th className="border border-slate-300 p-1 text-left font-semibold">
                Filing Period Visibility:
              </th>
              <td className="border border-slate-300 p-1">
                {display(report.reportFields.filingPeriod)}
              </td>
            </tr>
            <tr className="font-bold">
              <th className="border border-slate-300 p-1 text-left">FINAL BILL AMOUNT:</th>
              <td className="border border-slate-300 p-1 text-right">{money(finalAmount)}</td>
              <th className="border border-slate-300 p-1 text-left">
                Office Billing Status:
              </th>
              <td className="border border-slate-300 p-1">
                {display(report.reportFields.officeBillingStatus)}
              </td>
            </tr>
          </tbody>
        </table>
      </div>
      <p className="mt-2 text-xs text-muted-foreground">
        HTML representation of the approved Excel template. Final workbook formulas and print settings are generated by the server export.
      </p>
    </div>
  );
}
