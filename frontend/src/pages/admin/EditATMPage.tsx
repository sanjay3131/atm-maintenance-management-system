import { ArrowLeft } from "lucide-react";
import { useNavigate, useParams } from "react-router-dom";
import { Button } from "@/components/ui/button";
import CreateATMForm from "@/features/atms/components/CreateATMForm";
import { useATM } from "@/features/atms/hooks/useATM";

export default function EditATMPage() {
  const navigate = useNavigate();
  const { id = "" } = useParams<{ id: string }>();
  const { data: atm, isLoading, isError, refetch, isFetching } = useATM(id);

  if (isLoading) {
    return (
      <div className="space-y-4 p-6" role="status">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="h-96 max-w-2xl animate-pulse rounded-lg border bg-muted/40" />
        <p className="text-sm text-muted-foreground">Loading ATM details...</p>
      </div>
    );
  }

  if (isError || !atm) {
    return (
      <div className="p-6">
        <Button variant="ghost" onClick={() => navigate("/admin/atms")}>
          <ArrowLeft />
          Back to ATMs
        </Button>
        <div className="mt-6 max-w-2xl rounded-lg border border-destructive/30 bg-destructive/5 p-6">
          <h1 className="font-semibold text-destructive">ATM unavailable</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            This ATM may not exist or could not be loaded.
          </p>
          <Button
            variant="outline"
            className="mt-4"
            onClick={() => refetch()}
            disabled={isFetching}
          >
            {isFetching ? "Retrying..." : "Retry"}
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div className="p-6">
      <div className="max-w-2xl">
        <Button
          variant="ghost"
          className="-ml-3 mb-3"
          onClick={() => navigate(`/admin/atms/${atm._id}`)}
        >
          <ArrowLeft />
          Cancel
        </Button>
        <h1 className="text-2xl font-bold">Edit ATM</h1>
        <p className="mt-2 text-sm text-muted-foreground">{atm.atmId}</p>
        <CreateATMForm
          initialATM={atm}
          onClose={() => navigate(`/admin/atms/${atm._id}`)}
        />
      </div>
    </div>
  );
}
