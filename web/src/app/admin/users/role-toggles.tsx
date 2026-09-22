"use client";

import { useTransition } from "react";
import { setUserRole } from "./actions";
import type { MasterdataRole } from "@/lib/auth";

const ALL_ROLES: MasterdataRole[] = [
  "system_admin",
  "admin",
  "user",
  "viewer",
];

export function RoleToggles({
  userId,
  roles,
}: {
  userId: string;
  roles: MasterdataRole[];
}) {
  const [isPending, startTransition] = useTransition();

  return (
    <div className="flex flex-wrap gap-3">
      {ALL_ROLES.map((role) => {
        const checked = roles.includes(role);
        return (
          <label
            key={role}
            className="flex items-center gap-1.5 text-xs text-zinc-700 dark:text-zinc-300"
          >
            <input
              type="checkbox"
              checked={checked}
              disabled={isPending}
              onChange={(e) => {
                const next = e.target.checked;
                startTransition(async () => {
                  await setUserRole(userId, role, next);
                });
              }}
            />
            {role}
          </label>
        );
      })}
    </div>
  );
}
