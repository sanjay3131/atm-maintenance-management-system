import { useState } from "react";
import { isAxiosError } from "axios";
import { Download, LoaderCircle } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { useAuth } from "@/features/auth/auth-context";
import {
  downloadJobPhotosPdf,
  downloadJobPhotosZip,
} from "@/features/jobs/services/jobs.service";

type DownloadType = "zip" | "pdf";

const getDownloadErrorMessage = async (error: unknown) => {
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
    return error.message || "The download failed. Please try again.";
  }
  return error instanceof Error
    ? error.message
    : "The download failed. Please try again.";
};

const getFilename = (jobDisplayId: string, type: DownloadType) => {
  const safeJobId =
    jobDisplayId
      .replace(/[^a-zA-Z0-9._-]+/g, "_")
      .replace(/^[._-]+|[._-]+$/g, "")
      .slice(0, 100) || "job";
  return `${safeJobId}.${type}`;
};

export default function JobPhotoDownloadActions({
  jobId,
  jobDisplayId,
}: {
  jobId: string;
  jobDisplayId: string;
}) {
  const { user } = useAuth();
  const [downloadType, setDownloadType] = useState<DownloadType | null>(null);

  if (!["admin", "superAdmin"].includes(user?.userType ?? "")) return null;

  const downloadPhotos = async (type: DownloadType) => {
    if (!jobId || downloadType) return;
    setDownloadType(type);
    try {
      const blob =
        type === "zip"
          ? await downloadJobPhotosZip(jobId)
          : await downloadJobPhotosPdf(jobId);
      const objectURL = URL.createObjectURL(blob);
      const link = document.createElement("a");
      link.href = objectURL;
      link.download = getFilename(jobDisplayId, type);
      document.body.appendChild(link);
      link.click();
      link.remove();
      window.setTimeout(() => URL.revokeObjectURL(objectURL), 1000);
    } catch (error) {
      toast.error(await getDownloadErrorMessage(error));
    } finally {
      setDownloadType(null);
    }
  };

  return (
    <div className="mb-3 flex flex-wrap gap-2">
      <Button
        type="button"
        variant="outline"
        disabled={downloadType !== null}
        onClick={() => void downloadPhotos("zip")}
      >
        {downloadType === "zip" ? (
          <LoaderCircle className="animate-spin" aria-hidden="true" />
        ) : (
          <Download aria-hidden="true" />
        )}
        {downloadType === "zip" ? "Preparing ZIP..." : "Download ZIP"}
      </Button>
      <Button
        type="button"
        variant="outline"
        disabled={downloadType !== null}
        onClick={() => void downloadPhotos("pdf")}
      >
        {downloadType === "pdf" ? (
          <LoaderCircle className="animate-spin" aria-hidden="true" />
        ) : (
          <Download aria-hidden="true" />
        )}
        {downloadType === "pdf" ? "Preparing PDF..." : "Download PDF"}
      </Button>
    </div>
  );
}
