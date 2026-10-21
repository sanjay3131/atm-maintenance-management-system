import test from "node:test";
import assert from "node:assert/strict";
import AdmZip from "adm-zip";
import PDFDocument from "pdfkit";
import AMC from "../src/modules/amc/amc.model.js";
import AMCPhoto from "../src/modules/amcPhotos/amcPhoto.model.js";
import {
  getAMCById,
} from "../src/modules/amc/amc.controller.js";
import { getAMCPhotos } from "../src/modules/amcPhotos/amcPhoto.controller.js";
import {
  generateAMCPDF,
  generateAMCPhotoZip,
} from "../src/modules/reports/amcReport.service.js";

const selectedAMCId = "64b000000000000000000051";
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/cN8AAAAASUVORK5CYII=",
  "base64",
);

const createQuery = (value, { onPopulate, onSelect, onSort } = {}) => ({
  select(fields) {
    onSelect?.(fields);
    return this;
  },
  populate(path, fields) {
    onPopulate?.(path, fields);
    return this;
  },
  sort(fields) {
    onSort?.(fields);
    return this;
  },
  then(resolve, reject) {
    return Promise.resolve(value).then(resolve, reject);
  },
});

const invoke = (handler, req) =>
  new Promise((resolve, reject) => {
    const headers = {};
    const res = {
      statusCode: 200,
      status(code) {
        this.statusCode = code;
        return this;
      },
      json(body) {
        resolve({ status: this.statusCode, body, headers });
        return this;
      },
      setHeader(name, value) {
        headers[name] = value;
        return this;
      },
      send(body) {
        resolve({ status: this.statusCode, body, headers });
        return this;
      },
    };
    handler(req, res, reject);
  });

const admin = { _id: "64b000000000000000000099", userType: "admin" };

const reportAMC = {
  _id: selectedAMCId,
  amcId: "AMC-2026-10-042",
  atmId: {
    _id: "64b000000000000000000061",
    atmId: "ATM-42",
    locationName: "Central Branch",
    address: "12 Main Road",
  },
  bankId: { bankName: "Example Bank" },
  customerId: { customerName: "Example Customer" },
  districtId: { districtName: "Central District" },
  employeeId: { firstName: "Taylor", lastName: "Employee" },
  month: 10,
  year: 2026,
  status: "COMPLETED",
  deadlineDate: new Date("2026-10-20T23:59:00.000Z"),
  visitDate: new Date("2026-10-21T10:30:00.000Z"),
  completedAt: new Date("2026-10-21T11:30:00.000Z"),
  checklist: [
    { item: "door", response: "Good", remarks: "No damage" },
    { item: "light", response: "Working", remarks: "" },
  ],
  checklistCompleted: true,
  employeeRemarks: "Maintenance completed.",
  photoCount: 2,
  gpsValidated: true,
  gpsDistance: 5,
  isDeleted: false,
};

const reportPhotos = [
  {
    _id: "64b000000000000000000071",
    amcId: selectedAMCId,
    url: "https://res.cloudinary.com/example/image/upload/photo-one.png",
    mimeType: "image/png",
    uploadedAt: new Date("2026-10-21T10:45:00.000Z"),
  },
  {
    _id: "64b000000000000000000072",
    amcId: selectedAMCId,
    url: "https://res.cloudinary.com/example/image/upload/photo-two.png",
    mimeType: "image/png",
    uploadedAt: new Date("2026-10-21T10:46:00.000Z"),
  },
];

test("Admin AMC detail reads return a safe projection for only the selected record", async () => {
  const originalFindById = AMC.findById;
  let requestedId;
  AMC.findById = (id) => {
    requestedId = id;
    return createQuery({
      ...reportAMC,
      employeeId: {
        _id: "64b000000000000000000081",
        firstName: "Taylor",
        lastName: "Employee",
        email: "private@example.test",
        phoneNumber: "555-0100",
      },
      visitGps: { latitude: 12, longitude: 34 },
      photos: [{ url: "https://private.example/photo.jpg" }],
    });
  };

  try {
    const result = await invoke(getAMCById, {
      params: { id: selectedAMCId },
      user: admin,
    });
    assert.equal(result.status, 200);
    assert.equal(requestedId, selectedAMCId);
    assert.equal(result.body.data._id, selectedAMCId);
    assert.equal(result.body.data.checklist[0].response, "Good");
    assert.equal(result.body.data.gpsValidated, true);
    assert.equal(result.body.data.gpsDistance, 5);
    assert.equal(result.body.data.employeeId.email, "private@example.test");
    assert.equal(result.body.data.employeeId.phoneNumber, "555-0100");
    assert.equal(result.body.data.visitGps, undefined);
    assert.equal(result.body.data.photos, undefined);
  } finally {
    AMC.findById = originalFindById;
  }
});

