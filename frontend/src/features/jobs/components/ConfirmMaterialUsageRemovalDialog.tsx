import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { LoaderCircle } from "lucide-react";
import { useEmployeeLanguage } from "@/features/employee-portal/i18n";

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
  const { t } = useEmployeeLanguage();

  return (
    <Dialog
      open={open}
      onOpenChange={(nextOpen) => {
        if (!isPending) onOpenChange(nextOpen);
      }}
    >
      <DialogContent>
        <DialogTitle>{t("Remove material usage?")}</DialogTitle>
        <DialogDescription className="mt-2">
          {t("This removes the recorded {item} entry from this Job only. It will not change the Item Master.", { item: itemName })}
        </DialogDescription>
        <div className="mt-6 flex justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => onOpenChange(false)}
            disabled={isPending}
          >
            {t("Keep entry")}
          </Button>
          <Button
            type="button"
            variant="destructive"
            onClick={onConfirm}
            disabled={isPending}
          >
            {isPending && <LoaderCircle className="animate-spin" />}
            {t("Remove entry")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
