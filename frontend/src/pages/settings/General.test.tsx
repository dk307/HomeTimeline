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

describe("<GeneralSettings />", () => {
  it("loads and displays the configured timezone", async () => {
    mockGetSettings("America/New_York");
    renderWithClient(<GeneralSettings />);
    // Trigger shows the loaded value once the query resolves.
    expect(await screen.findByRole("button", { name: /America New York/ })).toBeInTheDocument();
  });

  it("saves the selected timezone and confirms", async () => {
    mockGetSettings("UTC");
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
    await user.click(await screen.findByRole("button", { name: /UTC/ }));
    await user.type(screen.getByRole("combobox"), "tokyo");
    await user.click(screen.getByRole("option", { name: /Asia\/Tokyo/ }));

    await user.click(screen.getByRole("button", { name: "Save" }));

    expect(await screen.findByText("Saved")).toBeInTheDocument();
    expect(patched).toEqual({ timezone: "Asia/Tokyo" });
  });

  it("surfaces an invalid-timezone error from the server", async () => {
    mockGetSettings("UTC");
    server.use(
      http.patch("/api/v1/settings", () =>
        HttpResponse.json({ detail: "Invalid timezone" }, { status: 400 }),
      ),
    );
    const user = userEvent.setup();
    renderWithClient(<GeneralSettings />);

    await screen.findByRole("button", { name: /UTC/ });
    await user.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(screen.getByText(/Invalid timezone/)).toBeInTheDocument());
    expect(screen.queryByText("Saved")).toBeNull();
  });
});
