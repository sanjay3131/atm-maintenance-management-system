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
import {
  useEffect,
  useCallback,
  useRef,
  useState,
  type ChangeEvent,
  type ReactNode,
} from "react";
import { toast } from "sonner";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useSubmitATMLocationRequest } from "@/features/atms/hooks/useATMLocationRequests";
import {
  canSubmitEmployeeATMLocationRequest,
  isAcceptableATMLocationRequestAccuracy,
} from "@/features/atms/atmLocationRequest.utils";
import JobPhotoGallery from "@/features/jobs/components/JobPhotoGallery";
import {
  useCompleteJob,
  useFinalizeJobPhoto,
  useUploadJobPhoto,
} from "../hooks/useJobLifecycle";
import type { Job, JobPhoto } from "../types/job.types";
import {
  getPendingJobPhotoUploads,
  type JobPhotoType,
  type PendingJobPhotoUpload,
} from "../services/jobs.service";
import { EMPLOYEE_REQUIRED_PHOTOS_PER_TYPE } from "../utils/employeeJobDetails.utils";
import {
  employeeErrorMessage,
  employeeLanguageClasses,
  useEmployeeLanguage,
  type EmployeeTranslationKey,
} from "@/features/employee-portal/i18n";
import {
  ImagePreparationError,
  prepareImageForUpload,
} from "../utils/imagePreparation";
import { createFinalizationRetryCoordinator } from "../utils/finalizationRetry";

const REQUIRED_PHOTOS_PER_TYPE = EMPLOYEE_REQUIRED_PHOTOS_PER_TYPE;
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
  clientPhotoId: string;
  file: File;
  photoType: JobPhotoType;
  previewUrl: string;
}

type PhotoSelection = Record<JobPhotoType, PendingPhoto[]>;
type PhotoCounts = Record<JobPhotoType, number>;
type UploadStatus = "idle" | "uploading" | "uploaded" | "failed";
type PendingUploadStatus =
  | "idle"
  | "uploading"
  | "uploaded"
  | "failed"
  | "verification"
  | "finalization-pending";

const EMPTY_SELECTION: PhotoSelection = { before: [], after: [] };

function getApiErrorMessage(
  error: unknown,
  t: ReturnType<typeof useEmployeeLanguage>["t"],
  language: "ta" | "en",
) {
  const fallback = t("The request could not be completed.");
  if (isAxiosError<{ message?: string }>(error)) {
    return employeeErrorMessage(
      error.response?.data?.message || "The request could not be completed.",
      "The request could not be completed.",
      language,
      t,
    );
  }
  return error instanceof Error
    ? employeeErrorMessage(
        error.message,
        "The request could not be completed.",
        language,
        t,
      )
    : fallback;
}

