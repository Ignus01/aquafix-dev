"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { ConfirmDialog } from "./confirm";
import { Popover } from "./popover";

export type RowMenuItem = {
  label: string;
  href?: string;
  // May be async (a server action); the menu waits before closing the
  // confirmation.
  onSelect?: () => unknown;
  danger?: boolean;
  // Asks first, in an in-page dialog, with this message.
  confirm?: string;
  shortcut?: string;
};

const itemClass =
  "flex w-full items-center justify-between gap-4 px-3 py-1.5 text-left text-[13px] outline-none transition-colors focus:bg-row-hover hover:bg-row-hover";

// The ⋯ button next to a row's ID. Shown on row hover, on keyboard focus and
// always on touch screens. Danger items (Delete) go last, after a divider.
export function RowMenu({ label, items }: { label: string; items: RowMenuItem[] }) {
  const [open, setOpen] = useState(false);
  const [confirming, setConfirming] = useState<RowMenuItem | null>(null);
  const [busy, setBusy] = useState(false);
  const button = useRef<HTMLButtonElement>(null);
  const list = useRef<HTMLDivElement>(null);

  const safe = items.filter((i) => !i.danger);
  const danger = items.filter((i) => i.danger);
  const ordered = [...safe, ...danger];

  useEffect(() => {
    if (open) list.current?.querySelector<HTMLElement>("[role=menuitem]")?.focus();
  }, [open]);

  if (ordered.length === 0) return null;

  function onKeyDown(e: React.KeyboardEvent) {
    const els = [...(list.current?.querySelectorAll<HTMLElement>("[role=menuitem]") ?? [])];
    const i = els.indexOf(document.activeElement as HTMLElement);
    const go = (n: number) => {
      e.preventDefault();
      els[(n + els.length) % els.length]?.focus();
    };
    if (e.key === "ArrowDown") go(i + 1);
    else if (e.key === "ArrowUp") go(i - 1);
    else if (e.key === "Home") go(0);
    else if (e.key === "End") go(els.length - 1);
    else if (e.key === "Tab") setOpen(false);
  }

  function choose(item: RowMenuItem) {
    setOpen(false);
    if (item.confirm) {
      setConfirming(item);
      return;
    }
    item.onSelect?.();
  }

  async function confirm() {
    if (!confirming) return;
    setBusy(true);
    try {
      await confirming.onSelect?.();
    } finally {
      setBusy(false);
      setConfirming(null);
    }
  }

  const render = (item: RowMenuItem) => {
    const cls = `${itemClass} ${item.danger ? "text-danger" : "text-ink"}`;
    const body = (
      <>
        {item.label}
        {item.shortcut && <span className="text-xs text-muted">{item.shortcut}</span>}
      </>
    );
    return item.href && !item.confirm ? (
      <Link key={item.label} href={item.href} role="menuitem" tabIndex={-1} className={cls} onClick={() => setOpen(false)}>
        {body}
      </Link>
    ) : (
      <button key={item.label} type="button" role="menuitem" tabIndex={-1} className={cls} onClick={() => choose(item)}>
        {body}
      </button>
    );
  };

  return (
    <>
      <button
        ref={button}
        type="button"
        aria-label={`Actions for ${label}`}
        aria-haspopup="menu"
        aria-expanded={open}
        onClick={() => setOpen((o) => !o)}
        onKeyDown={(e) => {
          if (e.key === "ArrowDown" && !open) {
            e.preventDefault();
            setOpen(true);
          }
        }}
        // Styled in globals.css: shown on row hover / focus, always on touch.
        className="grid-row-menu"
      >
        <svg viewBox="0 0 20 20" fill="currentColor" className="h-4 w-4" aria-hidden="true">
          <circle cx="4.5" cy="10" r="1.5" />
          <circle cx="10" cy="10" r="1.5" />
          <circle cx="15.5" cy="10" r="1.5" />
        </svg>
      </button>
      <Popover anchor={button} open={open} onClose={() => setOpen(false)} role="menu" label={`Actions for ${label}`} className="min-w-[180px] py-1">
        <div ref={list} onKeyDown={onKeyDown}>
          {safe.map(render)}
          {safe.length > 0 && danger.length > 0 && <div role="separator" className="my-1 h-px bg-border" />}
          {danger.map(render)}
        </div>
      </Popover>
      <ConfirmDialog
        open={confirming !== null}
        title={`${confirming?.label ?? ""} ${label}?`}
        message={confirming?.confirm ?? ""}
        confirmLabel={confirming?.label}
        danger={confirming?.danger ?? true}
        busy={busy}
        onConfirm={confirm}
        onCancel={() => setConfirming(null)}
      />
    </>
  );
}
