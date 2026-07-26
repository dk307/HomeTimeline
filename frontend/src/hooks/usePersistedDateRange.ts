import { useState, useEffect } from "react";

interface PersistedRange {
  preset: string;
  from: string;
  to: string;
  days: number;
}

export function usePersistedDateRange(
  storageKey: string,
  defaults: PersistedRange,
) {
  const [state, setState] = useState<PersistedRange>(() => {
    try {
      const raw = localStorage.getItem(storageKey);
      if (raw) {
        const parsed = JSON.parse(raw);
        if (
          parsed &&
          typeof parsed.preset === "string" &&
          typeof parsed.from === "string" &&
          typeof parsed.to === "string" &&
          typeof parsed.days === "number" &&
          parsed.days > 0 &&
          Number.isFinite(parsed.days)
        ) {
          return {
            preset: parsed.preset,
            from: parsed.from,
            to: parsed.to,
            days: parsed.days,
          };
        }
      }
    } catch { /* ignore */ }
    return defaults;
  });

  useEffect(() => {
    try {
      localStorage.setItem(storageKey, JSON.stringify(state));
    } catch { /* ignore quota/blocked storage errors */ }
  }, [storageKey, state]);

  const setPreset = (p: string) => setState((s) => ({ ...s, preset: p }));
  const setFrom = (v: string) => setState((s) => ({ ...s, from: v }));
  const setTo = (v: string) => setState((s) => ({ ...s, to: v }));
  const setDays = (d: number) => setState((s) => ({ ...s, days: d }));

  return {
    preset: state.preset,
    from: state.from,
    to: state.to,
    days: state.days,
    setPreset,
    setFrom,
    setTo,
    setDays,
  };
}
