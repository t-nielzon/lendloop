import { Badge } from "@/components/ui/badge";
import { formatDay } from "@/lib/dates";

export function AvailabilityBadge({
  availableNow,
  nextFreeDate,
}: {
  availableNow: boolean;
  nextFreeDate?: string;
}) {
  if (availableNow) {
    return (
      <Badge className="bg-emerald-100 text-emerald-900 dark:bg-emerald-900/30 dark:text-emerald-200">
        Available now
      </Badge>
    );
  }
  return (
    <Badge variant="secondary">
      On loan{nextFreeDate ? `, free ${formatDay(nextFreeDate)}` : ""}
    </Badge>
  );
}
