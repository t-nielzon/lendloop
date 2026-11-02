import { RelativeTime } from "@/components/common/relative-time";

type TimelineEvent = {
  id: string;
  at: number;
  type: string;
  actorType: string;
  actorName?: string;
  detail?: string;
};

const LABELS: Record<string, string> = {
  requested: "Request sent",
  approved: "Request approved",
  declined: "Request declined",
  cancelled: "Request cancelled",
  returned: "Marked as returned",
  notification_delivered: "Email notification delivered",
  notification_failed: "Email notification failed",
  reminder_sent: "Overdue reminder sent",
  pickup_reminder_sent: "Pickup reminder sent",
  request_nudged: "Owner nudged about this request",
  expired: "Request expired",
};

function actor(e: TimelineEvent) {
  if (e.actorType === "user") return e.actorName ?? "A member";
  return e.actorType === "automation" ? "Automation" : "System";
}

export function LoanTimeline({ events }: { events: TimelineEvent[] }) {
  if (events.length === 0) return <p className="text-sm text-muted-foreground">No activity yet.</p>;
  return (
    <ol className="relative space-y-4 border-l pl-5">
      {events.map((e) => (
        <li key={e.id} className="relative">
          <span className="absolute -left-[1.6rem] top-1.5 size-2.5 rounded-full bg-primary" aria-hidden />
          <p className="text-sm font-medium">{LABELS[e.type] ?? e.type}</p>
          <p className="text-xs text-muted-foreground">
            {actor(e)} · <RelativeTime at={e.at} />
          </p>
          {e.detail ? <p className="text-xs text-muted-foreground">{e.detail}</p> : null}
        </li>
      ))}
    </ol>
  );
}
