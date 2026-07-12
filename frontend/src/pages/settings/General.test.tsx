import { describe, it, expect } from "vitest";
import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/utils";
import GeneralSettings from "./General";

function mockGetSettings(timezone = "UTC") {
  server.use(http.get("/api/v1/settings", () => HttpResponse.json({ timezone })));
}

function mockHealth(version = "0.8.0") {
  server.use(http.get("/api/v1/health", () => HttpResponse.json({ status: "ok", db: true, version })));
}

describe("<GeneralSettings />", () => {
  it("loads and displays the configured timezone", async () => {
    mockGetSettings("America/New_York");
    mockHealth();
    renderWithClient(<GeneralSettings />);
    // The trigger's accessible name comes from its <label> ("Timezone"); the
    // loaded value shows up as its text content once the query resolves.
    const trigger = await screen.findByRole("button", { name: /Timezone/ });
    await waitFor(() => expect(trigger).toHaveTextContent("America/New York"));
  });

  it("saves the selected timezone and confirms", async () => {
    mockGetSettings("UTC");
    mockHealth();
    let patched: unknown;
    server.use(
      http.patch("/api/v1/settings", async ({ request }) => {
        patched = await request.json();
        return HttpResponse.json({ timezone: "Asia/Tokyo" });
      }),
    );
    const user = userEvent.setup();
    renderWithClient(<GeneralSettings />);

    // Pick a new timezone through the combobox.
    await user.click(await screen.findByRole("button", { name: /Timezone/ }));
    await user.type(screen.getByRole("combobox"), "tokyo");
    await user.click(screen.getByRole("option", { name: /Asia\/Tokyo/ }));

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(patched).toEqual({ timezone: "Asia/Tokyo" });
  });

  it("surfaces an invalid-timezone error from the server", async () => {
    mockGetSettings("UTC");
    mockHealth();
    server.use(
      http.patch("/api/v1/settings", () =>
        HttpResponse.json({ detail: "Invalid timezone" }, { status: 400 }),
      ),
    );
    const user = userEvent.setup();
    renderWithClient(<GeneralSettings />);

    await screen.findByRole("button", { name: /Timezone/ });
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByText(/Invalid timezone/)).toBeInTheDocument());
    expect(screen.queryByText("Saved")).toBeNull();
  });

  it("displays the app version from the health endpoint", async () => {
    mockGetSettings();
    mockHealth("0.8.0");
    renderWithClient(<GeneralSettings />);

    expect(await screen.findByText("Version 0.8.0")).toBeInTheDocument();
  });

  it("shows fallback when health endpoint fails", async () => {
    mockGetSettings();
    server.use(http.get("/api/v1/health", () => HttpResponse.json(null, { status: 500 })));
    renderWithClient(<GeneralSettings />);

    await screen.findByRole("button", { name: /Timezone/ });
    expect(screen.getByText("Version …")).toBeInTheDocument();
  });
});
