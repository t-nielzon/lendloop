"use client";

import Link from "next/link";
import { Show, SignInButton, UserButton } from "@clerk/nextjs";
import { useQuery } from "convex/react";
import { Wrench } from "lucide-react";
import { api } from "../../../convex/_generated/api";
import { Button } from "@/components/ui/button";
import { ThemeToggle } from "./theme-toggle";

function NavLinks() {
  const viewer = useQuery(api.users.me);
  return (
    <>
      <Link href="/dashboard" className="rounded-md px-2 py-1 text-sm hover:bg-muted focus-visible:outline-2">
        Dashboard
      </Link>
      {/* hidden for non-admins; convex still enforces access on every admin call */}
      {viewer?.role === "admin" ? (
        <Link href="/admin" className="rounded-md px-2 py-1 text-sm hover:bg-muted focus-visible:outline-2">
          Admin
        </Link>
      ) : null}
    </>
  );
}

export function SiteHeader() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-14 w-full max-w-5xl items-center gap-2 px-4 sm:px-6">
        <Link href="/" className="mr-2 flex items-center gap-2 font-semibold">
          <Wrench className="size-5" aria-hidden />
          LendLoop
        </Link>
        <nav aria-label="Main" className="flex items-center gap-1">
          <Show when="signed-in">
            <NavLinks />
          </Show>
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <ThemeToggle />
          <Show when="signed-out">
            <SignInButton>
              <Button size="sm">Sign in</Button>
            </SignInButton>
          </Show>
          <Show when="signed-in">
            <UserButton />
          </Show>
        </div>
      </div>
    </header>
  );
}
