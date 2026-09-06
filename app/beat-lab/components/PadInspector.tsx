"use client";

import { useEffect, useRef, type ReactNode } from "react";

export function PadInspector({
  open,
  title,
  modal,
  onClose,
  children,
}: {
  open: boolean;
  title: string;
  modal: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const panelRef = useRef<HTMLElement>(null);

  useEffect(() => {
    if (!open) return;
    const node = panelRef.current;
    if (!node) return;
    const focusable = () => Array.from(node.querySelectorAll<HTMLElement>(
      "button, [href], input, select, textarea, [tabindex]:not([tabindex='-1'])",
    )).filter((item) => !item.hasAttribute("disabled"));
    const items = focusable();
    items[0]?.focus();
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onClose();
        return;
      }
      if (!modal || event.key !== "Tab" || items.length === 0) return;
      const list = focusable();
      const first = list[0];
      const last = list[list.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last?.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first?.focus();
      }
    };
    node.addEventListener("keydown", onKey);
    return () => node.removeEventListener("keydown", onKey);
  }, [open, modal, onClose]);

  if (!open) return null;

  const panel = <section
    ref={panelRef}
    className={`bl-inspector ${modal ? "modal" : "docked"}`}
    role={modal ? "dialog" : "region"}
    aria-modal={modal || undefined}
    aria-label={title}
    data-bl-editor={modal ? "true" : undefined}
  >
    <header>
      <strong>{title}</strong>
      <button type="button" onClick={onClose} aria-label="Close pad editor">Close</button>
    </header>
    {children}
  </section>;

  if (!modal) return panel;
  return <div className="bl-inspector-layer" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose(); }}>
    {panel}
  </div>;
}
