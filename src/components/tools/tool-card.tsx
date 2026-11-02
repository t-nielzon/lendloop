import Link from "next/link";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { categoryLabel, conditionLabel } from "@/lib/labels";
import { AvailabilityBadge } from "./availability-badge";

export type ToolCardData = {
  id: string;
  name: string;
  description: string;
  category: string;
  condition: string;
  availableNow: boolean;
  nextFreeDate?: string;
  ownerName?: string;
  isMine?: boolean;
};

export function ToolCard({ tool, href }: { tool: ToolCardData; href: string }) {
  return (
    <Card className="relative h-full transition-shadow focus-within:ring-2 focus-within:ring-ring hover:shadow-md">
      <CardHeader>
        <CardTitle className="text-base">
          {/* stretched link makes the whole card clickable with a single tab stop */}
          <Link href={href} className="after:absolute after:inset-0 focus-visible:outline-none">
            {tool.name}
          </Link>
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        <p className="line-clamp-2 text-sm text-muted-foreground">{tool.description || "No description."}</p>
        <div className="flex flex-wrap gap-1.5">
          <Badge variant="outline">{categoryLabel(tool.category)}</Badge>
          <Badge variant="outline">{conditionLabel(tool.condition)}</Badge>
          <AvailabilityBadge availableNow={tool.availableNow} nextFreeDate={tool.nextFreeDate} />
          {tool.isMine ? <Badge variant="secondary">Yours</Badge> : null}
        </div>
        {tool.ownerName ? <p className="text-xs text-muted-foreground">Shared by {tool.ownerName}</p> : null}
      </CardContent>
    </Card>
  );
}
