import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

export async function updateSession(request: NextRequest) {
  let response = NextResponse.next({ request });

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) =>
            request.cookies.set(name, value),
          );
          response = NextResponse.next({ request });
          cookiesToSet.forEach(({ name, value, options }) =>
            response.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  // Refreshes the session if expired — required for Server Components,
  // which cannot write cookies themselves. getClaims() checks the token's
  // signature against the project's public keys, which are cached, so most
  // requests need no call to Supabase Auth here (a project still on a shared
  // JWT secret falls back to asking Auth, as getUser() does). This only
  // decides the redirects below: every page and action still confirms the
  // user with Auth through requireRole().
  const { data } = await supabase.auth.getClaims();
  const user = data?.claims ?? null;

  const path = request.nextUrl.pathname;
  const isAdminRoute = path.startsWith("/admin") || path === "/m" || path.startsWith("/m/");
  const isLoginRoute = path.startsWith("/login");

  if (!user && isAdminRoute) {
    const url = request.nextUrl.clone();
    url.pathname = "/login";
    url.searchParams.set("next", path);
    return NextResponse.redirect(url);
  }

  if (user && isLoginRoute) {
    const url = request.nextUrl.clone();
    const next = request.nextUrl.searchParams.get("next");
    url.pathname = next && next.startsWith("/") && !next.startsWith("//") ? next : "/admin";
    url.search = "";
    return NextResponse.redirect(url);
  }

  return response;
}
