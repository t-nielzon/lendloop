"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { useConvexAuth, useMutation } from "convex/react";
import type { DateRange } from "react-day-picker";
import { parseISO, startOfDay } from "date-fns";
import { api } from "../../../convex/_generated/api";
import type { Id } from "../../../convex/_generated/dataModel";
import { Button } from "@/components/ui/button";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import { DateRangePicker } from "@/components/common/date-range-picker";
import { useAction } from "@/components/common/use-action";
import { toIsoDate } from "@/lib/dates";

type Booked = { startDate: string; endDate: string };

export function RequestForm({
  toolId,
  isMine,
  booked,
}: {
  toolId: Id<"tools">;
  isMine: boolean;
  booked: Booked[];
}) {
  const { isAuthenticated } = useConvexAuth();
  const request = useMutation(api.loans.request);
  const router = useRouter();
  const { pending, run } = useAction();
  const [range, setRange] = useState<DateRange | undefined>();
  const [note, setNote] = useState("");

  const disabled = isMine || !isAuthenticated;
  const ready = Boolean(range?.from && range?.to);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    if (!range?.from || !range?.to) return;
    const id = await run(
      () =>
        request({
          toolId,
          startDate: toIsoDate(range.from!),
          endDate: toIsoDate(range.to!),
          note: note.trim() || undefined,
        }),
      "Request sent. The owner has been notified.",
    );
    if (id) router.push(`/loans/${id}`);
  }

  return (
    <form onSubmit={submit} className="space-y-4" aria-labelledby="request-heading">
      <h2 id="request-heading" className="text-lg font-semibold">
        Request this tool
      </h2>
      {isMine ? (
        <p className="text-sm text-muted-foreground">This is your tool, so you can&apos;t request it.</p>
      ) : null}
      {!isAuthenticated ? (
        <p className="text-sm text-muted-foreground">Sign in to request this tool.</p>
      ) : null}
      <div className="space-y-1.5">
        <Label htmlFor="request-dates">Dates</Label>
        <DateRangePicker
          id="request-dates"
          value={range}
          onChange={setRange}
          disabled={disabled || pending}
          disabledDays={[
            { before: startOfDay(new Date()) },
            ...booked.map((b) => ({ from: parseISO(b.startDate), to: parseISO(b.endDate) })),
          ]}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="request-note">Note to the owner (optional)</Label>
        <Textarea
          id="request-note"
          maxLength={500}
          value={note}
          disabled={disabled || pending}
          onChange={(e) => setNote(e.target.value)}
          placeholder="What will you use it for?"
        />
      </div>
      <Button type="submit" disabled={disabled || pending || !ready}>
        {pending ? "Sending..." : "Send request"}
      </Button>
    </form>
  );
}
