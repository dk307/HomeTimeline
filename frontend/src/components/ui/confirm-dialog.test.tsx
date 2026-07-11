import { describe, it, expect } from "vitest";
import { screen, render } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { useConfirm } from "./confirm-dialog";

function TestHarness() {
  const { confirm, dialog } = useConfirm();
  return (
    <div>
      <button
        data-testid="delete-btn"
        onClick={async () => {
          const ok = await confirm({ title: "Are you sure?", message: "This will delete data." });
          document.body.setAttribute("data-confirmed", String(ok));
        }}
      >
        Delete
      </button>
      <button
        data-testid="reindex-btn"
        onClick={async () => {
          const ok = await confirm({ title: "Reindex?", message: "Drop and rebuild." });
          if (ok) document.body.setAttribute("data-reindexed", "true");
        }}
      >
        Reindex
      </button>
      <button
        data-testid="destructive-btn"
        onClick={async () => {
          const ok = await confirm({ title: "Destructive?", message: "Really?", destructive: true, confirmLabel: "Remove" });
          if (ok) document.body.setAttribute("data-destructive", "true");
        }}
      >
        Destructive
      </button>
      {dialog}
    </div>
  );
}

describe("useConfirm", () => {
  it("opens the dialog and confirms returning true", async () => {
    const user = userEvent.setup();
    render(<TestHarness />);
    await user.click(screen.getByTestId("delete-btn"));
    expect(await screen.findByText("Are you sure?")).toBeInTheDocument();
    expect(screen.getByText("This will delete data.")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Confirm" }));
    expect(document.body.getAttribute("data-confirmed")).toBe("true");
  });

  it("opens the dialog and cancels returning false", async () => {
    const user = userEvent.setup();
    render(<TestHarness />);
    await user.click(screen.getByTestId("reindex-btn"));
    expect(await screen.findByText("Reindex?")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Cancel" }));
    expect(document.body.getAttribute("data-reindexed")).toBeNull();
  });

  it("renders destructive variant with custom label", async () => {
    const user = userEvent.setup();
    render(<TestHarness />);
    await user.click(screen.getByTestId("destructive-btn"));
    expect(await screen.findByText("Destructive?")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Remove" })).toBeInTheDocument();
  });
});