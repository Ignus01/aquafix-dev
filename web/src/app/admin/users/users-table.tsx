"use client";

import type { MasterdataRole } from "@/lib/auth";
import type { GridSpec } from "@/lib/grid/types";
import { formatDateTime } from "@/lib/incidents/format";
import { Dash, type GridColumn } from "../grid/columns";
import { Grid } from "../grid/grid";
import type { ListedUser } from "./actions";
import { RoleToggles } from "./role-toggles";

const ROLE_OPTIONS: { value: MasterdataRole; label: string }[] = [
  { value: "system_admin", label: "System admin" },
  { value: "admin", label: "Admin" },
  { value: "user", label: "User" },
  { value: "viewer", label: "Viewer" },
];

// Admin → User Management. Roles are changed in the row itself; there is no
// separate edit page. Changed is auth.users.updated_at (profile, password and
// sign-in changes); who made a change isn't recorded anywhere, so there is no
// Changed by.
const usersGrid: GridSpec = {
  id: "users",
  fields: [
    { key: "username", label: "Username", filter: "text" },
    { key: "email", label: "Email", filter: "text" },
    { key: "phone", label: "Phone", filter: "text", hideable: true },
    { key: "roles", label: "Roles", filter: "choice", options: ROLE_OPTIONS, sortable: false },
    { key: "changed", label: "Changed", filter: "datetime" },
  ],
  defaultSort: { key: "changed", desc: true },
  changedException: "auth.users and profiles don't record who changed an account.",
};

export function UsersTable({ users, timeZone }: { users: ListedUser[]; timeZone: string }) {
  const columns: GridColumn<ListedUser>[] = [
    { key: "username", render: (u) => u.username, value: (u) => u.username },
    { key: "email", render: (u) => u.email, value: (u) => u.email },
    { key: "phone", render: (u) => u.phone ?? <Dash />, value: (u) => u.phone },
    {
      key: "roles",
      className: "py-1.5",
      render: (u) => (
        <div className="min-w-[330px]">
          <RoleToggles userId={u.id} roles={u.roles} />
        </div>
      ),
      value: (u) => u.roles,
    },
    {
      key: "changed",
      render: (u) => <span className="text-muted tabular-nums">{formatDateTime(u.updatedAt, timeZone)}</span>,
      value: (u) => u.updatedAt,
    },
  ];

  return (
    <Grid
      mode="client"
      spec={usersGrid}
      rows={users}
      columns={columns}
      getKey={(u) => u.id}
      title="Users"
      timeZone={timeZone}
      rowLabel={(u) => u.username}
      rowMenu={(u) => [{ label: "Copy email", onSelect: () => navigator.clipboard?.writeText(u.email) }]}
      emptyLabel="No users yet."
    />
  );
}
