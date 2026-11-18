import assert from "node:assert/strict";
import { test } from "node:test";
import ExcelJS from "exceljs";
import atmRouter from "../src/modules/atms/atm.routes.js";
import {
  downloadATMUploadTemplate,
} from "../src/modules/atms/atm.controller.js";
import { verifyAccessToken } from "../src/middlewares/auth.middleware.js";

const CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

test("serves the protected ATM upload template workbook", async () => {
  const routeLayer = atmRouter.stack.find(
    (layer) => layer.route?.path === "/bulk-upload/template",
  );
  assert.ok(routeLayer);
  assert.equal(routeLayer.route.methods.get, true);
  assert.equal(routeLayer.route.stack.length, 3);
  assert.equal(routeLayer.route.stack[0].handle, verifyAccessToken);
  assert.equal(
    routeLayer.route.stack.at(-1).handle,
    downloadATMUploadTemplate,
  );

  const roleGate = routeLayer.route.stack[1].handle;
  for (const role of ["admin", "superAdmin"]) {
    let authorized = false;
    roleGate({ user: { userType: role } }, {}, () => {
      authorized = true;
    });
    assert.equal(authorized, true);
  }
  assert.throws(() =>
    roleGate({ user: { userType: "employee" } }, {}, () => {}),
  );

  const response = await new Promise((resolve, reject) => {
    const headers = {};
    const res = {
      statusCode: undefined,
      status(statusCode) {
        this.statusCode = statusCode;
        return this;
      },
      set(name, value) {
        headers[name] = value;
        return this;
      },
      send(buffer) {
        resolve({ statusCode: this.statusCode, headers, buffer });
        return this;
      },
    };

    downloadATMUploadTemplate({}, res, reject);
  });

  assert.equal(response.statusCode, 200);
  assert.equal(response.headers["Content-Type"], CONTENT_TYPE);
  assert.equal(
    response.headers["Content-Disposition"],
    'attachment; filename="atm-upload-template.xlsx"',
  );
  assert.equal(response.headers["Cache-Control"], "private, no-store");
  assert.ok(Buffer.isBuffer(response.buffer));

  const workbook = new ExcelJS.Workbook();
  await workbook.xlsx.load(response.buffer);
  assert.deepEqual(
    workbook.worksheets.map((sheet) => sheet.name),
    ["ATM Upload", "Instructions"],
  );

  const uploadSheet = workbook.getWorksheet("ATM Upload");
  assert.deepEqual(uploadSheet.getRow(1).values.slice(1), [
    "S.No",
    "ATM ID",
    "Location",
    "City",
    "Address",
    "Installation Type",
    "Customer Code",
    "Bank Code",
    "Region Name",
    "District Name",
  ]);
  assert.equal(uploadSheet.getCell("A2").value, "Example 1 - remove before upload");
  assert.equal(uploadSheet.getCell("A3").value, "Example 2 - remove before upload");
  assert.equal(uploadSheet.getCell("B2").value, "00001234");
  assert.equal(uploadSheet.getCell("B2").numFmt, "@");
  assert.equal(uploadSheet.getCell("G2").numFmt, "@");
  assert.equal(uploadSheet.getCell("H2").numFmt, "@");
  assert.equal(uploadSheet.rowCount, 503);
  assert.equal(uploadSheet.getCell("F2").dataValidation.type, "list");
  assert.equal(uploadSheet.views[0].state, "frozen");
  assert.equal(uploadSheet.views[0].ySplit, 1);
  assert.equal(uploadSheet.views[0].topLeftCell, "A2");
  assert.ok(uploadSheet.autoFilter);

  const instructions = workbook
    .getWorksheet("Instructions")
    .getSheetValues()
    .flat(Infinity)
    .filter((value) => typeof value === "string")
    .join(" ");
  for (const requiredInstruction of [
    "One ATM per row",
    "Enter ATM ID as text",
    "leading zeros",
    "multiple ATM IDs in one cell",
    "Customer Code must match an existing customer",
    "Bank Code must match an existing bank",
    "Region Name must belong to the selected bank",
    "District Name must belong to the selected bank and region",
    "Choose ONSITE or OFFSITE only",
    "internal ATM IDs, MongoDB IDs, employee assignments, or coordinates",
    "If any data row is invalid, the entire workbook is rejected",
    "All rows are imported together, or none are imported",
  ]) {
    assert.ok(instructions.includes(requiredInstruction), requiredInstruction);
  }
});
