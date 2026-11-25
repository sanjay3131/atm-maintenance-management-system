import { useEffect, useState } from "react";
import { isAxiosError } from "axios";
import { zodResolver } from "@hookform/resolvers/zod";
import { Combobox } from "@base-ui/react/combobox";
import { ChevronsUpDown } from "lucide-react";
import {
  Controller,
  useForm,
  type ControllerRenderProps,
} from "react-hook-form";
import { toast } from "sonner";
import { TAMIL_NADU_DISTRICTS } from "../../../../../shared/tamilNaduDistricts.js";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useBanks } from "@/features/banks/hooks/useBanks";
import { useRegionsByBank } from "../hooks/useRegionsByBank";
import { useCreateDistrict, useUpdateDistrict } from "../hooks/useDistrictMutations";
import {
  districtFormSchema,
  type DistrictFormSchemaValues,
} from "../types/district.schema";
import type { District } from "../types/district.types";

function getErrorMessage(error: unknown) {
  if (isAxiosError<{ message?: string }>(error)) {
    return error.response?.data?.message || "Unable to save the district.";
  }
  return error instanceof Error ? error.message : "Unable to save the district.";
}

function getRegionBankId(district: District | null) {
  if (!district || typeof district.regionId === "string") return "";
  const bank = district.regionId.bankId;
  return typeof bank === "string" ? bank : bank?._id ?? "";
}

