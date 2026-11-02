"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { useAction } from "@/components/common/use-action";
import { CATEGORIES, CONDITIONS, type Category, type Condition } from "@/lib/labels";

export type ToolFormValues = {
  name: string;
  description: string;
  category: Category;
  condition: Condition;
};

export function ToolForm({
  initial,
  submitLabel,
  successMessage,
  onSubmit,
  cancelHref,
}: {
  initial: ToolFormValues;
  submitLabel: string;
  successMessage: string;
  onSubmit: (values: ToolFormValues) => Promise<unknown>;
  cancelHref: string;
}) {
  const router = useRouter();
  const { pending, run } = useAction();
  const [values, setValues] = useState(initial);
  const set = <K extends keyof ToolFormValues>(key: K, value: ToolFormValues[K]) =>
    setValues((v) => ({ ...v, [key]: value }));

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    const result = await run(() => onSubmit(values), successMessage);
    if (result !== undefined) router.push(typeof result === "string" ? `/tools/${result}` : cancelHref);
  }

  return (
    <form onSubmit={submit} className="max-w-xl space-y-4">
      <div className="space-y-1.5">
        <Label htmlFor="tool-name">Name</Label>
        <Input
          id="tool-name"
          required
          maxLength={80}
          value={values.name}
          disabled={pending}
          onChange={(e) => set("name", e.target.value)}
        />
      </div>
      <div className="space-y-1.5">
        <Label htmlFor="tool-description">Description</Label>
        <Textarea
          id="tool-description"
          maxLength={1000}
          rows={5}
          value={values.description}
          disabled={pending}
          onChange={(e) => set("description", e.target.value)}
        />
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <div className="space-y-1.5">
          <Label htmlFor="tool-category">Category</Label>
          <Select value={values.category} onValueChange={(v) => set("category", v as Category)}>
            <SelectTrigger id="tool-category" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CATEGORIES.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="tool-condition">Condition</Label>
          <Select value={values.condition} onValueChange={(v) => set("condition", v as Condition)}>
            <SelectTrigger id="tool-condition" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {CONDITIONS.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
      </div>
      <div className="flex gap-2">
        <Button type="submit" disabled={pending || !values.name.trim()}>
          {pending ? "Saving..." : submitLabel}
        </Button>
        <Button type="button" variant="outline" disabled={pending} onClick={() => router.push(cancelHref)}>
          Cancel
        </Button>
      </div>
    </form>
  );
}
