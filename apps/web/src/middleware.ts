import { NextResponse, type NextRequest } from "next/server";

const SESSION_COOKIE = "platform.mock.session";
const ROLE_COOKIE = "platform.role";

const DEVELOPER_RESTRICTED_PREFIXES = [
  "/admin/dashboard",
  "/admin/organizations",
  "/admin/users",
  "/admin/students",
  "/admin/teachers",
  "/admin/classes",
  "/admin/sections",
  "/admin/allocations",
  "/admin/invitations",
  "/admin/assignments",
  "/admin/reports",
  "/admin/audit-logs",
  "/admin/search",
  "/admin/college",
  "/admin/academic",
  "/admin/departments",
  "/admin/platform",
];

function homeForRole(role: string | undefined): string {
  if (role === "TEACHER") return "/teacher/dashboard";
  if (role === "PLATFORM_DEVELOPER") return "/admin/courses";
  return "/admin/dashboard";
}

// Note: Next.js normalizes loopback hosts in redirects (127.0.0.1 → localhost). Cookies and
// localStorage are per-host, so local development and E2E tests must browse `localhost`
// consistently; real deployments use a single public domain and are unaffected.
function redirectTo(request: NextRequest, pathname: string, search = ""): NextResponse {
  return NextResponse.redirect(new URL(`${pathname}${search}`, request.url));
}

// Frontend route boundary only. These cookies are not an authentication mechanism; all
// authorization is enforced by the private backend API using HttpOnly JWT + PostgreSQL RLS.
export function middleware(request: NextRequest) {
  const hasSession = request.cookies.get(SESSION_COOKIE)?.value === "1";
  const role = request.cookies.get(ROLE_COOKIE)?.value;
  const { pathname, search } = request.nextUrl;

  if ((pathname.startsWith("/admin") || pathname.startsWith("/teacher")) && !hasSession) {
    return redirectTo(request, "/login", `?${new URLSearchParams({ next: `${pathname}${search}` })}`);
  }

  if (
    hasSession &&
    role === "STUDENT" &&
    (pathname.startsWith("/admin") || pathname.startsWith("/teacher"))
  ) {
    return redirectTo(request, "/login");
  }

  if (hasSession && role === "TEACHER" && pathname.startsWith("/admin")) {
    return redirectTo(request, "/teacher/dashboard");
  }

  if (
    hasSession &&
    role === "PLATFORM_DEVELOPER" &&
    (pathname.startsWith("/teacher") ||
      DEVELOPER_RESTRICTED_PREFIXES.some((prefix) => pathname.startsWith(prefix)))
  ) {
    return redirectTo(request, "/admin/courses");
  }

  if (pathname === "/login" && hasSession && role !== "STUDENT") {
    return redirectTo(request, homeForRole(role));
  }

  // "/" is the public marketing and download page.

  return NextResponse.next();
}

export const config = {
  matcher: ["/", "/login", "/admin/:path*", "/teacher/:path*"],
};
