import { useState } from "react";
import { isAxiosError } from "axios";
import {
  ArrowLeft,
  CheckCircle2,
  ClipboardCheck,
  Download,
  Image,
} from "lucide-react";
import { Link, useParams } from "react-router-dom";
import { Badge } from "@/components/ui/badge";
import { Button, buttonVariants } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import {
  isAdminAMCId,
  getAdminAMCDownloadFilename,
} from "@/features/amc/amcAdmin.utils";
import {
  useAdminAMCDetails,
  useAdminAMCPhotos,
} from "@/features/amc/hooks/useAdminAMCs";
import AMCPhotoGallery from "@/features/amc/components/AMCPhotoGallery";
import {
  downloadAdminAMCPhotosZip,
  downloadAdminAMCReport,
  type AdminAMCDetails,
} from "@/services/amc.service";

const formatDate = (value?: string | null) => {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeZone: "Asia/Kolkata",
  }).format(date);
};

const formatDateTime = (value?: string | null) => {
  if (!value) return "Not recorded";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Date unavailable";
  return new Intl.DateTimeFormat("en-IN", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "Asia/Kolkata",
  }).format(date);
};

const getPopulatedName = (
  value:
    | string
    | {
        firstName?: string | null;
        lastName?: string | null;
        bankName?: string | null;
        customerName?: string | null;
        districtName?: string | null;
      }
    | null
    | undefined,
) => {
  if (!value || typeof value === "string") return "Not available";
  return (
    value.bankName ||
    value.customerName ||
    value.districtName ||
    [value.firstName, value.lastName].filter(Boolean).join(" ") ||
    "Not available"
  );
};

const getATM = (amc: AdminAMCDetails) =>
  typeof amc.atmId === "object" && amc.atmId !== null ? amc.atmId : null;

const getStatusVariant = (status: AdminAMCDetails["status"]) => {
  if (status === "COMPLETED") return "default" as const;
  if (status === "OVERDUE") return "destructive" as const;
  if (status === "PENDING") return "secondary" as const;
  return "outline" as const;
};

const getErrorMessage = async (error: unknown) => {
  if (isAxiosError(error)) {
    const data: unknown = error.response?.data;
    if (data instanceof Blob) {
      try {
        const parsed: unknown = JSON.parse(await data.text());
        if (
          typeof parsed === "object" &&
          parsed !== null &&
          "message" in parsed &&
          typeof parsed.message === "string"
        ) {
          return parsed.message;
        }
      } catch {
        return "The download failed. Please try again.";
      }
    }
    if (
      typeof data === "object" &&
      data !== null &&
      "message" in data &&
      typeof data.message === "string"
    ) {
      return data.message;
    }
    return error.message || "The request could not be completed.";
  }
  return error instanceof Error
    ? error.message
    : "The request could not be completed.";
};

function Detail({
  label,
  value,
}: {
  label: string;
  value: string;
}) {
  return (
    <div className="min-w-0">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-sm font-medium">{value}</dd>
    </div>
  );
}

function BackToAMCs() {
  return (
    <Link
      to="/admin/amc"
      className={buttonVariants({
        variant: "ghost",
        className: "-ml-2 min-h-11",
      })}
    >
      <ArrowLeft className="size-4" aria-hidden="true" />
      Back to AMC records
    </Link>
  );
}

function LoadingState() {
  return (
    <div className="space-y-5" role="status" aria-label="Loading AMC details">
      <div className="h-44 animate-pulse rounded-xl border bg-muted/40" />
      <div className="h-64 animate-pulse rounded-xl border bg-muted/40" />
      <div className="h-48 animate-pulse rounded-xl border bg-muted/40" />
      <span className="sr-only">Loading AMC details...</span>
    </div>
  );
}

