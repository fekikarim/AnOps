import NextAuth from "next-auth";
import { NextResponse } from "next/server";
import { authConfig } from "@/server/auth/config";
import { buildCsp, createNonce } from "@/server/security/csp";

const { auth } = NextAuth(authConfig);

const protectedRoutes = [
  "/anops",
  "/organization",
  "/profile",
  "/dashboard",
  "/crm",
  "/sales",
  "/finance",
  "/inventory",
  "/purchasing",
  "/manufacturing",
  "/marketing",
  "/hr",
  "/ai",
  "/projects",
  "/documents",
  "/notifications",
  "/admin",
  "/onboarding",
  "/company",
  "/community",
  "/settings",
];

// Routes only for unauthenticated users — active logged-in users get
// redirected away from these, UNLESS they have a forcePasswordReset pending.
const authOnlyRoutes = [
  "/login",
  "/register",
  "/trial",
  "/get-started",
  "/forgot-password",
  "/verify",
  "/unverified",
  "/banned",
];

type AuthedRequest = Parameters<Parameters<typeof auth>[0]>[0];

function decide(req: AuthedRequest, requestHeaders: Headers) {
  const proceed = () => NextResponse.next({ request: { headers: requestHeaders } });
  const { nextUrl } = req;
  const isLoggedIn = !!req.auth;
  const status = req.auth?.user?.status;
  const forceReset = (req.auth?.user as { forcePasswordReset?: boolean } | undefined)
    ?.forcePasswordReset;

  const isProtected = protectedRoutes.some(
    (route) =>
      nextUrl.pathname === route || nextUrl.pathname.startsWith(route + "/")
  );
  const isAuthOnlyRoute = authOnlyRoutes.some(
    (route) => nextUrl.pathname === route
  );
  const isResetPasswordRoute = nextUrl.pathname === "/reset-password";

  // 1. Unauthenticated users cannot access protected routes
  if (isProtected && !isLoggedIn) {
    const loginUrl = new URL("/login", nextUrl.origin);
    loginUrl.searchParams.set("callbackUrl", nextUrl.pathname);
    return NextResponse.redirect(loginUrl);
  }

  // 2. Banned users → /banned (always, except when already there)
  if (isLoggedIn && status === "banned" && nextUrl.pathname !== "/banned") {
    return NextResponse.redirect(new URL("/banned", nextUrl.origin));
  }

  // 3. Unverified users cannot access protected routes → /unverified
  if (isLoggedIn && status === "unverified" && isProtected) {
    const unverifiedUrl = new URL("/unverified", nextUrl.origin);
    if (req.auth?.user?.email) unverifiedUrl.searchParams.set("email", req.auth.user.email);
    return NextResponse.redirect(unverifiedUrl);
  }

  // 4. Force-password-reset: must visit /reset-password before accessing app
  //    Let them stay on /reset-password; redirect away from everything else protected.
  if (isLoggedIn && forceReset && isProtected) {
    return NextResponse.redirect(
      new URL("/reset-password?force=1", nextUrl.origin)
    );
  }

  // 5. /reset-password: let forceReset users in; send everyone else to dashboard
  if (isResetPasswordRoute && isLoggedIn && !forceReset) {
    return NextResponse.redirect(new URL("/anops", nextUrl.origin));
  }

  // 6. Auth-only pages: active logged-in users go to dashboard; logged-in
  //    UNVERIFIED users go to /unverified. Never redirect a route onto
  //    itself — that caused an infinite redirect loop in production.
  if (isAuthOnlyRoute && isLoggedIn && !forceReset) {
    if (status === "unverified") {
      if (nextUrl.pathname !== "/unverified") {
        const unverifiedUrl = new URL("/unverified", nextUrl.origin);
        if (req.auth?.user?.email) unverifiedUrl.searchParams.set("email", req.auth.user.email);
        return NextResponse.redirect(unverifiedUrl);
      }
      return proceed();
    }
    return NextResponse.redirect(new URL("/anops", nextUrl.origin));
  }

  return proceed();
}

/**
 * Access rules (decide) plus a per-request Content-Security-Policy. The nonce travels to the app in request headers
 * (Next.js applies it to its own scripts; the root layout passes it to the theme script) and the policy goes out on the response.
 */
export default auth((req) => {
  const nonce = createNonce();
  const secureRequest = req.nextUrl.protocol === "https:" || req.headers.get("x-forwarded-proto") === "https";
  const csp = buildCsp(nonce, { development: process.env.NODE_ENV === "development", secureRequest });
  const requestHeaders = new Headers(req.headers);
  requestHeaders.set("x-nonce", nonce);
  requestHeaders.set("content-security-policy", csp);
  const response = decide(req, requestHeaders);
  response.headers.set("Content-Security-Policy", csp);
  return response;
});

export const config = {
  matcher: [
    "/((?!api|_next/static|_next/image|brand-kit/|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|webp|gif|ico|js|json|txt|xml|css|woff2?)$).*)",
  ],
};
