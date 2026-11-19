import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import CreateJobForm from "../src/features/jobs/components/CreateJobForm";
import type { ATM } from "../src/features/atms/types/atm.types";

const mocks = vi.hoisted(() => ({
  atms: [] as ATM[],
}));

vi.mock("@/features/atms/hooks/useATMs", () => ({
  useATMs: () => ({
    data: mocks.atms,
    isLoading: false,
    isError: false,
    refetch: vi.fn(),
    isFetching: false,
  }),
}));

vi.mock("@/features/jobs/hooks/useCreateJob", () => ({
  useCreateJob: () => ({ mutate: vi.fn(), isPending: false }),
}));

vi.mock("@/features/jobs/components/JobWorkTypeFields", () => ({
  default: () => null,
}));

vi.mock("@/lib/axios", () => ({ default: { get: vi.fn() } }));

vi.mock("@/components/ui/select", () => ({
  Select: ({
    value,
    onValueChange,
    disabled,
    children,
  }: {
    value: string;
    onValueChange: (value: string) => void;
    disabled?: boolean;
    children: React.ReactNode;
  }) => (
    <select
      value={value ?? ""}
      onChange={(event) => onValueChange(event.target.value)}
      disabled={disabled}
    >
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

function makeATM(
  _id: string,
  atmId: string,
  bank: { _id: string; bankName: string },
  region: { _id: string; name: string } | null,
  district: { _id: string; districtName: string },
): ATM {
  return {
    _id,
    atmId,
    locationName: `Location ${atmId}`,
    address: "Street",
    installationType: "ONSITE",
    status: "ACTIVE",
    bankId: bank,
    regionId: region,
    districtId: district,
    assignedEmployeeId: [],
  };
}

function selectForLabel(label: string): HTMLSelectElement {
  const select = screen.getByText(label).parentElement?.querySelector("select");
  if (!(select instanceof HTMLSelectElement)) {
    throw new Error(`Could not find select for ${label}`);
  }
  return select;
}

function optionValues(select: HTMLSelectElement): string[] {
  return [...select.options].map((option) => option.value);
}

function renderForm() {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false } },
  });
  render(
    <QueryClientProvider client={queryClient}>
      <CreateJobForm onCancel={vi.fn()} onCreated={vi.fn()} />
    </QueryClientProvider>,
  );
}

afterEach(() => {
  cleanup();
});

describe("Create job ATM geographic filters", () => {
  it("filters ATM choices through bank, region, and district and resets dependent filters", () => {
    mocks.atms = [
      makeATM(
        "atm-1",
        "ATM-001",
        { _id: "bank-1", bankName: "Bank One" },
        { _id: "region-1", name: "North" },
        { _id: "district-1", districtName: "Central" },
      ),
      makeATM(
        "atm-2",
        "ATM-002",
        { _id: "bank-1", bankName: "Bank One" },
        { _id: "region-2", name: "South" },
        { _id: "district-2", districtName: "Coastal" },
      ),
      makeATM(
        "atm-3",
        "ATM-003",
        { _id: "bank-2", bankName: "Bank Two" },
        { _id: "region-3", name: "East" },
        { _id: "district-3", districtName: "Hill" },
      ),
    ];
    renderForm();

    const bankSelect = selectForLabel("Bank filter");
    const regionSelect = selectForLabel("Region filter");
    const districtSelect = selectForLabel("District filter");
    const atmSelect = selectForLabel("ATM");

    fireEvent.change(bankSelect, { target: { value: "bank-1" } });
    expect(optionValues(atmSelect)).toEqual(["atm-1", "atm-2"]);
    expect(optionValues(regionSelect)).toContain("region-2");

    fireEvent.change(regionSelect, { target: { value: "region-2" } });
    expect(optionValues(districtSelect)).toEqual([
      "__all__",
      "district-2",
    ]);
    expect(optionValues(atmSelect)).toEqual(["atm-2"]);

    fireEvent.change(districtSelect, { target: { value: "district-2" } });
    expect(optionValues(atmSelect)).toEqual(["atm-2"]);

    fireEvent.change(bankSelect, { target: { value: "__all__" } });
    expect(regionSelect.value).toBe("__all__");
    expect(districtSelect.value).toBe("__all__");
    expect(optionValues(atmSelect)).toEqual(["atm-1", "atm-2", "atm-3"]);
  });
});
