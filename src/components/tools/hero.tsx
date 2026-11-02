"use client";

import Link from "next/link";
import { Show, SignInButton } from "@clerk/nextjs";
import { Button } from "@/components/ui/button";

export function Hero() {
  return (
    <section className="rounded-xl bg-muted/50 px-6 py-10 text-center sm:py-14">
      <h1 className="text-3xl font-semibold tracking-tight sm:text-4xl">
        Borrow tools. Lend yours. Skip the shopping.
      </h1>
      <p className="mx-auto mt-3 max-w-xl text-muted-foreground">
        LendLoop lets neighbours share the tools that mostly sit in the garage. Browse what is
        around, then sign in to request a loan.
      </p>
      <div className="mt-6 flex justify-center gap-3">
        <Show when="signed-out">
          <SignInButton>
            <Button size="lg">Sign in to borrow</Button>
          </SignInButton>
        </Show>
        <Show when="signed-in">
          <Button size="lg" asChild>
            <Link href="/tools/new">List a tool</Link>
          </Button>
        </Show>
      </div>
    </section>
  );
}
