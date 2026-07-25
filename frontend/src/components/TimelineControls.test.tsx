import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import {
  DatePicker,
  PRESETS,
  fmtRange,
  tickInterval,
  tickLabel,
} from "./TimelineControls";

describe("fmtRange", () => {
  it("shows a single dated label when from and to are the same day", () => {
    const d = new Date(2024, 0, 5);
    expect(fmtRange(d, d)).toBe("Jan 5, 2024");
  });

  it("omits the year on the start when both ends share a year", () => {
    expect(fmtRange(new Date(2024, 0, 5), new Date(2024, 0, 8))).toBe("Jan 5 – Jan 8, 2024");
  });

  it("keeps both years when the range crosses a year boundary", () => {
    expect(fmtRange(new Date(2023, 11, 30), new Date(2024, 0, 2))).toBe(
      "Dec 30, 2023 – Jan 2, 2024",
    );
  });
});

describe("tickInterval", () => {
  it.each([
    [1, 24],
    [2, 12],
    [4, 6],
    [8, 3],
    [16, 1],
    [32, 0.5],
  ])("maps zoom %i to a %f-hour interval", (zoom, expected) => {
    expect(tickInterval(zoom)).toBe(expected);
  });
});

describe("tickLabel", () => {
  const start = new Date(2024, 0, 1, 0, 0, 0);

  it("shows date-only labels when fully zoomed out", () => {
    expect(tickLabel(0, 1, start)).toBe("01/01");
  });

  it("shows date + time at mid zoom", () => {
    expect(tickLabel(6, 4, start)).toBe("01/01 06:00");
  });

  it("shows time-only when zoomed in", () => {
    expect(tickLabel(2, 8, start)).toBe("02:00");
  });
});

describe("PRESETS", () => {
  it("maps each preset id to the expected span in days", () => {
    const days = Object.fromEntries(PRESETS.map((p) => [p.id, p.days]));
    expect(days).toEqual({ today: 1, yesterday: 1, "7d": 7, "14d": 14, "30d": 30, "60d": 60, "90d": 90 });
  });
});

describe("<DatePicker />", () => {
  const baseProps = {
    preset: "today" as const,
    from: new Date(2024, 0, 5),
    to: new Date(2024, 0, 5),
    onApplyPreset: vi.fn(),
    onSelectRange: vi.fn(),
  };

  it("renders the active preset label", () => {
    render(<DatePicker {...baseProps} />);
    const trigger = screen.getByTestId("date-range-trigger");
    expect(trigger).toHaveTextContent("Today");
  });

  it("opens the popover and applies a preset on click", async () => {
    const onApplyPreset = vi.fn();
    const user = userEvent.setup();
    render(<DatePicker {...baseProps} onApplyPreset={onApplyPreset} />);

    // Open the popover
    const trigger = screen.getByTestId("date-range-trigger");
    expect(screen.queryByRole("option", { name: "Last 7 days" })).toBeNull();
    await user.click(trigger);

    await user.click(screen.getByRole("option", { name: "Last 7 days" }));
    expect(onApplyPreset).toHaveBeenCalledOnce();
    expect(onApplyPreset.mock.calls[0][0]).toMatchObject({ id: "7d", days: 7 });
  });
});
