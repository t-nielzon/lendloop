import { format, parseISO } from "date-fns";

// loan dates are plain yyyy-mm-dd strings; parse them as local dates to avoid timezone shifts
export function toIsoDate(date: Date): string {
  return format(date, "yyyy-MM-dd");
}

export function formatDay(iso: string): string {
  return format(parseISO(iso), "MMM d, yyyy");
}

export function formatRange(start: string, end: string): string {
  return `${formatDay(start)} to ${formatDay(end)}`;
}

export function formatDateTime(ms: number): string {
  return format(new Date(ms), "MMM d, yyyy h:mm a");
}

export function todayIso(): string {
  return toIsoDate(new Date());
}
