import { useEffect, useRef, useState, type ChangeEvent } from "react";
import {
  ArrowLeft,
  Camera,
  CheckCircle2,
  ClipboardCheck,
  MapPin,
  Trash2,
  Upload,
} from "lucide-react";
import { Link, useNavigate, useParams } from "react-router-dom";
import { toast } from "sonner";
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
  canStartAMC,
  createAMCChecklist,
  getAMCErrorMessage,
  getAMCPhotoSelectionError,
  isAMCChecklistEqual,
  hasStartedAMCVisit,
  validateAMCChecklist,
} from "@/features/amc/amcExecution.utils";
import type { AMCChecklistItem, EmployeeAMCRecord } from "@/services/amc.service";
import EmployeeATMLocationRequest from "@/features/atms/components/EmployeeATMLocationRequest";
import {
  employeeErrorMessage,
  employeeLanguageClasses,
  useEmployeeLanguage,
} from "@/features/employee-portal/i18n";
import {
  getEmployeeAMCStatusLabelKey,
  getEmployeeAMCValueLabelKey,
} from "@/features/employee-portal/employeeLanguage.utils";

function displayDate(
  value: string | null | undefined,
  language: "ta" | "en",
  t: ReturnType<typeof useEmployeeLanguage>["t"],
) {
  if (!value) return t("Not available");
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? t("Not available")
    : date.toLocaleString(language === "ta" ? "ta-IN" : "en-IN", {
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

const CONFETTI_COLORS = [
  "#0d9488",
  "#2563eb",
  "#f59e0b",
  "#e11d48",
  "#7c3aed",
];

export default function EmployeeAMCDetailsPage() {
  const { t, language } = useEmployeeLanguage();
  const { amcId = "" } = useParams();
  const navigate = useNavigate();
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
  const [photoPreviews, setPhotoPreviews] = useState<
    Array<{ file: File; url: string }>
  >([]);
  const [remarksDraft, setRemarksDraft] = useState<{
    amcId: string;
    value: string;
  } | null>(null);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [photoError, setPhotoError] = useState("");
  const [uploadProgress, setUploadProgress] = useState<number | null>(null);
  const [isLocating, setIsLocating] = useState(false);
  const [showConfetti, setShowConfetti] = useState(false);
  const redirectTimer = useRef<number | null>(null);
  const previewUrls = useRef(new Set<string>());
  const amc = amcQuery.data;
  const atm = amc ? getATM(amc) : null;
  const translateAMCValue = (value: string) => {
    const key = getEmployeeAMCValueLabelKey(value);
    return key ? t(key) : value;
  };
  const photoCount = amc?.photoCount ?? 0;
  const terminal = amc?.status === "COMPLETED";
  const editable = amc?.status === "IN_PROGRESS" || amc?.status === "OVERDUE";
  const visitStarted =
    amc !== undefined &&
    hasStartedAMCVisit({ status: amc.status, visitDate: amc.visitDate });
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
    visitStarted &&
    canCompleteAMC({
      status: amc.status,
      visitDate: amc.visitDate,
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
    if (files.length === 0) return;
    const selectionError = getAMCPhotoSelectionError(
      files,
      photoCount + selectedFiles.length,
      t,
    );
    setPhotoError(selectionError);
    if (!selectionError) {
      const previews = files.map((file) => {
        const url = URL.createObjectURL(file);
        previewUrls.current.add(url);
        return { file, url };
      });
      setPhotoPreviews((current) => [...current, ...previews]);
      setSelectedFiles((current) => [...current, ...files]);
    }
  };

  const clearSelectedPhotos = () => {
    for (const url of previewUrls.current) {
      URL.revokeObjectURL(url);
    }
    previewUrls.current.clear();
    setPhotoPreviews([]);
    setSelectedFiles([]);
  };

  useEffect(
    () => () => {
      if (redirectTimer.current !== null) {
        window.clearTimeout(redirectTimer.current);
      }
      for (const url of previewUrls.current) {
        URL.revokeObjectURL(url);
      }
      previewUrls.current.clear();
    },
    [],
  );

  const startVisit = async () => {
    setError("");
    setNotice("");
    try {
      await startMutation.mutateAsync({ amcId });
      setNotice(t("Visit started. Complete the checklist and upload six photos."));
    } catch (requestError) {
      setError(
        employeeErrorMessage(
          getAMCErrorMessage(requestError),
          "The AMC request could not be completed. Please try again.",
          language,
          t,
        ),
      );
    }
  };

  const saveChecklist = async () => {
    if (!amc) return;
    if (!validateAMCChecklist(checklist)) {
      setError(t("Complete all 11 checklist responses using the allowed options."));
      return;
    }
    setError("");
    setNotice("");
    try {
      await checklistMutation.mutateAsync({ amcId, checklist });
      setChecklistDraft(null);
      setNotice(t("Checklist saved."));
    } catch (requestError) {
      setError(
        employeeErrorMessage(
          getAMCErrorMessage(requestError),
          "The AMC request could not be completed. Please try again.",
          language,
          t,
        ),
      );
    }
  };

  const uploadPhotos = async () => {
    if (
      !selectedFiles.length ||
      photoError ||
      uploadMutation.isPending ||
      photoCount + selectedFiles.length > 6
    ) return;
    setError("");
    setNotice("");
    setUploadProgress(null);
    try {
      const result = await uploadMutation.mutateAsync({
        amcId,
        files: selectedFiles,
        onProgress: setUploadProgress,
      });
      if (result.uploaded !== selectedFiles.length) {
        clearSelectedPhotos();
        setPhotoError("");
        setNotice(
          t(
            "Photo upload partially succeeded: {uploaded} of {selected} selected photos were saved. Refresh the visit and check the remaining photo count before selecting more.",
            { uploaded: result.uploaded, selected: selectedFiles.length },
          ),
        );
      } else {
        clearSelectedPhotos();
        setPhotoError("");
        setNotice(t("{count} photo(s) uploaded successfully.", { count: result.uploaded }));
      }
    } catch (requestError) {
      clearSelectedPhotos();
      setPhotoError("");
      setError(
        `${employeeErrorMessage(
          getAMCErrorMessage(requestError),
          "The AMC request could not be completed. Please try again.",
          language,
          t,
        )} ${t("Selected files were cleared to avoid duplicate uploads; refresh the visit and verify the saved photo count before trying again.")}`,
      );
    } finally {
      setUploadProgress(null);
    }
  };

  const completeVisit = async () => {
    if (!amc || !completionReady || busy) return;
    if (!navigator.geolocation) {
      setError(t("This browser does not support location services."));
      return;
    }
    setError("");
    setNotice("");
    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setIsLocating(false);
        void (async () => {
          try {
            await completeMutation.mutateAsync({
            amcId,
            data: {
              gps: {
                latitude: position.coords.latitude,
                longitude: position.coords.longitude,
                accuracy: position.coords.accuracy,
              },
              remarks,
            },
            });
            setRemarksDraft(null);
            setNotice(t("AMC visit completed."));
            toast.success(t("AMC visit completed successfully."));
            setShowConfetti(true);
            redirectTimer.current = window.setTimeout(() => {
              setShowConfetti(false);
              navigate("/employee/amcs");
            }, 1100);
          } catch (requestError) {
            setError(
              employeeErrorMessage(
                getAMCErrorMessage(requestError),
                "The AMC request could not be completed. Please try again.",
                language,
                t,
              ),
            );
          }
        })();
      },
      (locationError) => {
        setIsLocating(false);
        setError(
          locationError.code === locationError.PERMISSION_DENIED
            ? t("Location permission is required to complete this visit.")
              : t("Could not get your location. Check location services and try again."),
        );
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
  };

  if (!validId) {
    return (
      <main className={`min-w-0 ${employeeLanguageClasses(language, "space-y-5 p-4 sm:p-6", "space-y-4 p-3 sm:p-5")}`}>
        <Link to="/employee/amcs" className="inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm font-medium hover:bg-muted">
          <ArrowLeft aria-hidden="true" /> {t("My AMC Visits")}
        </Link>
        <p className="rounded-lg border border-destructive/30 bg-destructive/5 p-5 text-destructive" role="alert">
          {t("AMC visit reference is invalid.")}
        </p>
      </main>
    );
  }

  if (amcQuery.isLoading) {
    return (
      <main className={`min-w-0 ${employeeLanguageClasses(language, "space-y-4 p-4 sm:p-6", "space-y-3 p-3 sm:p-5")}`} role="status">
        <div className="h-8 w-48 animate-pulse rounded bg-muted" />
        <div className="h-56 animate-pulse rounded-lg border bg-muted/40" />
        <div className="h-64 animate-pulse rounded-lg border bg-muted/40" />
        <span className="sr-only">{t("Loading AMC visit...")}</span>
      </main>
    );
  }

  if (amcQuery.isError || !amc) {
    return (
      <main className={`min-w-0 ${employeeLanguageClasses(language, "space-y-5 p-4 sm:p-6", "space-y-4 p-3 sm:p-5")}`}>
        <Link to="/employee/amcs" className="inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm font-medium hover:bg-muted">
          <ArrowLeft aria-hidden="true" /> {t("My AMC Visits")}
        </Link>
        <Card className="border-destructive/30">
          <CardContent className="p-5" role="alert">
            <p className="font-medium text-destructive">{t("AMC visit unavailable.")}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {employeeErrorMessage(
                getAMCErrorMessage(amcQuery.error),
                "The AMC request could not be completed. Please try again.",
                language,
                t,
              )}
            </p>
            <Button
              type="button"
              variant="outline"
              className="mt-4 min-h-11"
              onClick={() => void amcQuery.refetch()}
              disabled={amcQuery.isFetching}
            >
              {amcQuery.isFetching ? t("Retrying...") : t("Retry")}
            </Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <main className={`min-w-0 ${employeeLanguageClasses(language, "space-y-5 p-4 sm:space-y-6 sm:p-6", "space-y-4 p-3 sm:p-5")}`}>
      <Link to="/employee/amcs" className="inline-flex min-h-11 items-center gap-2 rounded-lg border px-3 text-sm font-medium hover:bg-muted">
        <ArrowLeft aria-hidden="true" /> {t("My AMC Visits")}
      </Link>

      <Card className="overflow-hidden">
        <div className="h-1.5 bg-gradient-to-r from-teal-600 to-blue-700" />
        <CardHeader className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
          <div>
            <p className="text-xs font-semibold uppercase tracking-wide text-primary">{amc.amcId}</p>
            <CardTitle className="mt-1 break-words text-2xl [overflow-wrap:anywhere]">{atm?.atmId || t("ATM unavailable")}</CardTitle>
            {(atm?.locationName || atm?.address) && (
              <p className="mt-1 text-sm text-muted-foreground">
                {atm.locationName || atm.address}
              </p>
            )}
          </div>
          <Badge variant={amc.status === "OVERDUE" ? "destructive" : amc.status === "PENDING" ? "secondary" : "outline"}>
            {t(getEmployeeAMCStatusLabelKey(amc.status))}
          </Badge>
        </CardHeader>
        <CardContent className="grid gap-4 border-t pt-4 text-sm sm:grid-cols-2 lg:grid-cols-4">
          <div><p className="text-xs text-muted-foreground">{t("Period")}</p><p className="font-medium">{amc.month}/{amc.year}</p></div>
          <div><p className="text-xs text-muted-foreground">{t("Deadline")}</p><p className="font-medium">{displayDate(amc.deadlineDate, language, t)}</p></div>
          <div><p className="text-xs text-muted-foreground">{t("Visit started")}</p><p className="font-medium">{displayDate(amc.visitDate, language, t)}</p></div>
          <div><p className="text-xs text-muted-foreground">{t("Completed")}</p><p className="font-medium">{displayDate(amc.completedAt, language, t)}</p></div>
          <div className="flex items-center gap-2 sm:col-span-2">
            <Camera className="size-4 text-primary" aria-hidden="true" />
            <span>{t("Photo evidence: {count}/{required} uploaded", { count: photoCount, required: 6 })}</span>
          </div>
        </CardContent>
      </Card>

      {["PENDING", "IN_PROGRESS", "OVERDUE"].includes(amc.status) && atm?._id && (
        <EmployeeATMLocationRequest
          atmId={atm._id}
          atmCode={atm.atmId || "ATM"}
          amcId={amc._id}
          locationConfigured={atm.locationConfigured}
          officialCoordinates={atm.location?.coordinates}
          hasApprovedLocationRequest={atm.locationRequestApproved}
          locationRequestWindowOpen={atm.locationRequestWindowOpen}
        />
      )}

      {amc.status === "OVERDUE" && (
        <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
          {t("This visit is overdue. If it has not been started, you can start it now. An already-started visit can still be completed.")}
        </div>
      )}

      {error && <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm text-destructive" role="alert">{error}</div>}
      {notice && <div className="rounded-lg border border-emerald-600/20 bg-emerald-600/5 p-4 text-sm text-emerald-800" role="status">{notice}</div>}

      {showConfetti && (
        <div className="amc-confetti-overlay" aria-hidden="true">
          {Array.from({ length: 28 }, (_, index) => (
            <span
              key={index}
              className="amc-confetti-piece"
              style={{
                left: `${(index * 37) % 100}%`,
                backgroundColor: CONFETTI_COLORS[index % CONFETTI_COLORS.length],
                animationDelay: `${(index % 7) * 45}ms`,
                transform: `rotate(${index * 29}deg)`,
              }}
            />
          ))}
        </div>
      )}

      {canStartAMC({ status: amc.status, visitDate: amc.visitDate }) && (
        <Card>
          <CardContent className="flex flex-col gap-3 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div>
              <p className="font-semibold">{t("Ready to begin the ATM visit?")}</p>
              <p className="mt-1 text-sm text-muted-foreground">{t("Starting requires the ATM location to be configured.")}</p>
            </div>
            <Button type="button" className="min-h-11" onClick={() => void startVisit()} disabled={busy}>
              {startMutation.isPending ? t("Starting...") : t("Start visit")}
            </Button>
          </CardContent>
        </Card>
      )}

      {!visitStarted && !terminal && (
        <Card>
          <CardContent className="p-5 text-sm text-muted-foreground">
            {t("Start the visit first. The checklist and photo upload will become available after the backend confirms the visit start.")}
          </CardContent>
        </Card>
      )}

      {visitStarted && (
      <Card>
        <CardHeader>
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardCheck className="size-5 text-primary" aria-hidden="true" />
            {t("Maintenance checklist")} {amc.checklistCompleted && <Badge variant="secondary">{t("Saved")}</Badge>}
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          {AMC_CHECKLIST_ITEMS.map((item) => {
            const value = checklist.find((entry) => entry.item === item.id);
            return (
              <div key={item.id} className="grid gap-2 border-b pb-4 last:border-0 sm:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)] sm:items-center">
                <label htmlFor={`amc-check-${item.id}`} className="text-sm font-medium">
                  {translateAMCValue(item.label)}
                </label>
                <div className="grid gap-2 sm:grid-cols-2">
                  <fieldset
                    aria-label={t("{item} response", {
                      item: translateAMCValue(item.label),
                    })}
                    className="grid gap-2 sm:grid-cols-2"
                  >
                    {item.options.map((option) => (
                      <label
                        key={option}
                        className={`flex min-h-11 cursor-pointer items-center gap-2 rounded-lg border px-3 text-sm transition ${
                          value?.response === option
                            ? "border-primary bg-primary/5 font-semibold text-primary"
                            : "border-input hover:bg-muted"
                        } ${!editable || terminal || busy ? "cursor-not-allowed opacity-70" : ""}`}
                      >
                        <input
                          type="radio"
                          name={`amc-check-${item.id}`}
                          value={option}
                          checked={value?.response === option}
                          onChange={() => handleChecklistChange(item.id, "response", option)}
                          disabled={!editable || terminal || busy}
                          className="size-4 accent-primary"
                        />
                        <span>
                          {translateAMCValue(option)}
                        </span>
                      </label>
                    ))}
                  </fieldset>
                  <input
                    type="text"
                    value={value?.remarks ?? ""}
                    onChange={(event) => handleChecklistChange(item.id, "remarks", event.target.value)}
                    disabled={!editable || terminal || busy}
                    aria-label={t("{item} remarks", {
                      item: translateAMCValue(item.label),
                    })}
                    placeholder={t("Remarks (optional)")}
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
              {checklistMutation.isPending ? t("Saving checklist...") : t("Save checklist")}
            </Button>
          )}
          {!checklistValid && editable && (
            <p className="text-sm text-muted-foreground">{t("Select an allowed response for all 11 items before saving.")}</p>
          )}
        </CardContent>
      </Card>
      )}

      {visitStarted && (
      <Card>
        <CardHeader><CardTitle className="text-base">{t("Photo evidence")}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            {t("Upload six JPEG, PNG, or WebP photos, up to 5 MB each. Existing photo URLs are not rendered in this workflow.")}
          </p>
          {!terminal && editable && photoCount < 6 && (
            <>
              <label htmlFor="amc-photo-files" className="block text-sm font-medium">
                {t("Choose photos ({count}/6 selected or uploaded)", {
                  count: photoCount + selectedFiles.length,
                })}
              </label>
              <input
                id="amc-photo-files"
                type="file"
                accept="image/jpeg,image/png,image/webp"
                multiple
                onChange={handleFileSelection}
                disabled={busy || photoCount + selectedFiles.length >= 6}
                className="block min-h-11 w-full text-sm file:mr-3 file:min-h-11 file:rounded-md file:border-0 file:bg-primary file:px-4 file:text-primary-foreground"
              />
              {selectedFiles.length > 0 && (
                <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
                  {photoPreviews.map(({ file, url }, index) => (
                    <figure key={`${file.name}-${file.lastModified}-${index}`} className="overflow-hidden rounded-lg border">
                      <img
                        src={url}
                        alt={t("Selected photo {number}: {filename}", {
                          number: index + 1,
                          filename: file.name,
                        })}
                        className="h-40 w-full object-cover"
                      />
                      <figcaption className="flex items-center justify-between gap-2 p-2">
                        <span className="min-w-0 truncate text-xs">{file.name}</span>
                        <Button
                          type="button"
                          variant="destructive"
                          size="sm"
                          aria-label={t("Remove {filename}", { filename: file.name })}
                          onClick={() => {
                            const preview = photoPreviews[index];
                            if (preview) {
                              URL.revokeObjectURL(preview.url);
                              previewUrls.current.delete(preview.url);
                            }
                            setPhotoPreviews((current) =>
                              current.filter((_preview, previewIndex) => previewIndex !== index),
                            );
                            setSelectedFiles((current) =>
                              current.filter((_selected, selectedIndex) => selectedIndex !== index),
                            );
                            setPhotoError("");
                          }}
                          disabled={busy}
                        >
                          <Trash2 aria-hidden="true" />
                          {t("Remove")}
                        </Button>
                      </figcaption>
                    </figure>
                  ))}
                </div>
              )}
              {photoError && <p className="text-sm text-destructive" role="alert">{photoError}</p>}
              {selectedFiles.length >= 6 - photoCount && (
                <p className="text-sm text-muted-foreground">
                  {t("Maximum of six photos reached. Remove a selected photo to choose another.")}
                </p>
              )}
              {uploadMutation.isPending && (
                <div className="space-y-2" role="status" aria-live="polite">
                  <p className="text-sm">
                    {uploadProgress === null
                      ? t("Uploading photos...")
                      : t("Uploading photos: {progress}%", { progress: uploadProgress })}
                  </p>
                  <div
                    role="progressbar"
                    aria-label={t("Photo upload progress")}
                    aria-valuemin={uploadProgress === null ? undefined : 0}
                    aria-valuemax={uploadProgress === null ? undefined : 100}
                    aria-valuenow={uploadProgress ?? undefined}
                    className="h-2 overflow-hidden rounded-full bg-muted"
                  >
                    <div
                      className={`h-full rounded-full bg-primary ${
                        uploadProgress === null
                          ? "amc-upload-indeterminate"
                          : "transition-[width]"
                      }`}
                      style={
                        uploadProgress === null
                          ? undefined
                          : { width: `${uploadProgress}%` }
                      }
                    />
                  </div>
                </div>
              )}
              <Button
                type="button"
                variant="outline"
                className="min-h-11"
                onClick={() => void uploadPhotos()}
                disabled={busy || selectedFiles.length === 0 || Boolean(photoError)}
              >
                <Upload aria-hidden="true" />
                {uploadMutation.isPending
                  ? uploadProgress === null
                    ? t("Uploading...")
                    : t("Uploading {progress}%", { progress: uploadProgress })
                  : t("Upload selected photos")}
              </Button>
            </>
          )}
          {photoCount >= 6 && (
            <p className="flex items-center gap-2 text-sm text-emerald-700">
              <CheckCircle2 className="size-4" aria-hidden="true" /> {t("Required photo evidence is uploaded.")}
            </p>
          )}
          {terminal && <p className="text-sm text-muted-foreground">{t("This completed AMC is read-only.")}</p>}
        </CardContent>
      </Card>
      )}

      <Card>
        <CardHeader><CardTitle className="text-base">{t("Complete visit")}</CardTitle></CardHeader>
        <CardContent className="space-y-4">
          <label htmlFor="amc-employee-remarks" className="block text-sm font-medium">{t("Visit remarks (optional)")}</label>
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
            {t("Completion requires browser location permission and the server validates proximity to the configured ATM location.")}
          </p>
          <Button
            type="button"
            className="min-h-11 w-full sm:w-auto"
            onClick={() => void completeVisit()}
            disabled={terminal || !completionReady || busy}
          >
            {isLocating
              ? t("Getting location...")
              : completeMutation.isPending
                ? t("Completing visit...")
                : t("Complete AMC visit")}
          </Button>
          {!terminal && !completionReady && (
            <p className="text-sm text-muted-foreground">
              {!visitStarted
                ? t("Start the visit before completing it.")
                : t("Save a valid checklist and upload all six required photos before completing.")}
            </p>
          )}
        </CardContent>
      </Card>
    </main>
  );
}
