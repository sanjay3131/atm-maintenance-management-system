import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { MemoryRouter, useLocation } from "react-router-dom";
import type {
  JobsListResponse,
  JobsQueryParams,
} from "../src/features/jobs/types/job.types";
import JobsPage from "../src/pages/admin/JobsPage";

const mocks = vi.hoisted(() => ({
  getJobs: vi.fn(),
}));

vi.mock("@/features/jobs/services/jobs.service", () => ({
  getJobs: mocks.getJobs,
}));

vi.mock("@/features/jobs/components/CreateJobForm", () => ({
  default: () => null,
}));

vi.mock("@/features/jobs/components/AssignJobDialog", () => ({
  default: () => null,
}));

vi.mock("@/components/ui/dialog", () => ({
  Dialog: ({ children }: { children: React.ReactNode }) => <>{children}</>,
  DialogContent: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogDescription: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
  DialogTitle: ({ children }: { children: React.ReactNode }) => (
    <div>{children}</div>
  ),
}));

vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    children,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    children: React.ReactNode;
  }) => (
    <select value={value} onChange={(event) => onValueChange(event.target.value)}>
      {children}
    </select>
  ),
  SelectContent: ({ children }: { children: React.ReactNode }) => (
    <>{children}</>
  ),
  SelectItem: ({
    value,
    children,
  }: {
    value: string;
    children: React.ReactNode;
  }) => <option value={value}>{children}</option>,
  SelectTrigger: () => null,
  SelectValue: () => null,
}));

function CurrentPath() {
  const location = useLocation();
  return <output data-testid="current-path">{location.pathname}</output>;
}

function jobResults(
  title: string,
  page = 1,
  totalPages = 1,
): JobsListResponse {
  return {
    jobs: [
      {
        _id: `job-${title}`,
        jobId: `ID-${title}`,
        title,
        atmId: null,
        workType: "service",
        priority: "medium",
        status: "PENDING",
        createdAt: "2026-01-01T00:00:00.000Z",
      },
    ],
    pagination: {
      page,
      limit: 10,
      total: totalPages * 10,
      totalPages,
    },
  };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function renderJobsPage() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false, gcTime: Infinity } },
  });

  render(
    <QueryClientProvider client={queryClient}>
      <MemoryRouter initialEntries={["/admin/jobs"]}>
        <CurrentPath />
        <JobsPage />
      </MemoryRouter>
    </QueryClientProvider>,
  );

  return queryClient;
}

beforeEach(() => {
  mocks.getJobs.mockReset();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("Admin Jobs search loading behavior", () => {
  it("shows the existing skeleton only during the initial page load", async () => {
    const initialRequest = deferred<JobsListResponse>();
    mocks.getJobs.mockReturnValue(initialRequest.promise);
    renderJobsPage();

    expect(screen.getByText("Loading jobs...")).toBeTruthy();
    expect(screen.queryByLabelText("Search jobs")).toBeNull();
    expect(mocks.getJobs).toHaveBeenCalledWith({ page: 1, limit: 10 });

    await act(async () => {
      initialRequest.resolve(jobResults("Initial job"));
    });

    expect(await screen.findByText("Initial job")).toBeTruthy();
  });

  it("debounces rapid typing and keeps focus and previous results through the request", async () => {
    const searchRequest = deferred<JobsListResponse>();
    mocks.getJobs.mockImplementation(({ search }: JobsQueryParams) =>
      search ? searchRequest.promise : Promise.resolve(jobResults("Existing job")),
    );

    renderJobsPage();
    expect(await screen.findByText("Existing job")).toBeTruthy();
    expect(screen.getByTestId("current-path").textContent).toBe("/admin/jobs");
    const input = screen.getByRole("searchbox", { name: "Search jobs" });
    expect(input.closest("form")).toBeNull();
    input.focus();

    fireEvent.change(input, { target: { value: "p" } });
    fireEvent.change(input, { target: { value: "pu" } });
    fireEvent.change(input, { target: { value: "pump" } });
    await new Promise((resolve) => window.setTimeout(resolve, 250));

    expect(mocks.getJobs).toHaveBeenCalledTimes(1);
    expect(input.isConnected).toBe(true);
    expect(document.activeElement).toBe(input);
    expect(screen.getByText("Existing job")).toBeTruthy();

    await waitFor(() => {
      expect(mocks.getJobs).toHaveBeenCalledTimes(2);
      expect(mocks.getJobs).toHaveBeenLastCalledWith({
        page: 1,
        limit: 10,
        search: "pump",
      });
    });
    expect(input.isConnected).toBe(true);
    expect(document.activeElement).toBe(input);
    expect(screen.getByText("Existing job")).toBeTruthy();
    expect(screen.getByText("Updating...").getAttribute("role")).toBe("status");
    expect(screen.getByTestId("current-path").textContent).toBe("/admin/jobs");

    await act(async () => {
      searchRequest.resolve(jobResults("Matching job"));
    });

    expect(await screen.findByText("Matching job")).toBeTruthy();
    expect(screen.queryByText("Existing job")).toBeNull();
    expect(document.activeElement).toBe(input);
  });

  it("keeps filters and pagination represented in subsequent query parameters", async () => {
    mocks.getJobs.mockImplementation(({ page }: JobsQueryParams) =>
      Promise.resolve(jobResults(`Page ${page}`, page, 2)),
    );
    renderJobsPage();
    expect(await screen.findByText("Page 1")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /Next/ }));
    expect(await screen.findByText("Page 2")).toBeTruthy();
    expect(mocks.getJobs).toHaveBeenLastCalledWith({ page: 2, limit: 10 });

    const [statusSelect] = screen.getAllByRole("combobox");
    fireEvent.change(statusSelect, { target: { value: "PENDING" } });
    expect(await screen.findByText("Page 1")).toBeTruthy();
    await waitFor(() => {
      expect(mocks.getJobs).toHaveBeenLastCalledWith({
        page: 1,
        limit: 10,
        status: "PENDING",
      });
    });
  });
});
