import assert from "node:assert/strict";
import test from "node:test";
import { formatHistoryDetailLines } from "../src/features/jobs/utils/formatJobHistoryDetails.ts";

const translations = {
  en: {
    "ATM ID": "ATM ID",
    Title: "Title",
  },
  ta: {
    "ATM ID": "ATM எண்",
    Title: "தலைப்பு",
  },
};

function createTranslator(language) {
  return (key, values) =>
    (translations[language][key] ?? key).replace(
      /\{(\w+)\}/g,
      (match, name) => values?.[name] ?? match,
    );
}

function translateKnownLabel(language, label) {
  return translations[language][label] ?? label;
}

test("omits missing optional details and preserves unrecognized detail values", () => {
  const language = "en";
  const t = createTranslator(language);

  assert.deepEqual(
    formatHistoryDetailLines(
      "assigned",
      {
        assignedTo: undefined,
        assignedAt: "2026-10-14T06:30:00.000Z",
      },
      t,
      (label) => translateKnownLabel(language, label),
    ),
    ["Assigned At: 2026-10-14T06:30:00.000Z"],
  );
});

test("formats ordinary history details with English and Tamil labels", () => {
  const details = { title: "Preventive maintenance", atmId: "ATM-123" };

  for (const language of ["en", "ta"]) {
    assert.deepEqual(
      formatHistoryDetailLines(
        "created",
        details,
        createTranslator(language),
        (label) => translateKnownLabel(language, label),
      ),
      language === "en"
        ? ["Title: Preventive maintenance", "ATM ID: ATM-123"]
        : ["தலைப்பு: Preventive maintenance", "ATM எண்: ATM-123"],
    );
  }
});
