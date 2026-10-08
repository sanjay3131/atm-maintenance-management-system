import { useState } from "react";
import { isAxiosError } from "axios";
import { Package, Pencil, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import ItemFormDialog from "@/features/items/components/ItemFormDialog";
import { useUpdateItem } from "@/features/items/hooks/useItemMutations";
import { useItems } from "@/features/items/hooks/useItems";
import type { Item, ItemStatusFilter } from "@/features/items/types/item.types";

const ALL_ITEMS = "all";

const currencyFormatter = new Intl.NumberFormat("en-IN", {
  style: "currency",
  currency: "INR",
  minimumFractionDigits: 2,
  maximumFractionDigits: 2,
});

function getErrorMessage(error: unknown) {
  if (isAxiosError<{ message?: string }>(error)) {
    return (
      error.response?.data?.message ||
      "The Item Master request could not be completed."
    );
  }
  return error instanceof Error
    ? error.message
    : "The Item Master request could not be completed.";
}

function formatDate(value?: string) {
  if (!value) return "—";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "—" : date.toLocaleString();
}

function ItemTableSkeleton() {
  return (
    <Card>
      <CardContent className="space-y-3 p-4" role="status">
        {Array.from({ length: 5 }, (_, index) => (
          <div
            key={index}
            className="h-12 animate-pulse rounded bg-muted/50"
          />
        ))}
        <p className="sr-only">Loading Items...</p>
      </CardContent>
    </Card>
  );
}

export default function ItemsPage() {
  const [statusFilter, setStatusFilter] =
    useState<ItemStatusFilter>(ALL_ITEMS);
  const [dialogOpen, setDialogOpen] = useState(false);
  const [itemToEdit, setItemToEdit] = useState<Item | null>(null);
  const params =
    statusFilter === ALL_ITEMS
      ? {}
      : { isActive: statusFilter === "active" };
  const {
    data: items = [],
    isLoading,
    isError,
    error,
    refetch,
    isFetching,
  } = useItems(params);
  const updateMutation = useUpdateItem();

  const openCreateDialog = () => {
    setItemToEdit(null);
    setDialogOpen(true);
  };

  const openEditDialog = (item: Item) => {
    setItemToEdit(item);
    setDialogOpen(true);
  };

  const changeItemStatus = async (item: Item, isActive: boolean) => {
    try {
      await updateMutation.mutateAsync({
        id: item._id,
        data: {
          itemName: item.itemName,
          unit: item.unit,
          currentUnitCost: item.currentUnitCost,
          isActive,
        },
      });
      toast.success(`Item ${isActive ? "activated" : "deactivated"} successfully.`);
    } catch (mutationError) {
      toast.error(getErrorMessage(mutationError));
    }
  };

  return (
    <div className="space-y-6 p-4 sm:p-6">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Item Master</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Manage material names, units, current costs, and availability.
          </p>
        </div>
        <Button type="button" onClick={openCreateDialog}>
          <Plus />
          Create Item
        </Button>
      </div>

      <Card>
        <CardContent className="grid gap-4 p-4 sm:grid-cols-[minmax(0,1fr)_14rem]">
          <div>
            <p className="text-sm text-muted-foreground">Items shown</p>
            <p className="mt-1 text-2xl font-semibold">{items.length}</p>
          </div>
          <div>
            <label className="mb-2 block text-sm font-medium">Status</label>
            <Select
              value={statusFilter}
              onValueChange={(value) =>
                setStatusFilter((value as ItemStatusFilter | null) ?? ALL_ITEMS)
              }
            >
              <SelectTrigger className="w-full">
                <SelectValue placeholder="All Items" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value={ALL_ITEMS}>All Items</SelectItem>
                <SelectItem value="active">Active</SelectItem>
                <SelectItem value="inactive">Inactive</SelectItem>
              </SelectContent>
            </Select>
          </div>
        </CardContent>
      </Card>

      {isLoading ? (
        <ItemTableSkeleton />
      ) : isError ? (
        <Card>
          <CardContent className="flex flex-col items-start gap-3 p-6">
            <div>
              <p className="font-medium text-destructive">
                Failed to load Items.
              </p>
              <p className="mt-1 text-sm text-muted-foreground">
                {getErrorMessage(error)}
              </p>
            </div>
            <Button
              type="button"
              variant="outline"
              onClick={() => void refetch()}
              disabled={isFetching}
            >
              <RefreshCw className={isFetching ? "animate-spin" : ""} />
              {isFetching ? "Retrying..." : "Retry"}
            </Button>
          </CardContent>
        </Card>
      ) : (
        <Card>
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle>Items</CardTitle>
            <span className="text-sm text-muted-foreground">
              {items.length} {items.length === 1 ? "Item" : "Items"}
            </span>
          </CardHeader>
          {items.length === 0 ? (
            <CardContent className="flex flex-col items-center px-6 py-14 text-center">
              <div className="flex size-12 items-center justify-center rounded-full bg-primary/10 text-primary">
                <Package className="size-6" />
              </div>
              <h2 className="mt-4 text-lg font-semibold">
                {statusFilter === ALL_ITEMS
                  ? "No Items yet."
                  : `No ${statusFilter} Items.`}
              </h2>
              <p className="mt-2 max-w-md text-sm text-muted-foreground">
                {statusFilter === ALL_ITEMS
                  ? "Create an active Item to make it available in Employee Job material selection."
                  : "Try another status filter or create an Item with this status."}
              </p>
            </CardContent>
          ) : (
            <CardContent className="p-0">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[52rem] text-sm">
                  <thead className="border-y bg-muted/40">
                    <tr>
                      <th scope="col" className="px-4 py-3 text-left font-medium">
                        Item name
                      </th>
                      <th scope="col" className="px-4 py-3 text-left font-medium">
                        Unit
                      </th>
                      <th scope="col" className="px-4 py-3 text-right font-medium">
                        Current unit cost
                      </th>
                      <th scope="col" className="px-4 py-3 text-left font-medium">
                        Status
                      </th>
                      <th scope="col" className="px-4 py-3 text-left font-medium">
                        Created
                      </th>
                      <th scope="col" className="px-4 py-3 text-left font-medium">
                        Updated
                      </th>
                      <th scope="col" className="px-4 py-3 text-right font-medium">
                        Actions
                      </th>
                    </tr>
                  </thead>
                  <tbody>
                    {items.map((item) => (
                      <tr key={item._id} className="border-b last:border-0">
                        <td className="max-w-64 break-words px-4 py-3 font-medium">
                          {item.itemName}
                        </td>
                        <td className="px-4 py-3">{item.unit}</td>
                        <td className="whitespace-nowrap px-4 py-3 text-right tabular-nums">
                          {currencyFormatter.format(item.currentUnitCost)}
                        </td>
                        <td className="px-4 py-3">
                          <Badge
                            variant={item.isActive ? "secondary" : "outline"}
                          >
                            {item.isActive ? "Active" : "Inactive"}
                          </Badge>
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                          {formatDate(item.createdAt)}
                        </td>
                        <td className="whitespace-nowrap px-4 py-3 text-muted-foreground">
                          {formatDate(item.updatedAt)}
                        </td>
                        <td className="px-4 py-3">
                          <div className="flex justify-end gap-2">
                            <Button
                              type="button"
                              size="sm"
                              variant="outline"
                              onClick={() => openEditDialog(item)}
                            >
                              <Pencil />
                              Edit
                            </Button>
                            <Button
                              type="button"
                              size="sm"
                              variant={item.isActive ? "destructive" : "outline"}
                              onClick={() =>
                                void changeItemStatus(item, !item.isActive)
                              }
                              disabled={updateMutation.isPending}
                            >
                              {updateMutation.isPending &&
                              updateMutation.variables?.id === item._id
                                ? item.isActive
                                  ? "Deactivating..."
                                  : "Activating..."
                                : item.isActive
                                  ? "Deactivate"
                                  : "Activate"}
                            </Button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </CardContent>
          )}
        </Card>
      )}

      <ItemFormDialog
        open={dialogOpen}
        item={itemToEdit}
        onOpenChange={(open) => {
          setDialogOpen(open);
          if (!open) setItemToEdit(null);
        }}
      />
    </div>
  );
}
