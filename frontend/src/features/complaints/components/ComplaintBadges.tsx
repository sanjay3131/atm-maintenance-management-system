import { Badge } from "@/components/ui/badge";
import type {
  ComplaintPriority,
  ComplaintStatus,
} from "../types/complaint.types";

const STATUS_LABELS: Record<ComplaintStatus, string> = {
  OPEN: "Open",
  ASSIGNED: "Assigned",
  IN_PROGRESS: "In Progress",
  RESOLVED: "Resolved",
  CLOSED: "Closed",
  CANCELLED: "Cancelled",
};

const PRIORITY_LABELS: Record<ComplaintPriority, string> = {
  LOW: "Low",
  MEDIUM: "Medium",
  HIGH: "High",
  CRITICAL: "Critical",
};

export function ComplaintStatusBadge({
  status,
}: {
  status: ComplaintStatus;
}) {
  const variant =
    status === "CANCELLED"
      ? "destructive"
      : status === "OPEN" || status === "IN_PROGRESS"
        ? "secondary"
        : "outline";

  return <Badge variant={variant}>{STATUS_LABELS[status]}</Badge>;
}

export function ComplaintPriorityBadge({
  priority,
}: {
  priority: ComplaintPriority;
}) {
  const variant =
    priority === "CRITICAL" || priority === "HIGH"
      ? "destructive"
      : priority === "LOW"
        ? "secondary"
        : "outline";

  return <Badge variant={variant}>{PRIORITY_LABELS[priority]}</Badge>;
}
