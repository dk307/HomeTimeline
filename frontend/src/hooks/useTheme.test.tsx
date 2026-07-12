import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { screen, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useTheme, ThemeToggle } from "./useTheme";

const origMatchMedia = window.matchMedia;

function TestComponent() {
  const { theme, toggle } = useTheme();
  return <ThemeToggle theme={theme} onToggle={toggle} />;
}

describe("useTheme / ThemeToggle", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("dark");
  });

  afterEach(() => {
    window.matchMedia = origMatchMedia;
  });

  it("renders with the light mode label by default", () => {
    render(<TestComponent />);
    expect(screen.getByRole("button", { name: /Switch to dark mode/ })).toBeInTheDocument();
    expect(screen.getByText("Dark mode")).toBeInTheDocument();
  });

  it("toggles to dark mode on click", async () => {
    const user = userEvent.setup();
    render(<TestComponent />);
    await user.click(screen.getByRole("button", { name: /Switch to dark mode/ }));
    expect(screen.getByRole("button", { name: /Switch to light mode/ })).toBeInTheDocument();
    expect(screen.getByText("Light mode")).toBeInTheDocument();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
    expect(localStorage.getItem("theme")).toBe("dark");
  });

  it("persists the dark preference across re-renders", () => {
    localStorage.setItem("theme", "dark");
    render(<TestComponent />);
    expect(screen.getByRole("button", { name: /Switch to light mode/ })).toBeInTheDocument();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("reads the system preference when no stored value exists", () => {
    window.matchMedia = vi.fn().mockImplementation((q: string) => ({
      matches: q === "(prefers-color-scheme: dark)",
      media: q,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn(),
    })) as unknown as typeof window.matchMedia;
    render(<TestComponent />);
    expect(screen.getByRole("button", { name: /Switch to light mode/ })).toBeInTheDocument();
    expect(document.documentElement.classList.contains("dark")).toBe(true);
  });

  it("hides the label text when collapsed", () => {
    render(<ThemeToggle theme="light" onToggle={() => {}} collapsed />);
    expect(screen.getByRole("button", { name: /Switch to dark mode/ })).toBeInTheDocument();
    expect(screen.queryByText("Dark mode")).not.toBeInTheDocument();
  });

  it("shows the label text when not collapsed", () => {
    render(<ThemeToggle theme="light" onToggle={() => {}} collapsed={false} />);
    expect(screen.getByText("Dark mode")).toBeInTheDocument();
  });
});