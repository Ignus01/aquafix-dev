"use client";

import { useActionState } from "react";
import { createUser, type CreateUserState } from "./actions";

const ROLES = ["system_admin", "admin", "user", "viewer"] as const;

const inputClass =
  "h-[42px] rounded-control border border-border bg-white px-3 text-sm text-ink outline-none transition-colors focus:border-primary";

const initialState: CreateUserState = { error: null, success: false };

export default function CreateUserForm() {
  const [state, formAction, pending] = useActionState(
    createUser,
    initialState,
  );

  return (
    <form action={formAction} className="grid gap-4 sm:grid-cols-2">
      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted" htmlFor="username">
          Username
        </label>
        <input id="username" name="username" required className={inputClass} />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted" htmlFor="email">
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

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted" htmlFor="phone">
          Phone (optional)
        </label>
        <input id="phone" name="phone" className={inputClass} />
      </div>

      <div className="flex flex-col gap-1.5">
        <label className="text-xs font-medium text-muted" htmlFor="password">
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

      <div className="col-span-full flex flex-col gap-1.5">
        <span className="text-xs font-medium text-muted">Roles</span>
        <div className="flex flex-wrap gap-2">
          {ROLES.map((role) => (
            <label
              key={role}
              className="flex h-[34px] cursor-pointer items-center gap-1.5 rounded-full border border-border bg-white px-3 text-[13px] font-medium text-ink transition-colors has-checked:border-primary has-checked:bg-primary/10 has-checked:text-primary-hover"
            >
              <input type="checkbox" name="roles" value={role} className="sr-only" />
              {role}
            </label>
          ))}
        </div>
      </div>

      {state.error && (
        <p className="col-span-full border-l-2 border-danger py-1 pl-3 text-[13px] text-danger">
          {state.error}
        </p>
      )}
      {state.success && (
        <p className="col-span-full border-l-2 border-success py-1 pl-3 text-[13px] text-success">
          User created.
        </p>
      )}

      <div className="col-span-full">
        <button
          type="submit"
          disabled={pending}
          className="h-[40px] rounded-control bg-primary px-4 text-sm font-semibold text-white transition-colors hover:bg-primary-hover disabled:opacity-60"
        >
          {pending ? "Creating…" : "Create user"}
        </button>
      </div>
    </form>
  );
}
