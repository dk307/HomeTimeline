# UI Modernization — Implementation Record

Replaced hand-rolled UI primitives with prebuilt headless/accessible component
libraries. All phases completed, 271 tests passing, TypeScript clean.

---

## Summary of changes

| Phase | What | Replaced | Library used | Files changed |
|-------|------|----------|-------------|---------------|
| 0 | Package swap | 4 dead Radix deps removed, 5 new deps installed | — | `package.json` |
| 1 | Dark mode | Custom `useTheme` hook | `next-themes` | `main.tsx`, `App.tsx`, new `theme-provider.tsx`, new `ThemeToggle.tsx` |
| 2 | Tabs | Hand-rolled tab component (104 lines) | `@radix-ui/react-tabs` | `ui/tabs.tsx` |
| 3 | Date range pickers | 3 near-identical hand-rolled portals (~460 lines total) | `@radix-ui/react-popover` | New `ui/popover.tsx`, new `ui/date-range-picker.tsx`, `RecordingsChart.tsx`, `Recordings.tsx`, `TimelineControls.tsx` |
| 4 | Segmented controls | 4 plain `<button>` groups with no ARIA | `@radix-ui/react-toggle-group` | New `ui/toggle-group.tsx`, `Live.tsx`, `CameraDetail.tsx`, `Logs.tsx`, `Recordings.tsx` |
| 5 | Combobox | Hand-rolled combobox (211 lines) with manual portal/keyboard/filtering | `@ariakit/react` + `@radix-ui/react-popover` | `ui/combobox.tsx` |
| 6 | Native selects | 2 unstyled `<select>` elements | `@radix-ui/react-select` (existing) | `Live.tsx`, `CameraDetail.tsx` |
| 7 | E2E test updates | Selectors updated for new ARIA roles | — | `test_cameras.py`, `test_e2e.py`, `test_settings.py` |
| 8 | CSS cleanup | Dead `.ht-rdr-popup` CSS (27 lines) | — | `index.css` |

---

## Dependencies added

| Package | Purpose |
|---------|---------|
| `next-themes` | Dark/light mode with system detection, zero-flash, cross-tab sync |
| `@radix-ui/react-tabs` | Accessible tab component (arrow-key nav, roving tabindex, aria-controls) |
| `@radix-ui/react-toggle-group` | Segmented control with `role="radiogroup"` |
| `@radix-ui/react-popover` | Positioned floating panel (replaces hand-rolled portals) |
| `@ariakit/react` | Accessible combobox with built-in filtering, keyboard nav, Radix Popover integration |

## Dependencies removed

| Package | Reason |
|---------|--------|
| `@radix-ui/react-dropdown-menu` | Installed but never imported |
| `@radix-ui/react-label` | Installed but never imported |
| `@radix-ui/react-separator` | Installed but never imported |
| `@radix-ui/react-slot` | Installed but never imported |

## Dependencies kept (previously listed as unused)

| Package | Reason |
|---------|--------|
| `@radix-ui/react-toast` | IS used by `hooks/useToast.tsx` |

---

## New files created

| File | Lines | Purpose |
|------|-------|---------|
| `src/components/ui/theme-provider.tsx` | ~15 | `next-themes` ThemeProvider wrapper (`attribute="class"`, `defaultTheme="system"`, `enableSystem`, `disableTransitionOnChange`) |
| `src/components/ThemeToggle.tsx` | ~25 | Sun/Moon toggle using `useTheme()` from next-themes |
| `src/components/ThemeToggle.test.tsx` | ~60 | 7 tests: toggle, collapsed mode, labels, localStorage persistence |
| `src/components/ui/popover.tsx` | ~40 | shadcn/ui Radix Popover wrapper (Popover, PopoverTrigger, PopoverContent) |
| `src/components/ui/date-range-picker.tsx` | ~190 | Shared component: Radix Popover with preset list + calendar view (Back/Apply). Exports `SHARED_PRESETS` (Today, Yesterday, Last 7/14/30/60/90/180d). Check mark on active preset. |
| `src/components/ui/toggle-group.tsx` | ~33 | Radix ToggleGroup wrapper (ToggleGroup + ToggleGroupItem) |

