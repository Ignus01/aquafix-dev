"use client";

import { useMemo, useState } from "react";
import {
  Pagination,
  SearchInput,
  SortableTh,
  sortRows,
  usePagination,
  useSort,
  type SortValue,
} from "../data-grid";
import type { ListedUser } from "./actions";
import { RoleToggles } from "./role-toggles";

const SORTERS: Record<string, (u: ListedUser) => SortValue> = {
  username: (u) => u.username,
  email: (u) => u.email,
  phone: (u) => u.phone,
};

const headClass = "px-4 py-2.5 text-left text-[11px] font-semibold text-muted whitespace-nowrap";

export function UsersTable({ users }: { users: ListedUser[] }) {
  const [query, setQuery] = useState("");
  const [sort, toggleSort] = useSort();

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matched = q
      ? users.filter((u) =>
          [u.username, u.email, u.phone ?? "", ...u.roles].some((v) => v.toLowerCase().includes(q)),
        )
      : users;
    return sort ? sortRows(matched, SORTERS[sort.key], sort.desc) : matched;
  }, [users, query, sort]);

  const { pageItems, ...paging } = usePagination(filtered, `${query}|${sort?.key}|${sort?.desc}`);

  return (
    <div data-grid className="flex scroll-mt-4 flex-col gap-4">
      <SearchInput value={query} onChange={setQuery} placeholder="Search users…" />

      <div className="overflow-hidden rounded-control border border-border">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-table-head">
                <SortableTh label="Username" sortKey="username" sort={sort} onSort={toggleSort} className={headClass} />
                <SortableTh label="Email" sortKey="email" sort={sort} onSort={toggleSort} className={headClass} />
                <SortableTh label="Phone" sortKey="phone" sort={sort} onSort={toggleSort} className={headClass} />
                <th className={`${headClass} tracking-wider uppercase`}>Roles</th>
              </tr>
            </thead>
            <tbody>
              {pageItems.length === 0 && (
                <tr>
                  <td colSpan={4} className="px-4 py-8 text-center text-muted">
                    {users.length === 0 ? "No users yet." : `No users match “${query.trim()}”.`}
                  </td>
                </tr>
              )}
              {pageItems.map((u) => (
                <tr key={u.id} className="h-[50px] border-t border-border transition-colors hover:bg-row-hover">
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
        <Pagination {...paging} className="border-t border-border px-4 py-2" />
      </div>
    </div>
  );
}