test("Admin AMC detail reads distinguish invalid and missing records", async () => {
  const originalFindById = AMC.findById;
  let requestedId;
  AMC.findById = (id) => {
    requestedId = id;
    return createQuery(null);
  };
  try {
    await assert.rejects(
      invoke(getAMCById, {
        params: { id: "invalid" },
        user: admin,
      }),
      (error) => error.statusCode === 400 && error.message === "Invalid AMC ID",
    );
    await assert.rejects(
      invoke(getAMCById, {
        params: { id: selectedAMCId },
        user: admin,
      }),
      (error) => error.statusCode === 404 && error.message === "AMC not found",
    );
    assert.equal(requestedId, selectedAMCId);
  } finally {
    AMC.findById = originalFindById;
  }
});

test("AMC photo listing scopes the evidence query to the selected AMC ID", async () => {
  const originalAMCFindById = AMC.findById;
  const originalPhotoFind = AMCPhoto.find;
  let photoFilter;
  AMC.findById = (id) =>
    createQuery(id === selectedAMCId ? reportAMC : null);
  AMCPhoto.find = (filter) => {
    photoFilter = filter;
    return createQuery(reportPhotos.filter((photo) => photo.amcId === filter.amcId));
  };

  try {
    const result = await invoke(getAMCPhotos, {
      params: { amcId: selectedAMCId },
      user: admin,
    });
    assert.equal(result.status, 200);
    assert.deepEqual(photoFilter, {
      amcId: selectedAMCId,
      isExpired: false,
    });
    assert.deepEqual(
      result.body.data.photos.map((photo) => photo._id),
      reportPhotos.map((photo) => photo._id),
    );
  } finally {
    AMC.findById = originalAMCFindById;
    AMCPhoto.find = originalPhotoFind;
  }
});

test("AMC ZIP contains all selected-record photos with visit-date filenames", async () => {
  const originalAMCFindById = AMC.findById;
  const originalPhotoFind = AMCPhoto.find;
  const originalFetch = globalThis.fetch;
  let photoFilter;
  AMC.findById = (id) => {
    assert.equal(id, selectedAMCId);
    return createQuery(reportAMC);
  };
  AMCPhoto.find = (filter) => {
    photoFilter = filter;
    return createQuery(reportPhotos);
  };
  globalThis.fetch = async (url, options) => {
    assert.equal(new URL(url).hostname, "res.cloudinary.com");
    assert.equal(options.redirect, "error");
    return new Response(png, {
      status: 200,
      headers: { "content-type": "image/png", "content-length": String(png.length) },
    });
  };

  try {
    const result = await generateAMCPhotoZip(selectedAMCId);
    assert.deepEqual(photoFilter, {
      amcId: selectedAMCId,
      isExpired: false,
    });
    assert.equal(result.filename, "ATM-42_2026-10-21_AMC_Photos.zip");
    const archive = new AdmZip(result.buffer);
    assert.deepEqual(
      archive.getEntries().map((entry) => entry.entryName).sort(),
      [
        "ATM-42_2026-10-21_Photo_01.png",
        "ATM-42_2026-10-21_Photo_02.png",
      ],
    );
    assert.ok(archive.getEntries().every((entry) => entry.getData().equals(png)));
  } finally {
    AMC.findById = originalAMCFindById;
    AMCPhoto.find = originalPhotoFind;
    globalThis.fetch = originalFetch;
  }
});

