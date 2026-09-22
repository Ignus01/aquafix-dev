import { requireRole } from "@/lib/auth";
import { listUsers } from "./actions";
import { RoleToggles } from "./role-toggles";
import CreateUserForm from "./create-user-form";

export default async function UsersPage() {
  await requireRole(["system_admin"]);
  const users = await listUsers();

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-10">
      <h1 className="mb-1 text-2xl font-semibold text-zinc-950 dark:text-zinc-50">
        User management
      </h1>
      <p className="mb-8 text-sm text-zinc-600 dark:text-zinc-400">
        Create accounts and manage masterdata roles (system_admin, admin,
        user, viewer).
      </p>

      <section className="mb-10 rounded-lg border border-black/[.08] p-6 dark:border-white/[.145]">
        <h2 className="mb-4 text-lg font-medium text-zinc-950 dark:text-zinc-50">
          Add user
        </h2>
        <CreateUserForm />
      </section>

      <section>
        <h2 className="mb-4 text-lg font-medium text-zinc-950 dark:text-zinc-50">
          Existing users ({users.length})
        </h2>
        <div className="overflow-x-auto rounded-lg border border-black/[.08] dark:border-white/[.145]">
          <table className="w-full text-sm">
            <thead className="bg-zinc-50 text-left dark:bg-zinc-900">
              <tr>
                <th className="px-4 py-2 font-medium">Username</th>
                <th className="px-4 py-2 font-medium">Email</th>
                <th className="px-4 py-2 font-medium">Phone</th>
                <th className="px-4 py-2 font-medium">Roles</th>
              </tr>
            </thead>
            <tbody>
              {users.map((u) => (
                <tr
                  key={u.id}
                  className="border-t border-black/[.08] dark:border-white/[.145]"
                >
                  <td className="px-4 py-3 font-medium">{u.username}</td>
                  <td className="px-4 py-3">{u.email}</td>
                  <td className="px-4 py-3">{u.phone ?? "—"}</td>
                  <td className="px-4 py-3">
                    <RoleToggles userId={u.id} roles={u.roles} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>
    </div>
  );
}
