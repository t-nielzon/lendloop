"use client";

import { useState } from "react";
import type { DateRange, Matcher } from "react-day-picker";
import { CalendarIcon } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Calendar } from "@/components/ui/calendar";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { formatDay, toIsoDate } from "@/lib/dates";

export function DateRangePicker({
  id,
  value,
  onChange,
  disabled,
  disabledDays,
}: {
  id?: string;
  value: DateRange | undefined;
  onChange: (range: DateRange | undefined) => void;
  disabled?: boolean;
  disabledDays?: Matcher[];
}) {
  const [open, setOpen] = useState(false);
  const label =
    value?.from && value?.to
      ? `${formatDay(toIsoDate(value.from))} to ${formatDay(toIsoDate(value.to))}`
      : value?.from
        ? `${formatDay(toIsoDate(value.from))} to ...`
        : "Pick start and end dates";

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <Button
          id={id}
          type="button"
          variant="outline"
          disabled={disabled}
          className="w-full justify-start font-normal"
        >
          <CalendarIcon className="size-4" aria-hidden />
          {label}
        </Button>
      </PopoverTrigger>
      <PopoverContent className="w-auto p-0" align="start">
        <Calendar
          mode="range"
          selected={value}
          onSelect={onChange}
          disabled={disabledDays}
          numberOfMonths={1}
        />
      </PopoverContent>
    </Popover>
  );
}
