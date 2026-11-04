import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { formatWorkedDuration } from "../src/features/attendance/attendance.utils";
import AdminAttendancePage from "../src/pages/admin/AdminAttendancePage";
import EmployeeAttendancePage from "../src/pages/employee/EmployeeAttendancePage";
import SupervisorAttendancePage from "../src/pages/supervisor/SupervisorAttendancePage";
import SupervisorEmployeeDetailsPage from "../src/pages/supervisor/SupervisorEmployeeDetailsPage";
import EmployeeAttendanceCalendar from "../src/features/attendance/components/EmployeeAttendanceCalendar";

const mocks = vi.hoisted(() => ({
  useAdminAttendanceDashboard: vi.fn(),
  useAttendanceStatusOverrideAudit: vi.fn(),
  useSetAttendanceStatusOverride: vi.fn(),
  useCheckIn: vi.fn(),
  useCheckOut: vi.fn(),
  useMyAttendance: vi.fn(),
  useRecentMyAttendance: vi.fn(),
  useMyOpenAttendance: vi.fn(),
  useEmployeeAttendanceCalendar: vi.fn(),
  useSupervisorEmployeeDetails: vi.fn(),
  useSupervisorEmployeeAttendance: vi.fn(),
  useSupervisorEmployeeJobs: vi.fn(),
  useSupervisorEmployeeAMC: vi.fn(),
}));

vi.mock("@/features/attendance/hooks/useAdminAttendance", () => ({
  useAdminAttendanceDashboard: mocks.useAdminAttendanceDashboard,
  useAttendanceStatusOverrideAudit: mocks.useAttendanceStatusOverrideAudit,
  useSetAttendanceStatusOverride: mocks.useSetAttendanceStatusOverride,
}));

vi.mock("@/features/attendance/hooks/useEmployeeAttendance", () => ({
  useCheckIn: mocks.useCheckIn,
  useCheckOut: mocks.useCheckOut,
  useMyAttendance: mocks.useMyAttendance,
  useRecentMyAttendance: mocks.useRecentMyAttendance,
  useMyOpenAttendance: mocks.useMyOpenAttendance,
}));

vi.mock("@/features/attendance/hooks/useEmployeeAttendanceCalendar", () => ({
  useEmployeeAttendanceCalendar: mocks.useEmployeeAttendanceCalendar,
}));

vi.mock("@/features/supervisor/hooks/useSupervisorEmployeeDetails", () => ({
  useSupervisorEmployeeDetails: mocks.useSupervisorEmployeeDetails,
}));

vi.mock("@/features/supervisor/hooks/useSupervisorEmployeeHistory", () => ({
  useSupervisorEmployeeAttendance: mocks.useSupervisorEmployeeAttendance,
  useSupervisorEmployeeJobs: mocks.useSupervisorEmployeeJobs,
  useSupervisorEmployeeAMC: mocks.useSupervisorEmployeeAMC,
}));

vi.mock("@/features/employee-portal/i18n", () => ({
  employeeErrorMessage: (message: string) => message,
  useEmployeeLanguage: () => ({
    language: "en",
    t: (value: string) => value,
  }),
}));

vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useParams: () => ({ employeeId: "64b000000000000000000001" }),
  };
});

const todayParts = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Kolkata",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
}).formatToParts(new Date());
const todayValues = Object.fromEntries(
  todayParts.map(({ type, value }) => [type, value]),
);
const today = `${todayValues.year}-${todayValues.month}-${todayValues.day}`;
const currentMonth = today.slice(0, 7);
const checkInAt = new Date(Date.now() - 6 * 60 * 60 * 1000).toISOString();
const openPresentRecord = {
  _id: "attendance-1",
  employeeId: "employee-1",
  attendanceDate: today,
  checkInAt,
  checkOutAt: null,
  checkInSource: "employee" as const,
  checkOutSource: null,
  checkInRecordedBy: "user-1",
  checkOutRecordedBy: null,
  effectiveStatus: "present" as const,
  statusOrigin: "recorded" as const,
  workedDurationMs: 6 * 60 * 60 * 1000,
};
const closedIncompleteRecord = {
  ...openPresentRecord,
  _id: "attendance-2",
  checkOutAt: new Date(Date.now() - 5 * 60 * 60 * 1000).toISOString(),
  checkOutSource: "employee" as const,
  checkOutRecordedBy: "user-1",
  effectiveStatus: "incomplete" as const,
  workedDurationMs: 60 * 60 * 1000,
};

