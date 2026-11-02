const fallbackPart = (value: string) =>
  value
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^[-_.]+|[-_.]+$/g, "")
    .slice(0, 100) || "job";

const decodeFilename = (value: string) => {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
};

const sanitizeFilename = (value: string, fallback: string) => {
  const withoutPath = value.split(/[\\/]/).pop() ?? "";
  const withoutUnsafeCharacters = [...withoutPath]
    .filter((character) => {
      const code = character.charCodeAt(0);
      return code >= 32 && code !== 127;
    })
    .join("");
  const sanitized = withoutUnsafeCharacters
    .replace(/"/g, "")
    .replace(/[^a-zA-Z0-9._-]+/g, "_")
    .replace(/^[-_.]+|[-_.]+$/g, "");

  if (!sanitized) return fallback;
  return sanitized.toLowerCase().endsWith(".xlsx")
    ? sanitized
    : `${sanitized}.xlsx`;
};

export const getJobCostReportDownloadFilename = (
  contentDisposition: string | undefined,
  jobId: string,
) => {
  const fallback = `job-cost-report-${fallbackPart(jobId)}.xlsx`;
  if (!contentDisposition) return fallback;

  const encodedMatch = contentDisposition.match(
    /filename\*\s*=\s*UTF-8''([^;]+)/i,
  );
  const quotedMatch = contentDisposition.match(
    /filename\s*=\s*"([^"]+)"/i,
  );
  const plainMatch = contentDisposition.match(
    /filename\s*=\s*([^;]+)/i,
  );
  const candidate = encodedMatch?.[1] ?? quotedMatch?.[1] ?? plainMatch?.[1];

  return candidate
    ? sanitizeFilename(decodeFilename(candidate.trim()), fallback)
    : fallback;
};
