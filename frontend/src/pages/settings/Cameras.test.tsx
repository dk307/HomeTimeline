import { describe, it, expect, beforeEach, vi, afterEach } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/utils";
import CamerasSettings from "./Cameras";

function cam(over: Record<string, unknown> = {}) {
  return {
    id: 1, name: "Garage", description: null, camera_type: "generic", location_id: null,
    recording_path: "/nas/garage", enabled: true, display_order: 0, clip_strategy: "daily_folder",
    scan_interval_minutes: 20, host: null, username: null, download_interval_minutes: null,
    has_password: false, last_downloaded_at: null, created_at: "", updated_at: "", ...over,
  };
}

let cameras: ReturnType<typeof cam>[];

beforeEach(() => {
  cameras = [
    cam(),
    cam({ id: 2, name: "Door", recording_path: "/nas/door", camera_type: "hikvision", scan_interval_minutes: null, enabled: false, download_interval_minutes: 60 }),
  ];
  server.use(
    http.get("/api/v1/cameras", () => HttpResponse.json(cameras)),
    http.get("/api/v1/locations", () => HttpResponse.json([])),
  );
});

describe("CamerasSettings", () => {
  it("summarizes each camera's scan schedule, type and enabled state", async () => {
    renderWithClient(<CamerasSettings />);
    expect(await screen.findByText("Garage")).toBeInTheDocument();
    expect(screen.getByText("Scan file system: every 20 min")).toBeInTheDocument();
    expect(screen.getByText("Scan file system: Never")).toBeInTheDocument();
    expect(screen.getByText("Hikvision")).toBeInTheDocument();
    expect(screen.getByText("Active")).toBeInTheDocument();
    expect(screen.getByText("Disabled")).toBeInTheDocument();
    // Hikvision cameras also show their download schedule.
    expect(screen.getByText("Download videos: every 60 min")).toBeInTheDocument();
  });

  it("creates a generic camera, sending the built payload", async () => {
    let posted: Record<string, unknown> | undefined;
    server.use(
      http.post("/api/v1/cameras", async ({ request }) => {
        posted = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(cam({ id: 3, name: "New" }));
      }),
    );
    renderWithClient(<CamerasSettings />);
    await screen.findByText("Garage");

    await userEvent.click(screen.getByRole("button", { name: /Add Camera/ }));
    await userEvent.type(screen.getByPlaceholderText("e.g. Garage Cam"), "New Cam");
    await userEvent.type(screen.getByPlaceholderText("/nas/camera/Garage"), "/nas/new");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(posted).toBeDefined());
    expect(posted).toMatchObject({
      name: "New Cam",
      recording_path: "/nas/new",
      camera_type: "generic",
      enabled: true,
      scan_interval_minutes: null,
    });
    // Generic cameras don't carry Hikvision-only fields.
    expect(posted).not.toHaveProperty("host");
  });

  it("toggling the scan switch reveals the interval input defaulting to 15", async () => {
    renderWithClient(<CamerasSettings />);
    await screen.findByText("Garage");
    await userEvent.click(screen.getByRole("button", { name: /Add Camera/ }));

    const form = screen.getByText("New Camera").closest("div")!;
    expect(within(form).getByText("Never — scan manually only")).toBeInTheDocument();

    await userEvent.click(document.getElementById("scan-enabled")!);
    expect(await within(form).findByText("minutes")).toBeInTheDocument();
    expect(within(form).getByDisplayValue("15")).toBeInTheDocument();
  });

  it("prefills the form when editing an existing camera", async () => {
    renderWithClient(<CamerasSettings />);
    await screen.findByText("Garage");

    // The pencil (edit) button is the second-to-last button in the Garage row.
    const row = screen.getByText("/nas/garage").closest("div.rounded-lg") as HTMLElement;
    const buttons = within(row).getAllByRole("button");
    await userEvent.click(buttons[buttons.length - 2]);

    expect(await screen.findByText("Edit Camera")).toBeInTheDocument();
    expect(screen.getByDisplayValue("Garage")).toBeInTheDocument();
    expect(screen.getByDisplayValue("/nas/garage")).toBeInTheDocument();
  });

  it("deletes a camera via the trash button", async () => {
    let deleted = false;
    server.use(
      http.delete("/api/v1/cameras/1", () => {
        deleted = true;
        cameras = cameras.filter((c) => c.id !== 1);
        return new HttpResponse(null, { status: 204 });
      }),
    );
    renderWithClient(<CamerasSettings />);
    await screen.findByText("Garage");

    const row = screen.getByText("/nas/garage").closest("div.rounded-lg") as HTMLElement;
    const buttons = within(row).getAllByRole("button");
    await userEvent.click(buttons[buttons.length - 1]); // trash is last
    await waitFor(() => expect(deleted).toBe(true));
  });

  it("reveals Hikvision fields when editing a Hikvision camera and PATCHes them", async () => {
    let patched: Record<string, unknown> | undefined;
    server.use(
      http.patch("/api/v1/cameras/2", async ({ request }) => {
        patched = (await request.json()) as Record<string, unknown>;
        return HttpResponse.json(cam({ id: 2, name: "Door", camera_type: "hikvision" }));
      }),
    );
    renderWithClient(<CamerasSettings />);
    await screen.findByText("Door");

    // Open the Door (Hikvision) row's editor.
    const row = screen.getByText("/nas/door").closest("div.rounded-lg") as HTMLElement;
    const buttons = within(row).getAllByRole("button");
    await userEvent.click(buttons[buttons.length - 2]); // pencil

    await screen.findByText("Edit Camera");
    // Hikvision-only fields are present.
    const host = screen.getByPlaceholderText(/192\.168\.1\.10/);
    const username = screen.getByPlaceholderText("admin");
    await userEvent.type(host, "10.0.0.5");
    await userEvent.type(username, "operator");
    await userEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => expect(patched).toBeDefined());
    expect(patched).toMatchObject({ host: "10.0.0.5", username: "operator", camera_type: "hikvision" });
  });

  it("reindexes a camera after confirmation", async () => {
    const confirmSpy = vi.spyOn(window, "confirm").mockReturnValue(true);
    let reindexed = false;
    server.use(
      http.post("/api/v1/cameras/1/reindex", () => {
        reindexed = true;
        return HttpResponse.json({ status: "started", camera: "Garage" });
      }),
    );
    renderWithClient(<CamerasSettings />);
    await screen.findByText("Garage");

    await userEvent.click(screen.getAllByRole("button", { name: /Reindex/ })[0]);
    await waitFor(() => expect(reindexed).toBe(true));
    expect(confirmSpy).toHaveBeenCalled();
  });
});

afterEach(() => {
  vi.restoreAllMocks();
});
