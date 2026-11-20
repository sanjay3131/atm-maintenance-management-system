import { useRef, useState } from "react";
import { isAxiosError } from "axios";
import { AlertCircle, CheckCircle2, LoaderCircle, Upload } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  importATMUpload,
  previewATMUpload,
  type ATMUploadImportErrorResponse,
  type ATMUploadImportResult,
  type ATMUploadPreview,
} from "@/features/atms/services/atm.service";

const MAX_FILE_SIZE = 5 * 1024 * 1024;

interface ATMUploadPreviewDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  onImportSuccess: () => void;
}

type ImportFailureKind = "validation" | "conflict" | "retryable" | "general";

interface ImportFailure {
  kind: ImportFailureKind;
  message: string;
  errors: NonNullable<ATMUploadImportErrorResponse["errors"]>;
}

function getErrorMessage(error: unknown) {
  if (isAxiosError<{ message?: unknown }>(error)) {
    const message = error.response?.data?.message;
    if (typeof message === "string" && message.trim()) return message;
    if (!error.response) {
      return "Could not reach the server. Check your connection and try again.";
    }
    return "Unable to generate the preview. Please try again.";
  }
  return error instanceof Error
    ? error.message
    : "Unable to generate the preview. Please try again.";
}

function getImportFailure(error: unknown): ImportFailure {
  if (isAxiosError<ATMUploadImportErrorResponse>(error)) {
    const status = error.response?.status;
    const message = error.response?.data?.message;
    return {
      kind:
        status === 409
          ? "conflict"
          : status === 503 || !error.response
            ? "retryable"
            : status === 400
              ? "validation"
              : "general",
      message:
        typeof message === "string" && message.trim()
          ? message
          : !error.response
            ? "The import result could not be confirmed. Retry with this workbook to safely check the result."
            : "Unable to import the workbook. Please try again.",
      errors: error.response?.data?.errors ?? [],
    };
  }

  return {
    kind: "general",
    message:
      error instanceof Error
        ? error.message
        : "Unable to import the workbook. Please try again.",
    errors: [],
  };
}

function validateFile(file: File) {
  if (!file.name.toLowerCase().endsWith(".xlsx")) {
    return "Choose an Excel workbook with the .xlsx extension.";
  }
  if (file.size > MAX_FILE_SIZE) {
    return "The workbook exceeds the 5 MiB upload limit.";
  }
  return "";
}