test("AMC PDF embeds every selected-record photo and includes checklist content", async () => {
  const originalAMCFindById = AMC.findById;
  const originalPhotoFind = AMCPhoto.find;
  const originalFetch = globalThis.fetch;
  const originalText = PDFDocument.prototype.text;
  const originalImage = PDFDocument.prototype.image;
  const renderedText = [];
  const embeddedImages = [];
  AMC.findById = (id) => {
    assert.equal(id, selectedAMCId);
    return createQuery(reportAMC);
  };
  AMCPhoto.find = (filter) => {
    assert.deepEqual(filter, { amcId: selectedAMCId, isExpired: false });
    return createQuery(reportPhotos);
  };
  PDFDocument.prototype.text = function (...args) {
    renderedText.push(String(args[0]));
    return originalText.apply(this, args);
  };
  PDFDocument.prototype.image = function (source, ...args) {
    embeddedImages.push(source);
    return originalImage.call(this, source, ...args);
  };
  globalThis.fetch = async (url) => {
    const photoURL = new URL(url);
    assert.equal(photoURL.hostname, "res.cloudinary.com");
    assert.match(photoURL.pathname, /\/f_jpg\//);
    return new Response(png, {
      status: 200,
      headers: { "content-type": "image/png", "content-length": String(png.length) },
    });
  };

  try {
    const result = await generateAMCPDF(selectedAMCId, { embedPhotos: true });
    const imageCount = (
      result.buffer.toString("latin1").match(/\/Subtype\s*\/Image\b/g) || []
    ).length;
    assert.equal(result.filename, "ATM-42_2026-10-21_AMC_Report.pdf");
    assert.equal(embeddedImages.length, reportPhotos.length);
    assert.ok(imageCount >= reportPhotos.length);
    assert.ok(embeddedImages.every((image) => image.equals(png)));
    assert.ok(renderedText.includes("Customer: Example Customer"));
    assert.ok(renderedText.includes("Employee: Taylor Employee"));
    assert.ok(renderedText.includes("✓ door: Good"));
    assert.ok(renderedText.includes("   Remarks: No damage"));
    assert.ok(renderedText.includes("Visit GPS validation: Passed"));
    assert.ok(renderedText.includes("Total Photos: 2"));
    assert.equal(
      renderedText.some((text) => text.includes("res.cloudinary.com")),
      false,
    );
  } finally {
    AMC.findById = originalAMCFindById;
    AMCPhoto.find = originalPhotoFind;
    PDFDocument.prototype.text = originalText;
    PDFDocument.prototype.image = originalImage;
    globalThis.fetch = originalFetch;
  }
});

test("Admin download names fall back from completion date to AMC period start", async () => {
  const originalAMCFindById = AMC.findById;
  const originalPhotoFind = AMCPhoto.find;
  const originalFetch = globalThis.fetch;
  let currentAMC = {
    ...reportAMC,
    visitDate: null,
    completedAt: new Date("2026-10-22T00:30:00.000Z"),
  };
  AMC.findById = () => createQuery(currentAMC);
  AMCPhoto.find = () =>
    createQuery([reportPhotos[0]]);
  globalThis.fetch = async () =>
    new Response(png, { status: 200, headers: { "content-length": String(png.length) } });

  try {
    const zip = await generateAMCPhotoZip(selectedAMCId);
    assert.equal(zip.filename, "ATM-42_2026-10-22_AMC_Photos.zip");

    currentAMC = {
      ...reportAMC,
      visitDate: null,
      completedAt: null,
    };
    AMCPhoto.find = () => createQuery([]);
    const pdf = await generateAMCPDF(selectedAMCId, { embedPhotos: true });
    assert.equal(pdf.filename, "ATM-42_2026-10-01_AMC_Report.pdf");
    assert.ok(pdf.buffer.toString("latin1").startsWith("%PDF"));
  } finally {
    AMC.findById = originalAMCFindById;
    AMCPhoto.find = originalPhotoFind;
    globalThis.fetch = originalFetch;
  }
});

test("AMC ZIP and PDF fail explicitly when photo evidence cannot be retrieved", async () => {
  const originalAMCFindById = AMC.findById;
  const originalPhotoFind = AMCPhoto.find;
  const originalFetch = globalThis.fetch;
  AMC.findById = () => createQuery(reportAMC);
  AMCPhoto.find = () => createQuery([reportPhotos[0]]);
  globalThis.fetch = async () => new Response("unavailable", { status: 503 });

  try {
    await assert.rejects(
      generateAMCPhotoZip(selectedAMCId),
      (error) =>
        error.statusCode === 502 &&
        /Photo evidence 1 of 1/.test(error.message) &&
        /not generated/.test(error.message),
    );
    await assert.rejects(
      generateAMCPDF(selectedAMCId, { embedPhotos: true }),
      (error) =>
        error.statusCode === 502 &&
        /Photo evidence 1 of 1/.test(error.message) &&
        /not generated/.test(error.message),
    );

    globalThis.fetch = async () =>
      new Response(Buffer.from("not an image"), { status: 200 });
    await assert.rejects(
      generateAMCPDF(selectedAMCId, { embedPhotos: true }),
      (error) =>
        error.statusCode === 502 &&
        /could not be retrieved or decoded/.test(error.message),
    );
  } finally {
    AMC.findById = originalAMCFindById;
    AMCPhoto.find = originalPhotoFind;
    globalThis.fetch = originalFetch;
  }
});

test("AMC evidence downloads reject untrusted remote photo URLs", async () => {
  const originalAMCFindById = AMC.findById;
  const originalPhotoFind = AMCPhoto.find;
  const originalFetch = globalThis.fetch;
  AMC.findById = () => createQuery(reportAMC);
  AMCPhoto.find = () =>
    createQuery([{ ...reportPhotos[0], url: "http://127.0.0.1/private" }]);
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    throw new Error("Should not fetch an untrusted host");
  };

  try {
    await assert.rejects(generateAMCPhotoZip(selectedAMCId), {
      statusCode: 502,
    });
    assert.equal(fetchCalled, false);
  } finally {
    AMC.findById = originalAMCFindById;
    AMCPhoto.find = originalPhotoFind;
    globalThis.fetch = originalFetch;
  }
});

test("Admin AMC ZIP route is restricted to admin roles", async () => {
  const amcRoutes = (await import("../src/modules/amc/amc.routes.js")).default;
  const route = amcRoutes.stack.find(
    (layer) =>
      layer.route?.path === "/:id/download-photos" &&
      layer.route.methods.get,
  )?.route;
  assert.ok(route);
  assert.doesNotThrow(() =>
    route.stack[1].handle(
      { user: { userType: "admin" } },
      {},
      () => {},
    ),
  );
  assert.throws(
    () =>
      route.stack[1].handle(
        { user: { userType: "supervisor" } },
        {},
        () => {},
      ),
    (error) => error.statusCode === 403,
  );
});
