import { useEffect, useMemo, useRef, useState } from "react";
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
  const btnRef = useRef<HTMLButtonElement>(null);
  const popRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const selected = options.find((o) => o.value === value);

  function toggle() {
    if (!open && btnRef.current) {
      const r = btnRef.current.getBoundingClientRect();
      setPos({ top: r.bottom + 6, left: r.left, width: r.width });
    }
    setQuery("");
    setOpen((v) => !v);
  }

  useEffect(() => {
    if (open) setTimeout(() => inputRef.current?.focus(), 0);
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

  function pick(v: string) {
    onChange(v);
    setOpen(false);
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
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Escape") setOpen(false);
                if (e.key === "Enter" && filtered.length) pick(filtered[0].value);
              }}
              placeholder={searchPlaceholder}
              className="w-full bg-transparent py-2 text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div className="max-h-64 overflow-y-auto p-1">
            {filtered.length === 0 && (
              <div className="px-3 py-6 text-center text-sm text-muted-foreground">No matches</div>
            )}
            {filtered.map((o) => (
              <button
                key={o.value}
                onClick={() => pick(o.value)}
                className={cn(
                  "flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-left text-sm transition-colors",
                  o.value === value ? "bg-accent text-accent-foreground" : "hover:bg-accent",
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
