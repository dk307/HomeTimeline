import { useEffect, useId, useLayoutEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { Check, ChevronsUpDown, Search } from "lucide-react";
import { cn } from "@/lib/utils";

export interface ComboboxOption {
  value: string;
  label: string;
  group?: string;
}

interface ComboboxProps {
  options: ComboboxOption[];
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  searchPlaceholder?: string;
  className?: string;
  id?: string;
}

/**
 * Searchable single-select. Type to filter a long option list (e.g. timezones).
 * Renders its dropdown in a body portal so it escapes card overflow.
 */
export function Combobox({
  options,
  value,
  onChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  className,
  id,
}: ComboboxProps) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const [pos, setPos] = useState({ top: 0, left: 0, width: 0 });
  const [activeIndex, setActiveIndex] = useState(0);
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const listboxId = useId();

  const selected = options.find((o) => o.value === value);

  function place() {
    if (!btnRef.current) return;
    const r = btnRef.current.getBoundingClientRect();
    setPos({ top: r.bottom + 6, left: r.left, width: r.width });
  }

  function toggle() {
    if (!open) place();
    setQuery("");
    setActiveIndex(0);
    setOpen((v) => !v);
  }

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  // Keep the portal aligned with the trigger while open — the fixed popup would
  // otherwise drift when the page scrolls or the window resizes.
  useEffect(() => {
    if (!open) return;
    const onMove = () => place();
    window.addEventListener("scroll", onMove, true);
    window.addEventListener("resize", onMove);
    return () => {
      window.removeEventListener("scroll", onMove, true);
      window.removeEventListener("resize", onMove);
    };
  }, [open]);

  useEffect(() => {
    function handle(e: MouseEvent) {
      if (
        popRef.current && !popRef.current.contains(e.target as Node) &&
        btnRef.current && !btnRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    }
    if (open) document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [open]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) => o.label.toLowerCase().includes(q) || o.value.toLowerCase().includes(q),
    );
  }, [options, query]);

  // Clamp the active option whenever the filtered set changes.
  useEffect(() => {
    setActiveIndex((i) => (filtered.length === 0 ? 0 : Math.min(i, filtered.length - 1)));
  }, [filtered]);

  // Keep the active option scrolled into view for keyboard navigation.
  useLayoutEffect(() => {
    if (!open) return;
    listRef.current?.querySelector<HTMLElement>('[data-active="true"]')?.scrollIntoView({ block: "nearest" });
  }, [activeIndex, open]);

  function pick(v: string) {
    onChange(v);
    setOpen(false);
  }

  function optionId(i: number) {
    return `${listboxId}-opt-${i}`;
  }

  function onKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Escape") {
      setOpen(false);
    } else if (e.key === "ArrowDown") {
      e.preventDefault();
      setActiveIndex((i) => (filtered.length ? (i + 1) % filtered.length : 0));
    } else if (e.key === "ArrowUp") {
      e.preventDefault();
      setActiveIndex((i) => (filtered.length ? (i - 1 + filtered.length) % filtered.length : 0));
    } else if (e.key === "Enter") {
      e.preventDefault();
      if (filtered[activeIndex]) pick(filtered[activeIndex].value);
    }
  }

  const popup = open
    ? createPortal(
        <div
          ref={popRef}
          className="fixed z-[120] rounded-md border bg-popover text-popover-foreground shadow-lg overflow-hidden"
          style={{ top: pos.top, left: pos.left, width: Math.max(pos.width, 240) }}
        >
          <div className="flex items-center gap-2 border-b px-3">
            <Search size={14} className="text-muted-foreground shrink-0" />
            <input
              ref={inputRef}
              role="combobox"
              aria-expanded={open}
              aria-controls={listboxId}
              aria-autocomplete="list"
              aria-activedescendant={filtered.length ? optionId(activeIndex) : undefined}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={onKeyDown}
              placeholder={searchPlaceholder}
              className="w-full bg-transparent py-2 text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div ref={listRef} id={listboxId} role="listbox" className="max-h-64 overflow-y-auto p-1">
            {filtered.length === 0 && (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">No matches</div>
            )}
            {filtered.map((o, i) => (
              <button
                key={o.value}
                id={optionId(i)}
                role="option"
                aria-selected={o.value === value}
                data-active={i === activeIndex}
                onClick={() => pick(o.value)}
                onMouseEnter={() => setActiveIndex(i)}
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors",
                  i === activeIndex ? "bg-accent text-accent-foreground" : "hover:bg-accent",
                )}
              >
                <span className="truncate">
                  {o.label}
                  {o.group && <span className="ml-2 text-xs text-muted-foreground">{o.group}</span>}
                </span>
                {o.value === value && <Check size={14} className="text-primary shrink-0" />}
              </button>
            ))}
          </div>
        </div>,
        document.body,
      )
    : null;

  return (
    <>
      <button
        id={id}
        ref={btnRef}
        type="button"
        aria-haspopup="listbox"
        aria-expanded={open}
        onClick={toggle}
        className={cn(
          "flex h-9 w-full items-center justify-between gap-2 rounded-md border border-input bg-card px-3 py-1 text-sm shadow-sm transition-colors",
          "hover:bg-accent focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 focus:ring-offset-background",
          open && "ring-2 ring-ring ring-offset-1 ring-offset-background",
          className,
        )}
      >
        <span className={cn("truncate", !selected && "text-muted-foreground")}>
          {selected ? selected.label : placeholder}
        </span>
        <ChevronsUpDown size={14} className="text-muted-foreground shrink-0" />
      </button>
      {popup}
    </>
  );
}
