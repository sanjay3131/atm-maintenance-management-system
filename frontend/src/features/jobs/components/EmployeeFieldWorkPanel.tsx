import { useEffect, useRef, useState, type ChangeEvent } from "react";
import { isAxiosError } from "axios";
import {
  CircleCheck,
  LoaderCircle,
  MapPin,
  Trash2,
  Upload,
} from "lucide-react";
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
import { useCompleteJob, useUploadJobPhoto } from "../hooks/useJobLifecycle";
import type { Job, JobPhoto } from "../types/job.types";
import type { JobPhotoType } from "../services/jobs.service";

const MAX_PHOTOS_PER_TYPE = 3;
const MAX_PHOTOS_PER_JOB = 6;
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
  error?: string;
  progress?: number;
}

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

function getLivePhotos(photos?: Array<JobPhoto | null>) {
  return (photos ?? []).filter((photo): photo is JobPhoto =>
    Boolean(photo?.url || photo?.thumbnailUrl),
  );
}

function PendingPhotoCard({
  photo,
  uploading,
  disabled,
  onRemove,
  onUpload,
}: {
  photo: PendingPhoto;
  uploading: boolean;
  disabled: boolean;
  onRemove: () => void;
  onUpload: () => void;
}) {
  return (
    <div className="min-w-0 rounded-md border p-2">
      <img
        src={photo.previewUrl}
        alt={`Preview of ${photo.file.name}`}
        className="aspect-square w-full rounded object-cover"
      />
      <p className="mt-2 truncate text-xs font-medium">{photo.file.name}</p>
      {photo.progress !== undefined && uploading && (
        <p className="mt-1 text-xs text-muted-foreground">
          Uploading {photo.progress}%
        </p>
      )}
      {photo.error && (
        <p role="alert" className="mt-1 text-xs text-destructive">
          {photo.error}
        </p>
      )}
      <div className="mt-2 flex gap-2">
        <Button
          type="button"
          size="sm"
          className="min-w-0 flex-1"
          disabled={disabled}
          onClick={onUpload}
        >
          {uploading ? <LoaderCircle className="animate-spin" /> : <Upload />}
          {photo.error ? "Retry" : "Upload"}
        </Button>
        <Button
          type="button"
          size="icon"
          variant="outline"
          aria-label={`Remove ${photo.file.name}`}
          title="Remove selected photo"
          disabled={disabled}
          onClick={onRemove}
        >
          <Trash2 />
        </Button>
      </div>
    </div>
  );
}

