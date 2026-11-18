import ExcelJS from "exceljs";

const EXCEL_CONTENT_TYPE =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";
const TEMPLATE_FILENAME = "atm-upload-template.xlsx";
const EXAMPLE_ROWS = [
  [
    "Example 1 - remove before upload",
    "00001234",
    "Illustrative location",
    "Example city",
    "Illustrative address",
    "ONSITE",
    "REPLACE WITH CUSTOMER CODE",
    "REPLACE WITH BANK CODE",
    "REPLACE WITH REGION NAME",
    "REPLACE WITH DISTRICT NAME",
  ],
  [
    "Example 2 - remove before upload",
    "00005678",
    "Illustrative location",
    "Example city",
    "Illustrative address",
    "OFFSITE",
    "REPLACE WITH CUSTOMER CODE",
    "REPLACE WITH BANK CODE",
    "REPLACE WITH REGION NAME",
    "REPLACE WITH DISTRICT NAME",
  ],
];
const BLANK_ENTRY_ROW_COUNT = 500;
const FIRST_DATA_ROW = 2;
const LAST_TEMPLATE_ROW =
  FIRST_DATA_ROW + EXAMPLE_ROWS.length + BLANK_ENTRY_ROW_COUNT - 1;
const TEXT_COLUMN_NUMBERS = [2, 7, 8];

const applyHeaderStyle = (row) => {
  row.height = 28;
  row.eachCell((cell) => {
    cell.fill = {
      type: "pattern",
      pattern: "solid",
      fgColor: { argb: "FF1F2937" },
    };
    cell.font = { bold: true, color: { argb: "FFFFFFFF" } };
    cell.alignment = { vertical: "middle", wrapText: true };
  });
};

export const createATMUploadTemplateWorkbook = async () => {
  const workbook = new ExcelJS.Workbook();
  workbook.creator = "ATM Maintenance Management System";
  workbook.title = "ATM Upload Template";
  workbook.subject = "ATM bulk upload template and instructions";

  const uploadSheet = workbook.addWorksheet("ATM Upload");
  uploadSheet.columns = [
    { header: "S.No", key: "serialNumber", width: 30 },
    {
      header: "ATM ID",
      key: "clientAtmId",
      width: 20,
      style: { numFmt: "@" },
    },
    { header: "Location", key: "location", width: 28 },
    { header: "City", key: "city", width: 20 },
    { header: "Address", key: "address", width: 38 },
    { header: "Installation Type", key: "installationType", width: 22 },
    {
      header: "Customer Code",
      key: "customerCode",
      width: 28,
      style: { numFmt: "@" },
    },
    {
      header: "Bank Code",
      key: "bankCode",
      width: 24,
      style: { numFmt: "@" },
    },
    { header: "Region Name", key: "regionName", width: 24 },
    { header: "District Name", key: "districtName", width: 24 },
  ];
  uploadSheet.properties.defaultRowHeight = 21;
  uploadSheet.views = [
    { state: "frozen", ySplit: 1, topLeftCell: "A2" },
  ];
  uploadSheet.autoFilter = `A1:J${LAST_TEMPLATE_ROW}`;
  applyHeaderStyle(uploadSheet.getRow(1));

  for (const exampleRow of EXAMPLE_ROWS) {
    const row = uploadSheet.addRow(exampleRow);
    row.height = 30;
    row.eachCell((cell) => {
      cell.fill = {
        type: "pattern",
        pattern: "solid",
        fgColor: { argb: "FFEAF0F6" },
      };
      cell.font = { italic: true, color: { argb: "FF374151" } };
      cell.alignment = { vertical: "middle", wrapText: true };
    });
  }

  for (let index = 0; index < BLANK_ENTRY_ROW_COUNT; index += 1) {
    uploadSheet.addRow([]);
  }

  for (const columnNumber of TEXT_COLUMN_NUMBERS) {
    for (let rowNumber = FIRST_DATA_ROW; rowNumber <= LAST_TEMPLATE_ROW; rowNumber += 1) {
      uploadSheet.getCell(rowNumber, columnNumber).numFmt = "@";
    }
  }

  uploadSheet.dataValidations.add(
    `F${FIRST_DATA_ROW}:F${LAST_TEMPLATE_ROW}`,
    {
      type: "list",
      allowBlank: true,
      formulae: ['"ONSITE,OFFSITE"'],
      showErrorMessage: true,
      errorStyle: "error",
      errorTitle: "Invalid installation type",
      error: "Choose ONSITE or OFFSITE.",
      showInputMessage: true,
      promptTitle: "Installation type",
      prompt: "Choose ONSITE or OFFSITE.",
    },
  );

  const instructionsSheet = workbook.addWorksheet("Instructions");
  instructionsSheet.mergeCells("A1:B1");
  instructionsSheet.getCell("A1").value = "ATM Upload Instructions";
  instructionsSheet.getCell("A1").font = {
    bold: true,
    size: 16,
    color: { argb: "FF1F2937" },
  };
  instructionsSheet.getCell("A1").alignment = { vertical: "middle" };
  instructionsSheet.getRow(1).height = 30;
  instructionsSheet.addRow(["Requirement", "Guidance"]);
  applyHeaderStyle(instructionsSheet.getRow(2));
  instructionsSheet.columns = [{ width: 34 }, { width: 100 }];
  instructionsSheet.views = [
    { state: "frozen", ySplit: 2, topLeftCell: "A3" },
  ];

  const instructions = [
    [
      "Illustrative examples",
      "The first two rows on ATM Upload are examples only. Replace them or remove them before upload.",
    ],
    ["S.No", "Informational only; it is not used to identify or create an ATM."],
    ["One ATM per row", "Enter one ATM on each row."],
    [
      "ATM ID as text",
      "Enter ATM ID as text and do not remove any leading zeros.",
    ],
    [
      "One ATM ID per cell",
      "Do not enter multiple ATM IDs in one cell.",
    ],
    [
      "Customer Code",
      "Customer Code must match an existing customer.",
    ],
    ["Bank Code", "Bank Code must match an existing bank."],
    [
      "Region Name",
      "Region Name must belong to the selected bank.",
    ],
    [
      "District Name",
      "District Name must belong to the selected bank and region.",
    ],
    [
      "Installation Type",
      "Choose ONSITE or OFFSITE only.",
    ],
    [
      "Do not enter",
      "Do not enter internal ATM IDs, MongoDB IDs, employee assignments, or coordinates.",
    ],
    [
      "Row results",
      "If any data row is invalid, the entire workbook is rejected. All rows are imported together, or none are imported.",
    ],
  ];

  for (const instruction of instructions) {
    const row = instructionsSheet.addRow(instruction);
    row.height = 30;
    row.alignment = { vertical: "middle", wrapText: true };
    row.getCell(1).font = { bold: true, color: { argb: "FF1F2937" } };
  }

  return {
    buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
    filename: TEMPLATE_FILENAME,
    contentType: EXCEL_CONTENT_TYPE,
  };
};
