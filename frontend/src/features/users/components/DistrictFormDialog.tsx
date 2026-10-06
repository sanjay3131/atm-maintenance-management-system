import { useEffect } from "react";
import { isAxiosError } from "axios";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useCreateDistrict, useUpdateDistrict } from "../hooks/useDistrictMutations";
import { districtFormSchema } from "../types/district.schema";
import type {
  District,
  DistrictFormValues,
} from "../types/district.types";

function getErrorMessage(error: unknown) {
  if (isAxiosError<{ message?: string }>(error)) {
    return error.response?.data?.message || "Unable to save the district.";
  }
  return error instanceof Error
    ? error.message
    : "Unable to save the district.";
}

export default function DistrictFormDialog({
  open,
  district,
  onOpenChange,
}: {
  open: boolean;
  district: District | null;
  onOpenChange: (open: boolean) => void;
}) {
  const createMutation = useCreateDistrict();
  const updateMutation = useUpdateDistrict();
  const isPending = createMutation.isPending || updateMutation.isPending;
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<DistrictFormValues>({
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
    reset({
      districtName: district?.districtName ?? "",
      pinCode: district?.pinCode ?? "",
      state: district?.state ?? "",
      isActive: district?.isActive ?? true,
    });
  }, [district, open, reset]);

  const onSubmit = async (values: DistrictFormValues) => {
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
        await createMutation.mutateAsync(data);
        toast.success("District created successfully.");
      }
      reset();
      onOpenChange(false);
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const fields = [
    { name: "districtName", label: "District Name" },
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
          <DialogTitle>
            {district ? "Edit District" : "Add District"}
          </DialogTitle>
          <DialogDescription>
            {district
              ? "Update this district's information."
              : "Add a district for ATM locations and regional organization."}
          </DialogDescription>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="mt-5 space-y-4">
          {fields.map(({ name, label }) => (
            <div key={name}>
              <label
                htmlFor={`district-${name}`}
                className="mb-2 block text-sm font-medium"
              >
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
                <p className="mt-1 text-sm text-destructive">
                  {errors[name]?.message}
                </p>
              )}
            </div>
          ))}
          <div className="flex items-center gap-2">
            <input
              id="district-is-active"
              type="checkbox"
              {...register("isActive")}
              className="size-4 accent-primary"
            />
            <label htmlFor="district-is-active" className="text-sm font-medium">
              Active
            </label>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <Button
              type="button"
              variant="outline"
              disabled={isPending}
              onClick={() => onOpenChange(false)}
            >
              Cancel
            </Button>
            <Button type="submit" disabled={isPending}>
              {isPending
                ? "Saving..."
                : district
                  ? "Update District"
                  : "Create District"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
