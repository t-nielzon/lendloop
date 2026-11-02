"use client";

import { ReactNode } from "react";
import { ClerkProvider, useAuth } from "@clerk/nextjs";
import { ConvexReactClient } from "convex/react";
import { ConvexProviderWithClerk } from "convex/react-clerk";
import { ThemeProvider } from "next-themes";
import { SiteHeader } from "@/components/layout/site-header";
import { StoreUser } from "@/components/store-user";

// single client instance so reconnects and subscriptions are shared
const convex = new ConvexReactClient(process.env.NEXT_PUBLIC_CONVEX_URL as string);

export function Providers({ children }: { children: ReactNode }) {
  return (
    <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
      <ClerkProvider>
        <ConvexProviderWithClerk client={convex} useAuth={useAuth}>
          <StoreUser />
          <SiteHeader />
          {children}
        </ConvexProviderWithClerk>
      </ClerkProvider>
    </ThemeProvider>
  );
}
