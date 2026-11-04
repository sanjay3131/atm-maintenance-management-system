import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { AxiosError } from "axios";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import App from "../src/App";
import AdminAttendanceReportPage from "../src/pages/admin/AdminAttendanceReportPage";
import type { AttendanceReportResponse } from "../src/services/attendance.service";
import type {
  Employee,
  EmployeeOption,
  EmployeeOptionsResponse,
} from "../src/services/employee.service";

const mocks = vi.hoisted(() => ({
  useAttendanceReport: vi.fn(),
  downloadAttendanceReportExport: vi.fn(),
  useEmployees: vi.fn(),
  useEmployeeOptions: vi.fn(),
  useAdminAttendanceDashboard: vi.fn(),
  useAttendanceStatusOverrideAudit: vi.fn(),
  useSetAttendanceStatusOverride: vi.fn(),
  userType: "admin",
}));

vi.mock("@/features/attendance/hooks/useAdminAttendance", () => ({
  useAttendanceReport: mocks.useAttendanceReport,
  useAdminAttendanceDashboard: mocks.useAdminAttendanceDashboard,
  useAttendanceStatusOverrideAudit: mocks.useAttendanceStatusOverrideAudit,
  useSetAttendanceStatusOverride: mocks.useSetAttendanceStatusOverride,
}));

vi.mock("@/services/attendance.service", async (importOriginal) => ({
  ...(await importOriginal<typeof import("@/services/attendance.service")>()),
  downloadAttendanceReportExport: mocks.downloadAttendanceReportExport,
}));

vi.mock("@/features/employees/hooks/useEmployees", () => ({
  useEmployees: mocks.useEmployees,
}));

vi.mock("@/features/employees/hooks/useEmployeeOptions", () => ({
  useEmployeeOptions: mocks.useEmployeeOptions,
}));

vi.mock("@/features/auth/auth-context", () => ({
  useAuth: () => ({
    user: { userType: mocks.userType, firstName: "Admin", lastName: "User" },
    isLoading: false,
    logout: vi.fn(),
  }),
}));

vi.mock("@/layouts/AdminLayout", async () => {
  const { Outlet } = await import("react-router-dom");
  return { default: () => <Outlet /> };
});

vi.mock("@/layouts/EmployeeLayout", async () => {
  const { Outlet } = await import("react-router-dom");
  return { default: () => <Outlet /> };
});

vi.mock("@/layouts/SupervisorLayout", async () => {
  const { Outlet } = await import("react-router-dom");
  return { default: () => <Outlet /> };
});

vi.mock("@/layouts/CustomerPortalLayout", async () => {
  const { Outlet } = await import("react-router-dom");
  return { default: () => <Outlet /> };
});

vi.mock("@/features/employee-portal/EmployeeLanguageProvider", () => ({
  default: ({ children }: { children: ReactNode }) => children,
}));

vi.mock("@/pages/admin/AdminDashboardPage", () => ({
  default: () => <div>Admin home</div>,
}));
vi.mock("@/pages/employee/EmployeeDashboardPage", () => ({
  default: () => <div>Employee home</div>,
}));
vi.mock("@/pages/supervisor/SupervisorDashboardPage", () => ({
  default: () => <div>Supervisor home</div>,
}));
vi.mock("@/pages/customer/CustomerPortalPages", () => {
  const Page = () => <div>Customer page</div>;
  return {
    CustomerAMCDetailsPage: Page,
    CustomerAMCsPage: Page,
    CustomerATMDetailsPage: Page,
    CustomerATMsPage: Page,
    CustomerDashboardPage: () => <div>Customer home</div>,
    CustomerJobDetailsPage: Page,
    CustomerJobsPage: Page,
    CustomerReportsPage: Page,
  };
});

const employee: Employee = {
  _id: "employee-document-id",
  employeeCode: "EMP-042",
  designation: "Technician",
  department: "Field Operations",
  joiningDate: "2020-04-01",
  employmentType: "full-time",
  status: "resigned",
  userId: {
    _id: "populated-user-id",
    firstName: "தமிழ்",
    lastName: "பெயர்",
    email: "employee@example.invalid",
    userType: "employee",
  },
  districtIds: [],
  assignedAtmIds: [],
  regionIds: [],
  createdAt: "2020-04-01T00:00:00.000Z",
  updatedAt: "2024-06-01T00:00:00.000Z",
};

const employeeOption: EmployeeOption = {
  _id: "employee-document-id",
  employeeCode: "EMP-042",
  firstName: "தமிழ்",
  lastName: "பெயர்",
  avatarUrl: null,
};

