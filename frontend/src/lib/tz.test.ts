import { afterEach, beforeEach, describe, it, expect, vi } from "vitest";
import { fmtDt, fmtRelative, FMT_TIME } from "./tz";

describe("fmtDt", () => {
  it("returns an em dash for null/undefined/empty input", () => {
    expect(fmtDt(null, "UTC", FMT_TIME)).toBe("—");
    expect(fmtDt(undefined, "UTC", FMT_TIME)).toBe("—");
    expect(fmtDt("", "UTC", FMT_TIME)).toBe("—");
  });

  it("returns an em dash for an unparseable date string", () => {
    expect(fmtDt("not-a-date", "UTC", FMT_TIME)).toBe("—");
  });

  it("renders the same instant differently per timezone", () => {
    // 2024-01-15T12:00:00Z, 24h time. In January New York is UTC-5, Tokyo UTC+9.
    const iso = "2024-01-15T12:00:00Z";
    expect(fmtDt(iso, "UTC", FMT_TIME)).toBe("12:00");
    expect(fmtDt(iso, "America/New_York", FMT_TIME)).toBe("07:00");
    expect(fmtDt(iso, "Asia/Tokyo", FMT_TIME)).toBe("21:00");
  });

  it("accepts a Date object as well as a string", () => {
    const d = new Date("2024-01-15T12:00:00Z");
    expect(fmtDt(d, "UTC", FMT_TIME)).toBe("12:00");
  });
});

describe("fmtRelative", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2024-06-01T12:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const ago = (ms: number) => new Date(Date.now() - ms).toISOString();

  it("returns 'Never' for null/undefined", () => {
    expect(fmtRelative(null)).toBe("Never");
    expect(fmtRelative(undefined)).toBe("Never");
  });

  it("returns 'Just now' under a minute", () => {
    expect(fmtRelative(ago(30_000))).toBe("Just now");
  });

  it("formats minutes, hours and days", () => {
    expect(fmtRelative(ago(5 * 60_000))).toBe("5m ago");
    expect(fmtRelative(ago(3 * 3_600_000))).toBe("3h ago");
    expect(fmtRelative(ago(2 * 86_400_000))).toBe("2d ago");
  });

  it("crosses the 60-minute boundary into hours", () => {
    expect(fmtRelative(ago(59 * 60_000))).toBe("59m ago");
    expect(fmtRelative(ago(60 * 60_000))).toBe("1h ago");
  });
});
