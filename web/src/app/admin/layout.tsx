import { createClient } from "@/lib/supabase/server";
import { signOut } from "@/app/login/actions";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  return (
    <div className="flex min-h-full flex-1 flex-col bg-zinc-50 dark:bg-black">
      <header className="flex items-center justify-between border-b border-black/[.08] bg-white px-6 py-4 dark:border-white/[.145] dark:bg-zinc-950">
        <span className="text-sm font-medium text-zinc-950 dark:text-zinc-50">
          AquaFix Master Data
        </span>
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
      </header>
      <main className="flex flex-1 flex-col">{children}</main>
    </div>
  );
}