const reportResponse: AttendanceReportResponse = {
  timeZone: "Asia/Kolkata",
  asOf: "2024-06-05T12:34:56.000Z",
  period: {
    fromDate: "2024-06-01",
    toDate: "2024-06-05",
    calculatedThroughDate: "2024-06-05",
  },
  pagination: {
    page: 1,
    limit: 25,
    totalEmployees: 26,
    totalPages: 2,
  },
  employees: [
    {
      employeeId: employee._id,
      employeeCode: employee.employeeCode,
      summary: {
        eligibleWorkingDays: 3,
        presentDays: 1,
        incompleteDays: 1,
        absentDays: 0,
        notRecordedDays: 1,
        attendancePercentage: 33.33,
        workedDurationMs: 3 * 60 * 60 * 1000,
        finalizedWorkedDurationMs: 60 * 60 * 1000,
        provisionalWorkedDurationMs: 2 * 60 * 60 * 1000,
      },
      dailyDetails: [
        {
          attendanceDate: "2024-06-03",
          status: "present",
          calculatedStatus: "present",
          statusOrigin: "recorded",
          checkInAt: "2024-06-03T03:30:00.000Z",
          checkOutAt: "2024-06-03T12:30:00.000Z",
          checkoutState: "checked_out",
          checkOutSource: "system",
          workedDurationMs: 9 * 60 * 60 * 1000,
          durationIsProvisional: true,
        },
        {
          attendanceDate: "2024-06-04",
          status: "not_recorded",
          calculatedStatus: null,
          statusOrigin: "no_record",
          checkInAt: null,
          checkOutAt: null,
          checkoutState: "no_record",
          checkOutSource: null,
          workedDurationMs: null,
          durationIsProvisional: false,
        },
      ],
    },
  ],
};

let employeeQuery: {
  data?: Employee[];
  isLoading: boolean;
  isError: boolean;
};
let employeeOptionsQuery: {
  data?: EmployeeOptionsResponse;
  isLoading: boolean;
  isFetching: boolean;
  isError: boolean;
  refetch: ReturnType<typeof vi.fn>;
};
let reportQueryState: {
  data?: AttendanceReportResponse;
  error?: unknown;
  isError: boolean;
  isFetching: boolean;
  isLoading: boolean;
  isSuccess: boolean;
  refetch: ReturnType<typeof vi.fn>;
};

function installReportHook() {
  mocks.useAttendanceReport.mockImplementation((params) => {
    const data = reportQueryState.data
      ? {
          ...reportQueryState.data,
          period: {
            ...reportQueryState.data.period,
            fromDate: params.fromDate,
            toDate: params.toDate,
          },
          pagination: {
            ...reportQueryState.data.pagination,
            page: params.page ?? 1,
            limit: params.limit ?? 25,
          },
        }
      : undefined;
    return { ...reportQueryState, data };
  });
}

function setPath(path: string) {
  window.history.replaceState({}, "", path);
}

function renderReport() {
  return render(
    <MemoryRouter>
      <AdminAttendanceReportPage />
    </MemoryRouter>,
  );
}

function openEmployeeSearch() {
  const input = screen.getByRole("combobox", { name: "Search employees" });
  fireEvent.focus(input);
  return input;
}

function getEmployeeResultOptions() {
  return within(screen.getByRole("listbox")).getAllByRole("option");
}

beforeEach(() => {
  employeeQuery = { data: [employee], isLoading: false, isError: false };
  employeeOptionsQuery = {
    data: {
      employees: [employeeOption],
      pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
    },
    isLoading: false,
    isFetching: false,
    isError: false,
    refetch: vi.fn(),
  };
  reportQueryState = {
    data: reportResponse,
    isError: false,
    isFetching: false,
    isLoading: false,
    isSuccess: true,
    refetch: vi.fn(),
  };
  mocks.downloadAttendanceReportExport.mockResolvedValue({
    blob: new Blob(["report"]),
    filename: "attendance-report-2024-06-01.xlsx",
  });
  mocks.userType = "admin";
  mocks.useEmployees.mockImplementation(() => employeeQuery);
  mocks.useEmployeeOptions.mockImplementation(() => employeeOptionsQuery);
  installReportHook();
  mocks.useAdminAttendanceDashboard.mockReturnValue({
    data: {
      date: "2024-06-05",
      timeZone: "Asia/Kolkata",
      summary: {
        employees: { total: 0, present: 0, absent: 0, incomplete: 0, unrecorded: 0 },
        supervisors: { total: 0, present: 0, absent: 0, incomplete: 0, unrecorded: 0 },
      },
      records: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    },
    isError: false,
    isFetching: false,
    isLoading: false,
    refetch: vi.fn(),
  });
  mocks.useAttendanceStatusOverrideAudit.mockReturnValue({
    data: { events: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } },
    isError: false,
    isLoading: false,
    error: null,
  });
  mocks.useSetAttendanceStatusOverride.mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  });
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.clearAllMocks();
  window.history.replaceState({}, "", "/");
});

