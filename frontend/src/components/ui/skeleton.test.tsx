import { describe, it, expect } from "vitest";
import { screen, render } from "@testing-library/react";
import { Skeleton, CardSkeleton, TableSkeleton, ChartSkeleton } from "./skeleton";

describe("Skeleton", () => {
  it("renders a basic skeleton with default classes", () => {
    const { container } = render(<Skeleton />);
    const el = container.firstChild as HTMLElement;
    expect(el.className).toContain("animate-pulse");
    expect(el.className).toContain("rounded");
    expect(el.className).toContain("bg-muted");
  });

  it("applies additional class names", () => {
    const { container } = render(<Skeleton className="h-10 w-20" />);
    expect(container.firstChild).toHaveClass("h-10");
    expect(container.firstChild).toHaveClass("w-20");
  });
});

describe("CardSkeleton", () => {
  it("renders a card-like skeleton", () => {
    const { container } = render(<CardSkeleton />);
    const card = container.firstChild as HTMLElement;
    expect(card.className).toContain("rounded-lg");
    expect(card.className).toContain("border");
    expect(card.className).toContain("bg-card");
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThanOrEqual(2);
  });
});

describe("TableSkeleton", () => {
  it("renders default 5 rows and 5 cols", () => {
    const { container } = render(<TableSkeleton />);
    // Header row + 5 body rows = 6 rows of skeleton bars
    const rows = container.querySelectorAll(".flex");
    expect(rows.length).toBeGreaterThanOrEqual(6);
  });

  it("renders custom number of rows", () => {
    const { container } = render(<TableSkeleton rows={3} cols={4} />);
    const rows = container.querySelectorAll(".flex");
    expect(rows.length).toBeGreaterThanOrEqual(4);
  });
});

describe("ChartSkeleton", () => {
  it("renders a chart skeleton", () => {
    const { container } = render(<ChartSkeleton />);
    expect(container.firstChild).toHaveClass("rounded-lg");
    expect(container.querySelectorAll(".animate-pulse").length).toBeGreaterThanOrEqual(2);
  });
});