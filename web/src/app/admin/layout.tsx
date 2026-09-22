import { createClient } from "@/lib/supabase/server";
import { getCurrentUserRoles } from "@/lib/auth";
import { signOut } from "@/app/login/actions";
import { NavLink } from "./nav-link";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  const roles = user ? await getCurrentUserRoles() : [];
  const isSystemAdmin = roles.includes("system_admin");

  return (
    <div className="flex min-h-full flex-1 flex-col bg-zinc-50 dark:bg-black">
      <header className="border-b border-black/[.08] bg-white dark:border-white/[.145] dark:bg-zinc-950">
        <div className="mx-auto flex max-w-6xl items-center justify-between px-6 py-4">
          <div className="flex items-center gap-8">
            <span className="text-sm font-semibold text-zinc-950 dark:text-zinc-50">
              AquaFix
            </span>
            <nav className="flex items-center gap-1">
              <NavLink href="/admin/masterdata">Master Data</NavLink>
              {isSystemAdmin && <NavLink href="/admin/users">Users</NavLink>}
            </nav>
          </div>
          <div className="flex items-center gap-4 text-sm text-zinc-600 dark:text-zinc-400">
            {user?.email && <span>{user.email}</span>}
            <form action={signOut}>
              <button
                type="submit"
                className="underline underline-offset-2 hover:text-zinc-950 dark:hover:text-zinc-50"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
