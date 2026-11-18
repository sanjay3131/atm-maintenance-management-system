import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
}));

vi.mock("@/lib/axios", () => ({
  default: { post: mocks.post },
}));

import {
  importATMUpload,
  previewATMUpload,
} from "../src/features/atms/services/atm.service";

describe("ATM bulk-upload service", () => {
  beforeEach(() => {
    mocks.post.mockReset();
  });

  it("posts the workbook as multipart data with the idempotency header", async () => {
    const result = { totalRows: 2, createdCount: 2 };
    const file = new File(["workbook"], "atms.xlsx");
    mocks.post.mockResolvedValue({ data: { data: result } });

    await expect(importATMUpload(file, "attempt-key")).resolves.toEqual(result);

    const [url, body, config] = mocks.post.mock.calls[0];
    expect(url).toBe("/atm/bulk-upload/import");
    expect(body).toBeInstanceOf(FormData);
    const uploadedFile = body.get("file");
    expect(uploadedFile).toBeInstanceOf(File);
    if (!(uploadedFile instanceof File)) {
      throw new Error("The uploaded FormData does not contain a File.");
    }
    expect(uploadedFile.name).toBe(file.name);
    expect(uploadedFile.size).toBe(file.size);
    expect(config.headers).toEqual({
      "Content-Type": undefined,
      "Idempotency-Key": "attempt-key",
    });
  });

  it("keeps the existing preview route and browser-set multipart boundary", async () => {
    const result = {
      totalRows: 0,
      validCount: 0,
      invalidCount: 0,
      rows: [],
    };
    const file = new File(["workbook"], "atms.xlsx");
    mocks.post.mockResolvedValue({ data: { data: result } });

    await expect(previewATMUpload(file)).resolves.toEqual(result);

    const [url, body, config] = mocks.post.mock.calls[0];
    expect(url).toBe("/atm/bulk-upload/preview");
    expect(body).toBeInstanceOf(FormData);
    expect(config.headers).toEqual({ "Content-Type": undefined });
  });
});
