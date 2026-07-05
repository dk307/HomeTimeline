import { describe, it, expect } from "vitest";
import { cn, formatBytes, formatDuration } from "./utils";

describe("cn", () => {
  it("joins truthy class names and drops falsy ones", () => {
    expect(cn("a", false && "b", null, undefined, "c")).toBe("a c");
  });

  it("lets a later Tailwind class win a conflict (twMerge)", () => {
    // px-4 should override px-2, not be appended alongside it.
    expect(cn("px-2", "px-4")).toBe("px-4");
  });
});

describe("formatBytes", () => {
  it("returns '0 B' for zero", () => {
    expect(formatBytes(0)).toBe("0 B");
  });

  it("keeps sub-KiB values in bytes", () => {
    expect(formatBytes(512)).toBe("512 B");
  });

  it("scales into KB/MB/GB at 1024 boundaries", () => {
    expect(formatBytes(1024)).toBe("1 KB");
    expect(formatBytes(1024 * 1024)).toBe("1 MB");
    expect(formatBytes(1024 * 1024 * 1024)).toBe("1 GB");
  });

  it("rounds to one decimal place", () => {
    // 1_572_864 bytes = 1.5 MiB exactly.
    expect(formatBytes(1_572_864)).toBe("1.5 MB");
    // 1500 bytes = 1.464… KiB -> 1.5 KB after rounding.
    expect(formatBytes(1500)).toBe("1.5 KB");
  });
});

describe("formatDuration", () => {
  it("returns an em dash for null", () => {
    expect(formatDuration(null)).toBe("—");
  });

  it("formats seconds-only durations", () => {
    expect(formatDuration(0)).toBe("0s");
    expect(formatDuration(45)).toBe("45s");
  });

  it("formats minutes with trailing seconds", () => {
    expect(formatDuration(90)).toBe("1m 30s");
  });

  it("formats hours with trailing minutes and omits seconds", () => {
    expect(formatDuration(3661)).toBe("1h 1m");
    expect(formatDuration(7200)).toBe("2h 0m");
  });
});
