import { format } from "date-fns";

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const DAY = 24 * HOUR;

// elapsed-time buckets (not calendar days) keep the output stable regardless of timezone
export function formatRelativeTime(at: number, now: number): string {
  const diff = now - at;
  const abs = Math.abs(diff);
  if (abs < MINUTE) return "just now";

  const future = diff < 0;
  const wrap = (text: string) => (future ? `in ${text}` : `${text} ago`);

  if (abs < HOUR) return wrap(`${Math.floor(abs / MINUTE)} min`);
  if (abs < DAY) return wrap(`${Math.floor(abs / HOUR)} h`);
  if (abs < 2 * DAY) return future ? "tomorrow" : "yesterday";
  const days = Math.floor(abs / DAY);
  if (days <= 30) return wrap(`${days} days`);
  return format(new Date(at), "MMM d, yyyy");
}
