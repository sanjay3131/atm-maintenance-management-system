import { useEffect, useMemo, useState } from "react";
import { motion, useReducedMotion } from "motion/react";
import { ChevronLeft, ChevronRight, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import type { JobPhoto } from "../types/job.types";

type PhotoSide = "before" | "after";

interface ReviewPhoto {
  pairIndex: number;
  side: PhotoSide;
  photo: JobPhoto;
  src: string;
}

const EMPTY_PHOTOS: Array<JobPhoto | null> = [];

function getPhotoUrl(photo?: JobPhoto | null) {
  return photo?.url || photo?.thumbnailUrl || undefined;
}

function PhotoSection({
  title,
  photoType,
  photos,
  onPhotoClick,
  reducedMotion,
}: {
  title: string;
  photoType: PhotoSide;
  photos?: Array<JobPhoto | null>;
  onPhotoClick: (index: number) => void;
  reducedMotion: boolean | null;
}) {
  const availablePhotos = (photos ?? []).flatMap((photo, index) =>
    photo && photo.photoType === photoType && getPhotoUrl(photo)
      ? [{ photo, index }]
      : [],
  );

  return (
    <Card className="min-w-0">
      <CardHeader className="flex flex-row items-center justify-between gap-2 p-4 sm:p-6">
        <CardTitle className="text-base">{title}</CardTitle>
        <span className="shrink-0 text-sm text-muted-foreground">
          {availablePhotos.length} / 3 required
        </span>
      </CardHeader>
      <CardContent className="p-4 pt-0 sm:p-6 sm:pt-0">
        {availablePhotos.length === 0 ? (
          <p className="text-sm text-muted-foreground">No photos uploaded.</p>
        ) : (
          <div className="grid grid-cols-2 gap-2 min-[400px]:gap-3 sm:grid-cols-3">
            {availablePhotos.map(({ photo, index }) => (
              <motion.figure
                key={photo._id}
                initial={reducedMotion ? false : { opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.18 }}
                className="min-w-0 overflow-hidden rounded-md border"
              >
                <button
                  type="button"
                  aria-label={`Review ${title.toLowerCase()} ${index + 1}`}
                  className="group block min-h-11 w-full cursor-zoom-in focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  onClick={() => onPhotoClick(index)}
                >
                  <img
                    src={photo.thumbnailUrl || photo.url || undefined}
                    alt={`${title} photo ${index + 1}`}
                    className="aspect-square w-full object-cover transition-opacity group-hover:opacity-90"
                  />
                </button>
                {photo.uploadedAt && (
                  <figcaption className="break-words p-2 text-xs text-muted-foreground">
                    {new Date(photo.uploadedAt).toLocaleString()}
                  </figcaption>
                )}
              </motion.figure>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export default function JobPhotoGallery({
  beforePhotos = EMPTY_PHOTOS,
  afterPhotos = EMPTY_PHOTOS,
}: {
  beforePhotos?: Array<JobPhoto | null>;
  afterPhotos?: Array<JobPhoto | null>;
}) {
  const reducedMotion = useReducedMotion();
  const [activePhotoPairIndex, setActivePhotoPairIndex] = useState<
    number | null
  >(null);
  const [activeFullImageIndex, setActiveFullImageIndex] = useState<
    number | null
  >(null);
  const photoPairCount = Math.max(beforePhotos.length, afterPhotos.length);
  const reviewPhotos = useMemo(() => {
    const photos: ReviewPhoto[] = [];
    for (let pairIndex = 0; pairIndex < photoPairCount; pairIndex += 1) {
      const beforePhoto = beforePhotos[pairIndex];
      const beforeSrc = getPhotoUrl(beforePhoto);
      if (beforePhoto && beforePhoto.photoType === "before" && beforeSrc) {
        photos.push({
          pairIndex,
          side: "before",
          photo: beforePhoto,
          src: beforeSrc,
        });
      }

      const afterPhoto = afterPhotos[pairIndex];
      const afterSrc = getPhotoUrl(afterPhoto);
      if (afterPhoto && afterPhoto.photoType === "after" && afterSrc) {
        photos.push({
          pairIndex,
          side: "after",
          photo: afterPhoto,
          src: afterSrc,
        });
      }
    }
    return photos;
  }, [afterPhotos, beforePhotos, photoPairCount]);

  const activePairBefore =
    activePhotoPairIndex === null ? null : beforePhotos[activePhotoPairIndex];
  const activePairAfter =
    activePhotoPairIndex === null ? null : afterPhotos[activePhotoPairIndex];
  const activeFullPhoto =
    activeFullImageIndex === null ? null : reviewPhotos[activeFullImageIndex];

  const openFullImage = (side: PhotoSide, pairIndex: number) => {
    const imageIndex = reviewPhotos.findIndex(
      (photo) => photo.side === side && photo.pairIndex === pairIndex,
    );
    if (imageIndex < 0) return;
    setActiveFullImageIndex(imageIndex);
  };

  const moveFullImage = (direction: -1 | 1) => {
    if (activeFullImageIndex === null) return;
    const nextIndex = activeFullImageIndex + direction;
    if (nextIndex < 0 || nextIndex >= reviewPhotos.length) return;
    setActiveFullImageIndex(nextIndex);
    setActivePhotoPairIndex(reviewPhotos[nextIndex].pairIndex);
  };

  useEffect(() => {
    if (activePhotoPairIndex === null && activeFullImageIndex === null) return;

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        if (activeFullImageIndex !== null) setActiveFullImageIndex(null);
        else setActivePhotoPairIndex(null);
      } else if (event.key === "ArrowLeft" || event.key === "ArrowRight") {
        event.preventDefault();
        const direction = event.key === "ArrowLeft" ? -1 : 1;
        if (activeFullImageIndex !== null) {
          const nextIndex = activeFullImageIndex + direction;
          if (nextIndex >= 0 && nextIndex < reviewPhotos.length) {
            setActiveFullImageIndex(nextIndex);
            setActivePhotoPairIndex(reviewPhotos[nextIndex].pairIndex);
          }
        } else if (activePhotoPairIndex !== null) {
          const nextIndex = activePhotoPairIndex + direction;
          if (nextIndex >= 0 && nextIndex < photoPairCount) {
            setActivePhotoPairIndex(nextIndex);
          }
        }
      }
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [
    activeFullImageIndex,
    activePhotoPairIndex,
    photoPairCount,
    reviewPhotos,
  ]);

  return (
    <section
      className="grid min-w-0 gap-4 lg:grid-cols-2"
      aria-label="Job photos"
    >
      <PhotoSection
        title="Before photos"
        photoType="before"
        photos={beforePhotos}
        onPhotoClick={setActivePhotoPairIndex}
        reducedMotion={reducedMotion}
      />
      <PhotoSection
        title="After photos"
        photoType="after"
        photos={afterPhotos}
        onPhotoClick={setActivePhotoPairIndex}
        reducedMotion={reducedMotion}
      />

      <Dialog
        open={activePhotoPairIndex !== null}
        onOpenChange={(open) => {
          if (!open && activeFullImageIndex === null) {
            setActivePhotoPairIndex(null);
          }
        }}
      >
        <DialogContent className="max-h-[95vh] w-[calc(100vw-1rem)] max-w-6xl overflow-y-auto p-4 sm:w-full sm:p-6">
          {activePhotoPairIndex !== null && (
            <>
              <div className="flex items-start justify-between gap-3">
                <div className="space-y-1">
                  <DialogTitle>Job Photos</DialogTitle>
                  <DialogDescription>
                    Before and after photos for this job.
                  </DialogDescription>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Close photo review"
                  onClick={() => setActivePhotoPairIndex(null)}
                >
                  <X />
                </Button>
              </div>
              <div className="mt-4 grid min-w-0 gap-4 sm:grid-cols-2">
                {[
                  {
                    side: "before" as const,
                    label: "Before",
                    photo: activePairBefore,
                  },
                  {
                    side: "after" as const,
                    label: "After",
                    photo: activePairAfter,
                  },
                ].map(({ side, label, photo }) => {
                  const src = getPhotoUrl(photo);
                  return (
                    <section key={side} className="min-w-0 space-y-2">
                      <h3 className="text-sm font-semibold">{label}</h3>
                      {photo && src ? (
                        <button
                          type="button"
                          aria-label={`Open ${label.toLowerCase()} photo ${activePhotoPairIndex + 1} full size`}
                          className="flex aspect-[4/3] w-full cursor-zoom-in items-center justify-center overflow-hidden rounded-md border bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                          onClick={() =>
                            openFullImage(side, activePhotoPairIndex)
                          }
                        >
                          <img
                            src={src}
                            alt={`${label} photo ${activePhotoPairIndex + 1}`}
                            className="max-h-full max-w-full object-contain"
                          />
                        </button>
                      ) : (
                        <div
                          className="flex aspect-[4/3] items-center justify-center rounded-md border border-dashed bg-muted/20 text-sm text-muted-foreground"
                          role="status"
                        >
                          No photo available
                        </div>
                      )}
                    </section>
                  );
                })}
              </div>
              <p className="mt-4 text-center text-sm text-muted-foreground">
                {activePhotoPairIndex + 1} / {photoPairCount}
              </p>
              <div className="mt-3 flex justify-between gap-3 border-t pt-4">
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  disabled={activePhotoPairIndex <= 0}
                  onClick={() =>
                    setActivePhotoPairIndex((index) =>
                      index === null ? null : Math.max(0, index - 1),
                    )
                  }
                >
                  <ChevronLeft />
                  Previous
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  disabled={activePhotoPairIndex >= photoPairCount - 1}
                  onClick={() =>
                    setActivePhotoPairIndex((index) =>
                      index === null
                        ? null
                        : Math.min(photoPairCount - 1, index + 1),
                    )
                  }
                >
                  Next
                  <ChevronRight />
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>

      <Dialog
        open={activeFullImageIndex !== null}
        onOpenChange={(open) => {
          if (!open) setActiveFullImageIndex(null);
        }}
      >
        <DialogContent className="max-h-[95vh] w-[calc(100vw-1rem)] max-w-7xl overflow-y-auto p-4 sm:w-full sm:p-6">
          {activeFullPhoto && activeFullImageIndex !== null && (
            <>
              <div className="flex items-start justify-between gap-3">
                <div>
                  <DialogTitle>Full-size photo</DialogTitle>
                  <DialogDescription className="mt-1">
                    {activeFullPhoto.side === "before" ? "Before" : "After"} ·{" "}
                    {activeFullPhoto.pairIndex + 1}
                  </DialogDescription>
                </div>
                <Button
                  type="button"
                  variant="ghost"
                  size="icon"
                  aria-label="Close full-size photo"
                  onClick={() => setActiveFullImageIndex(null)}
                >
                  <X />
                </Button>
              </div>
              <div className="mt-4 flex min-h-[35vh] items-center justify-center rounded-md bg-black/90 p-2 sm:min-h-[40vh]">
                <img
                  src={activeFullPhoto.src}
                  alt={`${activeFullPhoto.side} photo ${activeFullPhoto.pairIndex + 1}`}
                  className="max-h-[70vh] max-w-full object-contain"
                />
              </div>
              <p className="mt-3 text-center text-sm text-muted-foreground">
                {activeFullPhoto.side === "before" ? "Before" : "After"} ·{" "}
                {activeFullPhoto.pairIndex + 1} · {activeFullImageIndex + 1} /{" "}
                {reviewPhotos.length}
              </p>
              <div className="mt-3 flex justify-between gap-3 border-t pt-4">
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  disabled={activeFullImageIndex <= 0}
                  onClick={() => moveFullImage(-1)}
                >
                  <ChevronLeft />
                  Previous
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11"
                  disabled={activeFullImageIndex >= reviewPhotos.length - 1}
                  onClick={() => moveFullImage(1)}
                >
                  Next
                  <ChevronRight />
                </Button>
              </div>
            </>
          )}
        </DialogContent>
      </Dialog>
    </section>
  );
}