type TestAttendanceRecord =
  | typeof openPresentRecord
  | typeof closedIncompleteRecord;

const makeQuery = (records: TestAttendanceRecord[]) => ({
  data: { records, pagination: { page: 1, limit: 20, total: records.length, totalPages: 1 } },
  error: null,
  isError: false,
  isFetching: false,
  isLoading: false,
  refetch: vi.fn(),
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("attendance status displays", () => {
  it("formats worked duration in whole hours and minutes", () => {
    expect(formatWorkedDuration(0)).toBe("0h 0m");
    expect(formatWorkedDuration(59 * 60 * 1000 + 59_999)).toBe("0h 59m");
    expect(formatWorkedDuration(60 * 60 * 1000)).toBe("1h 0m");
    expect(formatWorkedDuration(5 * 60 * 60 * 1000 + 59 * 60 * 1000 + 59_999)).toBe(
      "5h 59m",
    );
    expect(() => formatWorkedDuration(-1)).toThrow(RangeError);
    expect(() => formatWorkedDuration(Number.NaN)).toThrow(RangeError);
  });

  it("keeps admin status and open-session state distinct", () => {
    mocks.useAdminAttendanceDashboard.mockReturnValue({
      ...makeQuery([]),
      data: {
        date: today,
        timeZone: "Asia/Kolkata",
        summary: {
          employees: { total: 1, present: 1, absent: 0, incomplete: 0, unrecorded: 0 },
          supervisors: { total: 0, present: 0, absent: 0, incomplete: 0, unrecorded: 0 },
        },
        records: [
          {
            employee: {
              id: "employee-1",
              employeeCode: "E-1",
              name: "Ravi Employee",
              role: "employee",
              avatarUrl: null,
              employeeStatus: "active",
              userStatus: "active",
            },
            attendance: {
              id: "attendance-1",
              attendanceDate: today,
              actualCheckInAt: checkInAt,
              actualCheckOutAt: null,
              effectiveCheckInAt: checkInAt,
              effectiveCheckOutAt: null,
              effectiveStatus: "present",
              statusOrigin: "recorded",
              workedDurationMs: 6 * 60 * 60 * 1000,
            },
          },
        ],
        pagination: { page: 1, limit: 20, total: 1, totalPages: 1 },
      },
    });
    mocks.useAttendanceStatusOverrideAudit.mockReturnValue({
      data: { events: [], pagination: { page: 1, limit: 20, total: 0, totalPages: 0 } },
      isLoading: false,
      isError: false,
      error: null,
    });
    mocks.useSetAttendanceStatusOverride.mockReturnValue({
      mutateAsync: vi.fn(),
      isPending: false,
    });

    render(<AdminAttendancePage />);

    expect(screen.getAllByText("Present").length).toBeGreaterThan(0);
    expect(screen.getByText("Open")).toBeTruthy();
    expect(screen.getByText("6h 0m")).toBeTruthy();
  });

  it("shows attendance status separately from closed session in employee history", () => {
    mocks.useMyAttendance.mockReturnValue(makeQuery([closedIncompleteRecord]));
    mocks.useRecentMyAttendance.mockReturnValue(makeQuery([closedIncompleteRecord]));
    mocks.useCheckIn.mockReturnValue({ mutateAsync: vi.fn(), isPending: false, error: null });
    mocks.useCheckOut.mockReturnValue({ mutateAsync: vi.fn(), isPending: false, error: null });

    render(<EmployeeAttendancePage />);

    expect(screen.getAllByText("Incomplete").length).toBeGreaterThan(0);
    expect(screen.getAllByText("Closed").length).toBeGreaterThan(0);
    expect(screen.getAllByText("1h 0m").length).toBeGreaterThan(0);
  });

  it("shows calculated status and duration in supervisor history", () => {
    mocks.useMyAttendance.mockReturnValue(makeQuery([closedIncompleteRecord]));
    mocks.useRecentMyAttendance.mockReturnValue(makeQuery([closedIncompleteRecord]));
    mocks.useMyOpenAttendance.mockReturnValue(makeQuery([]));
    mocks.useCheckIn.mockReturnValue({ mutateAsync: vi.fn(), isPending: false, error: null });
    mocks.useCheckOut.mockReturnValue({ mutateAsync: vi.fn(), isPending: false, error: null });

    render(<SupervisorAttendancePage />);

    expect(screen.getAllByText("Incomplete").length).toBeGreaterThan(0);
    expect(screen.getByText("Closed")).toBeTruthy();
    expect(screen.getAllByText("1h 0m").length).toBeGreaterThan(0);
  });

  it("shows backend status, session state, and safe duration in supervisor employee history", () => {
    mocks.useSupervisorEmployeeDetails.mockReturnValue({
      data: {
        employee: {
          name: "Ravi Employee",
          employeeCode: "E-1",
          status: "active",
        },
        assignedAtms: [],
      },
      error: null,
      isError: false,
      isFetchedAfterMount: true,
      isFetching: false,
      isLoading: false,
      isSuccess: true,
      refetch: vi.fn(),
    });
    mocks.useSupervisorEmployeeAttendance.mockReturnValue({
      data: {
        records: [
          {
            _id: "attendance-present",
            employeeId: "64b000000000000000000001",
            attendanceDate: "2026-11-03",
            checkInAt: "2026-11-03T03:00:00.000Z",
            checkOutAt: "2026-11-03T09:00:00.000Z",
            effectiveStatus: "present",
            statusOrigin: "recorded",
            workedDurationMs: 6 * 60 * 60 * 1000,
          },
          {
            _id: "attendance-incomplete",
            employeeId: "64b000000000000000000001",
            attendanceDate: "2026-11-02",
            checkInAt: "2026-11-02T03:00:00.000Z",
            checkOutAt: null,
            effectiveStatus: "incomplete",
            statusOrigin: "recorded",
          },
          {
            _id: "attendance-absent",
            employeeId: "64b000000000000000000001",
            attendanceDate: "2026-11-01",
            checkInAt: "2026-11-01T03:00:00.000Z",
            checkOutAt: "2026-11-01T04:00:00.000Z",
            effectiveStatus: "absent",
            statusOrigin: "admin_override",
            workedDurationMs: null,
          },
        ],
        pagination: { page: 1, limit: 10, total: 3, totalPages: 1 },
      },
      error: null,
      isError: false,
      isFetching: false,
      isLoading: false,
      refetch: vi.fn(),
    });
    mocks.useSupervisorEmployeeJobs.mockReturnValue({
      data: { records: [], pagination: { page: 1, limit: 10, total: 0, totalPages: 0 } },
      error: null,
      isError: false,
      isFetching: false,
      isLoading: false,
      refetch: vi.fn(),
    });
    mocks.useSupervisorEmployeeAMC.mockReturnValue({
      data: {
        amcs: [],
        statusCounts: { total: 0 },
        month: 11,
        year: 2026,
        pagination: { page: 1, limit: 10, total: 0, totalPages: 0 },
      },
      error: null,
      isError: false,
      isFetching: false,
      isLoading: false,
      refetch: vi.fn(),
    });

    render(
      <MemoryRouter>
        <SupervisorEmployeeDetailsPage />
      </MemoryRouter>,
    );

    expect(screen.getByText("Attendance status: Present")).toBeTruthy();
    expect(screen.getByText("Attendance status: Incomplete")).toBeTruthy();
    expect(screen.getByText("Attendance status: Absent")).toBeTruthy();
    expect(screen.getByText("Open")).toBeTruthy();
    expect(screen.getAllByText("Closed")).toHaveLength(2);
    expect(screen.getByText("Worked duration: 6h 0m")).toBeTruthy();
    expect(screen.getAllByText("Worked duration: —")).toHaveLength(2);
    expect(screen.getAllByText(/^Check-in:/)).toHaveLength(3);
    expect(screen.getAllByText(/^Check-out:/)).toHaveLength(3);
  });

  it("shows calendar status, session state, and worked duration independently", () => {
    mocks.useEmployeeAttendanceCalendar.mockReturnValue({
      data: {
        month: currentMonth,
        timeZone: "Asia/Kolkata",
        days: [
          {
            attendanceDate: `${currentMonth}-01`,
            status: "present",
            statusOrigin: "recorded",
            checkInAt,
            checkOutAt: null,
            workedDurationMs: 6 * 60 * 60 * 1000,
          },
        ],
      },
      error: null,
      isError: false,
      isFetching: false,
      isLoading: false,
      refetch: vi.fn(),
    });

    render(<EmployeeAttendanceCalendar employeeId="employee-1" />);
    fireEvent.click(
      screen.getByRole("button", { name: `${currentMonth}-01: Present` }),
    );

    expect(screen.getByText("Status:")).toBeTruthy();
    expect(screen.getByText("Session")).toBeTruthy();
    expect(screen.getByText("Open")).toBeTruthy();
    expect(screen.getByText("6h 0m")).toBeTruthy();
  });
});
