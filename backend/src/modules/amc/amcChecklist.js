/**
 * Official AMC Checklist Items
 * DO NOT modify these without client approval
 */

export const AMC_CHECKLIST_ITEMS = [
  {
    id: "door",
    label: "Door",
    type: "condition",
    options: ["Good", "Issue"],
  },
  {
    id: "fixed_glass",
    label: "Fixed Glass",
    type: "condition",
    options: ["Good", "Issue"],
  },
  {
    id: "floor",
    label: "Floor",
    type: "condition",
    options: ["Good", "Issue"],
  },
  {
    id: "light",
    label: "Light",
    type: "condition",
    options: ["Working", "Not Working"],
  },
  {
    id: "night_light",
    label: "Night Light Working",
    type: "condition",
    options: ["Working", "Not Working"],
  },
  {
    id: "atm_condition",
    label: "ATM",
    type: "condition",
    options: ["Good", "Issue"],
  },
  {
    id: "sign_board",
    label: "Sign Board",
    type: "condition",
    options: ["Good", "Issue"],
  },
  {
    id: "lollypop_sign_board",
    label: "Lollypop Sign Board",
    type: "condition",
    options: ["Good", "Issue"],
  },
  {
    id: "mopped",
    label: "Mopped",
    type: "cleaning",
    options: ["Done", "Not Done"],
  },
  {
    id: "deep_clean",
    label: "Deep Clean",
    type: "cleaning",
    options: ["Done", "Not Done"],
  },
  {
    id: "back_room_cleaned",
    label: "Back Room Cleaned",
    type: "cleaning",
    options: ["Done", "Not Done"],
  },
];

/**
 * Validate that a submitted checklist has all 11 items with valid responses
 * @param {Array} checklist — [{ item, response, remarks? }]
 * @returns {{ valid: boolean, errors: string[] }}
 */
export const validateChecklist = (checklist) => {
  const errors = [];

  if (!Array.isArray(checklist)) {
    return { valid: false, errors: ["Checklist must be an array"] };
  }

  if (checklist.length !== AMC_CHECKLIST_ITEMS.length) {
    errors.push(
      `Checklist must have exactly ${AMC_CHECKLIST_ITEMS.length} items`,
    );
  }

  const itemMap = new Map(AMC_CHECKLIST_ITEMS.map((i) => [i.id, i]));

  for (const entry of checklist) {
    const def = itemMap.get(entry.item);
    if (!def) {
      errors.push(`Invalid checklist item: ${entry.item}`);
      continue;
    }
    if (!def.options.includes(entry.response)) {
      errors.push(
        `Invalid response "${entry.response}" for ${entry.item}. Allowed: ${def.options.join(", ")}`,
      );
    }
  }

  // Check for missing items
  const submittedIds = new Set(checklist.map((e) => e.item));
  for (const def of AMC_CHECKLIST_ITEMS) {
    if (!submittedIds.has(def.id)) {
      errors.push(`Missing checklist item: ${def.label}`);
    }
  }

  return { valid: errors.length === 0, errors };
};

/**
 * Get default empty checklist structure
 */
export const getDefaultChecklist = () => {
  return AMC_CHECKLIST_ITEMS.map((item) => ({
    item: item.id,
    response: "",
    remarks: "",
  }));
};
