import type {
  AMCChecklistItem,
  AMCStatus,
  EmployeeAMCRecord,
} from "@/services/amc.service";

export const REQUIRED_AMC_PHOTOS = 6;

export const AMC_CHECKLIST_ITEMS = [
  { id: "door", label: "Door", options: ["Good", "Issue"] },
  { id: "fixed_glass", label: "Fixed Glass", options: ["Good", "Issue"] },
  { id: "floor", label: "Floor", options: ["Good", "Issue"] },
  { id: "light", label: "Light", options: ["Working", "Not Working"] },
  {
    id: "night_light",
    label: "Night Light Working",
    options: ["Working", "Not Working"],
  },
  { id: "atm_condition", label: "ATM", options: ["Good", "Issue"] },
  { id: "sign_board", label: "Sign Board", options: ["Good", "Issue"] },
  {
    id: "lollypop_sign_board",
    label: "Lollypop Sign Board",
    options: ["Good", "Issue"],
  },
  { id: "mopped", label: "Mopped", options: ["Done", "Not Done"] },
  { id: "deep_clean", label: "Deep Clean", options: ["Done", "Not Done"] },
  {
    id: "back_room_cleaned",
    label: "Back Room Cleaned",
    options: ["Done", "Not Done"],
  },
] as const;

export const AMC_STATUSES: AMCStatus[] = [
  "PENDING",
  "IN_PROGRESS",
  "COMPLETED",
  "OVERDUE",
];

export const formatAMCStatus = (status: AMCStatus) =>
  status
    .toLowerCase()
    .split("_")
    .map((part) => part[0].toUpperCase() + part.slice(1))
    .join(" ");

export const getAMCTaskListState = ({
  isLoading,
  isError,
  amcs,
}: {
  isLoading: boolean;
  isError: boolean;
  amcs: EmployeeAMCRecord[];
}) => {
  if (isLoading) return "loading" as const;
  if (isError) return "error" as const;
  return amcs.length ? ("ready" as const) : ("empty" as const);
};

export const getAMCErrorMessage = (error: unknown) => {
  if (
    typeof error === "object" &&
    error !== null &&
    "response" in error &&
    typeof error.response === "object" &&
    error.response !== null &&
    "data" in error.response &&
    typeof error.response.data === "object" &&
    error.response.data !== null &&
    "message" in error.response.data &&
    typeof error.response.data.message === "string"
  ) {
    return error.response.data.message;
  }
  return error instanceof Error ? error.message : "Please try again.";
};

export const createAMCChecklist = (
  existing: AMCChecklistItem[] = [],
): AMCChecklistItem[] =>
  AMC_CHECKLIST_ITEMS.map(({ id }) => {
    const item = existing.find((entry) => entry.item === id);
    return {
      item: id,
      response: item?.response ?? "",
      remarks: item?.remarks ?? "",
    };
  });

export const validateAMCChecklist = (checklist: AMCChecklistItem[]) => {
  if (checklist.length !== AMC_CHECKLIST_ITEMS.length) return false;
  return AMC_CHECKLIST_ITEMS.every(({ id, options }) => {
    const matches = checklist.filter((entry) => entry.item === id);
    return (
      matches.length === 1 &&
      options.some((option) => option === matches[0].response)
    );
  });
};

export const canCompleteAMC = ({
  status,
  checklistCompleted,
  photoCount,
}: {
  status: AMCStatus;
  checklistCompleted: boolean;
  photoCount: number;
}) =>
  (status === "IN_PROGRESS" || status === "OVERDUE") &&
  checklistCompleted &&
  photoCount >= REQUIRED_AMC_PHOTOS;

export const isAMCChecklistEqual = (
  left: AMCChecklistItem[],
  right: AMCChecklistItem[] = [],
) =>
  AMC_CHECKLIST_ITEMS.every(({ id }) => {
    const leftItem = left.find((entry) => entry.item === id);
    const rightItem = right.find((entry) => entry.item === id);
    return (
      leftItem?.response === rightItem?.response &&
      (leftItem?.remarks ?? "") === (rightItem?.remarks ?? "")
    );
  });

export const getAMCPhotoSelectionError = (
  files: File[],
  existingCount: number,
) => {
  if (files.length === 0) return "Choose at least one photo.";
  if (existingCount + files.length > REQUIRED_AMC_PHOTOS) {
    return `You can upload ${REQUIRED_AMC_PHOTOS - existingCount} more photo(s).`;
  }
  const allowedTypes = [
    "image/jpeg",
    "image/jpg",
    "image/png",
    "image/webp",
  ];
  if (files.some((file) => !allowedTypes.includes(file.type))) {
    return "Only JPEG, PNG, and WebP images are allowed.";
  }
  if (files.some((file) => file.size > 5 * 1024 * 1024)) {
    return "Each photo must be 5 MB or smaller.";
  }
  return "";
};
