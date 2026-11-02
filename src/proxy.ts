import { clerkMiddleware } from "@clerk/nextjs/server";

// plain path checks avoid the deprecated route matcher; convex still enforces real access
const PUBLIC_PREFIXES = ["/sign-in", "/sign-up"];
function isPublicRoute(pathname: string): boolean {
  return pathname === "/" || PUBLIC_PREFIXES.some((p) => pathname === p || pathname.startsWith(`${p}/`));
}

export default clerkMiddleware(
  async (auth, req) => {
  if (!isPublicRoute(req.nextUrl.pathname)) {
      await auth.protect();
    }
  },
  // without explicit urls clerk falls back to the hosted account portal
  { signInUrl: "/sign-in", signUpUrl: "/sign-up" },
);

export const config = {
  matcher: [
    // skip next internals and static files unless found in search params
    "/((?!_next|[^?]*\\.(?:html?|css|js(?!on)|jpe?g|webp|png|gif|svg|ttf|woff2?|ico|csv|docx?|xlsx?|zip|webmanifest)).*)",
    "/(api|trpc)(.*)",
  ],
};
