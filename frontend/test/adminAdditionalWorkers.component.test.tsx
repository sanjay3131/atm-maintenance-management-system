import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { AxiosError } from "axios";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AdminAdditionalWorkersSection from "../src/features/jobs/components/AdminAdditionalWorkersSection";
import { useJob } from "../src/features/jobs/hooks/useJob";
import type {
  AdditionalWorker,
  Job,
  JobStatus,
} from "../src/features/jobs/types/job.types";

const mocks = vi.hoisted(() => ({
  userType: "admin",
  job: null as null | Record<string, unknown>,
  getJob: vi.fn(),
  createWorker: vi.fn(),
  updateWorker: vi.fn(),
  deleteWorker: vi.fn(),
  toastSuccess: vi.fn(),
}));

vi.mock("@/features/auth/auth-context", () => ({
  useAuth: () => ({
    user: { _id: "admin-1", userType: mocks.userType },
  }),
}));

vi.mock("@/features/employee-portal/i18n", () => ({
  employeeLanguageClasses: (_language: string, english: string) => english,
  useEmployeeLanguage: () => ({
    language: "en",
    t: (key: string, values?: Record<string, string>) =>
      key.replace(/\{(\w+)\}/g, (_match, field: string) => values?.[field] ?? ""),
  }),
}));

vi.mock("@/features/jobs/services/jobs.service", () => ({
  getJobById: (...args: unknown[]) => mocks.getJob(...args),
  createAdditionalWorker: (...args: unknown[]) =>
    mocks.createWorker(...args),
  updateAdditionalWorker: (...args: unknown[]) =>
    mocks.updateWorker(...args),
  deleteAdditionalWorker: (...args: unknown[]) =>
    mocks.deleteWorker(...args),
}));

vi.mock("sonner", () => ({
  toast: { success: (...args: unknown[]) => mocks.toastSuccess(...args) },
}));

const statuses: JobStatus[] = [
  "PENDING",
  "ASSIGNED",
  "ACCEPTED",
  "IN_PROGRESS",
  "ON_HOLD",
  "COMPLETED",
  "VERIFIED",
  "APPROVED",
  "CLOSED",
  "REJECTED",
  "CANCELLED",
];

const worker = (
  overrides: Partial<AdditionalWorker> = {},
): AdditionalWorker => ({
  _id: "worker-1",
  workerType: "Technician",
  quantity: 2,
  notes: "Night shift",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
  ...overrides,
});

function makeJob(overrides: Partial<Job> = {}): Job {
  return {
    _id: "job-1",
    jobId: "JOB-001",
    title: "ATM maintenance",
    status: "IN_PROGRESS",
    additionalWorkers: [],
    __v: 12,
    ...overrides,
  } as Job;
}

function TestHarness({ readOnly = false }: { readOnly?: boolean }) {
  const query = useJob("job-1");
  if (!query.data) return <p>Loading job...</p>;

  return (
    <AdminAdditionalWorkersSection
      job={query.data}
      readOnly={readOnly}
      onRefreshLatest={async () => {
        const refreshed = await query.refetch();
        return (
          refreshed.isSuccess &&
          Number.isSafeInteger(refreshed.data?.__v) &&
          (refreshed.data?.__v ?? -1) >= 0
        );
      }}
    />
  );
}

async function renderSection({
  role = "admin",
  job = makeJob(),
  readOnly = false,
}: {
  role?: string;
  job?: Job;
  readOnly?: boolean;
} = {}) {
  mocks.userType = role;
  mocks.job = structuredClone(job) as unknown as Record<string, unknown>;
  const queryClient = new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  });
  queryClient.setQueryData(["job-history", "job-1"], []);
  const user = userEvent.setup();

  render(
    <QueryClientProvider client={queryClient}>
      <TestHarness readOnly={readOnly} />
    </QueryClientProvider>,
  );
  await screen.findByRole("heading", { name: "Additional Workers" });
  return { queryClient, user };
}

