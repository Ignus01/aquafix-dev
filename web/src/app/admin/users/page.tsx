import { requireRole } from "@/lib/auth";
import { PageHeader } from "../page-header";
import { listUsers } from "./actions";
import { RoleToggles } from "./role-toggles";
import CreateUserForm from "./create-user-form";

export default async function UsersPage() {
  await requireRole(["system_admin"]);
  const users = await listUsers();

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader breadcrumb="Setup / Users" title="Users" />

      <div className="flex flex-col gap-6 px-8 pb-10">
        <section className="rounded-card border border-border bg-card p-6">
          <h2 className="mb-4 text-[11px] font-semibold tracking-wider text-muted uppercase">
            Add user
          </h2>
          <CreateUserForm />
        </section>

        <section className="rounded-card border border-border bg-card p-6">
          <h2 className="mb-4 text-[11px] font-semibold tracking-wider text-muted uppercase">
            Existing users ({users.length})
          </h2>
          <div className="overflow-x-auto rounded-control border border-border">
            <table className="w-full text-sm">
              <thead>
                <tr className="bg-table-head">
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold tracking-wider text-muted uppercase">
                    Username
                  </th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold tracking-wider text-muted uppercase">
                    Email
                  </th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold tracking-wider text-muted uppercase">
                    Phone
                  </th>
                  <th className="px-4 py-2.5 text-left text-[11px] font-semibold tracking-wider text-muted uppercase">
                    Roles
                  </th>
                </tr>
              </thead>
              <tbody>
                {users.map((u) => (
                  <tr
                    key={u.id}
                    className="h-[50px] border-t border-border transition-colors hover:bg-row-hover"
                  >
                    <td className="px-4 font-medium text-ink">{u.username}</td>
                    <td className="px-4 text-ink">{u.email}</td>
                    <td className="px-4 text-ink">{u.phone ?? "—"}</td>
                    <td className="px-4 py-2">
                      <RoleToggles userId={u.id} roles={u.roles} />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
    </div>
  );
}
