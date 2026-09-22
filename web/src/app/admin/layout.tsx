import { createClient } from "@/lib/supabase/server";
import { getCurrentUserRoles } from "@/lib/auth";
import { signOut } from "@/app/login/actions";
import { Sidebar } from "./sidebar";

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
    <div className="flex min-h-full flex-1 bg-page">
      <Sidebar
        email={user?.email ?? null}
        showUsers={isSystemAdmin}
        signOutAction={signOut}
      />
      <main className="flex flex-1 flex-col overflow-y-auto">{children}</main>
    </div>
  );
}