## Key files modified

| File | Change |
|------|--------|
| `src/main.tsx` | Wrapped app with `<ThemeProvider>` |
| `src/App.tsx` | New ThemeToggle import path, removed useTheme |
| `src/components/ui/tabs.tsx` | Rewritten: Radix Tabs (~75 lines replacing ~104 lines) |
| `src/components/ui/combobox.tsx` | Rewritten: Ariakit + Radix Popover (~160 lines replacing ~211 lines) |
| `src/components/RecordingsChart.tsx` | Deleted ~180-line `DateRangeSelector` inner component, removed prev/next nav |
| `src/pages/Recordings.tsx` | Deleted ~163-line local `DateRangePicker`, removed prev/next nav, added "All time" preset, dead code cleanup |
| `src/components/TimelineControls.tsx` | Rewrote `DatePicker` export to use shared `DateRangePicker` |
| `src/pages/Live.tsx` | Replaced native `<select>` with Radix Select, layout buttons with ToggleGroup |
| `src/pages/CameraDetail.tsx` | Replaced native `<select>` with Radix Select, quality buttons with ToggleGroup, removed prev/next nav |
| `src/pages/Timeline.tsx` | Removed prev/next nav |
| `src/pages/Logs.tsx` | Level filter buttons → ToggleGroup |
| `src/index.css` | Removed dead `.ht-rdr-popup` CSS (27 lines) |

## Key files deleted

| File | Reason |
|------|--------|
| `src/hooks/useTheme.tsx` | Replaced by `next-themes` |
| `src/hooks/useTheme.test.tsx` | Replaced by `ThemeToggle.test.tsx` |

---

## Test impact

- **Frontend vitest:** 271 tests across 30 files, all passing
- **E2E selectors updated:**
  - Date range triggers: `get_by_role("button", name=...)` → `get_by_test_id("date-range-trigger")` (Popover button trigger)
  - Date range presets: `get_by_role("button", name=...)` → `get_by_role("option", name=...)` (inside Popover)
  - ToggleGroup items: `get_by_role("button", name=...)` → `get_by_role("radio", name=...)`
  - Camera switcher: `.select_option(value)` → click trigger + click option
  - Camera type combobox: unchanged (already Radix Select with `role="combobox"`)

---

## Dead code cleanup

After all phases completed, a diff audit removed:
- `Recordings.tsx`: Dead `playerHRef` ref + syncing `useEffect` (assigned but never read)
- `TimelineControls.tsx`: Removed unused `todayStr` export, un-exported local `TimelinePreset` interface
- `RecordingsChart.tsx`: Un-exported local `RecordingsChartProps` interface
- `Calendar.tsx`: Un-exported local `RangeCalendarProps` interface
- `Recordings.test.tsx`: Simplified camera filter selector (removed dead `data-testid` filter)

---

## DateRangePicker design

The shared `DateRangePicker` component (`ui/date-range-picker.tsx`) is a single Radix Popover that contains two views:

1. **Preset list** (default): `role="listbox"` with options like Today, Yesterday, Last 7/14/30/60/90/180 days. Check mark on active preset. Separator before "Custom range…" option.
2. **Calendar view** (when "Custom range" clicked): `RangeCalendar` (react-day-picker) with 2-month layout + Back/Apply footer.

- Trigger button shows `CalendarIcon` + display text (preset label OR "MMM d, yyyy – MMM d, yyyy" for custom range)
- `data-testid="date-range-trigger"` for E2E tests
- Exports `SHARED_PRESETS` — unified preset list used by all 3 consumers
- Prev/next arrows removed per UX decision (calendar has built-in month navigation)
- `pendingRange` state holds calendar selection until Apply is clicked
- Flash fix: synchronous `handleOpenChange` callback resets state on close (no `useEffect`)

---

## Deferred (phases 9-12)

Responsive/mobile improvements not yet implemented:
- Sidebar drawer pattern on mobile (< 768px)
- Touch target sizing (44x44px minimum)
- Table overflow handling
- Live view hover controls on touch devices
- Date range picker mobile layout (1-month calendar)
- Settings form responsive grids
