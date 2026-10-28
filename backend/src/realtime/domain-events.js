import { randomUUID } from "node:crypto";
import {
  emitToUser,
  JOB_EVENT,
  LOCATION_REQUEST_EVENT,
  LOCATION_TASK_EVENT,
} from "./socket.js";

export const DOMAIN_EVENT_VERSION = 1;

export const DOMAIN_EVENTS = {
  JOB_UPDATED: JOB_EVENT,
  LOCATION_TASK_UPDATED: LOCATION_TASK_EVENT,
  LOCATION_REQUEST_UPDATED: LOCATION_REQUEST_EVENT,
};

const uniqueRecipients = (recipients) => [
  ...new Set(
    recipients
      .map((recipient) => String(recipient ?? ""))
      .filter(Boolean),
  ),
];

export const createDomainEvent = ({
  event,
  entityType,
  entityId,
  action,
  data = {},
}) => ({
  eventVersion: DOMAIN_EVENT_VERSION,
  eventId: randomUUID(),
  entityType,
  entityId: String(entityId),
  action,
  occurredAt: new Date().toISOString(),
  data,
});

export const publishDomainEvent = async ({
  event,
  entityType,
  entityId,
  action,
  resolveRecipients,
  data = {},
}) => {
  const recipients = uniqueRecipients(await resolveRecipients());
  const payload = createDomainEvent({
    event,
    entityType,
    entityId,
    action,
    data,
  });

  for (const recipient of recipients) {
    emitToUser(recipient, event, payload);
  }

  return payload;
};

// Event delivery is best effort; REST remains authoritative after a committed mutation.
export const publishDomainEventSafely = async (options) => {
  try {
    return await publishDomainEvent(options);
  } catch (error) {
    console.error(
      `Realtime event publish failed for ${options.event}:`,
      error.message,
    );
    return null;
  }
};
