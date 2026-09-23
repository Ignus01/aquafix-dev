import { getCurrentUser, getCurrentUserRoles } from "@/lib/auth";
import { signOut } from "@/app/login/actions";
import { Sidebar } from "./sidebar";

export default async function AdminLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const user = await getCurrentUser();
  const roles = user ? await getCurrentUserRoles() : [];
  const isSystemAdmin = roles.includes("system_admin");

  return (
    <div className="flex min-h-full flex-1 flex-col bg-page md:flex-row">
      <Sidebar
        email={user?.email ?? null}
        isSystemAdmin={isSystemAdmin}
        signOutAction={signOut}
      />
      <main className="flex flex-1 flex-col overflow-y-auto">{children}</main>
    </div>
  );
}