function getGeolocationError(
  error: GeolocationPositionError,
  t: ReturnType<typeof useEmployeeLanguage>["t"],
) {
  if (error.code === error.PERMISSION_DENIED) {
    return t(
      "Location permission is required to continue. Allow location access in your browser and try again.",
    );
  }
  if (error.code === error.POSITION_UNAVAILABLE) {
    return t(
      "Your current location is unavailable. Check your device location settings and retry.",
    );
  }
  if (error.code === error.TIMEOUT) {
    return t(
      "Getting your location took too long. Move to an area with a clear GPS signal and retry.",
    );
  }
  return t("Could not get your location. Please retry.");
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

function isAmbiguousUploadError(error: unknown) {
  return isAxiosError(error) && !error.response;
}

function PendingPhotoCard({
  photo,
  disabled,
  status,
  progress,
  onRemove,
  onReplace,
  t,
}: {
  photo: PendingPhoto;
  disabled: boolean;
  status: PendingUploadStatus;
  progress?: number;
  onRemove: () => void;
  onReplace: () => void;
  t: ReturnType<typeof useEmployeeLanguage>["t"];
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
        alt={t("Preview of {type} photo: {filename}", {
          type: t(photo.photoType === "before" ? "Before" : "After"),
          filename: photo.file.name,
        })}
        className="aspect-square w-full rounded object-cover"
      />
      <p className="mt-2 truncate text-xs font-medium">
        {t(photo.photoType === "before" ? "Before" : "After")} ·{" "}
        {photo.file.name}
      </p>
      {status === "idle" && (
        <p className="mt-1 text-xs text-muted-foreground">
          {t("Waiting to upload")}
        </p>
      )}
      {status === "uploading" && (
        <p className="mt-1 text-xs font-medium" role="status">
          {t("Uploading...")}
          {progress !== undefined ? ` ${progress}%` : ""}
        </p>
      )}
      {status === "failed" && (
        <p className="mt-1 text-xs font-medium text-destructive">
          {t("Retry")}
        </p>
      )}
      {status === "verification" && (
        <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-300">
          {t("Photo upload requires verification before retrying.")}
        </p>
      )}
      {status === "finalization-pending" && (
        <p className="mt-1 text-xs font-medium text-amber-700 dark:text-amber-300">
          {t("Uploaded; finalization is pending.")}
        </p>
      )}
      <div className="mt-2 grid grid-cols-2 gap-2">
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="min-h-11 min-w-0 px-2 
          "
          disabled={disabled}
          onClick={onReplace}
        >
          <Replace aria-hidden="true" />
          {t("Replace")}
        </Button>
        <Button
          type="button"
          size="sm"
          variant="outline"
          className="min-h-11 min-w-0 px-2"
          aria-label={t("Remove {filename}", { filename: photo.file.name })}
          disabled={disabled}
          onClick={onRemove}
        >
          <Trash2 aria-hidden="true" />
          {t("Remove")}
        </Button>
      </div>
    </motion.li>
  );
}

interface EmployeeFieldWorkPanelProps {
  job: Job;
  workDescription?: ReactNode;
  materials?: ReactNode;
  onPendingSelectionChange?: (hasPendingSelection: boolean) => void;
}

export default function EmployeeFieldWorkPanel({
  job,
  workDescription,
  materials,
  onPendingSelectionChange,
}: EmployeeFieldWorkPanelProps) {
  const { t, language } = useEmployeeLanguage();
  const queryClient = useQueryClient();
  const reducedMotion = useReducedMotion();
  const [gps, setGps] = useState<GpsPosition | null>(null);
  const [gpsError, setGpsError] = useState("");
  const [isLocating, setIsLocating] = useState(false);
  const [selectedPhotos, setSelectedPhotos] =
    useState<PhotoSelection>(EMPTY_SELECTION);
  const selectedPhotosRef = useRef<PhotoSelection>(EMPTY_SELECTION);
  const [uploadStatus, setUploadStatus] = useState<
    Record<JobPhotoType, UploadStatus>
  >({ before: "idle", after: "idle" });
  const [uploadErrors, setUploadErrors] = useState<
    Record<JobPhotoType, string>
  >({ before: "", after: "" });
  const [activeUpload, setActiveUpload] = useState<{
    photoType: JobPhotoType;
    photoId: string;
    persistedCount: number;
    progress?: number;
  } | null>(null);
  const [isUploading, setIsUploading] = useState(false);
  const uploadLockRef = useRef(false);
  const [pendingUploadStatuses, setPendingUploadStatuses] = useState<
    Record<string, PendingUploadStatus>
  >({});
  const [pendingIntentRecords, setPendingIntentRecords] = useState<
    PendingJobPhotoUpload[]
  >([]);
  const [preparingPhotoType, setPreparingPhotoType] =
    useState<JobPhotoType | null>(null);
  const preparationLockRef = useRef(false);
  const preparationAbortRef = useRef<AbortController | null>(null);
  const isMountedRef = useRef(true);
  const [isCompleteDialogOpen, setIsCompleteDialogOpen] = useState(false);
  const [expandedStep, setExpandedStep] = useState<
    "location" | "before" | "after" | "review" | null
  >("before");
  const cameraInputRefs = useRef<Record<JobPhotoType, HTMLInputElement | null>>(
    { before: null, after: null },
  );
  const pickerInputRefs = useRef<Record<JobPhotoType, HTMLInputElement | null>>(
    { before: null, after: null },
  );
  const replaceInputRefs = useRef<
    Record<JobPhotoType, HTMLInputElement | null>
  >({ before: null, after: null });
  const replaceTargetRef = useRef<{
    photoType: JobPhotoType;
    id: string;
  } | null>(null);
  const uploadMutation = useUploadJobPhoto();
  const finalizeMutation = useFinalizeJobPhoto();
  const completeMutation = useCompleteJob();
  const locationRequestMutation = useSubmitATMLocationRequest();
  const finalizationCoordinatorRef = useRef(
    createFinalizationRetryCoordinator(),
  );
  const [finalizingIntentId, setFinalizingIntentId] = useState<string | null>(
    null,
  );

  useEffect(() => {
    isMountedRef.current = true;
    return () => {
      isMountedRef.current = false;
      preparationAbortRef.current?.abort();
      Object.values(selectedPhotosRef.current)
        .flat()
        .forEach((photo) => {
          URL.revokeObjectURL(photo.previewUrl);
        });
        onPendingSelectionChange?.(false);
    };
  }, [onPendingSelectionChange]);

  useEffect(() => {
    let active = true;
    void getPendingJobPhotoUploads(job._id)
      .then((records) => {
        if (active) {
          setPendingIntentRecords(
            Array.from(
              new Map(records.map((record) => [record.clientPhotoId, record])).values(),
            ),
          );
        }
      })
      .catch(() => {
        if (active) setPendingIntentRecords([]);
      });
    return () => {
      active = false;
    };
  }, [job._id]);

  const finalizePendingIntent = useCallback(async (
    uploadIntentId: string,
    photoType?: JobPhotoType,
    photoId?: string,
    retry = false,
  ) => {
    const coordinator = finalizationCoordinatorRef.current;
    if (coordinator.isLocked()) return false;
    if (isMountedRef.current) setFinalizingIntentId(uploadIntentId);
    try {
      const attempt = (intentId: string) =>
        finalizeMutation.mutateAsync({
          jobId: job._id,
          uploadIntentId: intentId,
        });
      const finalized = retry
        ? await coordinator.retry(uploadIntentId, attempt)
        : await coordinator.run(uploadIntentId, attempt);
      if (!finalized) return false;
      if (isMountedRef.current) {
        setPendingIntentRecords((current) =>
          current.filter((record) => record.uploadIntentId !== uploadIntentId),
        );
        if (photoId && photoType) {
          setPendingUploadStatuses((current) => ({
            ...current,
            [photoId]: "uploaded",
          }));
          setUploadStatus((current) => ({
            ...current,
            [photoType]: "uploaded",
          }));
        }
      }
      return finalized;
    } finally {
      if (isMountedRef.current) setFinalizingIntentId(null);
    }
  }, [finalizeMutation, job._id]);

  const retryPendingFinalization = useCallback(
    (record: PendingJobPhotoUpload) => {
      if (
        record.state !== "uploaded" ||
        finalizationCoordinatorRef.current.isLocked()
      ) {
        return;
      }
      void finalizePendingIntent(record.uploadIntentId, undefined, undefined, true);
    },
    [finalizePendingIntent],
  );

  useEffect(() => {
    let active = true;
    const records = pendingIntentRecords.filter(
      (record) =>
        record.state === "uploaded" &&
        !finalizationCoordinatorRef.current.hasAttempted(record.uploadIntentId),
    );
    void (async () => {
      for (const record of records) {
        if (!active) break;
        finalizationCoordinatorRef.current.markAttempted(record.uploadIntentId);
        try {
          await finalizePendingIntent(record.uploadIntentId);
        } catch {
          // Keep the uploaded intent visible for a later explicit retry.
        }
      }
    })();
    return () => {
      active = false;
    };
  }, [finalizePendingIntent, job._id, pendingIntentRecords]);

  const atm = typeof job.atmId === "object" && job.atmId ? job.atmId : null;
  const coordinates = atm?.location?.coordinates;
  const hasAtmCoordinates = Boolean(
    atm?.locationConfigured &&
    coordinates?.length === 2 &&
    Number.isFinite(coordinates[0]) &&
    Number.isFinite(coordinates[1]),
  );
  const persistedCounts: PhotoCounts = {
    before: getValidPhotoCount(job.beforePhotos, "before"),
    after: getValidPhotoCount(job.afterPhotos, "after"),
  };
  const photoTypes: Array<{
    type: JobPhotoType;
    title: EmployeeTranslationKey;
  }> = [
    { type: "before", title: "Before photos" },
    { type: "after", title: "After photos" },
  ];
  const evidenceComplete = photoTypes.every(
    ({ type }) => persistedCounts[type] >= REQUIRED_PHOTOS_PER_TYPE,
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
  const isPreparing = preparingPhotoType !== null;

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
    onPendingSelectionChange?.(
      Object.values(next).some((photos) => photos.length > 0),
    );
  };

  const handleFileSelection = async (
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
    if (preparationLockRef.current) return;
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
        issues.push(
          t("{filename}: use a JPEG, PNG, or WebP image.", {
            filename: file.name,
          }),
        );
      } else if (file.size > MAX_FILE_SIZE) {
        issues.push(
          t("{filename}: maximum file size is 5 MB.", {
            filename: file.name,
          }),
        );
      } else {
        validFiles.push(file);
      }
    }

    if (isReplace && !validFiles[0]) {
      if (issues.length > 0) toast.error(issues.join(" "));
      return;
    }
    if (!isReplace && validFiles.length === 0) {
      if (issues.length > 0) toast.error(issues.join(" "));
      return;
    }
    if (isReplace && validFiles.length > 1) {
      issues.push(t("Only the first valid image was used to replace this photo."));
    }

    preparationLockRef.current = true;
    preparationAbortRef.current = new AbortController();
    setPreparingPhotoType(photoType);
    try {
      const filesToPrepare = isReplace ? validFiles.slice(0, 1) : validFiles;
      const accepted: PendingPhoto[] = [];
      const fingerprints = new Set(currentSelection.map((photo) => photo.id));

      for (const [index, file] of filesToPrepare.entries()) {
        if (!isReplace && accepted.length >= availableSlots) {
          issues.push(
            t(
              "{count} selected {type} photo(s) were not added; only {slots} more can be selected.",
              {
                count: validFiles.length - index,
                type: t(photoType === "before" ? "Before" : "After"),
                slots: availableSlots,
              },
            ),
          );
          break;
        }

        const preparedFile = await prepareImageForUpload(file, {
          signal: preparationAbortRef.current.signal,
        });
        if (!isMountedRef.current) return;
        const id = getFileId(preparedFile);
        const duplicate = fingerprints.has(id);
        if (duplicate && (!isReplace || id !== target?.id)) {
          issues.push(
            t("{filename}: this file is already selected.", {
              filename: file.name,
            }),
          );
          continue;
        }
        fingerprints.add(id);
        accepted.push({
          id,
          clientPhotoId: crypto.randomUUID(),
          file: preparedFile,
          photoType,
          previewUrl: URL.createObjectURL(preparedFile),
        });
      }

      if (isReplace && accepted[0] && target) {
        replaceSelection(
          photoType,
          currentSelection.map((photo) =>
            photo.id === target.id ? accepted[0] : photo,
          ),
        );
      } else if (!isReplace && accepted.length > 0) {
        replaceSelection(photoType, [...currentSelection, ...accepted]);
      }
    } catch (error) {
      if (isMountedRef.current && error instanceof ImagePreparationError) {
        issues.push(t("The selected image could not be prepared for upload."));
      } else if (isMountedRef.current) {
        issues.push(t("The selected image could not be prepared for upload."));
      }
    } finally {
      if (isMountedRef.current) {
        setPreparingPhotoType(null);
        if (issues.length > 0) toast.error(issues.join(" "));
        setUploadStatus((current) => ({ ...current, [photoType]: "idle" }));
        setUploadErrors((current) => ({ ...current, [photoType]: "" }));
      }
      preparationAbortRef.current = null;
      preparationLockRef.current = false;
    }
  };

  const removeSelectedPhoto = (photoType: JobPhotoType, id: string) => {
    replaceSelection(
      photoType,
      selectedPhotosRef.current[photoType].filter((photo) => photo.id !== id),
    );
    setUploadStatus((current) => ({ ...current, [photoType]: "idle" }));
    setUploadErrors((current) => ({ ...current, [photoType]: "" }));
  };

  const startReplacingPhoto = (photoType: JobPhotoType, id: string) => {
    replaceTargetRef.current = { photoType, id };
    replaceInputRefs.current[photoType]?.click();
  };

  const acquireLocation = () => {
    setGpsError("");
    setGps(null);
    if (!navigator.geolocation) {
      setGpsError(t("This browser does not support location services."));
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
        setExpandedStep(
          persistedCounts.before < REQUIRED_PHOTOS_PER_TYPE
            ? "before"
            : persistedCounts.after < REQUIRED_PHOTOS_PER_TYPE
              ? "after"
              : "review",
        );
        setIsLocating(false);
      },
      (error) => {
        setGpsError(getGeolocationError(error, t));
        setIsLocating(false);
      },
      { enableHighAccuracy: true, maximumAge: 0, timeout: 15000 },
    );
  };

  const submitCurrentLocationForReview = () => {
    if (
      !atm ||
      !canSubmitEmployeeATMLocationRequest(atm) ||
      !gps ||
      locationRequestMutation.isPending
    ) {
      return;
    }
    if (!isAcceptableATMLocationRequestAccuracy(gps.accuracy)) {
      setGpsError(
        t(
          "GPS accuracy must be 50 meters or better. Retry GPS capture in a clearer area before submitting the location request.",
        ),
      );
      return;
    }

    void locationRequestMutation
      .mutateAsync({
        atmId: atm._id,
        latitude: gps.latitude,
        longitude: gps.longitude,
        accuracy: gps.accuracy,
        inputSource: "GPS",
      })
      .then(() =>
        toast.success(t("ATM location request submitted for review.")),
      )
      .catch((error) => {
        if (isAxiosError(error) && error.response?.status === 403) {
          toast.error(
            t(
              "You are not assigned to this ATM. Ask an administrator to assign this ATM to you.",
            ),
          );
          return;
        }
        toast.error(getApiErrorMessage(error, t, language));
      });
  };

  const uploadSelectedPhotos = async (type: JobPhotoType) => {
    if (uploadLockRef.current || evidenceComplete) return;
    uploadLockRef.current = true;
    setIsUploading(true);
    setUploadErrors((current) => ({ ...current, [type]: "" }));

    try {
      while (true) {
        const currentJob =
          queryClient.getQueryData<Job>(["job", job._id]) ?? job;
        const currentCount = Math.max(
          persistedCounts[type],
          getValidPhotoCount(
            type === "before"
              ? currentJob.beforePhotos
              : currentJob.afterPhotos,
            type,
          ),
        );
        if (currentCount >= REQUIRED_PHOTOS_PER_TYPE) break;

        const pendingPhoto = selectedPhotosRef.current[type].find(
          (photo) =>
            pendingUploadStatuses[photo.id] !== "verification" &&
          pendingUploadStatuses[photo.id] !== "uploading" &&
          pendingUploadStatuses[photo.id] !== "finalization-pending",
        );
        if (!pendingPhoto) break;

        setPendingUploadStatuses((current) => ({
          ...current,
          [pendingPhoto.id]: "uploading",
        }));
        setUploadStatus((current) => ({ ...current, [type]: "uploading" }));
        setActiveUpload({
          photoType: type,
          photoId: pendingPhoto.id,
          persistedCount: currentCount,
        });

        try {
          const response = await uploadMutation.mutateAsync({
            jobId: job._id,
            files: [pendingPhoto.file],
            photoType: type,
            clientPhotoId: pendingPhoto.clientPhotoId,
            onProgress: (progress) =>
              setActiveUpload((current) =>
                current?.photoId === pendingPhoto.id
                  ? {
                      ...current,
                      progress,
                    }
                  : current,
              ),
          });
          if (
            !["uploaded", "finalized"].includes(response.status) ||
            response.clientPhotoId !== pendingPhoto.clientPhotoId ||
            !response.uploadIntentId ||
            (response.status === "uploaded" &&
              response.finalizationPending !== true) ||
            (response.status === "finalized" &&
              response.finalizationPending !== false)
          ) {
            throw new Error(
              t(
                "The server could not confirm the uploaded {type} photo. Verify the upload before retrying.",
                {
                  type: t(type === "before" ? "Before" : "After"),
                },
              ),
            );
          }

          setPendingUploadStatuses((current) => ({
            ...current,
            [pendingPhoto.id]:
              response.status === "finalized"
                ? "uploaded"
                : "finalization-pending",
          }));
          setUploadStatus((current) => ({ ...current, [type]: "uploaded" }));
          setActiveUpload(null);
          if (response.status === "finalized") {
            setPendingIntentRecords((current) =>
              current.filter(
                (record) =>
                  record.uploadIntentId !== response.uploadIntentId,
              ),
            );
            toast.success(
              t("{type} photos uploaded successfully.", {
                type: t(type === "before" ? "Before" : "After"),
              }),
            );
          } else {
            const finalized = await finalizePendingIntent(
              response.uploadIntentId,
              type,
              pendingPhoto.id,
            );
            toast.success(
              finalized
                ? t("{type} photos uploaded successfully.", {
                    type: t(type === "before" ? "Before" : "After"),
                  })
                : t("{type} photo uploaded; finalization is pending.", {
                    type: t(type === "before" ? "Before" : "After"),
                  }),
            );
          }
          continue;
        } catch (error) {
          setActiveUpload(null);
          const ambiguous =
            isAmbiguousUploadError(error) ||
            (error instanceof Error &&
              error.message.includes("could not confirm"));
          setPendingUploadStatuses((current) => ({
            ...current,
            [pendingPhoto.id]: ambiguous ? "verification" : "failed",
          }));
          setUploadStatus((current) => ({ ...current, [type]: "failed" }));
          const message = ambiguous
            ? t("Photo upload response was not confirmed. Verify the saved photo before retrying.")
            : getApiErrorMessage(error, t, language);
          setUploadErrors((current) => ({ ...current, [type]: message }));
          toast.error(message);
          break;
        }
      }
    } catch (error) {
      const message = getApiErrorMessage(error, t, language);
      setActiveUpload(null);
      setUploadStatus((current) => ({
        ...current,
        [type]: "failed",
      }));
      setUploadErrors((current) => ({ ...current, [type]: message }));
      toast.error(message);
    } finally {
      setActiveUpload(null);
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
          toast.success(t("Job completed successfully."));
        },
        onError: (error) => toast.error(getApiErrorMessage(error, t, language)),
      },
    );
  };

  const renderPhotoSection = ({ type, title }: (typeof photoTypes)[number]) => {
    const selected = selectedPhotos[type];
    const persistedCount = persistedCounts[type];
    const canSelectMore =
      persistedCount + selected.length < MAX_PHOTOS_PER_TYPE;
    const status = uploadStatus[type];
    const currentUpload = activeUpload?.photoType === type;
    const pickerLabel = t(type === "before" ? "Before" : "After");
    const uploadLabel =
      type === "before" ? "Upload Before Photos" : "Upload After Photos";

    return (
      <details
        key={type}
        open={expandedStep === type}
        onToggle={(event) => {
          if (event.currentTarget.open) setExpandedStep(type);
          else if (expandedStep === type) setExpandedStep(null);
        }}
        className="min-w-0 border-b border-border last:border-b-0"
      >
        <summary className="flex min-h-12 cursor-pointer flex-wrap items-center justify-between gap-2 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
          <span>{t(title)}</span>
          <span className="flex flex-wrap items-center gap-x-2 text-xs font-normal tabular-nums text-muted-foreground">
            <span>
              {t("{count}/{required} saved", {
                count: Math.min(REQUIRED_PHOTOS_PER_TYPE, persistedCount),
                required: REQUIRED_PHOTOS_PER_TYPE,
              })}
            </span>
            {selected.length > 0 && (
              <span>{t("{count} selected", { count: selected.length })}</span>
            )}
          </span>
        </summary>
        <div className="space-y-3 pb-4 pt-2">
          {persistedCount < REQUIRED_PHOTOS_PER_TYPE && (
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
                aria-label={t("Take {type} photo", { type: pickerLabel })}
                disabled={!canSelectMore || isUploading || isPreparing}
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
                aria-label={t("Choose {type} photos", { type: pickerLabel })}
                disabled={!canSelectMore || isUploading || isPreparing}
                onChange={(event) => handleFileSelection(type, event)}
              />
              <input
                ref={(node) => {
                  replaceInputRefs.current[type] = node;
                }}
                type="file"
                accept="image/*"
                className="sr-only"
                aria-label={t("Replace a selected {type} photo", {
                  type: pickerLabel,
                })}
                disabled={isUploading || isPreparing}
                onChange={(event) => handleFileSelection(type, event, true)}
              />
              <Button
                type="button"
                variant="outline"
                className={employeeLanguageClasses(
                  language,
                  "min-h-11 w-full sm:w-auto",
                  "min-h-11 h-auto w-full whitespace-normal py-3 leading-5 sm:w-auto",
                )}
                disabled={!canSelectMore || isUploading || isPreparing}
                onClick={() => cameraInputRefs.current[type]?.click()}
              >
                <Camera aria-hidden="true" />
                {t("Take photo")}
              </Button>
              <Button
                type="button"
                variant="outline"
                className={employeeLanguageClasses(
                  language,
                  "min-h-11 w-full sm:w-auto",
                  "min-h-11 h-auto w-full whitespace-normal py-3 leading-5 sm:w-auto",
                )}
                disabled={!canSelectMore || isUploading || isPreparing}
                onClick={() => pickerInputRefs.current[type]?.click()}
              >
                <ImagePlus aria-hidden="true" />
                {t("Choose photos")}
              </Button>
            </div>
          )}

          {selected.length > 0 && (
            <>
              <p className="text-sm text-muted-foreground" role="status">
                {t("Selected photos are previews only. Upload them to save.")}
              </p>
              <ul className="grid min-w-0 grid-cols-1 gap-2 min-[420px]:gap-3 sm:grid-cols-3">
                <AnimatePresence initial={false}>
                  {selected.map((photo) => (
                    <PendingPhotoCard
                      key={photo.id}
                      photo={photo}
                      disabled={isUploading}
                      status={pendingUploadStatuses[photo.id] ?? "idle"}
                      progress={
                        activeUpload?.photoId === photo.id
                          ? activeUpload.progress
                          : undefined
                      }
                      t={t}
                      onRemove={() => removeSelectedPhoto(type, photo.id)}
                      onReplace={() => startReplacingPhoto(type, photo.id)}
                    />
                  ))}
                </AnimatePresence>
              </ul>
            </>
          )}

          {preparingPhotoType === type && (
            <p className="text-sm font-medium" role="status" aria-live="polite">
              <LoaderCircle className="mr-2 inline size-4 animate-spin" />
              {t("Preparing {type} photos...", { type: pickerLabel })}
            </p>
          )}

          <Button
            type="button"
            className="min-h-12 w-full whitespace-normal sm:w-auto"
            disabled={selected.length === 0 || isUploading || isPreparing}
            onClick={() => void uploadSelectedPhotos(type)}
          >
            {currentUpload ? (
              <LoaderCircle className="animate-spin" aria-hidden="true" />
            ) : (
              <Upload aria-hidden="true" />
            )}
            {currentUpload
              ? t("Uploading {type} photos...", { type: pickerLabel })
              : t(uploadLabel)}
          </Button>

          {uploadErrors[type] && (
            <p
              role="alert"
              className="break-words text-sm text-destructive [overflow-wrap:anywhere]"
            >
              {uploadErrors[type]}
            </p>
          )}
          {status === "uploaded" && selected.length === 0 && (
            <p className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-300">
              <Check className="size-4 shrink-0" aria-hidden="true" />
              {t("{type} photos uploaded successfully.", { type: pickerLabel })}
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
              {t("Uploading...")}
              {activeUpload.progress !== undefined &&
                ` · ${activeUpload.progress}%`}
            </motion.p>
          )}
        </div>
      </details>
    );
  };

  return (
    <Card className="min-w-0 overflow-hidden border-0 shadow-none p-2">
      <CardHeader
        className={`min-w-0 ${employeeLanguageClasses(language, "p-0 pb-2", "p-0 pb-2")}`}
      >
        <CardTitle className="text-base">{t("Field Work")}</CardTitle>
      </CardHeader>
      <CardContent
        className={`min-w-0 ${employeeLanguageClasses(language, "space-y-4 p-0", "space-y-3 p-0")}`}
      >
        {pendingIntentRecords.length > 0 && (
          <div
            className="rounded-md border border-amber-300 bg-amber-50 p-3 text-sm text-amber-900 dark:border-amber-700 dark:bg-amber-950/30 dark:text-amber-100"
            role="status"
          >
            <p className="font-medium">
              {t("Some uploaded photos are awaiting finalization.")}
            </p>
            <ul className="mt-1 list-disc pl-5">
              {pendingIntentRecords.map((record) => (
                <li key={record.clientPhotoId}>
                  <span>
                    {t(record.photoType === "before" ? "Before" : "After")} ·{" "}
                    {record.state === "uploaded"
                      ? t("Uploaded; finalization is pending.")
                      : record.state === "quarantined"
                        ? t("Verification requires administrator attention.")
                        : record.state === "failed"
                          ? t("Upload failed and can be retried.")
                          : t("Upload is being processed.")}
                  </span>
                  {record.state === "uploaded" && (
                    <Button
                      type="button"
                      variant="outline"
                      size="sm"
                      className="ml-2"
                      disabled={finalizingIntentId !== null}
                      onClick={() => retryPendingFinalization(record)}
                    >
                      {finalizingIntentId === record.uploadIntentId
                        ? t("Retrying...")
                        : t("Retry")}
                    </Button>
                  )}
                </li>
              ))}
            </ul>
          </div>
        )}
        <details
          open={expandedStep === "location"}
          onToggle={(event) => {
            if (event.currentTarget.open) setExpandedStep("location");
            else if (expandedStep === "location") setExpandedStep(null);
          }}
          className="border-y border-border"
        >
          <summary className="flex min-h-12 cursor-pointer items-center justify-between gap-3 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            <span className="flex items-center gap-2">
              <MapPin className="size-4 shrink-0" aria-hidden="true" />
              {t("GPS location")}
            </span>
            {gps && withinRadius && (
              <Check
                className="size-4 shrink-0 text-emerald-700 dark:text-emerald-300"
                aria-label={t("Validated")}
              />
            )}
          </summary>
          <div className="space-y-3 pb-4 pt-2">
            <p className="break-words text-sm leading-6 text-muted-foreground [overflow-wrap:anywhere]">
              {t(
                "The server checks your submitted location against the ATM before completing the job.",
              )}
            </p>
            <Button
              type="button"
              variant="outline"
              className={employeeLanguageClasses(
                language,
                "min-h-11 w-full sm:w-auto",
                "min-h-11 h-auto w-full whitespace-normal py-3 leading-5 sm:w-auto",
              )}
              onClick={acquireLocation}
              disabled={isLocating || locationRequestMutation.isPending}
            >
              {isLocating ? (
                <LoaderCircle className="animate-spin" />
              ) : (
                <MapPin />
              )}
              {isLocating
                ? t("Getting location...")
                : gps
                  ? t("Refresh location")
                  : t("Get current location")}
            </Button>
            {gpsError && (
              <p
                role="alert"
                className="break-words text-sm leading-6 text-destructive [overflow-wrap:anywhere]"
              >
                {gpsError}
              </p>
            )}
            {!hasAtmCoordinates && (
              <p
                role="status"
                className="break-words text-sm leading-6 text-destructive [overflow-wrap:anywhere]"
              >
                {t(
                  "ATM location is not configured. Acquire your current location and submit it for Admin or SuperAdmin approval before completing this job.",
                )}
              </p>
            )}
            {gps && (
              <div
                className="min-w-0 break-words bg-muted/40 p-3 text-sm"
                role="status"
              >
                <p className="break-words leading-6 [overflow-wrap:anywhere]">
                  {t("Location acquired · accuracy ±{accuracy} m", {
                    accuracy: Math.round(gps.accuracy),
                  })}
                </p>
                {distance !== null && (
                  <p
                    className={
                      withinRadius
                        ? "mt-1 font-medium text-emerald-700 dark:text-emerald-300"
                        : "mt-1 font-medium text-destructive"
                    }
                  >
                    {distance} m from ATM ·{" "}
                    {t(withinRadius ? "Within 20 m" : "Outside 20 m")}
                  </p>
                )}
                {gps.accuracy > 20 && (
                  <p className="mt-1 text-muted-foreground">
                    {t(
                      "GPS accuracy is low. Retry from a location with a clearer signal if possible.",
                    )}
                  </p>
                )}
                {atm &&
                  canSubmitEmployeeATMLocationRequest(atm) &&
                  !isAcceptableATMLocationRequestAccuracy(gps.accuracy) && (
                    <p className="mt-1 text-destructive" role="alert">
                      {t(
                        "GPS accuracy must be 50 meters or better. Retry GPS capture in a clearer area before submitting the location request.",
                      )}
                    </p>
                  )}
              </div>
            )}
            {atm && canSubmitEmployeeATMLocationRequest(atm) && gps && (
              <Button
                type="button"
                className="min-h-11 w-full whitespace-normal sm:w-auto"
                onClick={submitCurrentLocationForReview}
                disabled={
                  locationRequestMutation.isPending ||
                  !isAcceptableATMLocationRequestAccuracy(gps.accuracy)
                }
              >
                {locationRequestMutation.isPending ? (
                  <LoaderCircle className="animate-spin" />
                ) : (
                  <MapPin />
                )}
                {locationRequestMutation.isPending
                  ? t("Submitting location request...")
                  : t("Submit Current Location for ATM Review")}
              </Button>
            )}
          </div>
        </details>

        <section aria-label={t("Before photos")}>
          {renderPhotoSection(photoTypes[0])}
        </section>

        {workDescription}

        {materials && (
          <section className="border-y border-border py-3">
            <h2 className="mb-2 text-sm font-semibold">
              {t("Materials Used")}
            </h2>
            {materials}
          </section>
        )}

        <section aria-label={t("After photos")}>
          {renderPhotoSection(photoTypes[1])}
        </section>

        <details
          open={expandedStep === "review"}
          onToggle={(event) => {
            if (event.currentTarget.open) setExpandedStep("review");
            else if (expandedStep === "review") setExpandedStep(null);
          }}
          className="border-y border-border"
        >
          <summary className="flex min-h-12 cursor-pointer items-center justify-between gap-3 py-2 text-sm font-semibold focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring">
            {t("Review and complete")}
            {evidenceComplete && (
              <Check
                className="size-4 shrink-0 text-emerald-700 dark:text-emerald-300"
                aria-label={t("Validated")}
              />
            )}
          </summary>
          <div className="space-y-4 pb-4 pt-2">
            {!evidenceComplete && (
              <section
                aria-label={t("Missing photo evidence")}
                className="space-y-2"
              >
                <h3 className="text-sm font-semibold">
                  {t("Missing photo evidence")}
                </h3>
                <ul className="space-y-1 text-sm text-muted-foreground">
                  {photoTypes
                    .filter(
                      ({ type }) =>
                        persistedCounts[type] < REQUIRED_PHOTOS_PER_TYPE,
                    )
                    .map(({ type }) => (
                      <li key={type}>
                        {t(
                          "{type}: {count}/{required} saved; {remaining} remaining",
                          {
                            type: t(type === "before" ? "Before" : "After"),
                            count: Math.min(
                              REQUIRED_PHOTOS_PER_TYPE,
                              persistedCounts[type],
                            ),
                            required: REQUIRED_PHOTOS_PER_TYPE,
                            remaining: Math.max(
                              0,
                              REQUIRED_PHOTOS_PER_TYPE - persistedCounts[type],
                            ),
                          },
                        )}
                      </li>
                    ))}
                </ul>
              </section>
            )}

            <JobPhotoGallery
              beforePhotos={job.beforePhotos}
              afterPhotos={job.afterPhotos}
              compact
              showCounts={false}
            />

            {evidenceComplete && (
              <p
                className="flex items-center gap-2 border-l-2 border-emerald-600 py-2 pl-3 text-sm font-medium"
                role="status"
                aria-live="polite"
              >
                <CircleCheck
                  className="size-5 shrink-0 text-emerald-700 dark:text-emerald-300"
                  aria-hidden="true"
                />
                {t("All 3 Before and 3 After photos are uploaded.")}
              </p>
            )}
            <div className="space-y-3 border-t border-border pt-4">
              {evidenceComplete && (
                <Button
                  type="button"
                  className="min-h-12 w-full sm:w-auto"
                  disabled={
                    !canComplete || completeMutation.isPending || isUploading
                  }
                  onClick={() => setIsCompleteDialogOpen(true)}
                >
                  {completeMutation.isPending ? (
                    <LoaderCircle className="animate-spin" />
                  ) : (
                    <CircleCheck />
                  )}
                  {t("Complete Job")}
                </Button>
              )}
              {!gps && evidenceComplete && (
                <p className="break-words text-sm text-muted-foreground [overflow-wrap:anywhere]">
                  {t("Get your current location to complete this job.")}
                </p>
              )}
              {gps &&
                !withinRadius &&
                distance !== null &&
                evidenceComplete && (
                  <p className="break-words text-sm text-muted-foreground [overflow-wrap:anywhere]">
                    {t(
                      "Move within 20 m of the ATM and refresh your location to continue.",
                    )}
                  </p>
                )}
            </div>
          </div>
        </details>
      </CardContent>

      <Dialog
        open={isCompleteDialogOpen}
        onOpenChange={(open) => {
          if (!completeMutation.isPending) setIsCompleteDialogOpen(open);
        }}
      >
        <DialogContent className="max-h-[95dvh] w-[calc(100vw-1rem)] max-w-lg overflow-y-auto">
          <DialogTitle>{t("Complete this job?")}</DialogTitle>
          <DialogDescription className="mt-2">
            {t(
              "The server will validate your GPS coordinates. Once completed, you cannot continue working on this job unless an authorized user changes its status.",
            )}
          </DialogDescription>
          <div className="mt-5 flex flex-col-reverse gap-2 sm:flex-row sm:justify-end">
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              disabled={completeMutation.isPending}
              onClick={() => setIsCompleteDialogOpen(false)}
            >
              {t("Cancel")}
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
              {t("Confirm completion")}
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </Card>
  );
}
