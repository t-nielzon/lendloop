"use client";

import { useState } from "react";
import { useQuery } from "convex/react";
import { Search } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useDebounced } from "@/components/common/use-debounced";
import { useViewer } from "@/components/common/use-viewer";
import { CardGridSkeleton, EmptyState } from "@/components/common/states";
import { CATEGORIES, type Category } from "@/lib/labels";
import { ToolCard } from "./tool-card";

type Availability = "all" | "available" | "on-loan";

export function Catalog() {
  const [search, setSearch] = useState("");
  const [category, setCategory] = useState<Category | "all">("all");
  const [availability, setAvailability] = useState<Availability>("all");

  const { status } = useViewer();
  // typing waits briefly so each keystroke does not open a new subscription
  const debouncedSearch = useDebounced(search.trim(), 250);
  const args = {
    search: debouncedSearch || undefined,
    category: category === "all" ? undefined : category,
    availability,
  };
  // signed-in members get owner first names and the "yours" marker, visitors get the owner-free list
  const publicTools = useQuery(api.tools.listPublic, status === "anonymous" ? args : "skip");
  const memberTools = useQuery(api.tools.list, status === "ready" ? args : "skip");
  const tools = status === "anonymous" ? publicTools : status === "ready" ? memberTools : undefined;

  return (
    <section aria-labelledby="catalog-heading" className="space-y-4">
      <h2 id="catalog-heading" className="text-lg font-semibold">
        Browse tools
      </h2>
      <div className="grid gap-3 sm:grid-cols-[1fr_12rem_12rem]">
        <div className="space-y-1.5">
          <Label htmlFor="catalog-search">Search</Label>
          <div className="relative">
            <Search className="absolute left-2.5 top-2.5 size-4 text-muted-foreground" aria-hidden />
            <Input
              id="catalog-search"
              type="search"
              placeholder="Drill, ladder, mixer..."
              className="pl-8"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
            />
          </div>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="catalog-category">Category</Label>
          <Select value={category} onValueChange={(v) => setCategory(v as Category | "all")}>
            <SelectTrigger id="catalog-category" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {CATEGORIES.map((c) => (
                <SelectItem key={c.value} value={c.value}>
                  {c.label}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="catalog-availability">Availability</Label>
          <Select value={availability} onValueChange={(v) => setAvailability(v as Availability)}>
            <SelectTrigger id="catalog-availability" className="w-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any</SelectItem>
              <SelectItem value="available">Available now</SelectItem>
              <SelectItem value="on-loan">On loan</SelectItem>
            </SelectContent>
          </Select>
        </div>
      </div>

      {tools === undefined ? (
        <CardGridSkeleton />
      ) : tools.length === 0 ? (
        <EmptyState title="No tools match" description="Try a different search or clear the filters." />
      ) : (
        <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {tools.map((tool) => (
            <li key={tool.id}>
              <ToolCard tool={tool} href={`/tools/${tool.id}`} />
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
