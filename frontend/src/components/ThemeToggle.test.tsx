import { describe, it, expect, beforeEach } from "vitest";
import { screen, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ThemeProvider } from "./ui/theme-provider";
import { ThemeToggle } from "@/components/ThemeToggle";

function renderToggle(collapsed = false) {
  return render(
    <ThemeProvider>
      <ThemeToggle collapsed={collapsed} />
    </ThemeProvider>,
  );
}

describe("<ThemeToggle />", () => {
  beforeEach(() => {
    localStorage.clear();
    document.documentElement.classList.remove("dark");
  });

  it("renders with the light mode label by default", () => {
    renderToggle();
    expect(screen.getByRole("button", { name: /Switch to dark mode/ })).toBeInTheDocument();
    expect(screen.getByText("Dark mode")).toBeInTheDocument();
  });

  it("toggles to dark mode on click", async () => {
    const user = userEvent.setup();
    renderToggle();
    await user.click(screen.getByRole("button", { name: /Switch to dark mode/ }));
    expect(screen.getByRole("button", { name: /Switch to light mode/ })).toBeInTheDocument();
    expect(screen.getByText("Light mode")).toBeInTheDocument();
  });

  it("hides the label text when collapsed", () => {
    renderToggle(true);
    expect(screen.getByRole("button", { name: /Switch to dark mode/ })).toBeInTheDocument();
    expect(screen.queryByText("Dark mode")).not.toBeInTheDocument();
  });

  it("shows the label text when not collapsed", () => {
    renderToggle(false);
    expect(screen.getByText("Dark mode")).toBeInTheDocument();
  });
});
