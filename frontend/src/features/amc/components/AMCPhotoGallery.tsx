import { useEffect, useReducer, useState } from "react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import { updateAMCPhotoGalleryState } from "@/features/amc/amcPhotoGallery.utils";

export interface AMCPhotoGalleryItem {
  _id?: string;
  url?: string | null;
  thumbnailUrl?: string | null;
  uploadedAt?: string | null;
  originalName?: string | null;
  size?: number;
  mimeType?: string;
  uploadedBy?:
    | { firstName?: string | null; lastName?: string | null }
    | string
    | null;
}

interface AMCPhotoGalleryProps {
  photos?: readonly AMCPhotoGalleryItem[];
  loading: boolean;
  error?: unknown;
  retry: () => void;
  isFetching: boolean;
  emptyMessage?: string;
}

const formatUploadDate = (value?: string | null) => {
  if (!value) return "Upload date unavailable";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Upload date unavailable";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(date);
};

const getUploaderName = (photo: AMCPhotoGalleryItem) => {
  if (!photo.uploadedBy || typeof photo.uploadedBy === "string") {
    return undefined;
  }
  return (
    [photo.uploadedBy.firstName, photo.uploadedBy.lastName]
      .filter(Boolean)
      .join(" ") || undefined
  );
};

export default function AMCPhotoGallery({
  photos = [],
  loading,
  error,
  retry,
  isFetching,
  emptyMessage = "No AMC photos are available.",
}: AMCPhotoGalleryProps) {
  const [activeIndex, dispatch] = useReducer(
    (state: number | null, action: Parameters<typeof updateAMCPhotoGalleryState>[1]) =>
      updateAMCPhotoGalleryState(state, action, photos.length),
    null,
  );
  const [unavailablePhotos, setUnavailablePhotos] = useState<Set<string>>(
    () => new Set(),
  );
  const activePhoto = activeIndex === null ? null : photos[activeIndex];
  const activeSrc = activePhoto?.url || activePhoto?.thumbnailUrl;

  useEffect(() => {
    if (activeIndex === null) return;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "ArrowLeft") {
        event.preventDefault();
        dispatch({ type: "previous" });
      } else if (event.key === "ArrowRight") {
        event.preventDefault();
        dispatch({ type: "next" });
      }
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [activeIndex]);

  useEffect(() => {
    if (activeIndex !== null && activeIndex >= photos.length) {
      dispatch({ type: "close" });
    }
  }, [activeIndex, photos.length]);

  if (loading) {
    return (
      <div
        className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4"
        role="status"
        aria-label="Loading AMC photos"
      >
        {Array.from({ length: 4 }, (_, index) => (
          <div
            key={index}
            className="aspect-square animate-pulse rounded-xl border bg-muted/40"
          />
        ))}
      </div>
    );
  }

  if (error) {
    return (
      <div className="flex flex-col gap-3 rounded-lg border border-destructive/30 p-4 sm:flex-row sm:items-center sm:justify-between">
        <div role="alert">
          <p className="font-medium">Photo evidence could not be loaded.</p>
          <p className="mt-1 text-sm text-muted-foreground">
            {error instanceof Error ? error.message : "Please try again."}
          </p>
        </div>
        <Button
          type="button"
          variant="outline"
          onClick={retry}
          disabled={isFetching}
        >
          <span>{isFetching ? "Retrying..." : "Retry"}</span>
        </Button>
      </div>
    );
  }

  if (photos.length === 0) {
    return (
      <p className="rounded-lg border border-dashed px-4 py-8 text-center text-sm text-muted-foreground">
        {emptyMessage}
      </p>
    );
  }

  const photoKey = (photo: AMCPhotoGalleryItem, index: number) =>
    photo._id || String(index);

  return (
    <>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4">
        {photos.map((photo, index) => {
          const source = photo.thumbnailUrl || photo.url;
          const key = photoKey(photo, index);
          const unavailable = unavailablePhotos.has(key);
          return (
            <figure
              key={key}
              className="overflow-hidden rounded-xl border bg-muted/20"
            >
              {source && !unavailable ? (
                <button
                  type="button"
                  aria-label={`Open AMC photo ${index + 1} of ${photos.length}`}
                  className="group block min-h-11 w-full cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => dispatch({ type: "open", index })}
                >
                  <img
                    src={source}
                    alt={`AMC photo evidence ${index + 1}`}
                    loading="lazy"
                    referrerPolicy="no-referrer"
                    onError={() =>
                      setUnavailablePhotos((current) => {
                        const next = new Set(current);
                        next.add(key);
                        return next;
                      })
                    }
                    className="aspect-square w-full object-cover transition-opacity group-hover:opacity-90"
                  />
                </button>
              ) : (
                <div
                  className="grid aspect-square place-items-center px-3 text-center text-sm text-muted-foreground"
                  role="status"
                >
                  Image unavailable
                </div>
              )}
              <figcaption className="space-y-1 p-3 text-xs text-muted-foreground">
                {photo.originalName && <p>{photo.originalName}</p>}
                <p>{formatUploadDate(photo.uploadedAt)}</p>
                {getUploaderName(photo) && (
                  <p>By: {getUploaderName(photo)}</p>
                )}
                {typeof photo.size === "number" && (
                  <p>{Math.ceil(photo.size / 1024)} KB</p>
                )}
              </figcaption>
            </figure>
          );
        })}
      </div>

      <Dialog
        open={activeIndex !== null}
        onOpenChange={(open) => {
          if (!open) dispatch({ type: "close" });
        }}
      >
        <DialogContent className="flex max-h-[96vh] w-[calc(100vw-2rem)] max-w-7xl flex-col gap-3 overflow-hidden border-0 bg-slate-950 p-3 text-white sm:w-full sm:gap-4 sm:p-5">
          <div className="flex items-center justify-between gap-3">
            <div className="min-w-0">
              <DialogTitle className="text-white">AMC photo evidence</DialogTitle>
              <DialogDescription className="sr-only">
                View all photo evidence associated with this AMC.
              </DialogDescription>
            </div>
            <Button
              type="button"
              variant="ghost"
              size="icon"
              aria-label="Close photo gallery"
              onClick={() => dispatch({ type: "close" })}
              className="shrink-0 text-white hover:bg-white/10 hover:text-white"
            >
              <X aria-hidden="true" />
            </Button>
          </div>

          {activeIndex !== null && activePhoto && (
            <>
              <div className="flex min-h-0 flex-1 items-center justify-center gap-2 sm:gap-4">
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Previous photo"
                  disabled={activeIndex === 0}
                  onClick={() => dispatch({ type: "previous" })}
                  className="shrink-0 bg-white text-slate-950"
                >
                  <ChevronLeft aria-hidden="true" />
                </Button>
                <div className="flex h-[min(68vh,48rem)] min-h-0 min-w-0 flex-1 items-center justify-center overflow-hidden">
                  {activeSrc &&
                  !unavailablePhotos.has(photoKey(activePhoto, activeIndex)) ? (
                    <img
                      src={activeSrc}
                      alt={`AMC photo evidence ${activeIndex + 1}`}
                      className="max-h-full max-w-full object-contain"
                      onError={() =>
                        setUnavailablePhotos((current) => {
                          const next = new Set(current);
                          next.add(photoKey(activePhoto, activeIndex));
                          return next;
                        })
                      }
                    />
                  ) : (
                    <p className="text-sm text-slate-300" role="status">
                      Image unavailable
                    </p>
                  )}
                </div>
                <Button
                  type="button"
                  variant="outline"
                  size="icon"
                  aria-label="Next photo"
                  disabled={activeIndex === photos.length - 1}
                  onClick={() => dispatch({ type: "next" })}
                  className="shrink-0 bg-white text-slate-950"
                >
                  <ChevronRight aria-hidden="true" />
                </Button>
              </div>

              <p className="text-center text-sm text-slate-200" aria-live="polite">
                {activeIndex + 1} of {photos.length}
              </p>
              <div
                className="flex max-h-24 shrink-0 gap-2 overflow-x-auto border-t border-white/15 pt-3"
                role="group"
                aria-label="Choose a photo"
              >
                {photos.map((photo, index) => {
                  const key = photoKey(photo, index);
                  const source = photo.thumbnailUrl || photo.url;
                  return (
                    <button
                      key={key}
                      type="button"
                      aria-label={`Show photo ${index + 1} of ${photos.length}`}
                      aria-current={index === activeIndex ? "true" : undefined}
                      onClick={() => dispatch({ type: "open", index })}
                      className={`size-16 shrink-0 overflow-hidden rounded border-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white ${
                        index === activeIndex
                          ? "border-white"
                          : "border-transparent opacity-70 hover:opacity-100"
                      }`}
                    >
                      {source && !unavailablePhotos.has(key) ? (
                        <img
                          src={source}
                          alt=""
                          className="size-full object-cover"
                        />
                      ) : (
                        <span className="grid size-full place-items-center bg-slate-800 text-[10px]">
                          Unavailable
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  );
}
