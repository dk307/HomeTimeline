import { describe, it, expect } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { http, HttpResponse } from "msw";
import { server } from "@/test/msw/server";
import { renderWithClient } from "@/test/utils";
import Recordings from "./Recordings";

const settingsUTC = http.get("/api/v1/settings", () => HttpResponse.json({ timezone: "UTC" }));

const cameras = [
  { id: 1, name: "Garage", description: "", recording_path: "/g", enabled: true },
  { id: 2, name: "Backyard", description: "", recording_path: "/b", enabled: true },
];

const recordings = [
  { id: 1, camera_id: 1, file_path: "/1.mp4", start_time: "2024-01-01T10:00:00Z", end_time: null, duration_secs: 120, file_size_bytes: 2000, thumbnail_path: null, notes: null, status: "ready", created_at: "" },
  { id: 2, camera_id: 2, file_path: "/2.mp4", start_time: "2024-01-02T10:00:00Z", end_time: null, duration_secs: 60, file_size_bytes: 1000, thumbnail_path: null, notes: null, status: "processing", created_at: "" },
];

function mock(recs: unknown[] = recordings, opts: { captureList?: (u: URL) => void } = {}) {
  server.use(
    settingsUTC,
    http.get("/api/v1/cameras", () => HttpResponse.json(cameras)),
    http.get("/api/v1/recordings/:id", ({ params }) =>
      HttpResponse.json({ ...recordings[0], id: Number(params.id) }),
    ),
    http.get("/api/v1/recordings", ({ request }) => {
      const url = new URL(request.url);
      opts.captureList?.(url);
      return HttpResponse.json({ recordings: recs, total: recs.length });
    }),
  );
}

async function switchToListView() {
  await userEvent.click(screen.getByRole("button", { name: "List view" }));
}

function dataRows(): HTMLElement[] {
  return screen.getAllByRole("row").slice(1);
}

