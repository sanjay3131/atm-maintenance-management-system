import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { useQueryClient } from "@tanstack/react-query";
import { isAxiosError } from "axios";
import {
  Camera,
  Check,
  CircleCheck,
  ImagePlus,
  LoaderCircle,
  MapPin,
  Replace,
  Trash2,
  Upload,
} from "lucide-react";
import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useSetATMLocation } from "@/features/atms/hooks/useSetATMLocation";
import JobPhotoGallery from "@/features/jobs/components/JobPhotoGallery";
import { useCompleteJob, useUploadJobPhoto } from "../hooks/useJobLifecycle";
import type { Job, JobPhoto } from "../types/job.types";
import type { JobPhotoType } from "../services/jobs.service";

const REQUIRED_PHOTOS_PER_TYPE = 3;
const MAX_PHOTOS_PER_TYPE = 3;
const MAX_FILE_SIZE = 5 * 1024 * 1024;
const ALLOWED_FILE_TYPES = new Set([
  "image/jpeg",
  "image/jpg",
  "image/png",
  "image/webp",
]);

interface GpsPosition {
  latitude: number;
  longitude: number;
  accuracy: number;
}

interface PendingPhoto {
  id: string;
  file: File;
  photoType: JobPhotoType;
  previewUrl: string;
}

type PhotoSelection = Record<JobPhotoType, PendingPhoto[]>;
type PhotoCounts = Record<JobPhotoType, number>;
type UploadStatus = "idle" | "uploading" | "uploaded" | "failed";

const EMPTY_SELECTION: PhotoSelection = { before: [], after: [] };
const EMPTY_COUNTS: PhotoCounts = { before: 0, after: 0 };

function getApiErrorMessage(error: unknown) {
  if (isAxiosError<{ message?: string }>(error)) {
    return (
      error.response?.data?.message || "The request could not be completed."
    );
  }
  return error instanceof Error
    ? error.message
    : "The request could not be completed.";
}

function getGeolocationError(error: GeolocationPositionError) {
  if (error.code === error.PERMISSION_DENIED) {
    return "Location permission is required to continue. Allow location access in your browser and try again.";
  }
  if (error.code === error.POSITION_UNAVAILABLE) {
    return "Your current location is unavailable. Check your device location settings and retry.";
  }
  if (error.code === error.TIMEOUT) {
    return "Getting your location took too long. Move to an area with a clear GPS signal and retry.";
  }
  return "Could not get your location. Please retry.";
}

function calculateDistanceMeters(
  latitude: number,
  longitude: number,
  atmLatitude: number,
  atmLongitude: number,
) {
  const earthRadius = 6371e3;
  const latitudeRadians = (latitude * Math.PI) / 180;
  const atmLatitudeRadians = (atmLatitude * Math.PI) / 180;
  const latitudeDelta = ((atmLatitude - latitude) * Math.PI) / 180;
  const longitudeDelta = ((atmLongitude - longitude) * Math.PI) / 180;
  const haversine =
    Math.sin(latitudeDelta / 2) ** 2 +
    Math.cos(latitudeRadians) *
      Math.cos(atmLatitudeRadians) *
      Math.sin(longitudeDelta / 2) ** 2;

  return Math.round(
    earthRadius *
      2 *
      Math.atan2(Math.sqrt(haversine), Math.sqrt(1 - haversine)),
  );
}

function getValidPhotoCount(
  photos: Array<JobPhoto | null> | undefined,
  photoType: JobPhotoType,
) {
  return (photos ?? []).filter(
    (photo) =>
      photo?.photoType === photoType &&
      typeof photo.url === "string" &&
      photo.url.length > 0,
  ).length;
}

function getFileId(file: File) {
  return `${file.name}:${file.size}:${file.lastModified}`;
}

