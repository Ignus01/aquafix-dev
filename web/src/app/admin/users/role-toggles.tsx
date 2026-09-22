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
    <div className="flex flex-wrap gap-1.5">
      {ALL_ROLES.map((role) => {
        const checked = roles.includes(role);
        return (
          <button
            key={role}
            type="button"
            disabled={isPending}
            aria-pressed={checked}
            onClick={() => {
              const next = !checked;
              startTransition(async () => {
                await setUserRole(userId, role, next);
              });
            }}
            className={`h-[28px] rounded-full border px-2.5 text-xs font-medium transition-colors disabled:opacity-60 ${
              checked
                ? "border-primary bg-primary/10 text-primary-hover"
                : "border-border bg-white text-muted hover:bg-black/[.02]"
            }`}
          >
            {role}
          </button>
        );
      })}
    </div>
  );
}
