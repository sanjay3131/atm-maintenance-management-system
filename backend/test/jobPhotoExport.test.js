import test from "node:test";
import assert from "node:assert/strict";
import AdmZip from "adm-zip";
import PDFDocument from "pdfkit";
import Job from "../src/modules/jobs/jobs.model.js";
import JobPhoto from "../src/modules/jobPhotos/jobPhotos.model.js";
import {
  downloadJobPhotosPdf,
  downloadJobPhotosZip,
} from "../src/modules/jobPhotos/jobPhotos.controller.js";
import {
  generateJobPhotoPdf,
  generateJobPhotoZip,
} from "../src/modules/jobPhotos/jobPhotoExport.service.js";

const jobId = "64b000000000000000000101";
const job = {
  _id: jobId,
  jobId: "JOB-2026-101",
  beforePhotos: ["before-1", "before-2"],
  afterPhotos: ["after-1"],
  isDeleted: false,
};
const png = Buffer.from(
  "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR4nGNgYAAAAAMAASsJTYQAAAAASUVORK5CYII=",
  "base64",
);
const jpeg = Buffer.from([0xff, 0xd8, 0xff, 0x00, 0x01]);
const webp = Buffer.from("RIFF0000WEBPpayload");

const createQuery = (value) => ({
  select() {
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

const installPhotoMocks = (photos) => {
  const originalFind = JobPhoto.find;
  let filter;
  JobPhoto.find = (query) => {
    filter = query;
    return createQuery(photos);
  };
  return {
    getFilter: () => filter,
    restore: () => {
      JobPhoto.find = originalFind;
    },
  };
};

const photo = (id, photoType, file) => ({
  _id: id,
  photoType,
  url: `https://res.cloudinary.com/example/image/upload/${id}.${file}`,
});

const withPhotoFetch = async (handler, callback) => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = handler;
  try {
    await callback();
  } finally {
    globalThis.fetch = originalFetch;
  }
};

test("job photo ZIP preserves original supported formats and uses ordered names", async () => {
  const mocks = installPhotoMocks([
    photo("after-1", "after", "webp"),
    photo("before-2", "before", "jpg"),
    photo("before-1", "before", "png"),
  ]);
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, options) => {
    assert.equal(new URL(url).hostname, "res.cloudinary.com");
    assert.equal(options.redirect, "error");
    const imageId = new URL(url).pathname.split("/").at(-1).split(".")[0];
    const data =
      imageId === "before-1" ? png : imageId === "before-2" ? jpeg : webp;
    return new Response(data, {
      status: 200,
      headers: { "content-length": String(data.length) },
    });
  };

  try {
    const result = await generateJobPhotoZip(job);
    assert.deepEqual(mocks.getFilter(), {
      _id: { $in: [...job.beforePhotos, ...job.afterPhotos] },
      jobId: job._id,
      isExpired: false,
      photoType: { $in: ["before", "after"] },
    });
    assert.equal(result.filename, "JOB-2026-101.zip");
    const archive = new AdmZip(result.buffer);
    assert.deepEqual(
      archive.getEntries().map((entry) => entry.entryName).sort(),
      ["After_1.webp", "Before_1.png", "Before_2.jpg"],
    );
    assert.ok(
      archive
        .getEntry("Before_1.png")
        .getData()
        .equals(png),
    );
    assert.ok(
      archive
        .getEntry("Before_2.jpg")
        .getData()
        .equals(jpeg),
    );
    assert.ok(
      archive
        .getEntry("After_1.webp")
        .getData()
        .equals(webp),
    );
  } finally {
    globalThis.fetch = originalFetch;
    mocks.restore();
  }
});

test("job photo PDF pairs photos without cropping and handles missing sides", async () => {
  const mocks = installPhotoMocks([
    photo("after-1", "after", "png"),
    photo("before-2", "before", "png"),
    photo("before-1", "before", "png"),
  ]);
  const originalText = PDFDocument.prototype.text;
  const originalImage = PDFDocument.prototype.image;
  const renderedText = [];
  const imageOptions = [];
  PDFDocument.prototype.text = function (...args) {
    renderedText.push(String(args[0]));
    return originalText.apply(this, args);
  };
  PDFDocument.prototype.image = function (source, x, y, options) {
    imageOptions.push({ source, x, y, options });
    return originalImage.call(this, source, x, y, options);
  };

  try {
    await withPhotoFetch(async (url, options) => {
      assert.equal(options.redirect, "error");
      assert.match(new URL(url).pathname, /\/f_jpg\//);
      return new Response(png, {
        status: 200,
        headers: { "content-length": String(png.length) },
      });
    }, async () => {
      const result = await generateJobPhotoPdf(job);
      const pageCount =
        result.buffer.toString("latin1").match(/\/Type\s*\/Page\b/g)?.length ??
        0;
      assert.equal(result.filename, "JOB-2026-101.pdf");
      assert.equal(pageCount, 2);
      assert.equal(imageOptions.length, 3);
      assert.ok(
        imageOptions.every(
          ({ options: imageOption }) =>
            imageOption.fit?.length === 2 &&
            imageOption.align === "center" &&
            imageOption.valign === "center",
        ),
      );
      assert.ok(renderedText.includes("Job ID: JOB-2026-101"));
      assert.ok(renderedText.includes("Before Photo 1"));
      assert.ok(renderedText.includes("After Photo 1"));
      assert.ok(renderedText.includes("Before Photo 2"));
      assert.ok(renderedText.includes("After Photo 2"));
    });
  } finally {
    PDFDocument.prototype.text = originalText;
    PDFDocument.prototype.image = originalImage;
    mocks.restore();
  }
});

test("job photo PDF creates a readable document when no photos exist", async () => {
  const mocks = installPhotoMocks([]);
  try {
    const result = await generateJobPhotoPdf({
      ...job,
      beforePhotos: [],
      afterPhotos: [],
    });
    assert.ok(result.buffer.toString("latin1").startsWith("%PDF"));
    assert.equal(result.filename, "JOB-2026-101.pdf");
  } finally {
    mocks.restore();
  }
});

test("job photo exports reject untrusted Cloudinary URLs and oversized images", async () => {
  const originalFetch = globalThis.fetch;
  const mocks = installPhotoMocks([
    { ...photo("before-1", "before", "jpg"), url: "http://127.0.0.1/image.jpg" },
  ]);
  let fetchCalled = false;
  globalThis.fetch = async () => {
    fetchCalled = true;
    throw new Error("Untrusted URL should not be fetched");
  };

  try {
    await assert.rejects(generateJobPhotoZip(job), { statusCode: 502 });
    assert.equal(fetchCalled, false);

    JobPhoto.find = () =>
      createQuery([photo("before-1", "before", "jpg")]);
    await withPhotoFetch(
      async () =>
        new Response(Buffer.alloc(5 * 1024 * 1024 + 1), { status: 200 }),
      async () => {
        await assert.rejects(generateJobPhotoZip(job), {
          statusCode: 502,
        });
      },
    );
  } finally {
    globalThis.fetch = originalFetch;
    mocks.restore();
  }
});

test("job photo download endpoints validate jobs and set attachment headers", async () => {
  const originalFindById = Job.findById;
  const originalPhotoFind = JobPhoto.find;
  const originalFetch = globalThis.fetch;
  Job.findById = () => createQuery(job);
  JobPhoto.find = () => createQuery([]);
  globalThis.fetch = async () => {
    throw new Error("No photos expected");
  };

  try {
    await assert.rejects(
      invoke(downloadJobPhotosZip, {
        params: { jobId: "invalid" },
        user: { userType: "admin" },
      }),
      (error) => error.statusCode === 400,
    );
    Job.findById = () => createQuery(null);
    await assert.rejects(
      invoke(downloadJobPhotosZip, {
        params: { jobId },
        user: { userType: "admin" },
      }),
      (error) => error.statusCode === 404,
    );
    Job.findById = () => createQuery({ ...job, isDeleted: true });
    await assert.rejects(
      invoke(downloadJobPhotosPdf, {
        params: { jobId },
        user: { userType: "admin" },
      }),
      (error) => error.statusCode === 404,
    );
    Job.findById = () => createQuery(job);
    const zipResponse = await invoke(downloadJobPhotosZip, {
      params: { jobId },
      user: { userType: "admin" },
    });
    assert.equal(zipResponse.headers["Content-Type"], "application/zip");
    assert.equal(
      zipResponse.headers["Content-Disposition"],
      'attachment; filename="JOB-2026-101.zip"',
    );

    const pdfResponse = await invoke(downloadJobPhotosPdf, {
      params: { jobId },
      user: { userType: "superAdmin" },
    });
    assert.equal(pdfResponse.headers["Content-Type"], "application/pdf");
    assert.equal(
      pdfResponse.headers["Content-Disposition"],
      'attachment; filename="JOB-2026-101.pdf"',
    );
    await assert.rejects(
      invoke(downloadJobPhotosPdf, {
        params: { jobId },
        user: { userType: "supervisor" },
      }),
      (error) => error.statusCode === 403,
    );
  } finally {
    Job.findById = originalFindById;
    JobPhoto.find = originalPhotoFind;
    globalThis.fetch = originalFetch;
  }
});

test("job photo download routes authorize only admins and super admins", async () => {
  const routes = (await import("../src/modules/jobPhotos/jobPhotos.route.js"))
    .default;
  for (const routePath of [
    "/job/:jobId/download-zip",
    "/job/:jobId/download-pdf",
  ]) {
    const route = routes.stack.find(
      (layer) => layer.route?.path === routePath && layer.route.methods.get,
    )?.route;
    assert.ok(route);
    for (const userType of ["admin", "superAdmin"]) {
      assert.doesNotThrow(() =>
        route.stack[1].handle({ user: { userType } }, {}, () => {}),
      );
    }
    assert.throws(
      () =>
        route.stack[1].handle(
          { user: { userType: "supervisor" } },
          {},
          () => {},
        ),
      (error) => error.statusCode === 403,
    );
  }
});
