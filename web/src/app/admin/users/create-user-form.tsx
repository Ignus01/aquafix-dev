"use client";

import { useActionState } from "react";
import { createUser, type CreateUserState } from "./actions";

const ROLES = ["system_admin", "admin", "user", "viewer"] as const;

const inputClass =
  "rounded-md border border-black/[.12] bg-transparent px-3 py-2 text-sm outline-none focus:border-zinc-950 dark:border-white/[.18] dark:focus:border-zinc-50";

const initialState: CreateUserState = { error: null, success: false };

export default function CreateUserForm() {
  const [state, formAction, pending] = useActionState(
    createUser,
    initialState,
  );

  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-2">
      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium" htmlFor="username">
          Username
        </label>
        <input id="username" name="username" required className={inputClass} />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium" htmlFor="email">
          Email
        </label>
        <input
          id="email"
          name="email"
          type="email"
          required
          className={inputClass}
        />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium" htmlFor="phone">
          Phone (optional)
        </label>
        <input id="phone" name="phone" className={inputClass} />
      </div>

      <div className="flex flex-col gap-1">
        <label className="text-sm font-medium" htmlFor="password">
          Temporary password
        </label>
        <input
          id="password"
          name="password"
          type="text"
          required
          minLength={8}
          className={inputClass}
        />
      </div>

      <div className="col-span-full flex flex-col gap-1">
        <span className="text-sm font-medium">Roles</span>
        <div className="flex flex-wrap gap-4">
          {ROLES.map((role) => (
            <label key={role} className="flex items-center gap-1.5 text-sm">
              <input type="checkbox" name="roles" value={role} />
              {role}
            </label>
          ))}
        </div>
      </div>

      {state.error && (
        <p className="col-span-full text-sm text-red-600 dark:text-red-400">
          {state.error}
        </p>
      )}
      {state.success && (
        <p className="col-span-full text-sm text-green-600 dark:text-green-400">
          User created.
        </p>
      )}

      <div className="col-span-full">
        <button
          type="submit"
          disabled={pending}
          className="rounded-full bg-foreground px-4 py-2 text-sm font-medium text-background transition-colors hover:bg-[#383838] disabled:opacity-60 dark:hover:bg-[#ccc]"
        >
          {pending ? "Creating…" : "Create user"}
        </button>
      </div>
    </form>
  );
}
