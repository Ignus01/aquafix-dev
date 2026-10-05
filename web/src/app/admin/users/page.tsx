import { requireRole } from "@/lib/auth";
import { PageHeader } from "../page-header";
import { listUsers } from "./actions";
import { UsersTable } from "./users-table";
import CreateUserForm from "./create-user-form";

export default async function UsersPage() {
  await requireRole(["system_admin"]);
  const users = await listUsers();

  return (
    <div className="flex flex-1 flex-col">
      <PageHeader breadcrumb="Admin / User Management" title="User Management" />

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
          <UsersTable users={users} />
        </section>
      </div>
    </div>
  );
}
