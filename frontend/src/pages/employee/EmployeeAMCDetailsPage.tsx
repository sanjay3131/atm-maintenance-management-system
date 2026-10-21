import { useState, type ChangeEvent } from "react";
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  MapPin,
  Upload,
} from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  useCompleteEmployeeAMC,
  useEmployeeAMC,
  useSaveEmployeeAMCChecklist,
  useStartEmployeeAMC,
  useUploadEmployeeAMCPhotos,
} from "@/features/amc/hooks/useMyAMC";
import {
  AMC_CHECKLIST_ITEMS,
  canCompleteAMC,
  createAMCChecklist,
  getAMCErrorMessage,
  formatAMCStatus,
  getAMCPhotoSelectionError,
  isAMCChecklistEqual,
  validateAMCChecklist,
} from "@/features/amc/amcExecution.utils";
import type { AMCChecklistItem, EmployeeAMCRecord } from "@/services/amc.service";

function displayDate(value?: string | null) {
  if (!value) return "Not available";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? "Not available"
    : date.toLocaleString("en-IN", {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit",
      });
}

function getATM(amc: EmployeeAMCRecord) {
  return typeof amc.atmId === "object" && amc.atmId !== null ? amc.atmId : null;
}

function isValidAMCId(value: string) {
  return /^[a-f\d]{24}$/i.test(value);
}