function PendingPhotoCard({
  photo,
  disabled,
  onRemove,
  onReplace,
}: {
  photo: PendingPhoto;
  disabled: boolean;
  onRemove: () => void;
  onReplace: () => void;
}) {
  const reducedMotion = useReducedMotion();

  return (
    <motion.li
      layout={!reducedMotion}
      initial={reducedMotion ? false : { opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={reducedMotion ? undefined : { opacity: 0, scale: 0.94 }}
      transition={{ duration: 0.16 }}
      className="min-w-0 list-none rounded-md border p-2"
    >
      <img
        src={photo.previewUrl}
        alt={`Preview of ${photo.photoType} photo ${photo.file.name}`}
        className="aspect-square w-full rounded object-cover"
      />
      <p className="mt-2 truncate text-xs font-medium">
        {photo.photoType === "before" ? "Before" : "After"} · {photo.file.name}
      </p>
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="min-h-11 min-w-0 px-2"
          disabled={disabled}
          onClick={onReplace}
        >
          <Replace aria-hidden="true" />
          Replace
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="min-h-11 min-w-0 px-2"
          aria-label={`Remove ${photo.file.name}`}
          disabled={disabled}
          onClick={onRemove}
        >
          <Trash2 aria-hidden="true" />
          Remove
        </Button>
      </div>
    </motion.li>
  );
}

export default function EmployeeFieldWorkPanel({ job }: { job: Job }) {
  const queryClient = useQueryClient();
  const reducedMotion = useReducedMotion();
  const [gps, setGps] = useState<GpsPosition | null>(null);
  const [gpsError, setGpsError] = useState("");
  const [isLocating, setIsLocating] = useState(false);
  const [selectedPhotos, setSelectedPhotos] =
    useState<PhotoSelection>(EMPTY_SELECTION);
  const selectedPhotosRef = useRef<PhotoSelection>(EMPTY_SELECTION);
  const [confirmedCounts, setConfirmedCounts] =
    useState<PhotoCounts>(EMPTY_COUNTS);
  const [uploadStatus, setUploadStatus] = useState<
    Record<JobPhotoType, UploadStatus>
  >({ before: "idle", after: "idle" });
  const [uploadError, setUploadError] = useState("");
  const [activeUpload, setActiveUpload] = useState<{
    photoType: JobPhotoType;
    fileCount: number;
    persistedCount: number;
    progress?: number;
  } | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const uploadLockRef = useRef(false);
  const [isCompleteDialogOpen, setIsCompleteDialogOpen] = useState(false);
  const cameraInputRefs = useRef<
    Record<JobPhotoType, HTMLInputElement | null>
  >({ before: null, after: null });
  const pickerInputRefs = useRef<
    Record<JobPhotoType, HTMLInputElement | null>
  >({ before: null, after: null });
  const replaceInputRefs = useRef<
    Record<JobPhotoType, HTMLInputElement | null>
  >({ before: null, after: null });
  const replaceTargetRef = useRef<{
    photoType: JobPhotoType;
    id: string;
  } | null>(null);
  const uploadMutation = useUploadJobPhoto();
  const completeMutation = useCompleteJob();
  const setATMLocationMutation = useSetATMLocation();

  useEffect(
    () => () => {
      Object.values(selectedPhotosRef.current).flat().forEach((photo) => {
        URL.revokeObjectURL(photo.previewUrl);
      });
    },
    [],
  );

  const atm = typeof job.atmId === "object" && job.atmId ? job.atmId : null;
  const coordinates = atm?.location?.coordinates;
  const hasAtmCoordinates = Boolean(
    atm?.locationConfigured &&
      coordinates?.length === 2 &&
      Number.isFinite(coordinates[0]) &&
      Number.isFinite(coordinates[1]),
  );
  const persistedCounts: PhotoCounts = {
    before: Math.max(
      getValidPhotoCount(job.beforePhotos, "before"),
      confirmedCounts.before,
    ),
    after: Math.max(
      getValidPhotoCount(job.afterPhotos, "after"),
      confirmedCounts.after,
    ),
  };
  const photoTypes: Array<{
    type: JobPhotoType;
    title: string;
  }> = [
    { type: "before", title: "Before photos" },
    { type: "after", title: "After photos" },
  ];
  const evidenceComplete = photoTypes.every(
    ({ type }) => persistedCounts[type] >= REQUIRED_PHOTOS_PER_TYPE,
  );
  const selectionsComplete = photoTypes.every(
    ({ type }) =>
      persistedCounts[type] + selectedPhotos[type].length >=
      REQUIRED_PHOTOS_PER_TYPE,
  );
  const atmLatitude = coordinates?.[1];
  const atmLongitude = coordinates?.[0];
  const distance =
    gps &&
    hasAtmCoordinates &&
    atmLatitude !== undefined &&
    atmLongitude !== undefined
      ? calculateDistanceMeters(
          gps.latitude,
          gps.longitude,
          atmLatitude,
          atmLongitude,
        )
      : null;
  const withinRadius = distance !== null && distance <= 20;
  const canComplete = Boolean(
    gps &&
      hasAtmCoordinates &&
      withinRadius &&
      evidenceComplete &&
      !isUploading,
  );

  const replaceSelection = (
    photoType: JobPhotoType,
    nextPhotos: PendingPhoto[],
  ) => {
    const current = selectedPhotosRef.current;
    const next = { ...current, [photoType]: nextPhotos };
    const retainedIds = new Set(
      Object.values(next)
        .flat()
        .map((photo) => photo.id),
    );
    Object.values(current)
      .flat()
      .filter((photo) => !retainedIds.has(photo.id))
      .forEach((photo) => URL.revokeObjectURL(photo.previewUrl));
    selectedPhotosRef.current = next;
    setSelectedPhotos(next);
  };

  const handleFileSelection = (
    photoType: JobPhotoType,
    event: ChangeEvent<HTMLInputElement>,
    replace = false,
  ) => {
    const selectedFiles = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (selectedFiles.length === 0) return;

    const target = replace ? replaceTargetRef.current : null;
    if (replace || replaceTargetRef.current) replaceTargetRef.current = null;
    const isReplace = target?.photoType === photoType;
    const currentSelection = selectedPhotosRef.current[photoType];
    const persistedCount = persistedCounts[photoType];
    const availableSlots = Math.max(
      0,
      REQUIRED_PHOTOS_PER_TYPE - persistedCount - currentSelection.length,
    );
    const issues: string[] = [];
    const validFiles: File[] = [];

    for (const file of selectedFiles) {
      if (!ALLOWED_FILE_TYPES.has(file.type)) {
        issues.push(`${file.name}: use a JPEG, PNG, or WebP image.`);
      } else if (file.size > MAX_FILE_SIZE) {
        issues.push(`${file.name}: maximum file size is 5 MB.`);
      } else {
        validFiles.push(file);
      }
    }

    if (isReplace) {
      const replacementFile = validFiles[0];
      if (!replacementFile) {
        if (issues.length > 0) toast.error(issues.join(" "));
        return;
      }
      if (validFiles.length > 1) {
        issues.push("Only the first valid image was used to replace this photo.");
      }
      const duplicate = currentSelection.some(
        (photo) =>
          photo.id === getFileId(replacementFile) && photo.id !== target.id,
      );
      if (duplicate) {
        issues.push(`${replacementFile.name}: this file is already selected.`);
      } else {
        const replacement: PendingPhoto = {
          id: getFileId(replacementFile),
          file: replacementFile,
          photoType,
          previewUrl: URL.createObjectURL(replacementFile),
        };
        replaceSelection(
          photoType,
          currentSelection.map((photo) =>
            photo.id === target.id ? replacement : photo,
          ),
        );
      }
    } else {
      const accepted: PendingPhoto[] = [];
      const fingerprints = new Set(
        currentSelection.map((photo) => photo.id),
      );
      for (const [index, file] of validFiles.entries()) {
        const id = getFileId(file);
        if (fingerprints.has(id)) {
          issues.push(`${file.name}: this file is already selected.`);
          continue;
        }
        if (accepted.length >= availableSlots) {
          issues.push(
            `${validFiles.length - index} selected ${photoType} photo(s) were not added; only ${availableSlots} more can be selected.`,
          );
          break;
        }
        fingerprints.add(id);
        accepted.push({
          id,
          file,
          photoType,
          previewUrl: URL.createObjectURL(file),
        });
      }
      if (accepted.length > 0) {
        replaceSelection(photoType, [...currentSelection, ...accepted]);
      }
    }

    if (issues.length > 0) toast.error(issues.join(" "));
    if (uploadStatus[photoType] !== "uploaded") {
      setUploadStatus((current) => ({ ...current, [photoType]: "idle" }));
    }
    setUploadError("");
  };

  const removeSelectedPhoto = (photoType: JobPhotoType, id: string) => {
    replaceSelection(
      photoType,
      selectedPhotosRef.current[photoType].filter((photo) => photo.id !== id),
    );
    setUploadStatus((current) => ({ ...current, [photoType]: "idle" }));
    setUploadError("");
  };

  const startReplacingPhoto = (photoType: JobPhotoType, id: string) => {
    replaceTargetRef.current = { photoType, id };
    replaceInputRefs.current[photoType]?.click();
  };

  const acquireLocation = () => {
    setGpsError("");
    setGps(null);
    if (!navigator.geolocation) {
      setGpsError("This browser does not support location services.");
      return;
    }

    setIsLocating(true);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        setGps({
          latitude: position.coords.latitude,
          longitude: position.coords.longitude,
          accuracy: position.coords.accuracy,
        });
        setIsLocating(false);
      },
      (error) => {
        setGpsError(getGeolocationError(error));
        setIsLocating(false);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
  };

  const setCurrentLocationAsATMLocation = () => {
    if (
      !atm ||
      atm.locationConfigured ||
      !gps ||
      setATMLocationMutation.isPending
    ) {
      return;
    }

    setATMLocationMutation.mutate(
      {
        atmId: atm._id,
        jobId: job._id,
        data: {
          latitude: gps.latitude,
          longitude: gps.longitude,
          accuracy: gps.accuracy,
        },
      },
      {
        onSuccess: () => toast.success("ATM location configured successfully."),
        onError: (error) => {
          if (isAxiosError(error) && error.response?.status === 403) {
            toast.error(
              "You are not assigned to this ATM. Ask an administrator to assign this ATM to you.",
            );
            return;
          }
          toast.error(getApiErrorMessage(error));
        },
      },
    );
  };

  const refreshPersistedEvidence = async () => {
    await queryClient.refetchQueries({
      queryKey: ["job", job._id],
      exact: true,
    });
    const refreshedJob = queryClient.getQueryData<Job>(["job", job._id]);
    const refreshedCounts = refreshedJob
      ? {
          before: getValidPhotoCount(refreshedJob.beforePhotos, "before"),
          after: getValidPhotoCount(refreshedJob.afterPhotos, "after"),
        }
      : EMPTY_COUNTS;
    if (refreshedJob) {
      setConfirmedCounts((current) => ({
        before: Math.max(
          current.before,
          refreshedCounts.before,
        ),
        after: Math.max(
          current.after,
          refreshedCounts.after,
        ),
      }));
    }
    return refreshedCounts;
  };

  const uploadSelectedPhotos = async () => {
    if (uploadLockRef.current || !selectionsComplete || evidenceComplete) {
      return;
    }
    const confirmedDuringUpload = { ...persistedCounts };
    uploadLockRef.current = true;
    setIsUploading(true);
    setUploadError("");

    try {
      for (const { type } of photoTypes) {
        const currentJob =
          queryClient.getQueryData<Job>(["job", job._id]) ?? job;
        const currentCount = Math.max(
          confirmedDuringUpload[type],
          getValidPhotoCount(
            type === "before"
              ? currentJob.beforePhotos
              : currentJob.afterPhotos,
            type,
          ),
        );
        const remaining = Math.max(0, REQUIRED_PHOTOS_PER_TYPE - currentCount);
        if (remaining === 0) {
          setUploadStatus((current) => ({ ...current, [type]: "uploaded" }));
          continue;
        }

        const files = selectedPhotosRef.current[type]
          .slice(0, remaining)
          .map((photo) => photo.file);
        if (files.length !== remaining) {
          throw new Error(
            `Select ${remaining} more ${type} photo(s) before uploading.`,
          );
        }

        setUploadStatus((current) => ({ ...current, [type]: "uploading" }));
        setActiveUpload({
          photoType: type,
          fileCount: files.length,
          persistedCount: currentCount,
        });
        const response = await uploadMutation.mutateAsync({
          jobId: job._id,
          files,
          photoType: type,
          onProgress: (progress) =>
            setActiveUpload({
              photoType: type,
              fileCount: files.length,
              persistedCount: currentCount,
              progress,
            }),
        });

        const totalForType =
          type === "before" ? response.totalBefore : response.totalAfter;
        if (
          response.photos.length !== files.length ||
          response.photos.some(
            (photo) => !photo || photo.photoType !== type,
          ) ||
          totalForType < REQUIRED_PHOTOS_PER_TYPE
        ) {
          throw new Error(
            `The server did not confirm all required ${type} photos. Refresh the job and retry any missing photos.`,
          );
        }

        setConfirmedCounts((current) => ({
          ...current,
          [type]: Math.max(current[type], totalForType),
        }));
        confirmedDuringUpload[type] = Math.max(
          confirmedDuringUpload[type],
          totalForType,
        );
        replaceSelection(type, []);
        setUploadStatus((current) => ({ ...current, [type]: "uploaded" }));
        const refreshedCounts = await refreshPersistedEvidence();
        confirmedDuringUpload.before = Math.max(
          confirmedDuringUpload.before,
          refreshedCounts.before,
        );
        confirmedDuringUpload.after = Math.max(
          confirmedDuringUpload.after,
          refreshedCounts.after,
        );
      }

      setActiveUpload(null);
      const finalCounts: PhotoCounts = {
        before: Math.max(
          confirmedDuringUpload.before,
          getValidPhotoCount(job.beforePhotos, "before"),
          getValidPhotoCount(
            queryClient.getQueryData<Job>(["job", job._id])?.beforePhotos,
            "before",
          ),
        ),
        after: Math.max(
          confirmedDuringUpload.after,
          getValidPhotoCount(job.afterPhotos, "after"),
          getValidPhotoCount(
            queryClient.getQueryData<Job>(["job", job._id])?.afterPhotos,
            "after",
          ),
        ),
      };
      if (
        finalCounts.before >= REQUIRED_PHOTOS_PER_TYPE &&
        finalCounts.after >= REQUIRED_PHOTOS_PER_TYPE
      ) {
        setConfirmedCounts(finalCounts);
        toast.success("All required Before and After photos are uploaded.");
      } else {
        throw new Error(
          "The uploaded photos could not be confirmed. Refresh the job before retrying.",
        );
      }
    } catch (error) {
      const message = getApiErrorMessage(error);
      setActiveUpload(null);
      setUploadStatus((current) => ({
        ...current,
        ...(current.before === "uploading" ? { before: "failed" } : {}),
        ...(current.after === "uploading" ? { after: "failed" } : {}),
      }));
      try {
        const refreshedCounts = await refreshPersistedEvidence();
        confirmedDuringUpload.before = Math.max(
          confirmedDuringUpload.before,
          refreshedCounts.before,
        );
        confirmedDuringUpload.after = Math.max(
          confirmedDuringUpload.after,
          refreshedCounts.after,
        );
        for (const { type } of photoTypes) {
          if (
            confirmedDuringUpload[type] >= REQUIRED_PHOTOS_PER_TYPE &&
            selectedPhotosRef.current[type].length > 0
          ) {
            replaceSelection(type, []);
            setUploadStatus((current) => ({
              ...current,
              [type]: "uploaded",
            }));
          }
        }
        if (
          confirmedDuringUpload.before >= REQUIRED_PHOTOS_PER_TYPE &&
          confirmedDuringUpload.after >= REQUIRED_PHOTOS_PER_TYPE
        ) {
          setUploadError("");
          setUploadStatus({ before: "uploaded", after: "uploaded" });
          toast.success("All required Before and After photos are uploaded.");
          return;
        }
        setUploadError(message);
        toast.error(message);
      } catch {
        const refreshError = `${message} The saved photo status could not be refreshed; reload the job before retrying.`;
        setUploadError(refreshError);
        toast.error(refreshError);
      }
    } finally {
      uploadLockRef.current = false;
      setIsUploading(false);
    }
  };

  const completeJob = () => {
    if (!gps || !canComplete || completeMutation.isPending) return;
    completeMutation.mutate(
      {
        jobId: job._id,
        data: {
          gps: {
            latitude: gps.latitude,
            longitude: gps.longitude,
            accuracy: gps.accuracy,
          },
        },
      },
      {
        onSuccess: () => {
          setIsCompleteDialogOpen(false);
          toast.success("Job completed successfully.");
        },
        onError: (error) => toast.error(getApiErrorMessage(error)),
      },
    );
  };

  return (
    <Card className="min-w-0 overflow-hidden">
      <CardHeader className="p-4 sm:p-6">
        <CardTitle>Field Work</CardTitle>
      </CardHeader>
      <CardContent className="min-w-0 space-y-6 p-4 pt-0 sm:p-6 sm:pt-0">
        <section className="min-w-0 space-y-3" aria-labelledby="job-gps-heading">
          <div>
            <h2
              id="job-gps-heading"
              className="flex items-center gap-2 text-sm font-semibold"
            >
              <MapPin className="size-4 shrink-0" aria-hidden="true" />
              GPS location
            </h2>
            <p className="mt-1 text-sm text-muted-foreground">
              The server checks your submitted location against the ATM before
              completing the job.
            </p>
          </div>
          <Button
            type="button"
            variant="outline"
            className="min-h-11 w-full sm:w-auto"
            onClick={acquireLocation}
            disabled={isLocating || setATMLocationMutation.isPending}
          >
            {isLocating ? (
              <LoaderCircle className="animate-spin" />
            ) : (
              <MapPin />
            )}
            {isLocating
              ? "Getting location..."
              : gps
                ? "Refresh location"
                : "Get current location"}
          </Button>
          {gpsError && (
            <p role="alert" className="break-words text-sm text-destructive">
              {gpsError}
            </p>
          )}
          {!hasAtmCoordinates && (
            <p role="status" className="break-words text-sm text-destructive">
              ATM location is not configured. Acquire your current location and
              set it as the ATM location before completing this job.
            </p>
          )}
          {gps && (
            <div
              className="min-w-0 break-words rounded-md border bg-muted/30 p-3 text-sm"
              role="status"
            >
              <p>Location acquired · accuracy ±{Math.round(gps.accuracy)} m</p>
              {distance !== null && (
                <p
                  className={
                    withinRadius
                      ? "mt-1 font-medium text-emerald-700"
                      : "mt-1 font-medium text-destructive"
                  }
                >
                  {distance} m from ATM ·{" "}
                  {withinRadius ? "Within 20 m" : "Outside 20 m"}
                </p>
              )}
              {gps.accuracy > 20 && (
                <p className="mt-1 text-muted-foreground">
                  GPS accuracy is low. Retry from a location with a clearer
                  signal if possible.
                </p>
              )}
            </div>
          )}
          {atm && !atm.locationConfigured && gps && (
            <Button
              type="button"
              className="min-h-11 w-full sm:w-auto"
              onClick={setCurrentLocationAsATMLocation}
              disabled={setATMLocationMutation.isPending}
            >
              {setATMLocationMutation.isPending ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <MapPin />
              )}
              {setATMLocationMutation.isPending
                ? "Setting ATM location..."
                : "Set Current Location as ATM Location"}
            </Button>
          )}
        </section>

        <section className="min-w-0 space-y-4 border-t pt-5">
          <div>
            <h2 className="text-sm font-semibold">Cleaning photos</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              Select three Before and three After photos. Review the previews,
              then upload both groups.
            </p>
          </div>

          {photoTypes.map(({ type, title }) => {
            const selected = selectedPhotos[type];
            const persistedCount = persistedCounts[type];
            const displayedCount = Math.min(
              REQUIRED_PHOTOS_PER_TYPE,
              persistedCount + selected.length,
            );
            const canSelectMore =
              persistedCount + selected.length < MAX_PHOTOS_PER_TYPE;
            const status = uploadStatus[type];
            const currentUpload = activeUpload?.photoType === type;
            const pickerLabel =
              type === "before" ? "Before" : "After";

            return (
              <section
                key={type}
                className="min-w-0 space-y-3 rounded-lg border p-3 sm:p-4"
                aria-labelledby={`${type}-photos-heading`}
              >
                <div className="flex min-w-0 flex-wrap items-baseline justify-between gap-2">
                  <h3
                    id={`${type}-photos-heading`}
                    className="font-semibold"
                  >
                    {title}
                  </h3>
                  <p className="text-sm text-muted-foreground">
                    {pickerLabel}: {displayedCount}/
                    {REQUIRED_PHOTOS_PER_TYPE}
                  </p>
                </div>

                {!evidenceComplete && (
                  <div className="flex min-w-0 flex-col gap-2 sm:flex-row">
                    <input
                      ref={(node) => {
                        cameraInputRefs.current[type] = node;
                      }}
                      type="file"
                      accept="image/*"
                      capture="environment"
                      multiple
                      className="sr-only"
                      aria-label={`Take ${pickerLabel} photo`}
                      disabled={!canSelectMore || isUploading}
                      onChange={(event) => handleFileSelection(type, event)}
                    />
                    <input
                      ref={(node) => {
                        pickerInputRefs.current[type] = node;
                      }}
                      type="file"
                      accept="image/*"
                      multiple
                      className="sr-only"
                      aria-label={`Choose ${pickerLabel} photos`}
                      disabled={!canSelectMore || isUploading}
                      onChange={(event) => handleFileSelection(type, event)}
                    />
                    <input
                      ref={(node) => {
                        replaceInputRefs.current[type] = node;
                      }}
                      type="file"
                      accept="image/*"
                      className="sr-only"
                      aria-label={`Replace a selected ${pickerLabel} photo`}
                      disabled={isUploading}
                      onChange={(event) => handleFileSelection(type, event, true)}
                    />
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-11 w-full sm:w-auto"
                      disabled={!canSelectMore || isUploading}
                      onClick={() => cameraInputRefs.current[type]?.click()}
                    >
                      <Camera aria-hidden="true" />
                      Take photo
                    </Button>
                    <Button
                      type="button"
                      variant="outline"
                      className="min-h-11 w-full sm:w-auto"
                      disabled={!canSelectMore || isUploading}
                      onClick={() => pickerInputRefs.current[type]?.click()}
                    >
                      <ImagePlus aria-hidden="true" />
                      Choose photos
                    </Button>
                  </div>
                )}

                {selected.length > 0 && (
                  <ul className="grid min-w-0 grid-cols-2 gap-2 min-[420px]:gap-3 sm:grid-cols-3">
                    <AnimatePresence initial={false}>
                      {selected.map((photo) => (
                        <PendingPhotoCard
                          key={photo.id}
                          photo={photo}
                          disabled={isUploading}
                          onRemove={() => removeSelectedPhoto(type, photo.id)}
                          onReplace={() => startReplacingPhoto(type, photo.id)}
                        />
                      ))}
                    </AnimatePresence>
                  </ul>
                )}

                {persistedCount > 0 && (
                  <p className="text-xs text-muted-foreground">
                    {persistedCount} photo(s) already uploaded and saved.
                  </p>
                )}
                {status === "uploaded" && (
                  <p className="flex items-center gap-2 text-sm font-medium text-emerald-700">
                    <Check className="size-4 shrink-0" aria-hidden="true" />
                    {pickerLabel} photos uploaded successfully.
                  </p>
                )}
                {currentUpload && (
                  <motion.p
                    initial={reducedMotion ? false : { opacity: 0, y: 4 }}
                    animate={{ opacity: 1, y: 0 }}
                    className="break-words text-sm font-medium"
                    role="status"
                    aria-live="polite"
                  >
                    <LoaderCircle className="mr-2 inline size-4 animate-spin" />
                    Uploading {pickerLabel} photos:{" "}
                    {activeUpload.persistedCount + activeUpload.fileCount}/
                    {REQUIRED_PHOTOS_PER_TYPE}
                    {activeUpload.progress !== undefined &&
                      ` · ${activeUpload.progress}%`}
                  </motion.p>
                )}
              </section>
            );
          })}

          {!evidenceComplete && uploadError && (
            <p role="alert" className="break-words text-sm text-destructive">
              {uploadError}
            </p>
          )}

          {!evidenceComplete && (
            <Button
              type="button"
              className="min-h-12 w-full sm:w-auto"
              disabled={!selectionsComplete || isUploading}
              onClick={() => void uploadSelectedPhotos()}
            >
              {isUploading ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <Upload aria-hidden="true" />
              )}
              {isUploading ? "Uploading photos..." : "Upload Photos"}
            </Button>
          )}

          <JobPhotoGallery
            beforePhotos={job.beforePhotos}
            afterPhotos={job.afterPhotos}
          />

          <AnimatePresence>
            {evidenceComplete && (
              <motion.div
                initial={reducedMotion ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                exit={reducedMotion ? undefined : { opacity: 0 }}
                transition={{ duration: 0.2 }}
                className="relative overflow-hidden rounded-lg border border-emerald-200 bg-emerald-50 p-4 text-emerald-900"
                role="status"
                aria-live="polite"
              >
                {!reducedMotion && (
                  <div
                    aria-hidden="true"
                    className="pointer-events-none absolute inset-x-1/3 top-0 flex justify-around"
                  >
                    {["bg-emerald-500", "bg-amber-400", "bg-sky-500"].map(
                      (color, index) => (
                        <motion.span
                          key={color}
                          className={`size-2 rounded-sm ${color}`}
                          initial={{ y: -8, opacity: 0 }}
                          animate={{ y: 18 + (index % 2) * 7, opacity: [0, 1, 0] }}
                          transition={{ duration: 0.65, delay: index * 0.08 }}
                        />
                      ),
                    )}
                  </div>
                )}
                <p className="flex items-center gap-2 font-semibold">
                  <CircleCheck className="size-5 shrink-0" aria-hidden="true" />
                  All 3 Before and 3 After photos are uploaded.
                </p>
                <p className="mt-1 text-sm">
                  Acquire your GPS location to complete the job.
                </p>
              </motion.div>
            )}
          </AnimatePresence>
        </section>

        <div className="flex min-w-0 flex-col gap-3 border-t pt-5 sm:flex-row sm:flex-wrap sm:items-center">
          {evidenceComplete && (
            <motion.div
              initial={reducedMotion ? false : { opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ duration: 0.18 }}
            >
              <Button
                type="button"
                className="min-h-12 w-full sm:w-auto"
                disabled={
                  !canComplete ||
                  completeMutation.isPending ||
                  isUploading
                }
                onClick={() => setIsCompleteDialogOpen(true)}
              >
                {completeMutation.isPending ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <CircleCheck />
                )}
                Complete Job
              </Button>
            </motion.div>
          )}
          {!gps && evidenceComplete && (
            <p className="break-words text-sm text-muted-foreground">
              Get your current location to complete this job.
            </p>
          )}
          {gps && !withinRadius && distance !== null && evidenceComplete && (
            <p className="break-words text-sm text-muted-foreground">
              Move within 20 m of the ATM and refresh your location to continue.
            </p>
          )}
        </div>
      </CardContent>

      <Dialog
        open={isCompleteDialogOpen}
        onOpenChange={(open) => {
          if (!completeMutation.isPending) setIsCompleteDialogOpen(open);
        }}
      >
        <DialogContent className="w-[calc(100vw-1rem)] max-w-lg">
          <DialogTitle>Complete this job?</DialogTitle>
          <DialogDescription className="mt-2">
            The server will validate your GPS coordinates. Once completed, you
            cannot continue working on this job unless an authorized user
            changes its status.
          </DialogDescription>
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={completeMutation.isPending}
              onClick={() => setIsCompleteDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
              className="min-h-11"
              disabled={completeMutation.isPending || !canComplete}
              onClick={completeJob}
            >
              {completeMutation.isPending && (
                <LoaderCircle className="animate-spin" />
              )}
              Confirm completion
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
