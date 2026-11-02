"use client";

import { Zap } from "lucide-react";
import { RelativeTime } from "@/components/common/relative-time";
import { formatDateTime } from "@/lib/dates";
import { automationLabel } from "@/lib/automation";

export type Automation = { type: string; at: number };

export function AutomationLine({ automation }: { automation: Automation }) {
  return (
    <p
      className="flex items-center gap-1 text-xs text-muted-foreground"
      title={`${automationLabel(automation.type)}, ${formatDateTime(automation.at)}`}
    >
      <Zap className="size-3" aria-hidden />
      <span>
        {automationLabel(automation.type)} <RelativeTime at={automation.at} />
      </span>
    </p>
  );
}
