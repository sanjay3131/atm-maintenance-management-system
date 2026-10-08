import { useEffect } from "react";
import { isAxiosError } from "axios";
import { zodResolver } from "@hookform/resolvers/zod";
import { useForm } from "react-hook-form";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { useCreateItem, useUpdateItem } from "../hooks/useItemMutations";
import { itemFormSchema } from "../types/item.schema";
import type { Item, ItemFormValues } from "../types/item.types";

function getErrorMessage(error: unknown) {
  if (isAxiosError<{ message?: string; errors?: Array<{ message?: string }> }>(error)) {
    return (
      error.response?.data?.message ||
      error.response?.data?.errors?.map((entry) => entry.message).filter(Boolean).join(" ") ||
      "Unable to save the Item."
    );
  }
  return error instanceof Error ? error.message : "Unable to save the Item.";
}

export default function ItemFormDialog({
  open,
  item,
  onOpenChange,
}: {
  open: boolean;
  item: Item | null;
  onOpenChange: (open: boolean) => void;
}) {
  const createMutation = useCreateItem();
  const updateMutation = useUpdateItem();
  const isPending = createMutation.isPending || updateMutation.isPending;
  const {
    register,
    handleSubmit,
    reset,
    formState: { errors },
  } = useForm<ItemFormValues>({
    resolver: zodResolver(itemFormSchema),
    defaultValues: {
      itemName: "",
      unit: "",
      currentUnitCost: 0,
      isActive: true,
    },
  });

  useEffect(() => {
    if (!open) return;
    reset({
      itemName: item?.itemName ?? "",
      unit: item?.unit ?? "",
      currentUnitCost: item?.currentUnitCost ?? 0,
      isActive: item?.isActive ?? true,
    });
  }, [item, open, reset]);

  const onSubmit = async (values: ItemFormValues) => {
    const data = {
      itemName: values.itemName.trim(),
      unit: values.unit.trim(),
      currentUnitCost: values.currentUnitCost,
      isActive: values.isActive,
    };

    try {
      if (item) {
        await updateMutation.mutateAsync({ id: item._id, data });
        toast.success("Item updated successfully.");
      } else {
        await createMutation.mutateAsync(data);
        toast.success("Item created successfully.");
      }
      reset();
      onOpenChange(false);
    } catch (error) {
      toast.error(getErrorMessage(error));
    }
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!isPending) onOpenChange(nextOpen);
      }}
    >
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <div className="space-y-2">
          <DialogTitle>{item ? "Edit Item" : "Create Item"}</DialogTitle>
          <DialogDescription>
            {item
              ? "Update the Item Master details. Existing Job usage retains its recorded cost snapshots."
              : "Add an Item for employees to select when recording Job material usage."}
          </DialogDescription>
        </div>

        <form onSubmit={handleSubmit(onSubmit)} className="mt-5 space-y-4">
          <div>
            <label
              htmlFor="item-name"
              className="mb-2 block text-sm font-medium"
            >
              Item name
            </label>
            <input
              id="item-name"
              autoComplete="off"
              maxLength={120}
              {...register("itemName")}
              aria-invalid={Boolean(errors.itemName)}
              className="h-10 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            {errors.itemName && (
              <p className="mt-1 text-sm text-destructive">
                {errors.itemName.message}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="item-unit"
              className="mb-2 block text-sm font-medium"
            >
              Unit of measurement
            </label>
            <input
              id="item-unit"
              maxLength={40}
              placeholder="e.g. piece, pack, litre, kg"
              {...register("unit")}
              aria-invalid={Boolean(errors.unit)}
              className="h-10 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            {errors.unit && (
              <p className="mt-1 text-sm text-destructive">
                {errors.unit.message}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="item-cost"
              className="mb-2 block text-sm font-medium"
            >
              Current unit cost (₹)
            </label>
            <input
              id="item-cost"
              type="number"
              min="0"
              step="any"
              inputMode="decimal"
              {...register("currentUnitCost", { valueAsNumber: true })}
              aria-invalid={Boolean(errors.currentUnitCost)}
              className="h-10 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            />
            {errors.currentUnitCost && (
              <p className="mt-1 text-sm text-destructive">
                {errors.currentUnitCost.message}
              </p>
            )}
          </div>

          <div>
            <label
              htmlFor="item-status"
              className="mb-2 block text-sm font-medium"
            >
              Status
            </label>
            <select
              id="item-status"
              {...register("isActive", {
                setValueAs: (value: string) => value === "true",
              })}
              className="h-10 w-full rounded-lg border border-input bg-transparent px-3 text-sm outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring/50"
            >
              <option value="true">Active</option>
              <option value="false">Inactive</option>
            </select>
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
                : item
                  ? "Save changes"
                  : "Create Item"}
            </Button>
          </div>
        </form>
      </DialogContent>
    </Dialog>
  );
}
