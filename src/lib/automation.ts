const AUTOMATION_LABELS: Record<string, string> = {
  notification_delivered: "Notification sent",
  notification_failed: "Notification failed",
  reminder_sent: "Overdue reminder sent",
  pickup_reminder_sent: "Pickup reminder sent",
  request_nudged: "Owner nudged",
  expired: "Request expired",
};

// unknown types fall back to the raw key so a newer backend never renders blank
export function automationLabel(type: string): string {
  return AUTOMATION_LABELS[type] ?? type;
}