beforeEach(() => {
  mocks.job = structuredClone(makeJob()) as unknown as Record<string, unknown>;
  mocks.getJob.mockImplementation(async () =>
    structuredClone(mocks.job) as Record<string, unknown>,
  );
  mocks.createWorker.mockImplementation(
    async (_jobId: string, data: Record<string, unknown>) => {
      const current = mocks.job as unknown as Job;
      const created = worker({
        _id: `worker-${(current.additionalWorkers?.length ?? 0) + 1}`,
        workerType: String(data.workerType),
        quantity: Number(data.quantity),
        notes: typeof data.notes === "string" ? data.notes : undefined,
      });
      const additionalWorkers = [...(current.additionalWorkers ?? []), created];
      const version = Number(current.__v) + 1;
      mocks.job = { ...current, additionalWorkers, __v: version };
      return { additionalWorkers, version };
    },
  );
  mocks.updateWorker.mockImplementation(
    async (
      _jobId: string,
      workerId: string,
      data: Record<string, unknown>,
    ) => {
      const current = mocks.job as unknown as Job;
      const additionalWorkers = (current.additionalWorkers ?? []).map(
        (entry) =>
          entry._id === workerId
            ? {
                ...entry,
                workerType: String(data.workerType),
                quantity: Number(data.quantity),
                notes: String(data.notes ?? ""),
              }
            : entry,
      );
      const version = Number(current.__v) + 1;
      mocks.job = { ...current, additionalWorkers, __v: version };
      return { additionalWorkers, version };
    },
  );
  mocks.deleteWorker.mockImplementation(
    async (_jobId: string, workerId: string) => {
      const current = mocks.job as unknown as Job;
      const additionalWorkers = (current.additionalWorkers ?? []).filter(
        (entry) => entry._id !== workerId,
      );
      const version = Number(current.__v) + 1;
      mocks.job = { ...current, additionalWorkers, __v: version };
      return { additionalWorkers, version };
    },
  );
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("AdminAdditionalWorkersSection interactions", () => {
  it.each(statuses.flatMap((status) =>
    ["admin", "superAdmin"].map((role) => [role, status] as const),
  ))("%s can add workers when a job is %s", async (role, status) => {
    const { user } = await renderSection({
      role,
      job: makeJob({ status }),
    });

    await user.click(screen.getByRole("button", { name: "Add worker" }));
    expect(
      screen.getByRole("textbox", { name: "Worker type / name" }),
    ).toBeTruthy();
  });

  it("shows existing workers but hides mutation controls in read-only mode", async () => {
    await renderSection({
      readOnly: true,
      job: makeJob({ additionalWorkers: [worker()] }),
    });

    expect(screen.getByText("Technician")).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Add worker" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Edit Technician" }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Remove Technician" }),
    ).toBeNull();
  });

  it("enforces the 20-entry limit in the rendered controls", async () => {
    await renderSection({
      job: makeJob({
        additionalWorkers: Array.from({ length: 20 }, (_, index) =>
          worker({ _id: `worker-${index}`, workerType: `Worker ${index}` }),
        ),
      }),
    });

    expect(
      screen.queryByRole("button", { name: "Add worker" }),
    ).toBeNull();
    expect(
      screen.getByText("Maximum of 20 worker entries reached."),
    ).toBeTruthy();
  });

  it.each([undefined, -1, 1.5, Number.MAX_SAFE_INTEGER + 1, Number.NaN])(
    "blocks mutation when __v is invalid (%s)",
    async (version) => {
      const { user } = await renderSection({
        job: makeJob({ __v: version }),
      });
      const addButton = screen.getByRole("button", { name: "Add worker" });

      expect((addButton as HTMLButtonElement).disabled).toBe(true);
      await user.click(addButton);
      expect(
        screen.queryByRole("textbox", { name: "Worker type / name" }),
      ).toBeNull();
      expect(mocks.createWorker).not.toHaveBeenCalled();
    },
  );

  it("adds a worker with the current version and displays authoritative data", async () => {
    const { user, queryClient } = await renderSection();
    await user.click(screen.getByRole("button", { name: "Add worker" }));
    await user.type(
      screen.getByRole("textbox", { name: "Worker type / name" }),
      "Electrician",
    );
    await user.clear(screen.getByRole("spinbutton", { name: "Quantity" }));
    await user.type(screen.getByRole("spinbutton", { name: "Quantity" }), "3");
    await user.type(
      screen.getByRole("textbox", { name: "Notes (optional)" }),
      "Panel work",
    );
    await user.click(screen.getByRole("button", { name: "Add worker entry" }));

    await screen.findByText("Electrician");
    expect(mocks.createWorker).toHaveBeenCalledWith("job-1", {
      workerType: "Electrician",
      quantity: 3,
      notes: "Panel work",
      expectedVersion: 12,
    });
    expect(queryClient.getQueryData<Job>(["job", "job-1"])).toMatchObject({
      __v: 13,
      additionalWorkers: [{ workerType: "Electrician", quantity: 3 }],
    });
    expect(
      queryClient.getQueryState(["job-history", "job-1"])?.isInvalidated,
    ).toBe(true);
  });

  it("edits a worker and sends the current expectedVersion", async () => {
    await renderSection({
      job: makeJob({ additionalWorkers: [worker()] }),
    });
    const user = userEvent.setup();
    await user.click(screen.getByRole("button", { name: "Edit Technician" }));
    const workerType = screen.getByRole("textbox", {
      name: "Worker type / name",
    });
    await user.clear(workerType);
    await user.type(workerType, "Senior Technician");
    await user.click(screen.getByRole("button", { name: "Update worker" }));

    await screen.findByText("Senior Technician");
    expect(mocks.updateWorker).toHaveBeenCalledWith(
      "job-1",
      "worker-1",
      {
        workerType: "Senior Technician",
        quantity: 2,
        notes: "Night shift",
        expectedVersion: 12,
      },
    );
  });

  it("requires delete confirmation, supports cancellation, and sends expectedVersion", async () => {
    await renderSection({
      job: makeJob({ additionalWorkers: [worker()] }),
    });
    const user = userEvent.setup();

    await user.click(
      screen.getByRole("button", { name: "Remove Technician" }),
    );
    let dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Keep worker" }));
    expect(mocks.deleteWorker).not.toHaveBeenCalled();

    await user.click(
      screen.getByRole("button", { name: "Remove Technician" }),
    );
    dialog = screen.getByRole("dialog");
    await user.click(within(dialog).getByRole("button", { name: "Remove worker" }));

    await waitFor(() => expect(mocks.deleteWorker).toHaveBeenCalledWith(
      "job-1",
      "worker-1",
      12,
    ));
    await waitFor(() => expect(screen.queryByText("Technician")).toBeNull());
  });

  it("preserves drafts after 409 and refreshes only on explicit action", async () => {
    await renderSection();
    const user = userEvent.setup();
    mocks.createWorker.mockRejectedValueOnce(
      Object.assign(new AxiosError("Conflict"), {
        response: { status: 409 },
      }),
    );

    await user.click(screen.getByRole("button", { name: "Add worker" }));
    const workerType = screen.getByRole("textbox", {
      name: "Worker type / name",
    });
    await user.type(workerType, "Electrician");
    await user.type(
      screen.getByRole("textbox", { name: "Notes (optional)" }),
      "Keep this draft",
    );
    await user.click(screen.getByRole("button", { name: "Add worker entry" }));

    expect((await screen.findByRole("alert")).textContent).toContain(
      "This Job changed elsewhere.",
    );
    expect((workerType as HTMLInputElement).value).toBe("Electrician");
    expect(
      (screen.getByRole("textbox", {
        name: "Notes (optional)",
      }) as HTMLTextAreaElement).value,
    ).toBe("Keep this draft");
    expect(mocks.createWorker).toHaveBeenCalledTimes(1);
    expect(mocks.getJob).toHaveBeenCalledTimes(1);

    mocks.job = { ...(mocks.job as object), __v: 13 };
    await user.click(screen.getByRole("button", { name: "Refresh Job" }));
    await waitFor(() => expect(mocks.getJob).toHaveBeenCalledTimes(2));
    expect((workerType as HTMLInputElement).value).toBe("Electrician");
    expect(mocks.createWorker).toHaveBeenCalledTimes(1);

    await user.click(screen.getByRole("button", { name: "Add worker entry" }));
    await waitFor(() => expect(mocks.createWorker).toHaveBeenCalledTimes(2));
    expect(mocks.createWorker).toHaveBeenLastCalledWith("job-1", {
      workerType: "Electrician",
      quantity: 1,
      notes: "Keep this draft",
      expectedVersion: 13,
    });
  });

  it("prevents duplicate submissions while a request is pending", async () => {
    await renderSection();
    const user = userEvent.setup();
    let resolveCreate!: (value: {
      additionalWorkers: AdditionalWorker[];
      version: number;
    }) => void;
    mocks.createWorker.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          resolveCreate = resolve;
        }),
    );

    await user.click(screen.getByRole("button", { name: "Add worker" }));
    await user.type(
      screen.getByRole("textbox", { name: "Worker type / name" }),
      "Electrician",
    );
    const form = screen.getByRole("button", { name: "Add worker entry" })
      .closest("form");
    expect(form).not.toBeNull();
    const submitButton = screen.getByRole("button", {
      name: "Add worker entry",
    });
    fireEvent.click(submitButton);
    fireEvent.click(submitButton);
    await waitFor(() => expect(mocks.createWorker).toHaveBeenCalledTimes(1));
    expect(mocks.createWorker).toHaveBeenCalledTimes(1);

    resolveCreate({
      additionalWorkers: [worker({ workerType: "Electrician" })],
      version: 13,
    });
    mocks.job = {
      ...(mocks.job as object),
      additionalWorkers: [worker({ workerType: "Electrician" })],
      __v: 13,
    };
    await screen.findByText("Electrician");
  });

  it("associates each validation error only with its field and clears it on correction", async () => {
    const { user } = await renderSection();
    await user.click(screen.getByRole("button", { name: "Add worker" }));
    const workerType = screen.getByRole("textbox", {
      name: "Worker type / name",
    });
    const quantity = screen.getByRole("spinbutton", { name: "Quantity" });
    const notes = screen.getByRole("textbox", { name: "Notes (optional)" });

    const form = screen.getByRole("button", { name: "Add worker entry" })
      .closest("form")!;
    fireEvent.submit(form);
    expect(workerType.getAttribute("aria-invalid")).toBe("true");
    expect(workerType.getAttribute("aria-describedby")).toBe(
      "admin-additional-worker-type-error-job-1",
    );
    expect(quantity.getAttribute("aria-invalid")).not.toBe("true");
    expect(notes.getAttribute("aria-invalid")).not.toBe("true");
    await user.type(workerType, "Helper");
    expect(workerType.getAttribute("aria-invalid")).not.toBe("true");

    fireEvent.change(workerType, { target: { value: "W".repeat(81) } });
    fireEvent.submit(form);
    await screen.findByText("Worker type must be 80 characters or fewer.");
    expect(workerType.getAttribute("aria-invalid")).toBe("true");
    expect(quantity.getAttribute("aria-invalid")).not.toBe("true");
    expect(notes.getAttribute("aria-invalid")).not.toBe("true");
    fireEvent.change(workerType, { target: { value: "Helper" } });
    expect(workerType.getAttribute("aria-invalid")).not.toBe("true");

    await user.clear(quantity);
    fireEvent.submit(form);
    await screen.findByText("Quantity must be a positive whole number.");
    expect(quantity.getAttribute("aria-invalid")).toBe("true");
    expect(quantity.getAttribute("aria-describedby")).toBe(
      "admin-additional-worker-quantity-error-job-1",
    );
    expect(workerType.getAttribute("aria-invalid")).not.toBe("true");
    expect(notes.getAttribute("aria-invalid")).not.toBe("true");
    await user.clear(quantity);
    await user.type(quantity, "2");
    expect(quantity.getAttribute("aria-invalid")).not.toBe("true");

    fireEvent.change(notes, { target: { value: "x".repeat(301) } });
    fireEvent.submit(form);
    await screen.findByText("Notes must be 300 characters or fewer.");
    expect(notes.getAttribute("aria-invalid")).toBe("true");
    expect(notes.getAttribute("aria-describedby")).toBe(
      "admin-additional-worker-notes-error-job-1",
    );
    expect(workerType.getAttribute("aria-invalid")).not.toBe("true");
    expect(quantity.getAttribute("aria-invalid")).not.toBe("true");
    fireEvent.change(notes, { target: { value: "short note" } });
    expect(notes.getAttribute("aria-invalid")).not.toBe("true");
  });
});
