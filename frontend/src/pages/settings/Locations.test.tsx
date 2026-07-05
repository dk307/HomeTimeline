import { describe, it, expect, beforeEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/utils";
import LocationsSettings from "./Locations";

interface Loc { id: number; name: string; description: string | null; created_at: string }

let items: Loc[];

beforeEach(() => {
  items = [{ id: 1, name: "Front Door", description: "main entry", created_at: "" }];
  server.use(http.get("/api/v1/locations", () => HttpResponse.json(items)));
});

function rowFor(name: string): HTMLElement {
  return screen.getByText(name).closest("div.rounded-lg") as HTMLElement;
}

describe("LocationsSettings", () => {
  it("lists existing locations with their descriptions", async () => {
    renderWithClient(<LocationsSettings />);
    expect(await screen.findByText("Front Door")).toBeInTheDocument();
    expect(screen.getByText("main entry")).toBeInTheDocument();
  });

  it("disables Add until a name is entered, then POSTs the new location", async () => {
    let posted: unknown;
    server.use(
      http.post("/api/v1/locations", async ({ request }) => {
        posted = await request.json();
        const created = { id: 2, name: "Garage", description: null, created_at: "" };
        items = [...items, created];
        return HttpResponse.json(created);
      }),
    );
    renderWithClient(<LocationsSettings />);
    await screen.findByText("Front Door");

    const add = screen.getByRole("button", { name: "Add" });
    expect(add).toBeDisabled();

    await userEvent.type(screen.getByPlaceholderText("Name (e.g. Front Door)"), "Garage");
    expect(add).toBeEnabled();
    await userEvent.click(add);

    await waitFor(() => expect(posted).toMatchObject({ name: "Garage" }));
    expect(await screen.findByText("Garage")).toBeInTheDocument();
  });

  it("enters edit mode and PATCHes the renamed location", async () => {
    let patched: unknown;
    server.use(
      http.patch("/api/v1/locations/1", async ({ request }) => {
        patched = await request.json();
        items = [{ ...items[0], name: "Back Door" }];
        return HttpResponse.json(items[0]);
      }),
    );
    renderWithClient(<LocationsSettings />);
    await screen.findByText("Front Door");

    // Pencil is the first icon button in the display row.
    await userEvent.click(within(rowFor("Front Door")).getAllByRole("button")[0]);

    const nameInput = await screen.findByDisplayValue("Front Door");
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, "Back Door");

    // In edit mode the row exposes [check, cancel]; check is first.
    const editRow = nameInput.closest("div.rounded-lg") as HTMLElement;
    await userEvent.click(within(editRow).getAllByRole("button")[0]);

    await waitFor(() => expect(patched).toMatchObject({ name: "Back Door" }));
  });

  it("DELETEs a location via the trash button", async () => {
    let deleted = false;
    server.use(
      http.delete("/api/v1/locations/1", () => {
        deleted = true;
        items = [];
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderWithClient(<LocationsSettings />);
    await screen.findByText("Front Door");

    // Trash is the second icon button in the display row.
    await userEvent.click(within(rowFor("Front Door")).getAllByRole("button")[1]);
    await waitFor(() => expect(deleted).toBe(true));
  });
});