export default function ATMUploadPreviewDialog({
  open,
  onOpenChange,
  onImportSuccess,
}: ATMUploadPreviewDialogProps) {
  const fileInputRef = useRef<HTMLInputElement>(null);
  const importInFlightRef = useRef(false);
  const importIdempotencyKeyRef = useRef<string | null>(null);
  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<ATMUploadPreview | null>(null);
  const [errorMessage, setErrorMessage] = useState("");
  const [isLoading, setIsLoading] = useState(false);
  const [importFailure, setImportFailure] = useState<ImportFailure | null>(
    null,
  );
  const [importResult, setImportResult] =
    useState<ATMUploadImportResult | null>(null);
  const [isImporting, setIsImporting] = useState(false);
  const fileValidationError = file ? validateFile(file) : "";

  const reset = () => {
    importIdempotencyKeyRef.current = null;
    setFile(null);
    setPreview(null);
    setErrorMessage("");
    setImportFailure(null);
    setImportResult(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
  };

  const handleOpenChange = (nextOpen: boolean) => {
    if (!nextOpen && (isLoading || isImporting)) return;
    if (!nextOpen && !importIdempotencyKeyRef.current) reset();
    onOpenChange(nextOpen);
  };

  const handleFileChange = (event: React.ChangeEvent<HTMLInputElement>) => {
    const nextFile = event.currentTarget.files?.[0] ?? null;
    event.currentTarget.value = "";
    setFile(nextFile);
    setPreview(null);
    setErrorMessage(nextFile ? validateFile(nextFile) : "");
    setImportFailure(null);
    setImportResult(null);
    importIdempotencyKeyRef.current = null;
  };

  const generatePreview = async () => {
    if (!file) return;
    const validationError = validateFile(file);
    if (validationError) {
      setPreview(null);
      setErrorMessage(validationError);
      return;
    }

    setIsLoading(true);
    setPreview(null);
    setErrorMessage("");
    setImportFailure(null);
    try {
      setPreview(await previewATMUpload(file));
    } catch (error) {
      setErrorMessage(getErrorMessage(error));
    } finally {
      setIsLoading(false);
    }
  };

  const importWorkbook = async () => {
    if (
      !file ||
      !preview ||
      preview.totalRows === 0 ||
      preview.invalidCount > 0 ||
      preview.validCount !== preview.totalRows ||
      importResult ||
      importInFlightRef.current
    ) {
      return;
    }

    importInFlightRef.current = true;
    setIsImporting(true);
    setImportFailure(null);
    let result: ATMUploadImportResult;
    try {
      const idempotencyKey =
        importIdempotencyKeyRef.current ?? crypto.randomUUID();
      importIdempotencyKeyRef.current = idempotencyKey;
      result = await importATMUpload(file, idempotencyKey);
    } catch (error) {
      setImportFailure(getImportFailure(error));
      return;
    } finally {
      importInFlightRef.current = false;
      setIsImporting(false);
    }

    setImportResult(result);
    setImportFailure(null);
    importIdempotencyKeyRef.current = null;
    onImportSuccess();
  };

  const canImport =
    Boolean(file && preview) &&
    preview?.totalRows !== 0 &&
    preview?.invalidCount === 0 &&
    preview?.validCount === preview?.totalRows &&
    !fileValidationError &&
    !isImporting &&
    !importResult;

  return (
    <Dialog open={open} onOpenChange={handleOpenChange}>
      <DialogContent className="flex max-h-[92dvh] w-[calc(100vw-1rem)] max-w-6xl flex-col overflow-hidden p-4 sm:w-full sm:p-6">
        <div className="space-y-2">
          <DialogTitle>Preview ATM workbook</DialogTitle>
          <DialogDescription>
            Choose an .xlsx workbook to check its rows before importing.
          </DialogDescription>
        </div>

        <p className="mt-4 rounded-md border bg-muted/40 p-3 text-sm">
          Preview only validates the workbook. It does not save or create any
          ATM records.
        </p>

        <div className="mt-4 flex flex-wrap items-center gap-3">
          <label htmlFor="atm-bulk-upload-file" className="sr-only">
            Choose an XLSX workbook
          </label>
          <input
            ref={fileInputRef}
            id="atm-bulk-upload-file"
            type="file"
            accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
            onChange={handleFileChange}
            className="sr-only"
          />
          <Button
            type="button"
            variant="outline"
            onClick={() => fileInputRef.current?.click()}
            disabled={isLoading || isImporting}
          >
            <Upload className="size-4" aria-hidden="true" />
            Choose workbook
          </Button>
          <span className="min-w-0 flex-1 truncate text-sm text-muted-foreground">
            {file?.name ?? "XLSX only - maximum 5 MiB"}
          </span>
          <Button
            type="button"
            onClick={() => void generatePreview()}
            disabled={
              !file ||
              isLoading ||
              isImporting ||
              Boolean(fileValidationError)
            }
          >
            {isLoading ? (
              <>
                <LoaderCircle
                  className="size-4 animate-spin"
                  aria-hidden="true"
                />
                Generating preview...
              </>
            ) : (
              "Generate preview"
            )}
          </Button>
          {preview && (
            <Button
              type="button"
              onClick={() => void importWorkbook()}
              disabled={!canImport}
            >
              {isImporting ? (
                <>
                  <LoaderCircle
                    className="size-4 animate-spin"
                    aria-hidden="true"
                  />
                  Importing ATMs...
                </>
              ) : importFailure?.kind === "retryable" ? (
                "Retry import"
              ) : (
                "Import ATMs"
              )}
            </Button>
          )}
        </div>

        {errorMessage && (
          <p
            className="mt-3 flex items-start gap-2 text-sm text-destructive"
            role="alert"
          >
            <AlertCircle
              className="mt-0.5 size-4 shrink-0"
              aria-hidden="true"
            />
            {errorMessage}
          </p>
        )}

        {isLoading && (
          <p className="mt-4 text-sm text-muted-foreground" role="status">
            The workbook is being checked. This may take a moment.
          </p>
        )}

        {isImporting && (
          <p className="mt-4 text-sm text-muted-foreground" role="status">
            The workbook is being imported. Keep this window open until the
            result is confirmed.
          </p>
        )}

        {preview?.invalidCount ? (
          <p className="mt-4 text-sm text-destructive" role="status">
            Resolve all preview errors before importing this workbook.
          </p>
        ) : null}

        {importFailure && (
          <div
            className="mt-4 space-y-2 rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"
            role="alert"
          >
            <p>{importFailure.message}</p>
            {importFailure.errors.length > 0 && (
              <ul className="list-inside list-disc space-y-1">
                {importFailure.errors.map((rowError, index) => (
                  <li key={`${rowError.rowNumber}-${rowError.field}-${index}`}>
                    {rowError.rowNumber
                      ? `Excel row ${rowError.rowNumber}: `
                      : ""}
                    {rowError.field ? `${rowError.field}: ` : ""}
                    {rowError.message}
                  </li>
                ))}
              </ul>
            )}
            {importFailure.kind === "retryable" && (
              <p>Retrying will reuse the same request key for this workbook.</p>
            )}
          </div>
        )}

        {importResult && (
          <p
            className="mt-4 rounded-md border border-emerald-600/30 bg-emerald-500/10 p-3 text-sm text-emerald-800 dark:text-emerald-300"
            role="status"
          >
            Imported {importResult.createdCount} ATM
            {importResult.createdCount === 1 ? "" : "s"} from{" "}
            {importResult.totalRows} row
            {importResult.totalRows === 1 ? "" : "s"}.
          </p>
        )}

        {preview && (
          <div className="mt-5 min-h-0 space-y-4 overflow-y-auto">
            <div className="grid gap-3 sm:grid-cols-3">
              <div className="rounded-md border p-3">
                <p className="text-sm text-muted-foreground">Candidate rows</p>
                <p className="mt-1 text-2xl font-semibold">
                  {preview.totalRows}
                </p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-sm text-muted-foreground">Valid rows</p>
                <p className="mt-1 text-2xl font-semibold text-emerald-700 dark:text-emerald-400">
                  {preview.validCount}
                </p>
              </div>
              <div className="rounded-md border p-3">
                <p className="text-sm text-muted-foreground">Invalid rows</p>
                <p className="mt-1 text-2xl font-semibold text-destructive">
                  {preview.invalidCount}
                </p>
              </div>
            </div>

            {preview.rows.length === 0 ? (
              <p className="rounded-md border p-4 text-sm text-muted-foreground">
                No non-empty candidate rows were found in this workbook.
              </p>
            ) : (
              <div className="overflow-x-auto rounded-md border">
                <table className="w-full min-w-[850px] text-left text-sm">
                  <thead className="border-b bg-muted/40 text-muted-foreground">
                    <tr>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Excel row
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        ATM ID
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Location
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        City
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Status
                      </th>
                      <th scope="col" className="px-3 py-2 font-medium">
                        Validation errors
                      </th>
                    </tr>
                  </thead>
                  <tbody className="divide-y">
                    {preview.rows.map((row) => {
                      const isValid = row.status === "valid";
                      return (
                        <tr
                          key={row.rowNumber}
                          className={
                            isValid
                              ? "bg-background"
                              : "bg-destructive/[0.04]"
                          }
                        >
                          <td className="px-3 py-3 align-top">
                            {row.rowNumber}
                          </td>
                          <td className="px-3 py-3 align-top font-medium">
                            {row.values.atmId || "N/A"}
                          </td>
                          <td className="px-3 py-3 align-top">
                            {row.values.location || "N/A"}
                          </td>
                          <td className="px-3 py-3 align-top">
                            {row.values.city || "N/A"}
                          </td>
                          <td className="px-3 py-3 align-top">
                            <Badge
                              variant="outline"
                              className={
                                isValid
                                  ? "border-emerald-600/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400"
                                  : "border-destructive/30 bg-destructive/10 text-destructive"
                              }
                            >
                              {isValid ? (
                                <CheckCircle2
                                  className="mr-1 size-3.5"
                                  aria-hidden="true"
                                />
                              ) : (
                                <AlertCircle
                                  className="mr-1 size-3.5"
                                  aria-hidden="true"
                                />
                              )}
                              {isValid ? "Valid" : "Invalid"}
                            </Badge>
                          </td>
                          <td className="max-w-sm px-3 py-3 align-top">
                            {row.errors.length ? (
                              <ul className="space-y-1 text-destructive">
                                {row.errors.map((rowError, index) => (
                                  <li key={`${rowError.field}-${index}`}>
                                    <span className="font-medium">
                                      {rowError.field}:
                                    </span>{" "}
                                    {rowError.message}
                                  </li>
                                ))}
                              </ul>
                            ) : (
                              <span className="text-muted-foreground">N/A</span>
                            )}
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