describe("attendance report page", () => {
  it("defaults to the current Asia/Kolkata month through business today", () => {
    renderReport();
    const todayParts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const values = Object.fromEntries(
      todayParts.map(({ type, value }) => [type, value]),
    );
    const today = `${values.year}-${values.month}-${values.day}`;

    expect((screen.getByLabelText("Period") as HTMLSelectElement).value).toBe(
      "month",
    );
    expect(mocks.useAttendanceReport).toHaveBeenLastCalledWith(
      expect.objectContaining({
        fromDate: `${today.slice(0, 7)}-01`,
        toDate: today,
        page: 1,
        limit: 25,
      }),
    );
  });

  it("exports the complete current scope with the displayed asOf and no UI pagination", async () => {
    const originalCreateObjectURL = URL.createObjectURL;
    const originalRevokeObjectURL = URL.revokeObjectURL;
    const originalAnchorClick = HTMLAnchorElement.prototype.click;
    Object.defineProperty(URL, "createObjectURL", {
      configurable: true,
      value: vi.fn(() => "blob:attendance-report"),
    });
    Object.defineProperty(URL, "revokeObjectURL", {
      configurable: true,
      value: vi.fn(),
    });
    HTMLAnchorElement.prototype.click = vi.fn();

    try {
      renderReport();
      const excelButton = screen.getByRole("button", {
        name: "Download Excel",
      });
      expect((excelButton as HTMLButtonElement).disabled).toBe(false);
      fireEvent.click(excelButton);
      await waitFor(() => {
        expect(mocks.downloadAttendanceReportExport).toHaveBeenCalledWith(
          "xlsx",
          expect.objectContaining({
            fromDate: expect.any(String),
            toDate: expect.any(String),
            periodType: "month",
            asOf: reportResponse.asOf,
          }),
        );
      });
      const request =
        mocks.downloadAttendanceReportExport.mock.calls[0][1] as Record<
          string,
          unknown
        >;
      expect(request).not.toHaveProperty("page");
      expect(request).not.toHaveProperty("limit");
      await waitFor(() => {
        expect(URL.revokeObjectURL).toHaveBeenCalledWith(
          "blob:attendance-report",
        );
      });
    } finally {
      Object.defineProperty(URL, "createObjectURL", {
        configurable: true,
        value: originalCreateObjectURL,
      });
      Object.defineProperty(URL, "revokeObjectURL", {
        configurable: true,
        value: originalRevokeObjectURL,
      });
      HTMLAnchorElement.prototype.click = originalAnchorClick;
    }
  });

  it("includes the selected Employee document ID and disables exports without a successful cutoff", async () => {
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    renderReport();
    openEmployeeSearch();
    fireEvent.click(getEmployeeResultOptions()[0]);
    fireEvent.click(screen.getByRole("button", { name: "Download PDF" }));
    await waitFor(() => {
      expect(mocks.downloadAttendanceReportExport).toHaveBeenCalledWith(
        "pdf",
        expect.objectContaining({
          employeeId: employee._id,
          asOf: reportResponse.asOf,
        }),
      );
    });

    cleanup();
    reportQueryState = {
      ...reportQueryState,
      data: { ...reportResponse, asOf: null },
    };
    renderReport();
    expect(
      (screen.getByRole("button", { name: "Download Excel" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
  });

  it("shows a clear export failure and disables duplicate downloads while pending", async () => {
    vi.spyOn(HTMLAnchorElement.prototype, "click").mockImplementation(() => {});
    let finishDownload: (() => void) | undefined;
    mocks.downloadAttendanceReportExport.mockImplementationOnce(
      () =>
        new Promise((resolve) => {
          finishDownload = () =>
            resolve({
              blob: new Blob(["report"]),
              filename: "attendance-report-2024-06-01.xlsx",
            });
        }),
    );
    renderReport();
    fireEvent.click(screen.getByRole("button", { name: "Download Excel" }));
    expect(
      (screen.getByRole("button", { name: "Preparing Excel…" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(
      (screen.getByRole("button", { name: "Download PDF" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    finishDownload?.();
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Download Excel" }),
      ).toBeTruthy();
    });

    mocks.downloadAttendanceReportExport.mockRejectedValueOnce(
      new Error("private server error"),
    );
    fireEvent.click(screen.getByRole("button", { name: "Download PDF" }));
    expect((await screen.findByRole("alert")).textContent).toContain(
      "The PDF attendance report could not be downloaded.",
    );
  });

  it("supports weekly, monthly, yearly, and custom period selection", () => {
    renderReport();
    const period = screen.getByLabelText("Period");

    fireEvent.change(period, { target: { value: "week" } });
    expect((period as HTMLSelectElement).value).toBe("week");
    fireEvent.change(period, { target: { value: "year" } });
    expect((period as HTMLSelectElement).value).toBe("year");
    fireEvent.change(period, { target: { value: "custom" } });
    expect((period as HTMLSelectElement).value).toBe("custom");
    expect(screen.getByLabelText("From date")).toBeTruthy();
    expect(screen.getByLabelText("To date")).toBeTruthy();
    fireEvent.change(period, { target: { value: "month" } });
    expect((period as HTMLSelectElement).value).toBe("month");
  });

  it("preserves report scope when a weekly range would exceed year 9999", async () => {
    renderReport();

    await waitFor(() => {
      expect(mocks.useAttendanceReport).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 1 }),
      );
    });
    fireEvent.change(screen.getByLabelText("Period"), {
      target: { value: "custom" },
    });
    fireEvent.change(screen.getByLabelText("From date"), {
      target: { value: "9999-12-31" },
    });
    fireEvent.change(screen.getByLabelText("To date"), {
      target: { value: "9999-12-31" },
    });
    await waitFor(() => {
      expect(mocks.useAttendanceReport).toHaveBeenLastCalledWith(
        expect.objectContaining({
          fromDate: "9999-12-31",
          toDate: "9999-12-31",
          page: 1,
        }),
      );
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => {
      expect(mocks.useAttendanceReport).toHaveBeenLastCalledWith(
        expect.objectContaining({
          fromDate: "9999-12-31",
          toDate: "9999-12-31",
          page: 2,
          asOf: reportResponse.asOf,
        }),
      );
    });

    fireEvent.change(screen.getByLabelText("Period"), {
      target: { value: "week" },
    });

    expect((screen.getByLabelText("Period") as HTMLSelectElement).value).toBe(
      "custom",
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "This report cannot move beyond years 0001–9999.",
    );
    expect((screen.getByLabelText("From date") as HTMLInputElement).value).toBe(
      "9999-12-31",
    );
    expect((screen.getByLabelText("To date") as HTMLInputElement).value).toBe(
      "9999-12-31",
    );
    expect(screen.getByText(/page 2 of 2/)).toBeTruthy();
    expect(mocks.useAttendanceReport).toHaveBeenLastCalledWith(
      expect.objectContaining({
        fromDate: "9999-12-31",
        toDate: "9999-12-31",
        page: 2,
        asOf: reportResponse.asOf,
      }),
    );
    expect(
      mocks.useAttendanceReport.mock.calls.every(([params]) =>
        params.fromDate.length === 10 &&
        params.toDate.length === 10 &&
        !params.fromDate.startsWith("10000-") &&
        !params.toDate.startsWith("10000-"),
      ),
    ).toBe(true);
  });

  it("moves between preset periods and reports navigation boundary errors", async () => {
    renderReport();
    fireEvent.change(screen.getByLabelText("Period"), {
      target: { value: "week" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Previous week" }));
    fireEvent.click(screen.getByRole("button", { name: "Next week" }));
    expect(mocks.useAttendanceReport).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1 }),
    );

    const utils = await import("../src/features/attendance/attendanceReport.utils");
    const navigation = vi
      .spyOn(utils, "navigateAttendanceReportPeriod")
      .mockImplementation(() => {
        throw new RangeError("boundary");
      });
    fireEvent.click(screen.getByRole("button", { name: "Previous week" }));
    expect(screen.getByRole("alert").textContent).toContain(
      "This report cannot move beyond years 0001–9999.",
    );
    navigation.mockRestore();
  });

  it("rejects reversed and overlong custom ranges without issuing a valid scope", () => {
    renderReport();
    fireEvent.change(screen.getByLabelText("Period"), {
      target: { value: "custom" },
    });
    fireEvent.change(screen.getByLabelText("From date"), {
      target: { value: "2024-02-02" },
    });
    fireEvent.change(screen.getByLabelText("To date"), {
      target: { value: "2024-02-01" },
    });
    expect(screen.getByRole("alert").textContent).toContain(
      "The start date must be on or before the end date.",
    );

    fireEvent.change(screen.getByLabelText("From date"), {
      target: { value: "2024-01-01" },
    });
    fireEvent.change(screen.getByLabelText("To date"), {
      target: { value: "2024-12-31" },
    });
    expect(screen.queryByRole("alert")).toBeNull();
    expect(mocks.useAttendanceReport).toHaveBeenLastCalledWith(
      expect.objectContaining({
        fromDate: "2024-01-01",
        toDate: "2024-12-31",
      }),
    );
    fireEvent.change(screen.getByLabelText("To date"), {
      target: { value: "2025-01-01" },
    });
    expect(screen.getByRole("alert").textContent).toContain(
      "Custom date ranges can include at most 366 days.",
    );
  });

  it("uses the Employee document id, includes resigned employees, and resets scope", async () => {
    renderReport();
    expect(screen.getByText("All employees")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Next month" }));
    await waitFor(() => {
      expect(mocks.useAttendanceReport).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 1 }),
      );
    });
    const employeeFilter = openEmployeeSearch();
    await waitFor(() => {
      expect(getEmployeeResultOptions()).toHaveLength(1);
    });
    fireEvent.click(getEmployeeResultOptions()[0]);
    expect(mocks.useAttendanceReport).toHaveBeenLastCalledWith(
      expect.objectContaining({
        employeeId: "employee-document-id",
        page: 1,
      }),
    );
    expect(employeeFilter).toBeTruthy();
    expect(mocks.useAttendanceReport).not.toHaveBeenLastCalledWith(
      expect.objectContaining({ employeeId: "populated-user-id" }),
    );
  });

  it("shows employee names, codes, avatar images, and safe initials", async () => {
    employeeOptionsQuery.data = {
      employees: [
        { ...employeeOption, firstName: "Asha", lastName: "Patel", avatarUrl: "https://images.example.test/asha.png" },
        { ...employeeOption, _id: "employee-without-avatar", employeeCode: "EMP-007", firstName: "Ravi", lastName: null },
      ],
      pagination: { page: 1, limit: 20, total: 2, totalPages: 1 },
    };
    const { container } = renderReport();
    openEmployeeSearch();

    await waitFor(() => expect(getEmployeeResultOptions()).toHaveLength(2));
    const options = getEmployeeResultOptions();
    expect(within(options[0]).getByText("Asha Patel")).toBeTruthy();
    expect(within(options[0]).getByText("EMP-042")).toBeTruthy();
    expect(options[0].querySelector('img[src="https://images.example.test/asha.png"]')).toBeTruthy();
    expect(within(options[1]).getByText("Ravi")).toBeTruthy();
    expect(within(options[1]).getByText("EMP-007")).toBeTruthy();
    expect(within(options[1]).getByText("RA")).toBeTruthy();
    expect(container.querySelectorAll("img")).toHaveLength(1);
  });

  it("reopens after Escape by click or ArrowDown and keeps search text for selection", async () => {
    employeeOptionsQuery.data = {
      employees: [
        employeeOption,
        { ...employeeOption, _id: "employee-second", employeeCode: "EMP-043" },
      ],
      pagination: { page: 1, limit: 20, total: 2, totalPages: 1 },
    };
    renderReport();
    const input = openEmployeeSearch();
    await waitFor(() => expect(getEmployeeResultOptions()).toHaveLength(2));

    fireEvent.change(input, { target: { value: "Tamil search" } });
    await waitFor(() => {
      expect(
        mocks.useEmployeeOptions.mock.calls.some(
          ([search]) => search === "Tamil search",
        ),
      ).toBe(true);
    });
    fireEvent.keyDown(input, { key: "Escape" });
    expect(screen.queryByRole("listbox")).toBeNull();
    expect((input as HTMLInputElement).value).toBe("Tamil search");
    expect(input.getAttribute("aria-expanded")).toBe("false");

    fireEvent.click(input);
    expect(screen.getByRole("listbox")).toBeTruthy();
    expect(input.getAttribute("aria-expanded")).toBe("true");

    fireEvent.keyDown(input, { key: "Escape" });
    fireEvent.keyDown(input, { key: "ArrowDown" });
    expect(screen.getByRole("listbox")).toBeTruthy();
    expect(input.getAttribute("aria-activedescendant")).toBe(
      getEmployeeResultOptions()[0].id,
    );
    fireEvent.keyDown(input, { key: "Enter" });

    expect(mocks.useAttendanceReport).toHaveBeenLastCalledWith(
      expect.objectContaining({ employeeId: employeeOption._id, page: 1 }),
    );
    expect(screen.getByRole("button", { name: "Clear selection" })).toBeTruthy();
  });

  it("scrolls the active keyboard option into view", async () => {
    const scrolledOptionIds: string[] = [];
    const originalDescriptor = Object.getOwnPropertyDescriptor(
      HTMLElement.prototype,
      "scrollIntoView",
    );
    Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
      configurable: true,
      value: function (this: HTMLElement) {
        scrolledOptionIds.push(this.id);
      },
    });

    try {
      employeeOptionsQuery.data = {
        employees: [
          employeeOption,
          { ...employeeOption, _id: "employee-second", employeeCode: "EMP-043" },
        ],
        pagination: { page: 1, limit: 20, total: 2, totalPages: 1 },
      };
      renderReport();
      const input = openEmployeeSearch();
      await waitFor(() => expect(getEmployeeResultOptions()).toHaveLength(2));
      const options = getEmployeeResultOptions();

      fireEvent.keyDown(input, { key: "ArrowDown" });

      await waitFor(() => {
        expect(scrolledOptionIds.at(-1)).toBe(options[1].id);
      });
    } finally {
      if (originalDescriptor) {
        Object.defineProperty(
          HTMLElement.prototype,
          "scrollIntoView",
          originalDescriptor,
        );
      } else {
        Reflect.deleteProperty(HTMLElement.prototype, "scrollIntoView");
      }
    }
  });

  it("keeps the selected employee when searching and clears back to all employees", async () => {
    renderReport();
    let input = openEmployeeSearch();
    await waitFor(() => expect(getEmployeeResultOptions()).toHaveLength(1));
    fireEvent.click(getEmployeeResultOptions()[0]);
    expect(screen.queryByText("All employees")).toBeNull();

    input = openEmployeeSearch();
    fireEvent.change(input, { target: { value: "EMP-042" } });
    expect(mocks.useEmployeeOptions).not.toHaveBeenCalledWith(
      "EMP-042",
      1,
      true,
    );
    await waitFor(() => {
      expect(
        mocks.useEmployeeOptions.mock.calls.some(
          ([search]) => search === "EMP-042",
        ),
      ).toBe(true);
    });
    expect(screen.getByRole("button", { name: "Clear selection" })).toBeTruthy();
    expect(mocks.useAttendanceReport).toHaveBeenLastCalledWith(
      expect.objectContaining({ employeeId: employeeOption._id }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Clear selection" }));
    expect(screen.getByText("All employees")).toBeTruthy();
    expect(mocks.useAttendanceReport.mock.calls.at(-1)?.[0]).not.toHaveProperty(
      "employeeId",
    );
  });

  it("shows the no-results state for an empty search response", async () => {
    employeeOptionsQuery.data = {
      employees: [],
      pagination: { page: 1, limit: 20, total: 0, totalPages: 0 },
    };
    renderReport();
    openEmployeeSearch();
    await waitFor(() => {
      expect(screen.getByText("No employees found.")).toBeTruthy();
    });
  });

  it("omits asOf initially, then preserves the returned cutoff for pagination", async () => {
    renderReport();
    const initialRequest = mocks.useAttendanceReport.mock.calls[0][0];
    expect(initialRequest).not.toHaveProperty("asOf");

    await waitFor(() => {
      expect(mocks.useAttendanceReport).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 1 }),
      );
    });
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => {
      expect(mocks.useAttendanceReport).toHaveBeenLastCalledWith(
        expect.objectContaining({
          page: 2,
          asOf: reportResponse.asOf,
        }),
      );
    });
  });

  it("resets page and cutoff for scope changes but preserves cutoff for page-size changes", async () => {
    renderReport();
    await waitFor(() => {
      expect(mocks.useAttendanceReport).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 1 }),
      );
    });

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => {
      expect(mocks.useAttendanceReport).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 2, asOf: reportResponse.asOf }),
      );
    });

    fireEvent.change(screen.getByLabelText("Rows per page"), {
      target: { value: "50" },
    });
    expect(mocks.useAttendanceReport).toHaveBeenLastCalledWith(
      expect.objectContaining({
        page: 1,
        limit: 50,
        asOf: reportResponse.asOf,
      }),
    );

    openEmployeeSearch();
    await waitFor(() => expect(getEmployeeResultOptions()).toHaveLength(1));
    fireEvent.click(getEmployeeResultOptions()[0]);
    expect(mocks.useAttendanceReport).toHaveBeenLastCalledWith(
      expect.objectContaining({
        page: 1,
        employeeId: "employee-document-id",
      }),
    );
    expect(mocks.useAttendanceReport.mock.calls.at(-1)?.[0]).not.toHaveProperty(
      "asOf",
    );
    fireEvent.change(screen.getByLabelText("Period"), {
      target: { value: "year" },
    });
    expect(mocks.useAttendanceReport).toHaveBeenLastCalledWith(
      expect.objectContaining({ page: 1 }),
    );
    expect(mocks.useAttendanceReport.mock.calls.at(-1)?.[0]).not.toHaveProperty(
      "asOf",
    );
  });

  it("preserves report page and asOf when the selected employee is reselected", async () => {
    renderReport();
    openEmployeeSearch();
    await waitFor(() => expect(getEmployeeResultOptions()).toHaveLength(1));
    fireEvent.click(getEmployeeResultOptions()[0]);

    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() => {
      expect(mocks.useAttendanceReport).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 2, asOf: reportResponse.asOf }),
      );
    });

    openEmployeeSearch();
    await waitFor(() => expect(getEmployeeResultOptions()).toHaveLength(1));
    fireEvent.click(getEmployeeResultOptions()[0]);

    expect(mocks.useAttendanceReport).toHaveBeenLastCalledWith(
      expect.objectContaining({
        employeeId: employeeOption._id,
        page: 2,
        asOf: reportResponse.asOf,
      }),
    );
  });

  it("renders API summaries without converting a null percentage to zero", () => {
    reportQueryState.data = {
      ...reportResponse,
      employees: [
        {
          ...reportResponse.employees[0],
          summary: {
            ...reportResponse.employees[0].summary,
            eligibleWorkingDays: 0,
            attendancePercentage: null,
          },
        },
      ],
    };
    renderReport();

    expect(screen.getByText("Not applicable")).toBeTruthy();
    expect(screen.getByText(/No eligible working days/)).toBeTruthy();
    expect(screen.getByText("Not recorded days")).toBeTruthy();
    expect(screen.getByText("Finalized")).toBeTruthy();
    expect(screen.queryByText("0%")).toBeNull();
  });

  it("shows returned daily records and marks system checkout and provisional time", () => {
    renderReport();
    fireEvent.click(screen.getByText(/Daily attendance/));

    expect(screen.getAllByText("System checkout").length).toBeGreaterThan(0);
    expect(screen.getByText("Provisional duration")).toBeTruthy();
    expect(screen.getAllByText("No attendance record").length).toBeGreaterThan(0);
    const dailyDisclosure = screen.getByText(/Daily attendance/).closest("details");
    expect(dailyDisclosure?.open).toBe(true);
    fireEvent.click(screen.getByText(/Daily attendance/));
    expect(dailyDisclosure?.open).toBe(false);
    const mobileEntries = document.querySelector(".lg\\:hidden");
    expect(mobileEntries).toBeTruthy();
    expect(document.querySelector(".hidden.lg\\:block")).toBeTruthy();
  });

  it("shows partial-period cutoff only when the API supplies it", () => {
    const todayParts = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kolkata",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
    }).formatToParts(new Date());
    const values = Object.fromEntries(
      todayParts.map(({ type, value }) => [type, value]),
    );
    const today = `${values.year}-${values.month}-${values.day}`;
    reportQueryState.data = {
      ...reportResponse,
      period: {
        fromDate: `${today.slice(0, 7)}-01`,
        toDate: today,
        calculatedThroughDate: today,
      },
    };
    renderReport();
    expect(screen.getByText(/calculated through/)).toBeTruthy();

    cleanup();
    reportQueryState.data = {
      ...reportResponse,
      period: { ...reportResponse.period, calculatedThroughDate: null },
    };
    renderReport();
    expect(screen.queryByText(/calculated through/)).toBeNull();

    cleanup();
    reportQueryState.data = {
      ...reportResponse,
      period: {
        ...reportResponse.period,
        toDate: "2024-06-30",
        calculatedThroughDate: "2024-06-05",
      },
    };
    renderReport();
    fireEvent.change(screen.getByLabelText("Period"), {
      target: { value: "custom" },
    });
    fireEvent.change(screen.getByLabelText("From date"), {
      target: { value: "2024-06-01" },
    });
    fireEvent.change(screen.getByLabelText("To date"), {
      target: { value: "2024-06-30" },
    });
    expect(
      screen.getByText(/The selected range is partially calculated/),
    ).toBeTruthy();
    expect(screen.getByText(/5 Jun 2024/)).toBeTruthy();
  });

  it("shows an empty state for no matching employees", () => {
    reportQueryState.data = {
      ...reportResponse,
      pagination: {
        ...reportResponse.pagination,
        totalEmployees: 0,
        totalPages: 0,
      },
      employees: [],
    };
    renderReport();
    expect(screen.getByText("No matching employees")).toBeTruthy();
  });

  it("corrects a page that exceeds the final page", async () => {
    let correctionStarted = false;
    mocks.useAttendanceReport.mockImplementation((params) => {
      const currentPage = params.page ?? 1;
      let response = reportResponse;
      if (currentPage === 3) {
        correctionStarted = true;
        response = {
          ...reportResponse,
          pagination: {
            ...reportResponse.pagination,
            page: 3,
            totalPages: 2,
          },
          employees: [],
        };
      } else {
        response = {
          ...reportResponse,
          pagination: {
            ...reportResponse.pagination,
            page: currentPage,
            totalPages: correctionStarted ? 2 : 3,
          },
        };
      }
      return { ...reportQueryState, data: response };
    });
    renderReport();
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(mocks.useAttendanceReport).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 2 }),
      ),
    );
    fireEvent.click(screen.getByRole("button", { name: "Next" }));
    await waitFor(() =>
      expect(mocks.useAttendanceReport).toHaveBeenLastCalledWith(
        expect.objectContaining({ page: 2, asOf: reportResponse.asOf }),
      ),
    );
    expect(
      mocks.useAttendanceReport.mock.calls.some(([params]) => params.page === 3),
    ).toBe(true);
  });

  it("shows employee-filter loading and failure without blocking all-employee reports", () => {
    employeeOptionsQuery = {
      data: undefined,
      isLoading: true,
      isFetching: true,
      isError: false,
      refetch: vi.fn(),
    };
    const { rerender } = renderReport();
    openEmployeeSearch();
    expect(screen.getByText("Searching employees…")).toBeTruthy();
    expect(screen.getByText("Attendance summary")).toBeTruthy();

    employeeOptionsQuery = {
      data: undefined,
      isLoading: false,
      isFetching: false,
      isError: true,
      refetch: vi.fn(),
    };
    rerender(
      <MemoryRouter>
        <AdminAttendanceReportPage />
      </MemoryRouter>,
    );
    expect(
      screen.getByText(/Employee search could not be loaded/),
    ).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Search employees" })).toBeTruthy();
  });

  it("shows initial loading, background refetch, and safe retryable errors", () => {
    reportQueryState = {
      ...reportQueryState,
      data: undefined,
      isLoading: true,
      isFetching: true,
    };
    const { rerender } = renderReport();
    expect(screen.getByRole("status", { name: "Loading attendance report" })).toBeTruthy();

    reportQueryState = {
      ...reportQueryState,
      data: reportResponse,
      isLoading: false,
      isFetching: true,
    };
    rerender(
      <MemoryRouter>
        <AdminAttendanceReportPage />
      </MemoryRouter>,
    );
    expect(screen.getByText("Updating report…")).toBeTruthy();

    reportQueryState = {
      ...reportQueryState,
      data: undefined,
      error: new Error("sensitive backend details"),
      isError: true,
      isFetching: false,
    };
    rerender(
      <MemoryRouter>
        <AdminAttendanceReportPage />
      </MemoryRouter>,
    );
    expect(screen.getByRole("alert").textContent).toContain(
      "The attendance report could not be loaded.",
    );
    expect(screen.queryByText(/sensitive backend details/)).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Retry" }));
    expect(reportQueryState.refetch).toHaveBeenCalled();
  });

  it("shows a clear access-denied state for a 403 response", () => {
    const error = new AxiosError("forbidden");
    error.response = { status: 403 } as AxiosError["response"];
    reportQueryState = {
      ...reportQueryState,
      data: undefined,
      error,
      isError: true,
    };
    renderReport();
    expect(screen.getByText(/Access denied/)).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Retry" })).toBeNull();
  });
});

describe("attendance report routing", () => {
  afterEach(() => {
    cleanup();
    window.history.replaceState({}, "", "/");
  });

  it.each(["admin", "superAdmin"])("%s can open the report route", (role) => {
    mocks.userType = role;
    setPath("/admin/attendance/reports");
    render(<App />);
    expect(
      screen.getByRole("heading", { name: "Attendance reports" }),
    ).toBeTruthy();
  });

  it.each([
    ["supervisor", "Supervisor home"],
    ["employee", "Employee home"],
    ["customer", "Customer home"],
  ])("%s cannot open the report route", (role, destination) => {
    mocks.userType = role;
    setPath("/admin/attendance/reports");
    render(<App />);
    expect(screen.getByText(destination)).toBeTruthy();
    expect(
      screen.queryByRole("heading", { name: "Attendance reports" }),
    ).toBeNull();
  });

  it("keeps the existing attendance route and links to the report route", () => {
    mocks.userType = "admin";
    setPath("/admin/attendance");
    render(<App />);
    expect(
      screen.getByRole("heading", { name: "Attendance Dashboard" }),
    ).toBeTruthy();

    expect(screen.getByRole("link", { name: "Reports" }).getAttribute("href")).toBe(
      "/admin/attendance/reports",
    );
  });
});
