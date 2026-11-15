import { useState } from "react";
import { isAxiosError } from "axios";
import { Pencil, Plus, RefreshCw } from "lucide-react";
import { toast } from "sonner";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useBanks } from "@/features/banks/hooks/useBanks";
import { useRegionsByBank } from "@/features/users/hooks/useRegionsByBank";
import { useUpdateRegion } from "@/features/users/hooks/useRegionMutations";
import RegionFormDialog from "@/features/users/components/RegionFormDialog";
import type { Region } from "@/features/users/services/region.service";

function errorMessage(error: unknown) {
  if (isAxiosError<{ message?: string }>(error)) {
    return error.response?.data?.message ?? "Could not complete the request.";
  }
  return error instanceof Error ? error.message : "Could not complete the request.";
}

export default function RegionsPage() {
  const { data: banks = [], isLoading: banksLoading } = useBanks();
  const [bankId, setBankId] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selectedRegion, setSelectedRegion] = useState<Region | null>(null);
  const regionsQuery = useRegionsByBank(bankId, true);
  const updateRegion = useUpdateRegion(bankId);

  const openCreate = () => {
    setSelectedRegion(null);
    setDialogOpen(true);
  };
  const openEdit = (region: Region) => {
    setSelectedRegion(region);
    setDialogOpen(true);
  };
  const toggleActive = async (region: Region) => {
    try {
      await updateRegion.mutateAsync({
        regionId: region._id,
        data: { isActive: !region.isActive },
      });
      toast.success(`Region ${region.isActive ? "deactivated" : "activated"}.`);
    } catch (error) {
      toast.error(errorMessage(error));
    }
  };

  return (
    <div className="space-y-6 p-6">
      <header className="flex flex-wrap items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold">Regions</h1>
          <p className="mt-2 text-sm text-muted-foreground">
            Manage regions within each bank.
          </p>
        </div>
        <Button type="button" onClick={openCreate} disabled={!bankId}>
          <Plus /> Add Region
        </Button>
      </header>

      <Card>
        <CardContent className="p-4">
          <label htmlFor="regions-bank" className="mb-2 block text-sm font-medium">
            Bank
          </label>
          <select
            id="regions-bank"
            value={bankId}
            onChange={(event) => setBankId(event.target.value)}
            disabled={banksLoading}
            className="h-10 w-full max-w-xl rounded-lg border border-input bg-background px-3 text-sm"
          >
            <option value="">{banksLoading ? "Loading banks..." : "Select a bank"}</option>
            {banks.map((bank) => (
              <option key={bank._id} value={bank._id}>
                {bank.bankName} ({bank.bankCode}){bank.isActive ? "" : " — inactive"}
              </option>
            ))}
          </select>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{bankId ? "Bank regions" : "Select a bank"}</CardTitle>
        </CardHeader>
        {!bankId ? (
          <CardContent className="text-sm text-muted-foreground">
            Choose a bank to view and manage its regions.
          </CardContent>
        ) : regionsQuery.isLoading ? (
          <CardContent className="flex items-center gap-2 text-sm text-muted-foreground" role="status">
            <RefreshCw className="size-4 animate-spin" /> Loading regions...
          </CardContent>
        ) : regionsQuery.isError ? (
          <CardContent className="space-y-3">
            <p className="text-sm text-destructive">{errorMessage(regionsQuery.error)}</p>
            <Button type="button" variant="outline" onClick={() => void regionsQuery.refetch()}>
              Retry
            </Button>
          </CardContent>
        ) : (regionsQuery.data ?? []).length === 0 ? (
          <CardContent className="text-sm text-muted-foreground">
            No regions are configured for this bank.
          </CardContent>
        ) : (
          <CardContent className="space-y-2">
            {(regionsQuery.data ?? []).map((region) => (
              <div key={region._id} className="flex flex-wrap items-center justify-between gap-3 rounded-lg border p-4">
                <div>
                  <p className="font-medium">{region.name}</p>
                  <p className="text-sm text-muted-foreground">
                    {region.code || "No code"}{region.description ? ` · ${region.description}` : ""}
                  </p>
                </div>
                <div className="flex items-center gap-2">
                  <Badge variant={region.isActive ? "secondary" : "outline"}>
                    {region.isActive ? "Active" : "Inactive"}
                  </Badge>
                  <Button type="button" size="sm" variant="outline" onClick={() => openEdit(region)}>
                    <Pencil /> Edit
                  </Button>
                  <Button type="button" size="sm" variant="outline" disabled={updateRegion.isPending} onClick={() => void toggleActive(region)}>
                    {region.isActive ? "Deactivate" : "Activate"}
                  </Button>
                </div>
              </div>
            ))}
          </CardContent>
        )}
      </Card>

      <RegionFormDialog
        open={dialogOpen}
        bankId={bankId}
        region={selectedRegion}
        onOpenChange={setDialogOpen}
      />
    </div>
  );
}
