import Link from "next/link";
import { Compass } from "lucide-react";
import { Button } from "@/components/ui/button";

export default function NotFound() {
  return (
    <main className="mx-auto flex w-full max-w-xl flex-1 flex-col items-center justify-center gap-4 px-4 py-16 text-center">
      <Compass className="size-10 text-muted-foreground" aria-hidden />
      <h1 className="text-2xl font-semibold tracking-tight">We couldn&apos;t find that page</h1>
      <p className="text-muted-foreground">The link may be old, or the tool may have been taken off the shelf.</p>
      <Button asChild>
        <Link href="/">Back to the catalog</Link>
      </Button>
    </main>
  );
}
