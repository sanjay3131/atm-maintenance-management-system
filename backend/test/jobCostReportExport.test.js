import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs/promises";
import ExcelJS from "exceljs";
import AdmZip from "adm-zip";
import jobCostReportRouter from "../src/modules/jobCostReports/jobCostReport.routes.js";
import {
  calculateDynamicRows,
  createJobCostReportWorkbook,
  getJobCostReportTemplatePath,
} from "../src/modules/jobCostReports/jobCostReport.export.service.js";
import { exportCostReport } from "../src/modules/jobCostReports/jobCostReport.controller.js";
import { verifyAccessToken } from "../src/middlewares/auth.middleware.js";
import { authorizeRoles } from "../src/middlewares/role.middleware.js";

const makeReport = (visitCount = 0, materialCount = 0, overrides = {}) => ({
  materialSnapshotStatus: "REFRESHED",
  materialSnapshotFresh: true,
  jobSnapshot: {
    jobId: "job-1",
    jobNumber: "WO-001",
    complaintNumber: "C-001",
    callLogDate: new Date("2026-01-01T00:00:00.000Z"),
    bankName: "ATM Bank",
    branch: null,
    atmId: "ATM-001",
    atmLocationName: "Main Branch",
    complaintDescription: "Cash dispenser service",
    currentStatus: "COMPLETED",
    assignedTechnicianName: "Test Employee",
    workType: "repair",
  },
  reportFields: {
    serviceLaborCost: "100.00",
    gstRate: "18.00",
    bankPurchaseOrderNumber: "PO-001",
    taxInvoiceNumber: "INV-001",
    filingPeriod: "2026-01",
    officeBillingStatus: "Pending",
  },
  serviceVisits: Array.from({ length: visitCount }, (_, index) => ({
    sequence: index + 1,
    visitDate: new Date(`2026-01-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`),
    workPerformed: `Visit ${index + 1}`,
    status: "Completed",
    signOffOrPhotoReference: `REF-${index + 1}`,
  })),
  materialSnapshot: Array.from({ length: materialCount }, (_, index) => ({
    usageId: `usage-${index + 1}`,
    itemId: `507f1f77bcf86cd7994390${String(index + 1).padStart(2, "0")}`,
    itemNameSnapshot: `Historical material ${index + 1}`,
    quantity: index + 1,
    unitSnapshot: "piece",
    unitCostSnapshot: "10.00",
    lineCostSnapshot: `${((index + 1) * 10).toFixed(2)}`,
    capturedAt: new Date("2026-01-02T00:00:00.000Z"),
  })),
  ...overrides,
});

const loadWorkbook = async (buffer) => {
  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(buffer);
  return workbook;
};

const assertNoOverlappingMerges = (ranges) => {
  const occupied = new Set();
  for (const range of ranges) {
    const [start, end] = range.split(":");
    const [, startColumn, startRow] = /^([A-Z]+)(\d+)$/.exec(start);
    const [, endColumn, endRow] = /^([A-Z]+)(\d+)$/.exec(end);
    const columnNumber = (letters) =>
      [...letters].reduce((sum, letter) => sum * 26 + letter.charCodeAt(0) - 64, 0);
    for (let row = Number(startRow); row <= Number(endRow); row += 1) {
      for (
        let column = columnNumber(startColumn);
        column <= columnNumber(endColumn);
        column += 1
      ) {
        const key = `${row}:${column}`;
        assert.equal(occupied.has(key), false, `overlapping merge at ${key}`);
        occupied.add(key);
      }
    }
  }
};

test("exports preserve dynamic layouts and formulas for practical report sizes", async () => {
  for (const [visitCount, materialCount] of [
    [0, 0],
    [1, 1],
    [3, 4],
    [4, 5],
    [6, 9],
    [20, 30],
  ]) {
    const report = makeReport(visitCount, materialCount);
    const rows = calculateDynamicRows(report);
    const workbook = await loadWorkbook(await createJobCostReportWorkbook(report));
    const worksheet = workbook.getWorksheet("Work Order Print");

    assert.equal(worksheet.getCell(`C${rows.billingRows.total}`).value.formula, `SUM(F${rows.materialFirst}:F${rows.materialLast})`);
    assert.equal(worksheet.getCell(`C${rows.billingRows.subtotal}`).value.formula, `C${rows.billingRows.total}+C${rows.billingRows.labor}`);
    assert.equal(worksheet.getCell(`C${rows.billingRows.gst}`).value.formula, `C${rows.billingRows.subtotal}*0.18`);
    assert.equal(worksheet.getCell(`C${rows.billingRows.final}`).value.formula, `C${rows.billingRows.subtotal}+C${rows.billingRows.gst}`);
    assert.equal(worksheet.getCell(`G${rows.billingRows.subtotal}`).value, "18.00%");
    assert.equal(worksheet.getCell(`G${rows.billingRows.gst}`).value, "2026-01");
    assert.equal(worksheet.getCell(`G${rows.billingRows.final}`).value, "Pending");

    const materialNames = Array.from({ length: materialCount }, (_, index) =>
      worksheet.getCell(`B${rows.materialFirst + index}`).value,
    );
    assert.deepEqual(
      materialNames,
      report.materialSnapshot.map((material) => material.itemNameSnapshot),
    );
    assert.equal(materialNames.some((value) => String(value).includes("507f1f")), false);
    assert.equal(worksheet.model.merges.length, new Set(worksheet.model.merges).size);
    assertNoOverlappingMerges(worksheet.model.merges);
  }
});

