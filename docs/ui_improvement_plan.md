# UI Improvement & Feature Plan

A comprehensive analysis of the HomeTimeline UI, identifying gaps and opportunities
for improvement. Prioritized by impact and implementation effort.

---

## Tier 1: High Impact / Low Effort

### 1. Toast notifications

`@radix-ui/react-toast` is already installed but unused. Replace `window.confirm()`
calls and inline error messages with a proper toast notification system.

- Scan started/completed/failed
- Download started/completed/failed
- Purge completed/failed
- Settings saved
- Generic error feedback
- Actions that currently only show inline `<p role="alert">` text

### 2. Confirm dialogs

`@radix-ui/react-dialog` is installed but unused. Replace all `window.confirm()`
calls with a proper modal dialog component.

- Purge old videos confirmation
- Reindex confirmation
- Drop index confirmation
- Delete camera confirmation

### 3. Loading skeletons

Replace `"Loading..."` text across all pages with skeleton placeholders that match
the content shape (card skeletons, table row skeletons, chart skeleton). Reduces
perceived latency and looks polished.

Pages affected: Dashboard, Cameras, CameraDetail, Recordings, Activity, Logs,
all Settings pages.

### 4. Dark/Light mode toggle

CSS variables are already fully configured for both themes (see `:root` and `.dark`
in `index.css`). Add a toggle button in the sidebar footer or settings page.

- Store preference in `localStorage`
- Respect `prefers-color-scheme` as default
- Toggle the `.dark` class on `<html>`
- Icon: Sun/Moon toggle using lucide-react

---

## Tier 2: Feature Gaps

### 5. Recordings search, bulk actions & pagination

- Add free-text search across recording metadata (filename, camera name)
- Add multi-select checkboxes with bulk delete/download toolbar
- Add server-side pagination (limit/offset) instead of loading all recordings
- Currently limited to date range + camera filter

### 6. Activity filters

Add type filter (scan/download/purge), status filter (ok/error/interrupted), and
date range filter to the Activity page. Currently shows all events unfiltered.

### 7. Keyboard shortcuts help

Arrow keys work on the timeline player. Add a `?` shortcut or help icon that opens
a modal listing all available keyboard shortcuts:

- `← / →` — Previous/next clip
- `Space` — Play/pause video
- `Esc` — Close player or dialog

### 8. Video player fullscreen

Add a fullscreen button to the VideoPlayer component. The native `<video>` element
has controls but no dedicated fullscreen toggle in the custom toolbar.

### 9. Logs date/time filter

Logs page already has level filters and text search. Add a date/time range filter
to narrow down to specific time windows.

---

## Tier 3: UX Polish

### 10. Collapsible sidebar

Make the sidebar collapsible to an icon-only state, giving more horizontal space
on smaller screens. The app name and text labels hide; icons remain.

### 11. "Jump to today" on timeline

Add a button next to the date picker that resets the timeline to today's range.
Currently requires manual navigation.

### 12. Dashboard last scan duration

Show how long the last scan took (not just when it completed). The Activity page
already calculates duration — expose it on the dashboard too.

### 13. Recordings persist sort preference

Save sort key + direction to `localStorage` so the user's preferred sort order
survives page navigations.

### 14. Camera detail tabs state in URL

The active tab (timeline/details/commands) resets on page refresh. Move tab state
to the URL query string (`/cameras/1?tab=commands`) so deep linking works.

---

## Tier 4: Longer-term Features

### 15. Notification/webhook system

Allow configuring webhook URLs or email notifications for scan/download/purge
completions and errors.

### 16. Bookmarks / starred recordings

Let users bookmark important recordings. Simple boolean column on the Recording
model. Shown with a star icon in the table and filterable.

### 17. Export recordings as CSV

Add a download button next to the date picker on the Recordings page that exports
the current filtered/sorted list as a CSV file.

### 18. Error boundaries

Wrap each route page with a React Error Boundary so a crash in one page doesn't
take down the entire SPA.

### 19. Accessibility audit

Add `aria-label` to icon-only buttons (some already have them, many don't).
Ensure proper `role` attributes, focus management, and keyboard navigation across
all interactive components.