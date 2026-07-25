import { useState, useMemo } from "react";
import {
  ComboboxProvider,
  Combobox as AriakitCombobox,
  ComboboxList,
  ComboboxItem,
} from "@ariakit/react";
import * as RadixPopover from "@radix-ui/react-popover";
import { Check, ChevronsUpDown } from "lucide-react";
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

export function Combobox({
  options,
  value,
  onChange,
  placeholder = "Select…",
  searchPlaceholder = "Search…",
  className,
  id,
}: ComboboxProps) {
  const [query, setQuery] = useState("");
  const [open, setOpen] = useState(false);

  const selectedOption = options.find((o) => o.value === value);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return options;
    return options.filter(
      (o) =>
        o.label.toLowerCase().includes(q) ||
        o.value.toLowerCase().includes(q),
    );
  }, [options, query]);

  const grouped = useMemo(() => {
    const map = new Map<string, ComboboxOption[]>();
    for (const o of filtered) {
      const key = o.group ?? "";
      if (!map.has(key)) map.set(key, []);
      map.get(key)!.push(o);
    }
    return map;
  }, [filtered]);

  const handleOpenChange = (next: boolean) => {
    setOpen(next);
    if (!next) setQuery("");
  };

  const handleSetValue = (v: string) => {
    const match = options.find((o) => o.label === v);
    if (match) {
      onChange(match.value);
      setOpen(false);
      setQuery("");
    } else {
      setQuery(v);
    }
  };

  return (
    <RadixPopover.Root open={open} onOpenChange={handleOpenChange}>
      <ComboboxProvider
        value={query}
        setValue={handleSetValue}
        open={open}
        setOpen={handleOpenChange}
      >
        <RadixPopover.Trigger asChild>
          <button
            id={id}
            type="button"
            className={cn(
              "flex h-9 w-full items-center justify-between rounded-md border border-input bg-card px-3 py-1 text-sm shadow-sm transition-colors",
              "hover:bg-accent/50 focus:outline-none focus:ring-2 focus:ring-ring focus:ring-offset-1 focus:ring-offset-background",
              !selectedOption && "text-muted-foreground/50",
              className,
            )}
          >
            <span className="truncate">
              {selectedOption?.label ?? placeholder}
            </span>
            <ChevronsUpDown
              size={14}
              className="text-muted-foreground shrink-0 ml-2"
            />
          </button>
        </RadixPopover.Trigger>

        <RadixPopover.Portal>
          <RadixPopover.Content
            className={cn(
              "z-[120] w-[var(--radix-popover-trigger-width)] rounded-md border bg-popover p-1 shadow-lg outline-none",
              "data-[state=open]:animate-in data-[state=closed]:animate-out",
              "data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0",
              "data-[state=closed]:zoom-out-95 data-[state=open]:zoom-in-95",
              "data-[side=bottom]:slide-in-from-top-2 data-[side=top]:slide-in-from-bottom-2",
            )}
            sideOffset={4}
            onOpenAutoFocus={(e) => e.preventDefault()}
          >
            <AriakitCombobox
              placeholder={searchPlaceholder}
              className={cn(
                "flex h-8 w-full rounded border border-input bg-transparent px-2 text-sm",
                "placeholder:text-muted-foreground/50",
                "focus:outline-none focus:ring-1 focus:ring-ring",
              )}
            />
            <ComboboxList
              role="listbox"
              className="mt-1 max-h-64 overflow-auto"
            >
              {filtered.length === 0 ? (
                <div className="px-2 py-4 text-center text-sm text-muted-foreground">
                  No matches
                </div>
              ) : (
                Array.from(grouped.entries()).map(([group, items]) => (
                  <div key={group} role="group">
                    {group && (
                      <div className="px-2 py-1 text-xs font-medium text-muted-foreground">
                        {group}
                      </div>
                    )}
                    {items.map((o) => (
                      <ComboboxItem
                        key={o.value}
                        value={o.label}
                        focusOnHover
                        aria-selected={value === o.value ? "true" : undefined}
                        className={cn(
                          "flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1.5 text-sm cursor-pointer outline-none",
                          "data-[active-item]:bg-accent data-[active-item]:text-accent-foreground",
                        )}
                      >
                        <span className="truncate">{o.label}</span>
                        {value === o.value && (
                          <Check size={14} className="text-primary shrink-0" />
                        )}
                      </ComboboxItem>
                    ))}
                  </div>
                ))
              )}
            </ComboboxList>
          </RadixPopover.Content>
        </RadixPopover.Portal>
      </ComboboxProvider>
    </RadixPopover.Root>
  );
}