export default function AdminAMCDetailsPage() {
  const { amcId = "" } = useParams<{ amcId: string }>();
  const validId = isAdminAMCId(amcId);
  const amcQuery = useAdminAMCDetails(amcId, validId);
  const amc = amcQuery.data;
  const photosQuery = useAdminAMCPhotos(amc?._id || "", Boolean(amc));
  const photos = photosQuery.data?.photos ?? [];
  const [downloadType, setDownloadType] = useState<"zip" | "pdf" | null>(null);
  const [downloadError, setDownloadError] = useState("");

  const downloadEvidence = async (type: "zip" | "pdf") => {
    if (!amc || downloadType) return;
    setDownloadType(type);
    setDownloadError("");
    try {
      const blob =
        type === "zip"
          ? await downloadAdminAMCPhotosZip(amc._id)
          : await downloadAdminAMCReport(amc._id);
      const objectURL = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectURL;
      link.download = getAdminAMCDownloadFilename(amc, type);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectURL), 1000);
    } catch (error) {
      setDownloadError(await getErrorMessage(error));
    } finally {
      setDownloadType(null);
    }
  };

  if (!validId) {
    return (
      <main className="space-y-5 p-4 sm:p-6">
        <BackToAMCs />
        <Card className="border-destructive/30">
          <CardContent className="p-5" role="alert">
            <h2 className="font-semibold">Invalid AMC reference</h2>
            <p className="mt-1 text-sm text-muted-foreground">
              The AMC ID in this link is not valid.
            </p>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (amcQuery.isLoading || amcQuery.isFetching) {
    return (
      <main className="space-y-5 p-4 sm:p-6">
        <BackToAMCs />
        <LoadingState />
      </main>
    );
  }

  if (amcQuery.isError || !amc) {
    const notFound =
      isAxiosError(amcQuery.error) &&
      [400, 404].includes(amcQuery.error.response?.status ?? 0);
    return (
      <main className="space-y-5 p-4 sm:p-6">
        <BackToAMCs />
        <Card className="border-destructive/30">
          <CardContent className="flex flex-col gap-4 p-5 sm:flex-row sm:items-center sm:justify-between">
            <div role="alert">
              <h2 className="font-semibold">
                {notFound ? "AMC record not found" : "Could not load AMC details"}
              </h2>
              <p className="mt-1 text-sm text-muted-foreground">
                {notFound
                  ? "This AMC may have been deleted or does not exist."
                  : amcQuery.error instanceof Error
                    ? amcQuery.error.message
                    : "Please try again."}
              </p>
            </div>
            {!notFound && (
              <Button
                type="button"
                variant="outline"
                onClick={() => void amcQuery.refetch()}
                disabled={amcQuery.isFetching}
              >
                Retry
              </Button>
            )}
          </CardContent>
        </Card>
      </main>
    );
  }

  const atm = getATM(amc);
  const employeeName = getPopulatedName(amc.employeeId);
  const statusLabel =
    amc.status.toLowerCase().replaceAll("_", " ").replace(/\b\w/g, (part) =>
      part.toUpperCase(),
    );

  return (
    <main className="space-y-6 p-4 sm:p-6">
      <BackToAMCs />

      <Card className="overflow-hidden border-teal-100 shadow-sm">
        <div className="h-1.5 bg-gradient-to-r from-teal-600 to-blue-700" />
        <CardContent className="p-4 sm:p-6">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="min-w-0">
              <p className="text-xs font-semibold uppercase tracking-[0.14em] text-teal-700">
                Admin AMC inspection
              </p>
              <h1 className="mt-1 break-words text-2xl font-bold tracking-tight sm:text-3xl">
                {amc.amcId || "AMC details"}
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Maintenance period {amc.month}/{amc.year}
              </p>
            </div>
            <Badge variant={getStatusVariant(amc.status)}>{statusLabel}</Badge>
          </div>

          <dl className="mt-5 grid gap-4 border-t pt-4 sm:grid-cols-2 lg:grid-cols-4">
            <Detail
              label="ATM"
              value={atm?.atmId || atm?.locationName || "ATM unavailable"}
            />
            <Detail label="Bank" value={getPopulatedName(amc.bankId)} />
            <Detail label="Customer" value={getPopulatedName(amc.customerId)} />
            <Detail
              label="Location"
              value={atm?.locationName || atm?.address || "Not available"}
            />
            <Detail label="Address" value={atm?.address || "Not available"} />
            <Detail label="Responsible employee" value={employeeName} />
            <Detail label="Deadline" value={formatDate(amc.deadlineDate)} />
            <Detail
              label="Generated"
              value={formatDateTime(amc.generatedAt || amc.createdAt)}
            />
          </dl>

          {downloadError && (
            <p className="mt-4 text-sm text-destructive" role="alert">
              Download failed: {downloadError}
            </p>
          )}
          <div className="mt-5 flex flex-col gap-3 sm:flex-row">
            <Button
              type="button"
              variant="outline"
              onClick={() => void downloadEvidence("zip")}
              disabled={downloadType !== null}
              className="min-h-11"
            >
              <Download className="size-4" aria-hidden="true" />
              {downloadType === "zip" ? "Preparing ZIP..." : "Download Photos (ZIP)"}
            </Button>
            <Button
              type="button"
              onClick={() => void downloadEvidence("pdf")}
              disabled={downloadType !== null}
              className="min-h-11"
            >
              <Download className="size-4" aria-hidden="true" />
              {downloadType === "pdf" ? "Preparing report..." : "Download PDF Report"}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <ClipboardCheck className="size-4 text-teal-700" aria-hidden="true" />
            Visit and inspection
          </CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          <dl className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
            <Detail label="Visit started" value={formatDateTime(amc.visitDate)} />
            <Detail label="Completed" value={formatDateTime(amc.completedAt)} />
            <Detail
              label="Checklist"
              value={amc.checklistCompleted ? "Complete" : "Incomplete"}
            />
            <Detail
              label="Visit validation"
              value={amc.gpsValidated ? "GPS validated" : "Not validated"}
            />
            <Detail
              label="GPS distance from ATM"
              value={
                amc.gpsDistance === null || amc.gpsDistance === undefined
                  ? "Not recorded"
                  : `${amc.gpsDistance} m`
              }
            />
          </dl>

          <div className="border-t pt-4">
            <p className="mb-3 flex items-center gap-2 text-sm font-semibold">
              <CheckCircle2 className="size-4 text-teal-700" aria-hidden="true" />
              Saved checklist responses
              <Badge variant={amc.checklistCompleted ? "secondary" : "outline"}>
                {amc.checklistCompleted ? "Complete" : "Incomplete"}
              </Badge>
            </p>
            {!amc.checklist?.length ? (
              <p className="rounded-lg border border-dashed px-4 py-6 text-center text-sm text-muted-foreground">
                No checklist responses have been recorded.
              </p>
            ) : (
              <ul className="divide-y rounded-lg border">
                {amc.checklist.map((item, index) => (
                  <li
                    key={`${item.item || "item"}-${index}`}
                    className="grid gap-1 p-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start"
                  >
                    <p className="text-sm font-medium">
                      {item.item || `Checklist item ${index + 1}`}
                    </p>
                    <p className="text-sm text-muted-foreground">
                      {item.response || "No response"}
                    </p>
                    {item.remarks && (
                      <p className="whitespace-pre-wrap text-xs leading-5 text-muted-foreground sm:col-span-2">
                        Remarks: {item.remarks}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            )}
          </div>

          <div className="border-t pt-4">
            <p className="mb-2 text-xs font-medium text-muted-foreground">
              Employee remarks
            </p>
            <p className="whitespace-pre-wrap text-sm leading-6">
              {amc.employeeRemarks?.trim() || "No employee remarks recorded."}
            </p>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Image className="size-4 text-teal-700" aria-hidden="true" />
            Photo evidence
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            {photos.length} available
            {typeof amc.photoCount === "number" &&
              amc.photoCount !== photos.length &&
              ` · ${amc.photoCount} recorded on AMC`}
          </p>
        </CardHeader>
        <CardContent>
          <AMCPhotoGallery
            photos={photos}
            loading={
              photosQuery.isLoading ||
              photosQuery.isFetching ||
              !photosQuery.isFetched
            }
            isFetching={photosQuery.isFetching}
            error={photosQuery.error}
            retry={() => void photosQuery.refetch()}
          />
        </CardContent>
      </Card>
    </main>
  );
}
