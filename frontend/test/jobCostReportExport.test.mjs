import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { getJobCostReportDownloadFilename } from "../src/features/job-cost-reports/utils/jobCostReportExport.utils.ts";

test("extracts safe filenames from Content-Disposition", () => {
  assert.equal(
    getJobCostReportDownloadFilename(
      'attachment; filename="job-cost-report-WO-001.xlsx"',
      "job-1",
    ),
    "job-cost-report-WO-001.xlsx",
  );
  assert.equal(
    getJobCostReportDownloadFilename(
      "attachment; filename*=UTF-8''job%20cost%20report.xlsx",
      "job-1",
    ),
    "job_cost_report.xlsx",
  );
  assert.equal(
    getJobCostReportDownloadFilename(
      'attachment; filename="../unsafe/report.xlsx"',
      "job-1",
    ),
    "report.xlsx",
  );
});

test("uses a safe fallback filename when the response has no filename", () => {
  assert.equal(
    getJobCostReportDownloadFilename(undefined, "WO/001"),
    "job-cost-report-WO_001.xlsx",
  );
});

test("uses the authenticated report client and confirm-before-download flow", async () => {
  const service = await readFile(
    new URL(
      "../src/features/job-cost-reports/services/jobCostReport.service.ts",
      import.meta.url,
    ),
    "utf8",
  );
  const component = await readFile(
    new URL(
      "../src/features/job-cost-reports/components/JobCostReportSection.tsx",
      import.meta.url,
    ),
    "utf8",
  );
  const preview = await readFile(
    new URL(
      "../src/features/job-cost-reports/components/JobCostReportExcelPreview.tsx",
      import.meta.url,
    ),
    "utf8",
  );

  assert.match(service, /api\.get<Blob>\(\s*`\/jobs\/\$\{jobId\}\/cost-report\/export\.xlsx`/s);
  assert.match(service, /responseType:\s*"blob"/);
  assert.match(service, /response\.headers\["content-disposition"\]/);
  assert.match(component, /URL\.createObjectURL\(blob\)/);
  assert.match(component, /URL\.revokeObjectURL\(url\)/);
  assert.match(component, /Confirm & Download Excel/);
  assert.match(component, /await updateMutation\.mutateAsync/);
  assert.match(component, /The report was saved, but the Excel download failed/);
  assert.match(component, /Your local edits were preserved/);
  assert.ok(
    component.indexOf("Number(report.reportFields.gstRate)") <
      component.indexOf('report.materialSnapshotStatus !== "REFRESHED"'),
  );
  assert.match(component, /reportFields: localEditableState\.reportFields/);
  assert.match(component, /serviceVisits: localEditableState\.serviceVisits/);
  assert.doesNotMatch(component, /Confirm or discard your local edits before refreshing/);
  assert.match(component, /grid min-w-0 gap-6 lg:grid-cols-2 lg:items-start/);
  assert.doesNotMatch(component, /Save draft/);
  assert.doesNotMatch(component, /Print preview/);
  assert.match(preview, /SERVICE VISITS LOG/);
  assert.match(preview, /MATERIALS CONSUMED LOG/);
  assert.match(preview, /OFFICE BILLING &amp; TAX VERIFICATION/);
  assert.match(preview, /Math\.max\(MIN_VISIT_SLOTS, report\.serviceVisits\.length\)/);
  assert.match(preview, /Math\.max\(\s*MIN_MATERIAL_SLOTS/);
  assert.match(component, /toast\.error/);
});
