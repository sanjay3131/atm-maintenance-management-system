/**
 * AMC (Annual Maintenance Contract) Configuration
 * Centralized business rules — do not hardcode these elsewhere
 */

export const AMC_CONFIG = {
  // Deadline: AMC must be completed within first N days of month
  DEADLINE_DAY: 20,

  // Required photos per AMC visit
  REQUIRED_PHOTOS: 6,

  // GPS validation radius in meters
  GPS_RADIUS_METERS: 20,

  // Minimum GPS accuracy threshold (meters) — warn if worse
  MIN_GPS_ACCURACY_METERS: 50,

  // Cron schedules
  CRON: {
    // 1st of every month at 01:00 AM — generate AMC records
    GENERATE: "0 1 1 * *",
    // Daily at 08:00 AM — check overdue AMCs
    OVERDUE_CHECK: "0 8 * * *",
  },

  // Photo folder in Cloudinary
  CLOUDINARY_FOLDER: (amcId) => `atm-fsm/amc/${amcId}`,

  // AMC ID format: AMC-YYYY-MM-NNN
  ID_PREFIX: "AMC",
};

export const AMC_STATUS = {
  PENDING: "PENDING",
  IN_PROGRESS: "IN_PROGRESS",
  COMPLETED: "COMPLETED",
  OVERDUE: "OVERDUE",
};

export const VALID_AMC_TRANSITIONS = {
  [AMC_STATUS.PENDING]: [AMC_STATUS.IN_PROGRESS],
  [AMC_STATUS.IN_PROGRESS]: [AMC_STATUS.COMPLETED],
  [AMC_STATUS.COMPLETED]: [], // Terminal
  [AMC_STATUS.OVERDUE]: [AMC_STATUS.IN_PROGRESS, AMC_STATUS.COMPLETED], // Can still complete after overdue
};
