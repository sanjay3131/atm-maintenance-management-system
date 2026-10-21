export type AMCPhotoGalleryState = number | null;

export type AMCPhotoGalleryAction =
  | { type: "open"; index: number }
  | { type: "previous" }
  | { type: "next" }
  | { type: "close" };

export const updateAMCPhotoGalleryState = (
  state: AMCPhotoGalleryState,
  action: AMCPhotoGalleryAction,
  photoCount: number,
): AMCPhotoGalleryState => {
  if (action.type === "close") return null;
  if (action.type === "open") {
    return Number.isInteger(action.index) &&
      action.index >= 0 &&
      action.index < photoCount
      ? action.index
      : state;
  }
  if (state === null || photoCount === 0) return state;
  if (action.type === "previous") return Math.max(0, state - 1);
  return Math.min(photoCount - 1, state + 1);
};