export default function EmployeeFieldWorkPanel({ job }: { job: Job }) {
  const [gps, setGps] = useState<GpsPosition | null>(null);
  const [gpsError, setGpsError] = useState("");
  const [isLocating, setIsLocating] = useState(false);
  const [pendingPhotos, setPendingPhotos] = useState<PendingPhoto[]>([]);
  const pendingPhotosRef = useRef<PendingPhoto[]>([]);
  const [isCompleteDialogOpen, setIsCompleteDialogOpen] = useState(false);
  const uploadMutation = useUploadJobPhoto();
  const completeMutation = useCompleteJob();
  const setATMLocationMutation = useSetATMLocation();

  useEffect(
    () => () => {
      pendingPhotosRef.current.forEach((photo) =>
        URL.revokeObjectURL(photo.previewUrl),
      );
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
  const beforePhotos = getLivePhotos(job.beforePhotos);
  const afterPhotos = getLivePhotos(job.afterPhotos);
  const totalPhotos = beforePhotos.length + afterPhotos.length;
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
    gps && hasAtmCoordinates && withinRadius && !uploadMutation.isPending,
  );

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

  const handleFileSelection = (
    photoType: JobPhotoType,
    event: ChangeEvent<HTMLInputElement>,
  ) => {
    const selectedFiles = Array.from(event.currentTarget.files ?? []);
    event.currentTarget.value = "";
    if (selectedFiles.length === 0) return;

    const typeCount =
      photoType === "before" ? beforePhotos.length : afterPhotos.length;
    const pendingTypeCount = pendingPhotos.filter(
      (photo) => photo.photoType === photoType,
    ).length;
    const availableSlots = Math.max(
      0,
      Math.min(
        MAX_PHOTOS_PER_TYPE - typeCount - pendingTypeCount,
        MAX_PHOTOS_PER_JOB - totalPhotos - pendingPhotos.length,
      ),
    );
    const fingerprints = new Set(
      pendingPhotos.map(
        (photo) =>
          `${photo.file.name}:${photo.file.size}:${photo.file.lastModified}`,
      ),
    );
    const accepted: PendingPhoto[] = [];
    const issues: string[] = [];

    for (const file of selectedFiles) {
      if (!ALLOWED_FILE_TYPES.has(file.type)) {
        issues.push(`${file.name}: use a JPEG, PNG, or WebP image.`);
        continue;
      }
      if (file.size > MAX_FILE_SIZE) {
        issues.push(`${file.name}: maximum file size is 5 MB.`);
        continue;
      }
      const fingerprint = `${file.name}:${file.size}:${file.lastModified}`;
      if (fingerprints.has(fingerprint)) {
        issues.push(`${file.name}: this file is already selected.`);
        continue;
      }
      if (accepted.length >= availableSlots) {
        issues.push("Photo limits are 3 per type and 6 total per job.");
        break;
      }

      fingerprints.add(fingerprint);
      accepted.push({
        id: fingerprint,
        file,
        photoType,
        previewUrl: URL.createObjectURL(file),
      });
    }

    if (accepted.length > 0) {
      const next = [...pendingPhotosRef.current, ...accepted];
      pendingPhotosRef.current = next;
      setPendingPhotos(next);
    }
    if (issues.length > 0) toast.error(issues.join(" "));
  };

  const updatePendingPhoto = (id: string, update: Partial<PendingPhoto>) => {
    const next = pendingPhotosRef.current.map((photo) =>
      photo.id === id ? { ...photo, ...update } : photo,
    );
    pendingPhotosRef.current = next;
    setPendingPhotos(next);
  };

  const removePendingPhoto = (id: string) => {
    const current = pendingPhotosRef.current;
    const removed = current.find((photo) => photo.id === id);
    const next = current.filter((photo) => photo.id !== id);
    pendingPhotosRef.current = next;
    setPendingPhotos(next);
    if (removed) URL.revokeObjectURL(removed.previewUrl);
  };

  const uploadPendingPhoto = (photo: PendingPhoto) => {
    updatePendingPhoto(photo.id, { error: undefined, progress: 0 });
    uploadMutation.mutate(
      {
        jobId: job._id,
        file: photo.file,
        photoType: photo.photoType,
        onProgress: (progress) => updatePendingPhoto(photo.id, { progress }),
      },
      {
        onSuccess: () => {
          removePendingPhoto(photo.id);
          toast.success(`${photo.photoType} photo uploaded.`);
        },
        onError: (error) => {
          const message = getApiErrorMessage(error);
          updatePendingPhoto(photo.id, { error: message, progress: undefined });
          toast.error(message);
        },
      },
    );
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

  const photoTypes: Array<{
    type: JobPhotoType;
    title: string;
    count: number;
  }> = [
    { type: "before", title: "Before photos", count: beforePhotos.length },
    { type: "after", title: "After photos", count: afterPhotos.length },
  ];

  return (
    <Card>
      <CardHeader>
        <CardTitle>Field Work</CardTitle>
      </CardHeader>
      <CardContent className="space-y-6">
        <section className="space-y-3" aria-labelledby="job-gps-heading">
          <div>
            <h2
              id="job-gps-heading"
              className="flex items-center gap-2 text-sm font-semibold"
            >
              <MapPin className="size-4" aria-hidden="true" />
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
            <p role="alert" className="text-sm text-destructive">
              {gpsError}
            </p>
          )}
          {!hasAtmCoordinates && (
            <p role="status" className="text-sm text-destructive">
              ATM location is not configured. Acquire your current location and
              set it as the ATM location before completing this job.
            </p>
          )}
          {gps && (
            <div
              className="rounded-md border bg-muted/30 p-3 text-sm"
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

        <div className="space-y-5 border-t pt-5">
          {photoTypes.map(({ type, title, count }) => {
            const selected = pendingPhotos.filter(
              (photo) => photo.photoType === type,
            );
            const remaining = Math.max(
              0,
              Math.min(
                MAX_PHOTOS_PER_TYPE - count - selected.length,
                MAX_PHOTOS_PER_JOB - totalPhotos - pendingPhotos.length,
              ),
            );

            return (
              <section
                key={type}
                className="space-y-3"
                aria-labelledby={`${type}-photos-heading`}
              >
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <h2
                    id={`${type}-photos-heading`}
                    className="text-sm font-semibold"
                  >
                    {title}
                  </h2>
                  <p className="text-xs text-muted-foreground">
                    {count} uploaded · up to 3 per type, 6 total
                  </p>
                </div>
                <label className="block text-sm">
                  <span className="sr-only">
                    Capture or select {type} photos
                  </span>
                  <input
                    type="file"
                    accept="image/jpeg,image/jpg,image/png,image/webp"
                    capture="environment"
                    multiple
                    disabled={remaining === 0 || uploadMutation.isPending}
                    onChange={(event) => handleFileSelection(type, event)}
                    className="block w-full cursor-pointer rounded-md border border-input text-sm file:mr-3 file:border-0 file:bg-muted file:px-3 file:py-2"
                  />
                </label>
                {selected.length > 0 && (
                  <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                    {selected.map((photo) => (
                      <PendingPhotoCard
                        key={photo.id}
                        photo={photo}
                        uploading={
                          uploadMutation.isPending &&
                          uploadMutation.variables?.file === photo.file
                        }
                        disabled={uploadMutation.isPending}
                        onUpload={() => uploadPendingPhoto(photo)}
                        onRemove={() => removePendingPhoto(photo.id)}
                      />
                    ))}
                  </div>
                )}
              </section>
            );
          })}
        </div>

        <div className="flex flex-wrap items-center gap-3 border-t pt-5">
          <Button
            type="button"
            disabled={
              !canComplete ||
              completeMutation.isPending ||
              uploadMutation.isPending
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
          {!gps && (
            <p className="text-sm text-muted-foreground">
              Get your current location to complete this job.
            </p>
          )}
          {gps && !withinRadius && distance !== null && (
            <p className="text-sm text-muted-foreground">
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
        <DialogContent>
          <DialogTitle>Complete this job?</DialogTitle>
          <DialogDescription className="mt-2">
            The server will validate your GPS coordinates. Once completed, you
            cannot continue working on this job unless an authorized user
            changes its status.
          </DialogDescription>
          <div className="mt-5 flex justify-end gap-2">
            <Button
              type="button"
              variant="outline"
              disabled={completeMutation.isPending}
              onClick={() => setIsCompleteDialogOpen(false)}
            >
              Cancel
            </Button>
            <Button
              type="button"
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
