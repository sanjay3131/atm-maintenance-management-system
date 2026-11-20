import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import JobPhotoDownloadActions from "../src/features/jobs/components/JobPhotoDownloadActions";

const mocks = vi.hoisted(() => ({
  user: { userType: "admin" as string },
  downloadJobPhotosPdf: vi.fn(),
  downloadJobPhotosZip: vi.fn(),
  toastError: vi.fn(),
}));

vi.mock("@/features/auth/auth-context", () => ({
  useAuth: () => ({ user: mocks.user }),
}));

vi.mock("@/features/jobs/services/jobs.service", () => ({
  downloadJobPhotosPdf: mocks.downloadJobPhotosPdf,
  downloadJobPhotosZip: mocks.downloadJobPhotosZip,
}));

vi.mock("sonner", () => ({
  toast: { error: mocks.toastError },
}));

describe("JobPhotoDownloadActions", () => {
  beforeEach(() => {
    mocks.user.userType = "admin";
    mocks.downloadJobPhotosPdf.mockReset();
    mocks.downloadJobPhotosZip.mockReset();
    mocks.toastError.mockReset();
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:job-photos"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
  });

  afterEach(() => {
    cleanup();
    vi.restoreAllMocks();
  });

  it("hides downloads from supervisors", () => {
    mocks.user.userType = "supervisor";
    render(
      <JobPhotoDownloadActions
        jobId="64b000000000000000000101"
        jobDisplayId="JOB-101"
      />,
    );

    expect(screen.queryByRole("button", { name: "Download ZIP" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Download PDF" })).toBeNull();
  });

  it("shows downloads to super admins", () => {
    mocks.user.userType = "superAdmin";
    render(
      <JobPhotoDownloadActions
        jobId="64b000000000000000000101"
        jobDisplayId="JOB-101"
      />,
    );

    expect(screen.getByRole("button", { name: "Download ZIP" })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download PDF" })).toBeTruthy();
  });

  it("shows both downloads to admins and requests the selected format", async () => {
    let resolveZipDownload!: (blob: Blob) => void;
    mocks.downloadJobPhotosZip.mockReturnValue(
      new Promise<Blob>((resolve) => {
        resolveZipDownload = resolve;
      }),
    );
    render(
      <JobPhotoDownloadActions
        jobId="64b000000000000000000101"
        jobDisplayId="JOB-101"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Download ZIP" }));
    expect(screen.getByRole("button", { name: "Preparing ZIP..." })).toBeTruthy();
    expect(screen.getByRole("button", { name: "Download PDF" }).disabled).toBe(
      true,
    );
    await waitFor(() =>
      expect(mocks.downloadJobPhotosZip).toHaveBeenCalledWith(
        "64b000000000000000000101",
      ),
    );
    resolveZipDownload(new Blob(["zip"]));
  });

  it("shows the backend error when a download fails", async () => {
    const errorBlob = new Blob([
      JSON.stringify({ message: "Export failed." }),
    ]);
    Object.defineProperty(errorBlob, "text", {
      value: async () => JSON.stringify({ message: "Export failed." }),
    });
    mocks.downloadJobPhotosPdf.mockRejectedValue({
      isAxiosError: true,
      response: { data: errorBlob },
    });
    render(
      <JobPhotoDownloadActions
        jobId="64b000000000000000000101"
        jobDisplayId="JOB-101"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Download PDF" }));
    await waitFor(() => expect(mocks.toastError).toHaveBeenCalledWith("Export failed."));
  });
});
