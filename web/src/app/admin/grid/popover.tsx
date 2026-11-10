"use client";

import { useEffect, useLayoutEffect, useRef, type ReactNode, type RefObject } from "react";
import { createPortal } from "react-dom";

// A panel anchored to a button, portalled to <body> with position: fixed so
// the grid's scroll container and sticky cells can't clip or cover it.
// Closes on Escape (focus goes back to the anchor) and on a click outside.
export function Popover({
  anchor,
  open,
  onClose,
  children,
  align = "start",
  role,
  label,
  className = "",
}: {
  anchor: RefObject<HTMLElement | null>;
  open: boolean;
  onClose: () => void;
  children: ReactNode;
  align?: "start" | "end";
  role?: "menu" | "dialog";
  label?: string;
  className?: string;
}) {
  const panel = useRef<HTMLDivElement>(null);
  // Placed by writing the panel's style directly: it depends on the
  // panel's own size, known only once it is in the DOM.
  useLayoutEffect(() => {
    if (!open) return;
    function place() {
      const a = anchor.current?.getBoundingClientRect();
      const p = panel.current;
      if (!a || !p) return;
      const w = p.offsetWidth;
      const h = p.offsetHeight;
      let left = align === "end" ? a.right - w : a.left;
      left = Math.max(8, Math.min(left, window.innerWidth - w - 8));
      // Open upwards when there's no room below.
      let top = a.bottom + 4;
      if (top + h > window.innerHeight - 8 && a.top - h - 4 > 8) top = a.top - h - 4;
      p.style.top = `${top}px`;
      p.style.left = `${left}px`;
    }
    place();
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, anchor, align]);

  useEffect(() => {
    if (!open) return;
    function onDown(e: PointerEvent) {
      const t = e.target as Node;
      if (panel.current?.contains(t) || anchor.current?.contains(t)) return;
      onClose();
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") {
        e.stopPropagation();
        onClose();
        anchor.current?.focus();
      }
    }
    document.addEventListener("pointerdown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, anchor]);

  if (!open) return null;
  return createPortal(
    <div
      ref={panel}
      role={role}
      aria-label={label}
      style={{ top: -9999, left: -9999 }}
      className={`fixed z-[70] rounded-control border border-border bg-card shadow-lg ${className}`}
    >
      {children}
    </div>,
    document.body,
  );
}