export default function EmployeeAMCDetailsPage() {
  const { amcId = "" } = useParams();
  const validId = isValidAMCId(amcId);
  const amcQuery = useEmployeeAMC(validId ? amcId : "");
  const startMutation = useStartEmployeeAMC();
  const checklistMutation = useSaveEmployeeAMCChecklist();
  const uploadMutation = useUploadEmployeeAMCPhotos();
  const completeMutation = useCompleteEmployeeAMC();
  const [checklistDraft, setChecklistDraft] = useState<{
    amcId: string;
    items: AMCChecklistItem[];
  } | null>(null);
  const [selectedFiles, setSelectedFiles] = useState<File[]>([]);
  const [remarksDraft, setRemarksDraft] = useState<{
    amcId: string;
    value: string;
  } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [photoError, setPhotoError] = useState("");
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const amc = amcQuery.data;
  const atm = amc ? getATM(amc) : null;
  const photoCount = amc?.photoCount ?? 0;
  const terminal = amc?.status === "COMPLETED";
  const editable = amc?.status === "IN_PROGRESS" || amc?.status === "OVERDUE";
  const checklist =
    amc && checklistDraft && checklistDraft.amcId === amc._id
      ? checklistDraft.items
      : createAMCChecklist(amc?.checklist);
  const remarks =
    amc && remarksDraft && remarksDraft.amcId === amc._id
      ? remarksDraft.value
      : amc?.employeeRemarks ?? "";
  const checklistValid = validateAMCChecklist(checklist);
  const checklistDirty = !isAMCChecklistEqual(checklist, amc?.checklist);
  const busy =
    isLocating ||
    startMutation.isPending ||
    checklistMutation.isPending ||
    uploadMutation.isPending ||
    completeMutation.isPending;
  const completionReady =
    amc !== undefined &&
    canCompleteAMC({
      status: amc.status,
      checklistCompleted: Boolean(
        amc.checklistCompleted && checklistValid && !checklistDirty,
      ),
      photoCount,
    });

  const handleChecklistChange = (
    itemId: string,
    field: "response" | "remarks",
    value: string,
  ) => {
    if (!amc) return;
    setChecklistDraft({
      amcId: amc._id,
      items: checklist.map((entry) =>
        entry.item === itemId ? { ...entry, [field]: value } : entry,
      ),
    });
    setNotice("");
  };

  const handleFileSelection = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files ?? []);
    event.target.value = "";
    const selectionError = getAMCPhotoSelectionError(files, photoCount);
    setPhotoError(selectionError);
    setSelectedFiles(selectionError ? [] : files);
  };

  const startVisit = async () => {
    setError("");
    setNotice("");
    try {
      await startMutation.mutateAsync({ amcId });
      setNotice("Visit started. Complete the checklist and upload six photos.");
    } catch (requestError) {
      setError(getAMCErrorMessage(requestError));
    }
  };

  const saveChecklist = async () => {
    if (!amc) return;
    if (!validateAMCChecklist(checklist)) {
      setError("Complete all 11 checklist responses using the allowed options.");
      return;
    }
    setError("");
    setNotice("");
    try {
      await checklistMutation.mutateAsync({ amcId, checklist });
      setChecklistDraft(null);
      setNotice("Checklist saved.");
    } catch (requestError) {
      setError(getAMCErrorMessage(requestError));
    }
  };

  const uploadPhotos = async () => {
    if (!selectedFiles.length || photoError) return;
    setError("");
    setNotice("");
    setUploadProgress(0);
    try {
      await uploadMutation.mutateAsync({
        amcId,
        files: selectedFiles,
        onProgress: setUploadProgress,
      });
      setSelectedFiles([]);
      setPhotoError("");
      setNotice("Photo evidence uploaded.");
    } catch (requestError) {
      setError(getAMCErrorMessage(requestError));
    } finally {
      setUploadProgress(null);
    }
  };

  const completeVisit = async () => {
    if (!amc || !completionReady || busy) return;
    if (!navigator.geolocation) {
      setError("This browser does not support location services.");
      return;
    }
    setError("");
    setNotice("");
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setIsLocating(false);
        completeMutation.mutate(
          {
            amcId,
            data: {
              gps: {
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                accuracy: position.coords.accuracy,
              },
              remarks,
            },
          },
          {
            onSuccess: () => {
              setRemarksDraft(null);
              setNotice("AMC visit completed.");
            },
            onError: (requestError) => setError(getAMCErrorMessage(requestError)),
          },
        );
      },
      (locationError) => {
        setIsLocating(false);
        setError(
          locationError.code === locationError.PERMISSION_DENIED
            ? "Location permission is required to complete this visit."
            : "Could not get your location. Check location services and try again.",
        );
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
  };

  if (!validId) {
    return (
      <main className="space-y-5 p-4 sm:p-6">
        <Link to="/employee/amcs" className="inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm font-medium hover:bg-muted">
          <ArrowLeft aria-hidden="true" /> My AMC Visits
        </Link>
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-5 text-destructive" role="alert">
          This AMC reference is invalid.
        </p>
      </main>
    );
  }

  if (amcQuery.isLoading) {
    return (
      <main className="space-y-4 p-4 sm:p-6" role="status">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="h-56 animate-pulse rounded-lg border bg-muted/40" />
        <div className="h-64 animate-pulse rounded-lg border bg-muted/40" />
        <span className="sr-only">Loading AMC visit...</span>
      </main>
    );
  }

  if (amcQuery.isError || !amc) {
    return (
      <main className="space-y-5 p-4 sm:p-6">
        <Link to="/employee/amcs" className="inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm font-medium hover:bg-muted">
          <ArrowLeft aria-hidden="true" /> My AMC Visits
        </Link>
        <Card className="border-destructive/30">
          <CardContent className="p-5" role="alert">
            <p className="font-medium text-destructive">AMC visit unavailable.</p>
            <p className="mt-1 text-sm text-muted-foreground">{getAMCErrorMessage(amcQuery.error)}</p>
            <Button
              type="button"
              variant="outline"
              className="mt-4 min-h-11"
              onClick={() => void amcQuery.refetch()}
              disabled={amcQuery.isFetching}
            >
              {amcQuery.isFetching ? "Retrying..." : "Retry"}
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className="space-y-5 p-4 sm:space-y-6 sm:p-6">
      <Link to="/employee/amcs" className="inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm font-medium hover:bg-muted">
        <ArrowLeft aria-hidden="true" /> My AMC Visits
      </Link>

      <Card className="overflow-hidden">
        <div className="h-1.5 bg-gradient-to-r from-teal-600 to-blue-700" />
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">{amc.amcId}</p>
            <CardTitle className="mt-1 text-2xl">{atm?.atmId || "ATM unavailable"}</CardTitle>
            {(atm?.locationName || atm?.address) && (
              <p className="mt-1 text-sm text-muted-foreground">
                {atm.locationName || atm.address}
              </p>
            )}
          </div>
          <Badge variant={amc.status === "OVERDUE" ? "destructive" : amc.status === "PENDING" ? "secondary" : "outline"}>
            {formatAMCStatus(amc.status)}
          </Badge>
        </CardHeader>
        <CardContent className="grid gap-4 border-t pt-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div><p className="text-xs text-muted-foreground">Period</p><p className="font-medium">{amc.month}/{amc.year}</p></div>
          <div><p className="text-xs text-muted-foreground">Deadline</p><p className="font-medium">{displayDate(amc.deadlineDate)}</p></div>
          <div><p className="text-xs text-muted-foreground">Visit started</p><p className="font-medium">{displayDate(amc.visitDate)}</p></div>
          <div><p className="text-xs text-muted-foreground">Completed</p><p className="font-medium">{displayDate(amc.completedAt)}</p></div>
          <div className="flex items-center gap-2 sm:col-span-2">
            <Camera className="size-4 text-primary" aria-hidden="true" />
            <span>Photo evidence: {photoCount}/{6} uploaded</span>
          </div>
        </CardContent>
      </Card>

      {amc.status === "OVERDUE" && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
          This visit is overdue. The existing service allows the assigned employee to save evidence and complete it, but does not allow the overdue state to be started again.
        </div>
      )}

      {error && <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive" role="alert">{error}</div>}
      {notice && <div className="rounded-lg border border-emerald-600/20 bg-emerald-600/5 p-4 text-sm text-emerald-800" role="status">{notice}</div>}

      {amc.status === "PENDING" && (
        <Card>
          <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold">Ready to begin the ATM visit?</p>
              <p className="mt-1 text-sm text-muted-foreground">Starting requires the ATM location to be configured.</p>
            </div>
            <Button type="button" className="min-h-11" onClick={() => void startVisit()} disabled={busy}>
              {startMutation.isPending ? "Starting..." : "Start visit"}
            </Button>
          </CardContent>
        </Card>
      )}

      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardCheck className="size-5 text-primary" aria-hidden="true" />
            Maintenance checklist {amc.checklistCompleted && <Badge variant="secondary">Saved</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {AMC_CHECKLIST_ITEMS.map((item) => {
            const value = checklist.find((entry) => entry.item === item.id);
            return (
              <div key={item.id} className="grid gap-2 border-b pb-4 last:border-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] sm:items-center">
                <label htmlFor={`amc-check-${item.id}`} className="text-sm font-medium">{item.label}</label>
                <div className="grid gap-2 sm:grid-cols-2">
                  <select
                    id={`amc-check-${item.id}`}
                    value={value?.response ?? ""}
                    onChange={(event) => handleChecklistChange(item.id, "response", event.target.value)}
                    disabled={!editable || terminal || busy}
                    className="h-11 w-full rounded-lg border border-input bg-background px-3"
                  >
                    <option value="">Choose response</option>
                    {item.options.map((option) => <option key={option} value={option}>{option}</option>)}
                  </select>
                  <input
                    type="text"
                    value={value?.remarks ?? ""}
                    onChange={(event) => handleChecklistChange(item.id, "remarks", event.target.value)}
                    disabled={!editable || terminal || busy}
                    aria-label={`${item.label} remarks`}
                    placeholder="Remarks (optional)"
                    className="h-11 w-full rounded-lg border border-input bg-background px-3"
                  />
                </div>
              </div>
            );
          })}
          {editable && (
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={() => void saveChecklist()}
              disabled={busy || !checklistValid}
            >
              {checklistMutation.isPending ? "Saving checklist..." : "Save checklist"}
            </Button>
          )}
          {!checklistValid && editable && (
            <p className="text-sm text-muted-foreground">Select an allowed response for all 11 items before saving.</p>
          )}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Photo evidence</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Upload six JPEG, PNG, or WebP photos, up to 5 MB each. Existing photo URLs are not rendered in this workflow.
          </p>
          {!terminal && editable && photoCount < 6 && (
            <>
              <label htmlFor="amc-photo-files" className="block text-sm font-medium">Select photos</label>
              <input
                id="amc-photo-files"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                onChange={handleFileSelection}
                disabled={busy}
                className="block min-h-11 w-full text-sm file:mr-3 file:min-h-11 file:rounded-md file:border-0 file:bg-primary file:px-4 file:text-primary-foreground"
              />
              {selectedFiles.length > 0 && <p className="text-sm">{selectedFiles.length} photo(s) selected.</p>}
              {photoError && <p className="text-sm text-destructive" role="alert">{photoError}</p>}
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                onClick={() => void uploadPhotos()}
                disabled={busy || selectedFiles.length === 0 || Boolean(photoError)}
              >
                <Upload aria-hidden="true" />
                {uploadMutation.isPending
                  ? `Uploading${uploadProgress === null ? "..." : ` ${uploadProgress}%`}`
                  : "Upload selected photos"}
              </Button>
            </>
          )}
          {photoCount >= 6 && (
            <p className="flex items-center gap-2 text-sm text-emerald-700">
              <CheckCircle2 className="size-4" aria-hidden="true" /> Required photo evidence is uploaded.
            </p>
          )}
          {terminal && <p className="text-sm text-muted-foreground">This completed AMC is read-only.</p>}
        </CardContent>
      </Card>

      <Card>
        <CardHeader><CardTitle className="text-base">Complete visit</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <label htmlFor="amc-employee-remarks" className="block text-sm font-medium">Visit remarks (optional)</label>
          <textarea
            id="amc-employee-remarks"
            value={remarks}
            onChange={(event) =>
              setRemarksDraft({ amcId: amc._id, value: event.target.value })
            }
            maxLength={1000}
            disabled={terminal || busy}
            rows={3}
            className="w-full rounded-lg border border-input bg-background p-3"
          />
          <p className="flex items-start gap-2 text-sm text-muted-foreground">
            <MapPin className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            Completion requires browser location permission and the server validates proximity to the configured ATM location.
          </p>
          <Button
            type="button"
            className="min-h-11 w-full sm:w-auto"
            onClick={() => void completeVisit()}
            disabled={terminal || !completionReady || busy}
          >
            {isLocating
              ? "Getting location..."
              : completeMutation.isPending
                ? "Completing visit..."
                : "Complete AMC visit"}
          </Button>
          {!terminal && !completionReady && (
            <p className="text-sm text-muted-foreground">
              Save a valid checklist and upload all six required photos before completing.
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