function DistrictNameCombobox({
  field,
  invalid,
}: {
  field: ControllerRenderProps<DistrictFormSchemaValues, "districtName">;
  invalid: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState("");

  return (
    <Combobox.Root
      items={TAMIL_NADU_DISTRICTS}
      value={field.value || null}
      inputValue={open ? searchQuery : field.value}
      open={open}
      onOpenChange={(nextOpen) => {
        setOpen(nextOpen);
        setSearchQuery("");
      }}
      onInputValueChange={(value, eventDetails) => {
        setSearchQuery(value);
        if (eventDetails.reason === "input-change") field.onChange("");
      }}
      onValueChange={(value) => {
        if (typeof value === "string" && TAMIL_NADU_DISTRICTS.includes(value)) {
          field.onChange(value);
          setSearchQuery("");
          setOpen(false);
        } else if (value === null) {
          field.onChange("");
        }
      }}
      filter={(district, query) =>
        district.toLowerCase().includes(query.trim().toLowerCase())
      }
      itemToStringLabel={(value) => value ?? ""}
      itemToStringValue={(value) => value ?? ""}
      autoHighlight
    >
      <div className="relative">
        <Combobox.Input
          id="district-districtName"
          ref={field.ref}
          onBlur={field.onBlur}
          aria-label="Search and select a Tamil Nadu district"
          aria-invalid={invalid}
          placeholder="Search districts..."
          className="h-9 w-full rounded-lg border border-input bg-background py-2 pl-3 pr-10 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
        />
        <Combobox.Trigger
          aria-label="Show district options"
          className="absolute inset-y-0 right-1 inline-flex w-8 items-center justify-center rounded-md text-muted-foreground outline-none hover:bg-muted focus-visible:ring-2 focus-visible:ring-ring"
        >
          <ChevronsUpDown aria-hidden="true" className="size-4" />
        </Combobox.Trigger>
      </div>
      <Combobox.Portal>
        <Combobox.Positioner sideOffset={4} className="z-50">
          <Combobox.Popup className="max-h-80 w-(--anchor-width) min-w-48 overflow-y-auto rounded-lg border bg-popover p-1 text-popover-foreground shadow-lg">
            <Combobox.Empty className="px-3 py-6 text-center text-sm text-muted-foreground">
              No districts found
            </Combobox.Empty>
            <Combobox.List>
              {TAMIL_NADU_DISTRICTS.map((name) => (
                <Combobox.Item
                  key={name}
                  value={name}
                  className="flex cursor-pointer items-center rounded-md px-2.5 py-2 text-sm outline-none hover:bg-accent hover:text-accent-foreground focus-visible:bg-accent focus-visible:text-accent-foreground data-[highlighted]:bg-accent data-[highlighted]:text-accent-foreground data-[selected]:bg-primary/10"
                >
                  {name}
                </Combobox.Item>
              ))}
            </Combobox.List>
          </Combobox.Popup>
        </Combobox.Positioner>
      </Combobox.Portal>
    </Combobox.Root>
  );
}

export default function DistrictFormDialog({
  open,
  district,
  onOpenChange,
  initialBankId = "",
  initialRegionId = "",
}: {
  open: boolean;
  district: District | null;
  onOpenChange: (open: boolean) => void;
  initialBankId?: string;
  initialRegionId?: string;
}) {
  const createMutation = useCreateDistrict();
  const updateMutation = useUpdateDistrict();
  const isPending = createMutation.isPending || updateMutation.isPending;
  const { data: banks = [], isLoading: banksLoading } = useBanks();
  const [bankId, setBankId] = useState("");
  const [selectedRegionId, setSelectedRegionId] = useState("");
  const { data: regions = [], isLoading: regionsLoading } = useRegionsByBank(bankId);
  const {
    control,
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<DistrictFormSchemaValues>({
    resolver: zodResolver(districtFormSchema),
    defaultValues: {
      districtName: "",
      pinCode: "",
      state: "",
      isActive: true,
    },
  });

  useEffect(() => {
    if (!open) return;
    const regionId =
      typeof district?.regionId === "string"
        ? district.regionId
        : district?.regionId?._id ?? "";
    setSelectedRegionId(
      district ? regionId : initialRegionId,
    );
    setBankId(
      district ? getRegionBankId(district) : initialBankId,
    );
    reset({
      districtName: district?.districtName ?? "",
      pinCode: district?.pinCode ?? "",
      state: district?.state ?? "",
      isActive: district?.isActive ?? true,
    });
  }, [district, initialBankId, initialRegionId, open, reset]);

  const onSubmit = async (values: DistrictFormSchemaValues) => {
    const data = {
      districtName: values.districtName.trim(),
      pinCode: values.pinCode.trim(),
      state: values.state.trim(),
      isActive: values.isActive,
    };

    try {
      if (district) {
        await updateMutation.mutateAsync({ id: district._id, data });
        toast.success("District updated successfully.");
      } else {
        if (!TAMIL_NADU_DISTRICTS.includes(data.districtName)) {
          toast.error("Select a district from the list.");
          return;
        }
        if (!selectedRegionId) {
          toast.error("Select an active region.");
          return;
        }
        await createMutation.mutateAsync({ ...data, regionId: selectedRegionId });
        toast.success("District created successfully.");
      }
      reset();
      onOpenChange(false);
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const fields = [
    { name: "pinCode", label: "PIN Code" },
    { name: "state", label: "State" },
  ] as const;
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!isPending) onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <div className="space-y-2">
          <DialogTitle>{district ? "Edit District" : "Add District"}</DialogTitle>
          <DialogDescription>
            {district
              ? "Update this district's information. Its region is unchanged."
              : "Add a district under an active bank region."}
          </DialogDescription>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="mt-5 space-y-4">
          {!district && (
            <>
              <div>
                <label htmlFor="district-bank" className="mb-2 block text-sm font-medium">
                  Bank *
                </label>
                <select
                  id="district-bank"
                  value={bankId}
                  onChange={(event) => {
                    setBankId(event.target.value);
                    setSelectedRegionId("");
                  }}
                  disabled={banksLoading}
                  className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                  required
                >
                  <option value="">{banksLoading ? "Loading banks..." : "Select bank"}</option>
                  {banks.filter((bank) => bank.isActive).map((bank) => (
                    <option key={bank._id} value={bank._id}>
                      {bank.bankName} ({bank.bankCode})
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label htmlFor="district-region" className="mb-2 block text-sm font-medium">
                  Region *
                </label>
                <select
                  id="district-region"
                  value={selectedRegionId}
                  onChange={(event) => setSelectedRegionId(event.target.value)}
                  disabled={!bankId || regionsLoading}
                  className="h-10 w-full rounded-lg border border-input bg-background px-3 text-sm"
                  required
                >
                  <option value="">
                    {!bankId
                      ? "Select bank first"
                      : regionsLoading
                        ? "Loading regions..."
                        : "Select region"}
                  </option>
                  {regions.filter((region) => region.isActive).map((region) => (
                    <option key={region._id} value={region._id}>
                      {region.name}
                    </option>
                  ))}
                </select>
                {bankId && !regionsLoading && regions.length === 0 && (
                  <p className="mt-1 text-sm text-muted-foreground">
                    Create an active region for this bank before adding districts.
                  </p>
                )}
                {selectedRegionId && !regions.some((region) => region._id === selectedRegionId) && (
                  <p className="mt-1 text-sm text-destructive">
                    The selected region is no longer available.
                  </p>
                )}
              </div>
            </>
          )}
          {district && (
            <div className="rounded-lg border bg-muted/30 p-3 text-sm">
              <span className="text-muted-foreground">Bank / region: </span>
              {getRegionBankId(district)
                ? `${typeof district.regionId === "object" ? (typeof district.regionId.bankId === "object" ? district.regionId.bankId.bankName : "") : ""} / ${typeof district.regionId === "object" ? district.regionId.name : ""}`
                : "Geography is unmapped"}
            </div>
          )}
          <div>
            <label
              htmlFor="district-districtName"
              className="mb-2 block text-sm font-medium"
            >
              District Name *
            </label>
            {district ? (
              <input
                id="district-districtName"
                type="text"
                {...register("districtName")}
                aria-invalid={Boolean(errors.districtName)}
                className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
            ) : (
              <Controller
                control={control}
                name="districtName"
                render={({ field }) => (
                  <DistrictNameCombobox
                    field={field}
                    invalid={Boolean(errors.districtName)}
                  />
                )}
              />
            )}
            {errors.districtName && (
              <p className="mt-1 text-sm text-destructive">
                {errors.districtName.message}
              </p>
            )}
          </div>
          {fields.map(({ name, label }) => (
            <div key={name}>
              <label htmlFor={`district-${name}`} className="mb-2 block text-sm font-medium">
                {label} *
              </label>
              <input
                id={`district-${name}`}
                type="text"
                {...register(name)}
                aria-invalid={Boolean(errors[name])}
                className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
              />
              {errors[name] && (
                <p className="mt-1 text-sm text-destructive">{errors[name]?.message}</p>
              )}
            </div>
          ))}
          <div className="flex items-center gap-2">
            <input id="district-is-active" type="checkbox" {...register("isActive")} className="size-4 accent-primary" />
            <label htmlFor="district-is-active" className="text-sm font-medium">Active</label>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button type="button" variant="outline" disabled={isPending} onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending ? "Saving..." : district ? "Update District" : "Create District"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
