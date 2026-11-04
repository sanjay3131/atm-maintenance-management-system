// @vitest-environment jsdom

import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Employee } from "../src/services/employee.service";
import type { ATM } from "../src/features/atms/types/atm.types";
import EmployeePerformance from "../src/features/dashboard/components/EmployeePerformance";
import ATMDetailsPage from "../src/pages/admin/ATMDetailsPage";

const mocks = vi.hoisted(() => ({
  useEmployeePerformance: vi.fn(),
  useEmployeePerformanceDetails: vi.fn(),
  useEmployees: vi.fn(),
  useDistricts: vi.fn(),
  useAllRegionsByDistrict: vi.fn(),
  useQuery: vi.fn(),
  useQueryClient: vi.fn(),
  useDeleteATM: vi.fn(),
  useAssignEmployeeToATM: vi.fn(),
  useUpdateATM: vi.fn(),
  useSetATMAMCResponsibleEmployee: vi.fn(),
  useATM: vi.fn(),
  useATMLocationRequests: vi.fn(),
  useReopenATMLocationRequests: vi.fn(),
}));

vi.mock("@/features/dashboard/hooks/useEmployeePerformance", () => ({
  useEmployeePerformance: mocks.useEmployeePerformance,
}));
vi.mock("@/features/dashboard/hooks/useEmployeePerformanceDetails", () => ({
  useEmployeePerformanceDetails: mocks.useEmployeePerformanceDetails,
}));
vi.mock("@/features/employees/hooks/useEmployees", () => ({
  useEmployees: mocks.useEmployees,
}));
vi.mock("@/features/users/hooks/useAllRegionsByDistrict", () => ({
  useAllRegionsByDistrict: mocks.useAllRegionsByDistrict,
}));
vi.mock("@/features/users/hooks/useDistricts", () => ({
  useDistricts: mocks.useDistricts,
}));
vi.mock("@tanstack/react-query", () => ({
  useQuery: mocks.useQuery,
  useQueryClient: mocks.useQueryClient,
}));
vi.mock("@/features/atms/hooks/useDeleteATM", () => ({
  useDeleteATM: mocks.useDeleteATM,
}));
vi.mock("@/features/atms/hooks/useAssignEmployeeToATM", () => ({
  useAssignEmployeeToATM: mocks.useAssignEmployeeToATM,
}));
vi.mock("@/features/atms/hooks/useUpdateATM", () => ({
  useUpdateATM: mocks.useUpdateATM,
}));
vi.mock("@/features/atms/hooks/useSetATMAMCResponsibleEmployee", () => ({
  useSetATMAMCResponsibleEmployee: mocks.useSetATMAMCResponsibleEmployee,
}));
vi.mock("@/features/atms/hooks/useATM", () => ({
  useATM: mocks.useATM,
}));
vi.mock("@/features/atms/hooks/useATMLocationRequests", () => ({
  useATMLocationRequests: mocks.useATMLocationRequests,
  useReopenATMLocationRequests: mocks.useReopenATMLocationRequests,
}));
vi.mock("@/lib/axios", () => ({ default: { get: vi.fn() } }));
vi.mock("react-router-dom", async (importOriginal) => {
  const actual = await importOriginal<typeof import("react-router-dom")>();
  return {
    ...actual,
    useNavigate: () => vi.fn(),
    useParams: () => ({ id: "atm-1" }),
  };
});

const makeEmployee = (
  firstName: string,
  lastName: string,
  avatarUrl?: string | null,
) =>
  ({
    _id: "employee-1",
    employeeCode: "EMP-001",
    designation: "Technician",
    department: "Maintenance",
    joiningDate: "2020-01-01",
    employmentType: "full-time",
    status: "active",
    userId: {
      _id: "user-1",
      firstName,
      lastName,
      email: "employee@example.test",
      userType: "employee",
      avatar: avatarUrl ? { url: avatarUrl } : null,
    },
    districtIds: [],
    assignedAtmIds: [],
    regionIds: [],
    createdAt: "2020-01-01",
    updatedAt: "2020-01-01",
  }) as Employee;

const makeATM = (
  firstName: string,
  lastName: string,
  avatarUrl?: string | null,
) =>
  ({
    _id: "atm-1",
    atmId: "ATM-001",
    locationName: "Central",
    address: "Main Road",
    installationType: "ONSITE",
    status: "ACTIVE",
    bankId: { _id: "bank-1", bankName: "Example Bank" },
    districtId: { _id: "district-1", districtName: "Central" },
    regionId: null,
    assignedEmployeeId: [
      {
        _id: "employee-1",
        employeeCode: "EMP-001",
        userId: {
          firstName,
          lastName,
          avatar: avatarUrl ? { url: avatarUrl } : null,
        },
      },
    ],
  }) as ATM;

