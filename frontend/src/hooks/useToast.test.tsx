import { describe, it, expect } from "vitest";
import { screen, render, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ToastProvider, useToast } from "./useToast";

function TestHarness() {
  const { toast } = useToast();
  return (
    <div>
      <button onClick={() => toast("Hello")}>Toast default</button>
      <button onClick={() => toast("Success", { variant: "success" })}>Toast success</button>
      <button onClick={() => toast("Error", { variant: "error", description: "Something broke" })}>Toast error</button>
    </div>
  );
}

describe("ToastProvider + useToast", () => {
  it("renders a default toast when triggered", async () => {
    const user = userEvent.setup();
    render(<ToastProvider><TestHarness /></ToastProvider>);
    await user.click(screen.getByRole("button", { name: "Toast default" }));
    expect(await screen.findByText("Hello")).toBeInTheDocument();
  });

  it("renders a success variant toast", async () => {
    const user = userEvent.setup();
    render(<ToastProvider><TestHarness /></ToastProvider>);
    await user.click(screen.getByRole("button", { name: "Toast success" }));
    expect(await screen.findByText("Success")).toBeInTheDocument();
  });

  it("renders an error toast with description", async () => {
    const user = userEvent.setup();
    render(<ToastProvider><TestHarness /></ToastProvider>);
    await user.click(screen.getByRole("button", { name: "Toast error" }));
    expect(await screen.findByText("Error")).toBeInTheDocument();
    expect(screen.getByText("Something broke")).toBeInTheDocument();
  });

  it("dismisses a toast when the close button is clicked", async () => {
    const user = userEvent.setup();
    render(<ToastProvider><TestHarness /></ToastProvider>);
    await user.click(screen.getByRole("button", { name: "Toast default" }));
    expect(await screen.findByText("Hello")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Close" }));
    await waitFor(() => expect(screen.queryByText("Hello")).not.toBeInTheDocument(), { timeout: 2000 });
  });
});