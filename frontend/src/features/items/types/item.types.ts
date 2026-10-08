export interface Item {
  _id: string;
  itemName: string;
  unit: string;
  currentUnitCost: number;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface ItemFormValues {
  itemName: string;
  unit: string;
  currentUnitCost: number;
  isActive: boolean;
}

export type ItemData = ItemFormValues;

export type ItemStatusFilter = "all" | "active" | "inactive";
