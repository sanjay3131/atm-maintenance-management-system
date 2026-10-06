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
import {
  useCreateRegion,
  useUpdateRegion,
} from "../hooks/useRegionMutations";
import type { Region } from "../services/region.service";
import {
  regionFormSchema,
  type RegionFormSchemaValues,
} from "../types/region.schema";

function getErrorMessage(error: unknown) {
  if (isAxiosError<{ message?: string }>(error)) {
    return error.response?.data?.message || "Unable to save the region.";
  }
  return error instanceof Error ? error.message : "Unable to save the region.";
}

export default function RegionFormDialog({
  open,
  districtId,
  region,
  onOpenChange,
  onSaved,
}: {
  open: boolean;
  districtId: string;
  region: Region | null;
  onOpenChange: (open: boolean) => void;
  onSaved?: (region: Region) => void;
}) {
  const createMutation = useCreateRegion(districtId);
  const updateMutation = useUpdateRegion(districtId);
  const isPending = createMutation.isPending || updateMutation.isPending;
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<RegionFormSchemaValues>({
    resolver: zodResolver(regionFormSchema),
    defaultValues: {
      name: "",
      code: "",
      description: "",
      isActive: true,
    },
  });

  useEffect(() => {
    if (!open) return;
    reset({
      name: region?.name ?? "",
      code: region?.code ?? "",
      description: region?.description ?? "",
      isActive: region?.isActive ?? true,
    });
  }, [open, region, reset]);

  const onSubmit = async (values: RegionFormSchemaValues) => {
    const data = {
      name: values.name.trim(),
      code: values.code.trim(),
      description: values.description.trim(),
      isActive: values.isActive,
    };

    try {
      const savedRegion = region
        ? await updateMutation.mutateAsync({
            regionId: region._id,
            data,
          })
        : await createMutation.mutateAsync({ districtId, ...data });
      toast.success(
        region
          ? "Region updated successfully."
          : "Region created successfully.",
      );
      reset();
      onOpenChange(false);
      onSaved?.(savedRegion);
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  const fields = [
    { name: "name", label: "Name", required: true },
    { name: "code", label: "Code", required: false },
    { name: "description", label: "Description", required: false },
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
          <DialogTitle>{region ? "Edit Region" : "Create Region"}</DialogTitle>
          <DialogDescription>
            {region
              ? "Update this region's information."
              : "Add a region to this district."}
          </DialogDescription>
        </div>
        <form onSubmit={handleSubmit(onSubmit)} className="mt-5 space-y-4">
          {fields.map(({ name, label, required }) => (
            <div key={name}>
              <label
                htmlFor={`region-${name}`}
                className="mb-2 block text-sm font-medium"
              >
                {label}
                {required ? " *" : ""}
              </label>
              {name === "description" ? (
                <textarea
                  id={`region-${name}`}
                  rows={4}
                  {...register(name)}
                  aria-invalid={Boolean(errors[name])}
                  className="w-full rounded-lg border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                />
              ) : (
                <input
                  id={`region-${name}`}
                  type="text"
                  {...register(name)}
                  aria-invalid={Boolean(errors[name])}
                  className="h-9 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
                />
              )}
              {errors[name] && (
                <p className="mt-1 text-sm text-destructive">
                  {errors[name]?.message}
                </p>
              )}
            </div>
          ))}
          <div className="flex items-center gap-2">
            <input
              id="region-is-active"
              type="checkbox"
              {...register("isActive")}
              className="size-4 accent-primary"
            />
            <label htmlFor="region-is-active" className="text-sm font-medium">
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
                : region
                  ? "Update Region"
                  : "Create Region"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
