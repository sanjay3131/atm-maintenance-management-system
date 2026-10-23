export function employeeLanguageClasses(
  language: "ta" | "en",
  englishClasses: string,
  tamilClasses: string,
) {
  return language === "ta" ? tamilClasses : englishClasses;
}

const employeeAMCStatusLabels = {
  PENDING: "Pending",
  IN_PROGRESS: "In progress",
  COMPLETED: "Completed",
  OVERDUE: "Overdue",
} as const;

export type EmployeeAMCStatus = keyof typeof employeeAMCStatusLabels;

export function getEmployeeAMCStatusLabelKey(status: EmployeeAMCStatus) {
  return employeeAMCStatusLabels[status];
}

const employeeAMCValueLabels = {
  Door: "Door",
  "Fixed Glass": "Fixed Glass",
  Floor: "Floor",
  Light: "Light",
  "Night Light Working": "Night Light Working",
  ATM: "ATM",
  "Sign Board": "Sign Board",
  "Lollypop Sign Board": "Lollypop Sign Board",
  Mopped: "Mopped",
  "Deep Clean": "Deep Clean",
  "Back Room Cleaned": "Back Room Cleaned",
  Good: "Good",
  Issue: "Issue",
  Working: "Working",
  "Not Working": "Not Working",
  Done: "Done",
  "Not Done": "Not Done",
} as const;

export type EmployeeAMCValueLabelKey = keyof typeof employeeAMCValueLabels;

export function getEmployeeAMCValueLabelKey(
  value: string,
): EmployeeAMCValueLabelKey | undefined {
  return Object.hasOwn(employeeAMCValueLabels, value)
    ? (value as EmployeeAMCValueLabelKey)
    : undefined;
}