describe("Recordings", () => {
  describe("grid view (default)", () => {
    it("renders a grid card per recording with camera name", async () => {
      mock();
      renderWithClient(<Recordings />);
      expect(await screen.findByText("Garage")).toBeInTheDocument();
      expect(screen.getByText("Backyard")).toBeInTheDocument();
    });

    it("shows the empty state when there are no recordings", async () => {
      mock([]);
      renderWithClient(<Recordings />);
      expect(await screen.findByText("No recordings found.")).toBeInTheDocument();
    });

    it("defaults to grid view", async () => {
      mock();
      renderWithClient(<Recordings />);
      await screen.findByText("Garage");
      expect(screen.getByRole("button", { name: "Grid view" })).toHaveClass("bg-primary");
    });

    it("opens the inline player when a grid card is clicked", async () => {
      mock();
      renderWithClient(<Recordings />);
      await screen.findByText("Garage");

      const cards = screen.getAllByRole("button");
      const garageCard = cards.find(el => el.textContent?.includes("Garage") && el.querySelector("img, svg"));
      expect(garageCard).toBeTruthy();
      await userEvent.click(garageCard!);
      expect(await screen.findByText("1.mp4")).toBeInTheDocument();
    });

    it("shows skeleton loaders while loading", async () => {
      mock();
      const { container } = renderWithClient(<Recordings />);
      const skeletons = container.querySelectorAll(".animate-pulse");
      expect(skeletons.length).toBeGreaterThan(0);
    });
  });

  describe("view toggle", () => {
    it("switches to list view when List button is clicked", async () => {
      mock();
      renderWithClient(<Recordings />);
      await screen.findByText("Garage");

      await switchToListView();
      expect(screen.getAllByRole("row").length).toBeGreaterThan(1);
      expect(screen.getByRole("button", { name: "List view" })).toHaveClass("bg-primary");
    });

    it("switches back to grid view when Grid button is clicked", async () => {
      mock();
      renderWithClient(<Recordings />);
      await screen.findByText("Garage");

      await switchToListView();
      await userEvent.click(screen.getByRole("button", { name: "Grid view" }));
      expect(screen.getByRole("button", { name: "Grid view" })).toHaveClass("bg-primary");
    });
  });

  describe("list view (table)", () => {
    it("renders a row per recording with the camera name joined in", async () => {
      mock();
      renderWithClient(<Recordings />);
      await screen.findByText("Garage");
      await switchToListView();
      // Default sort: start_time desc → Backyard (Jan 2) first, Garage (Jan 1) second.
      expect(within(dataRows()[0]).getByText("Backyard")).toBeInTheDocument();
      expect(within(dataRows()[1]).getByText("Garage")).toBeInTheDocument();
    });

    it("defaults to the 'Last 7 days' preset and requests days=7", async () => {
      let captured: URL | undefined;
      mock(recordings, { captureList: (u) => (captured = u) });
      renderWithClient(<Recordings />);
      await screen.findByText("Garage");
      await switchToListView();
      expect(captured?.searchParams.get("days")).toBe("7");
      expect(captured?.searchParams.get("date")).toBeTruthy();
    });

    it("re-sorts when a sortable column header is clicked", async () => {
      mock();
      renderWithClient(<Recordings />);
      await screen.findByText("Garage");
      await switchToListView();

      expect(within(dataRows()[0]).getByText("Backyard")).toBeInTheDocument();

      await userEvent.click(screen.getByText(/Duration/));
      await waitFor(() => expect(within(dataRows()[0]).getByText("Garage")).toBeInTheDocument());
    });

    it("flags a non-ready recording with a status warning", async () => {
      mock();
      renderWithClient(<Recordings />);
      await screen.findByText("Backyard");
      await switchToListView();
      expect(screen.getByTitle("Status: processing")).toBeInTheDocument();
    });

    it("opens the inline player when a row's Play button is clicked", async () => {
      mock();
      renderWithClient(<Recordings />);
      await screen.findByText("Garage");
      await switchToListView();

      await userEvent.click(screen.getAllByTitle("Play")[0]);
      expect(await screen.findByText("1.mp4")).toBeInTheDocument();
    });

    it("toggles sort direction when the same column header is clicked twice", async () => {
      mock();
      renderWithClient(<Recordings />);
      await screen.findByText("Garage");
      await switchToListView();

      await userEvent.click(screen.getByText(/Duration/));
      await waitFor(() => expect(within(dataRows()[0]).getByText("Garage")).toBeInTheDocument());
      await userEvent.click(screen.getByText(/Duration/));
      await waitFor(() => expect(within(dataRows()[0]).getByText("Backyard")).toBeInTheDocument());
      await userEvent.click(screen.getByText(/Size/));
      await waitFor(() => expect(within(dataRows()[0]).getByText("Garage")).toBeInTheDocument());
    });

    it("renders a thumbnail and plays the recording when it is clicked", async () => {
      const withThumb = [{ ...recordings[0], thumbnail_path: "/thumbs/a.jpg" }];
      mock(withThumb);
      const { container } = renderWithClient(<Recordings />);
      await screen.findByText("Garage");
      await switchToListView();

      const img = container.querySelector('img[src="/thumbnails/a.jpg"]') as HTMLImageElement;
      expect(img).toBeInTheDocument();
      await userEvent.click(img);
      expect(await screen.findByText("1.mp4")).toBeInTheDocument();
    });
  });

  describe("split panel player", () => {
    it("shows player in top panel when a recording is played", async () => {
      mock();
      renderWithClient(<Recordings />);
      await screen.findByText("Garage");
      await switchToListView();

      await userEvent.click(screen.getAllByTitle("Play")[0]);
      await screen.findByText("1.mp4");

      expect(screen.getByTestId("video-player-wrapper")).toBeInTheDocument();
    });

    it("shows resize handle below the player", async () => {
      mock();
      renderWithClient(<Recordings />);
      await screen.findByText("Garage");
      await switchToListView();

      await userEvent.click(screen.getAllByTitle("Play")[0]);
      await screen.findByText("1.mp4");

      expect(screen.getByTestId("resize-handle")).toBeInTheDocument();
    });

    it("closes player when the close button in VideoPlayer is triggered", async () => {
      mock();
      renderWithClient(<Recordings />);
      await screen.findByText("Garage");
      await switchToListView();

      await userEvent.click(screen.getAllByTitle("Play")[0]);
      await screen.findByText("1.mp4");

      expect(screen.getByTestId("video-player-wrapper")).toBeInTheDocument();
    });
  });

  describe("infinite scroll", () => {
    it("shows loaded/total count in the header", async () => {
      mock();
      renderWithClient(<Recordings />);
      await screen.findByText("Garage");
      expect(screen.getByText("2 / 2")).toBeInTheDocument();
    });
  });

  describe("keyboard navigation", () => {
    it("plays next recording when ArrowRight is pressed", async () => {
      mock();
      renderWithClient(<Recordings />);
      await screen.findByText("Garage");
      await switchToListView();

      await userEvent.click(screen.getAllByTitle("Play")[0]);
      await screen.findByText("1.mp4");

      await userEvent.keyboard("{ArrowRight}");
      await waitFor(() => expect(screen.getByText("1.mp4")).toBeInTheDocument());
    });

    it("plays previous recording when ArrowLeft is pressed", async () => {
      mock();
      renderWithClient(<Recordings />);
      await screen.findByText("Garage");
      await switchToListView();

      await userEvent.click(screen.getAllByTitle("Play")[0]);
      await screen.findByText("1.mp4");

      await userEvent.keyboard("{ArrowLeft}");
      await waitFor(() => expect(screen.getByText("1.mp4")).toBeInTheDocument());
    });

    it("wraps around from last to first on ArrowRight", async () => {
      mock();
      renderWithClient(<Recordings />);
      await screen.findByText("Garage");
      await switchToListView();

      // Default sort: start_time desc → Backyard (idx 0), Garage (idx 1)
      await userEvent.click(screen.getAllByTitle("Play")[1]);
      await screen.findByText("1.mp4");

      await userEvent.keyboard("{ArrowRight}");
      await waitFor(() => expect(screen.getByText("1.mp4")).toBeInTheDocument());
    });
  });

  describe("date range and filters", () => {
    it("applies a preset from the date-range picker", async () => {
      mock();
      renderWithClient(<Recordings />);
      await screen.findByText("Garage");

      await userEvent.click(screen.getByTestId("date-range-trigger"));
      await userEvent.click(await screen.findByRole("button", { name: "Today" }));
      await waitFor(() => expect(screen.getByTestId("date-range-trigger")).toHaveTextContent("Today"));
    });

    it("navigates to previous period when left arrow is clicked", async () => {
      let captured: URL | undefined;
      mock(recordings, { captureList: (u) => (captured = u) });
      renderWithClient(<Recordings />);
      await screen.findByText("Garage");

      const prevDate = captured?.searchParams.get("date");

      await userEvent.click(screen.getByTitle("Previous period"));
      await waitFor(() => {
        expect(captured?.searchParams.get("date")).not.toBe(prevDate);
      });
    });

    it("navigates to next period when right arrow is clicked", async () => {
      let captured: URL | undefined;
      mock(recordings, { captureList: (u) => (captured = u) });
      renderWithClient(<Recordings />);
      await screen.findByText("Garage");

      const prevDate = captured?.searchParams.get("date");

      await userEvent.click(screen.getByTitle("Next period"));
      await waitFor(() => {
        expect(captured?.searchParams.get("date")).not.toBe(prevDate);
      });
    });

    it("disables navigation buttons when 'All time' preset is selected", async () => {
      mock();
      renderWithClient(<Recordings />);
      await screen.findByText("Garage");

      await userEvent.click(screen.getByTestId("date-range-trigger"));
      await userEvent.click(await screen.findByRole("button", { name: "All time" }));
      await waitFor(() => expect(screen.getByTestId("date-range-trigger")).toHaveTextContent("All time"));

      expect(screen.getByTitle("Previous period")).toBeDisabled();
      expect(screen.getByTitle("Next period")).toBeDisabled();
    });
  });
});