test("exports the approved six-visit/nine-material row layout", async () => {
  const report = makeReport(6, 9);
  const rows = calculateDynamicRows(report);
  const workbook = await loadWorkbook(await createJobCostReportWorkbook(report));
  const worksheet = workbook.getWorksheet("Work Order Print");

  assert.deepEqual(rows, {
    visitSlots: 6,
    materialSlots: 9,
    materialHeading: 18,
    materialHeader: 19,
    materialFirst: 20,
    materialLast: 28,
    officeHeading: 30,
    billingRows: { total: 31, labor: 32, subtotal: 33, gst: 34, final: 35 },
  });

  assert.equal(worksheet.getCell("C31").value.formula, "SUM(F20:F28)");
  assert.equal(worksheet.getCell("C33").value.formula, "C31+C32");
  assert.equal(worksheet.getCell("C34").value.formula, "C33*0.18");
  assert.equal(worksheet.getCell("C35").value.formula, "C33+C34");
  assert.equal(worksheet.getCell("B20").value, "Historical material 1");
  assert.deepEqual(
    [...worksheet.model.merges].filter(
      (merge) => merge.startsWith("C") && Number(merge.match(/\d+/)?.[0]) >= 11,
    ),
    ["C11:E11", "C12:E12", "C13:E13", "C14:E14", "C15:E15", "C16:E16"],
  );
  assert.deepEqual(
    [...worksheet.model.merges].filter(
      (merge) =>
        merge.startsWith("B") &&
        merge.includes(":C") &&
        Number(merge.match(/\d+/)?.[0]) >= 19,
    ),
    ["B19:C19", "B20:C20", "B21:C21", "B22:C22", "B23:C23", "B24:C24", "B25:C25", "B26:C26", "B27:C27", "B28:C28"],
  );
});

test("uses the ATM location override in the workbook header", async () => {
  const report = makeReport(0, 0, {
    reportFields: {
      serviceLaborCost: "100.00",
      gstRate: "18.00",
      bankPurchaseOrderNumber: "PO-001",
      taxInvoiceNumber: "INV-001",
      filingPeriod: "2026-01",
      officeBillingStatus: "Pending",
      overrides: {
        atmLocationName: { value: "Temporary Site", isOverridden: true },
      },
    },
  });
  const workbook = await loadWorkbook(await createJobCostReportWorkbook(report));
  assert.equal(
    workbook.getWorksheet("Work Order Print").getCell("E5").value,
    "ATM-001 — Temporary Site",
  );
});

test("rejects stale snapshots and non-18% GST without generating a workbook", async () => {
  await assert.rejects(
    () => createJobCostReportWorkbook(makeReport(0, 0, { materialSnapshotFresh: false })),
    /Material snapshot is missing or stale/,
  );
  await assert.rejects(
    () =>
      createJobCostReportWorkbook(
        makeReport(0, 0, { reportFields: { ...makeReport().reportFields, gstRate: "5.00" } }),
      ),
    /requires an 18% GST rate/,
  );
});

test("preserves printer settings and validates the final OOXML package", async () => {
  const sourceBuffer = await fs.readFile(getJobCostReportTemplatePath());
  const sourceHash = crypto.createHash("sha256").update(sourceBuffer).digest("hex");
  const output = await createJobCostReportWorkbook(makeReport(6, 9));
  const sourceZip = new AdmZip(sourceBuffer);
  const outputZip = new AdmZip(output);
  const sourcePrinter = sourceZip.readFile("xl/printerSettings/printerSettings1.bin");
  const outputPrinter = outputZip.readFile("xl/printerSettings/printerSettings1.bin");

  assert.equal(crypto.createHash("sha256").update(sourceBuffer).digest("hex"), sourceHash);
  assert.equal(crypto.createHash("sha256").update(outputPrinter).digest("hex"), crypto.createHash("sha256").update(sourcePrinter).digest("hex"));
  assert.equal(outputZip.getEntries().length, new Set(outputZip.getEntries().map((entry) => entry.entryName)).size);
  assert.equal(outputZip.getEntry("xl/calcChain.xml"), null);
  assert.match(outputZip.readAsText("xl/worksheets/_rels/sheet1.xml.rels"), /Id="rId1"/);
  assert.equal((outputZip.readAsText("[Content_Types].xml").match(/printerSettings/g) ?? []).length, 1);
  assert.match(outputZip.readAsText("xl/workbook.xml"), /fullCalcOnLoad="1"/);
  assert.doesNotMatch(outputZip.readAsText("xl/worksheets/sheet1.xml"), /firstPageNumber|useFirstPageNumber/);
});

test("keeps the export route behind the existing admin and superAdmin middleware", () => {
  const middlewareLayers = jobCostReportRouter.stack.slice(0, 3);
  assert.equal(middlewareLayers.every((layer) => !layer.route), true);
  const exportLayer = jobCostReportRouter.stack.find(
    (layer) => layer.route?.path === "/export.xlsx" && layer.route.methods.get,
  );
  assert.ok(exportLayer);
  assert.equal(exportLayer.route.stack.at(-1).handle, exportCostReport);
  assert.equal(exportLayer.match("/export.xlsx"), true);
  assert.equal(exportLayer.match("/export.xlsx/anything"), false);
  assert.doesNotThrow(() =>
    authorizeRoles("admin", "superAdmin")(
      { user: { userType: "admin" } },
      {},
      () => {},
    ),
  );
  assert.throws(
    () =>
      authorizeRoles("admin", "superAdmin")(
        { user: { userType: "employee" } },
        {},
        () => {},
      ),
    { statusCode: 403 },
  );
  assert.equal(typeof verifyAccessToken, "function");
});
