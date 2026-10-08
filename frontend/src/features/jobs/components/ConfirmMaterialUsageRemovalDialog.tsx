import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { LoaderCircle } from "lucide-react";

interface ConfirmMaterialUsageRemovalDialogProps {
  open: boolean;
  itemName: string;
  isPending: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}

export default function ConfirmMaterialUsageRemovalDialog({
  open,
  itemName,
  isPending,
  onOpenChange,
  onConfirm,
}: ConfirmMaterialUsageRemovalDialogProps) {
  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!isPending) onOpenChange(nextOpen);
      }}
    >
      <DialogContent>
        <DialogTitle>Remove material usage?</DialogTitle>
        <DialogDescription className="mt-2">
          This removes the recorded {itemName} entry from this Job only. It will
          not change the Item Master.
        </DialogDescription>
        <div className="mt-6 flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            Keep entry
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={onConfirm}
            disabled={isPending}
          >
            {isPending && <LoaderCircle className="animate-spin" />}
            Remove entry
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