const configureEmployeePerformance = () => {
  mocks.useEmployeePerformance.mockReturnValue({
    data: { performance: [] },
    isLoading: false,
    isFetching: false,
    refetch: vi.fn(),
  });
  mocks.useEmployeePerformanceDetails.mockReturnValue({
    isLoading: true,
    isError: false,
  });
  mocks.useEmployees.mockReturnValue({
    data: [],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
  mocks.useDistricts.mockReturnValue({
    data: [],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
  mocks.useAllRegionsByDistrict.mockReturnValue({
    data: [],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
};

const configureATMDetails = (atm: ATM) => {
  mocks.useQuery.mockReturnValue({
    data: [],
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
  });
  mocks.useQueryClient.mockReturnValue({
    invalidateQueries: vi.fn(),
    removeQueries: vi.fn(),
  });
  mocks.useDeleteATM.mockReturnValue({ mutate: vi.fn(), isPending: false });
  mocks.useAssignEmployeeToATM.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  });
  mocks.useUpdateATM.mockReturnValue({ mutate: vi.fn(), isPending: false });
  mocks.useSetATMAMCResponsibleEmployee.mockReturnValue({
    mutate: vi.fn(),
    isPending: false,
  });
  mocks.useATM.mockReturnValue({
    data: atm,
    isLoading: false,
    isError: false,
    isFetching: false,
    refetch: vi.fn(),
  });
  mocks.useATMLocationRequests.mockReturnValue({
    data: { requests: [] },
    refetch: vi.fn(),
  });
  mocks.useReopenATMLocationRequests.mockReturnValue({
    mutateAsync: vi.fn(),
    isPending: false,
  });
};

beforeEach(() => {
  configureEmployeePerformance();
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("Employee Performance avatars", () => {
  it("passes the user's photo URL to the rendered employee avatar", () => {
    const avatarUrl = "https://images.example.test/employee.png";
    render(
      <EmployeePerformance
        employee={makeEmployee("Asha", "Patel", avatarUrl)}
      />,
    );

    const images = screen.getAllByAltText("");
    expect(images.length).toBeGreaterThan(0);
    expect(images.every((image) => image.getAttribute("src") === avatarUrl)).toBe(
      true,
    );
  });

  it("uses the photo URL in the picker, selected employee, and results row", () => {
    const avatarUrl = "https://images.example.test/picker-employee.png";
    const employee = makeEmployee("Asha", "Patel", avatarUrl);
    mocks.useEmployees.mockReturnValue({
      data: [employee],
      isLoading: false,
      isError: false,
      refetch: vi.fn(),
    });

    const { container } = render(<EmployeePerformance />);
    fireEvent.change(screen.getByLabelText("Search employees"), {
      target: { value: "Asha" },
    });
    fireEvent.click(
      screen.getByRole("row", { name: /View performance for Asha Patel/ }),
    );

    const images = Array.from(container.querySelectorAll("img"));
    expect(images.length).toBeGreaterThanOrEqual(3);
    expect(images.every((image) => image.getAttribute("src") === avatarUrl)).toBe(
      true,
    );
  });

  it.each([
    ["Asha", "Patel", "AP"],
    ["Cher", "", "CH"],
    ["   ", "  ", "NU"],
  ])("shows fallback initials for name %j %j", (firstName, lastName, initials) => {
    render(
      <EmployeePerformance employee={makeEmployee(firstName, lastName)} />,
    );
    const employeeRow = screen.getByRole("row", {
      name: /View performance for/,
    });
    const avatar = employeeRow.querySelector("td span[aria-hidden='true']");
    expect(avatar?.textContent).toBe(initials);
    expect(avatar?.querySelector("img")).toBeNull();
  });

  it("falls back to initials when the photo fails to load", () => {
    render(
      <EmployeePerformance
        employee={makeEmployee(
          "Asha",
          "Patel",
          "https://images.example.test/broken.png",
        )}
      />,
    );
    const employeeRow = screen.getByRole("row", {
      name: /View performance for/,
    });
    const avatar = employeeRow.querySelector("td span[aria-hidden='true']");
    const image = avatar?.querySelector("img");
    expect(image).not.toBeNull();
    fireEvent.error(image!);
    expect(avatar?.querySelector("img")).toBeNull();
    expect(avatar?.textContent).toBe("AP");
  });
});

describe("ATM Details assigned employee avatars", () => {
  it("renders the projected employee photo URL", () => {
    const avatarUrl = "https://images.example.test/atm-employee.png";
    configureATMDetails(makeATM("Asha", "Patel", avatarUrl));
    const { container } = render(<ATMDetailsPage />);
    expect(
      container.querySelector(`img[src="${avatarUrl}"]`),
    ).not.toBeNull();
  });

  it.each([
    ["Asha", "Patel", "AP"],
    ["Cher", "", "CH"],
    ["   ", "  ", "?"],
  ])("renders safe fallback initials for %j %j", (firstName, lastName, initials) => {
    configureATMDetails(makeATM(firstName, lastName));
    const { container } = render(<ATMDetailsPage />);
    const code = screen.getByText("Code: EMP-001");
    const employeeRow = code.parentElement?.parentElement;
    expect(employeeRow?.querySelector("span")?.textContent).toBe(initials);
  });

  it("falls back to initials when an assigned employee photo fails", () => {
    configureATMDetails(
      makeATM("Asha", "Patel", "https://images.example.test/broken.png"),
    );
    const { container } = render(<ATMDetailsPage />);
    const image = container.querySelector(
      'img[src="https://images.example.test/broken.png"]',
    );
    expect(image).not.toBeNull();
    fireEvent.error(image!);
    const employeeRow = screen
      .getByText("Code: EMP-001")
      .parentElement?.parentElement;
    expect(employeeRow?.querySelector("img")).toBeNull();
    expect(employeeRow?.querySelector("span")?.textContent).toBe("AP");
  });
});
