import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import ATMUploadPreviewDialog from "../src/features/atms/components/ATMUploadPreviewDialog";

const mocks = vi.hoisted(() => ({
  post: vi.fn(),
}));

vi.mock("@/lib/axios", () => ({
  default: { post: mocks.post },
}));

const validPreview = {
  totalRows: 1,
  validCount: 1,
  invalidCount: 0,
  rows: [
    {
      rowNumber: 2,
      status: "valid" as const,
      values: { atmId: "CLIENT-001", location: "Main branch", city: "Example" },
      errors: [],
    },
  ],
};

const successfulImport = {
  totalRows: 1,
  createdCount: 1,
};

const makeFile = (name = "atms.xlsx") =>
  new File(["workbook content"], name, {
    type: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  });

const renderDialog = () => {
  const onOpenChange = vi.fn();
  const onImportSuccess = vi.fn();
  render(
    <ATMUploadPreviewDialog
      open
      onOpenChange={onOpenChange}
      onImportSuccess={onImportSuccess}
    />,
  );
  return { onOpenChange, onImportSuccess };
};

const selectFileAndPreview = async (file = makeFile()) => {
  fireEvent.change(screen.getByLabelText("Choose an XLSX workbook"), {
    target: { files: [file] },
  });
  fireEvent.click(screen.getByRole("button", { name: "Generate preview" }));
  await waitFor(() => {
    expect(
      screen.getByRole("button", { name: "Import ATMs" }),
    ).toBeTruthy();
  });
  return file;
};

beforeEach(() => {
  mocks.post.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("ATM bulk-upload import workflow", () => {
  it("reuses the key on retry and creates a new key for a changed workbook", async () => {
    let importCount = 0;
    mocks.post.mockImplementation(async (url: string) => {
      if (url.endsWith("/preview")) return { data: { data: validPreview } };
      importCount += 1;
      if (importCount === 1) {
        throw { isAxiosError: true };
      }
      return { data: { data: successfulImport } };
    });
    const { onImportSuccess } = renderDialog();

    await selectFileAndPreview();
    fireEvent.click(screen.getByRole("button", { name: "Import ATMs" }));
    fireEvent.click(await screen.findByRole("button", { name: "Retry import" }));
    expect(
      await screen.findByText(/Imported 1 ATM from 1 row/),
    ).toBeTruthy();

    await selectFileAndPreview(makeFile("replacement.xlsx"));
    fireEvent.click(screen.getByRole("button", { name: "Import ATMs" }));
    await waitFor(() => expect(onImportSuccess).toHaveBeenCalledTimes(2));

    const importCalls = mocks.post.mock.calls.filter(([url]) =>
      url.endsWith("/import"),
    );
    const keys = importCalls.map((call) => call[2].headers["Idempotency-Key"]);
    expect(importCalls).toHaveLength(3);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[2]).not.toBe(keys[1]);
  });

  it.each([
    [
      400,
      "One or more ATM upload rows are invalid",
      [
        {
          rowNumber: 2,
          field: "ATM ID",
          message: "This identifier is already in use.",
        },
      ],
      /Excel row 2: ATM ID: This identifier is already in use/,
    ],
    [409, "The workbook conflicts with the current import state", [], /conflicts with the current import state/],
    [503, "Retry using the same idempotency key", [], /same idempotency key/],
  ])(
    "displays import status %s errors",
    async (status, message, errors, expectedText) => {
      mocks.post.mockImplementation(async (url: string) => {
        if (url.endsWith("/preview")) return { data: { data: validPreview } };
        throw {
          isAxiosError: true,
          response: { status, data: { message, errors } },
        };
      });
      renderDialog();

      await selectFileAndPreview();
      fireEvent.click(screen.getByRole("button", { name: "Import ATMs" }));

      expect((await screen.findByRole("alert")).textContent).toMatch(expectedText);
      if (status === 503) {
        expect(
          (screen.getByRole("button", { name: "Retry import" }) as HTMLButtonElement)
            .disabled,
        ).toBe(false);
      }
    },
  );

  it("blocks duplicate submissions while the import request is pending", async () => {
    let resolveImport:
      | ((response: { data: { data: typeof successfulImport } }) => void)
      | undefined;
    mocks.post.mockImplementation((url: string) => {
      if (url.endsWith("/preview")) {
        return Promise.resolve({ data: { data: validPreview } });
      }
      return new Promise((resolve) => {
        resolveImport = resolve;
      });
    });
    renderDialog();

    await selectFileAndPreview();
    fireEvent.click(screen.getByRole("button", { name: "Import ATMs" }));
    const importingButton = (await screen.findByRole("button", {
      name: "Importing ATMs...",
    })) as HTMLButtonElement;
    expect(importingButton.disabled).toBe(true);
    fireEvent.click(importingButton);

    expect(
      mocks.post.mock.calls.filter(([url]) => url.endsWith("/import")),
    ).toHaveLength(1);

    await act(async () => {
      resolveImport?.({ data: { data: successfulImport } });
    });
    expect(
      await screen.findByText(/Imported 1 ATM from 1 row/),
    ).toBeTruthy();
  });

  it("does not allow importing rows rejected by preview", async () => {
    const invalidPreview = {
      ...validPreview,
      validCount: 0,
      invalidCount: 1,
      rows: [
        {
          ...validPreview.rows[0],
          status: "invalid" as const,
          errors: [{ field: "ATM ID", message: "Required." }],
        },
      ],
    };
    mocks.post.mockResolvedValue({ data: { data: invalidPreview } });
    renderDialog();

    await selectFileAndPreview();

    expect(
      (screen.getByRole("button", { name: "Import ATMs" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      screen.getByText("Resolve all preview errors before importing this workbook."),
    ).toBeTruthy();
    expect(
      mocks.post.mock.calls.some(([url]) => url.endsWith("/import")),
    ).toBe(false);
  });
});
