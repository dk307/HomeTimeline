import { describe, it, expect } from "vitest";
import type { TimelineSegment } from "@/api/recordings";
import { clipSequence, neighborRecordingId } from "./timeline";

function seg(recording_id: number, camera_id: number, start_time: string): TimelineSegment {
  return {
    recording_id,
    camera_id,
    camera_name: `cam${camera_id}`,
    start_time,
    end_time: start_time,
    duration_secs: 60,
    thumbnail_path: null,
    status: "ready",
  };
}

// Two cameras, deliberately out of time order in the array.
const segments: TimelineSegment[] = [
  seg(3, 1, "2024-01-01T12:00:00Z"),
  seg(1, 1, "2024-01-01T10:00:00Z"),
  seg(2, 1, "2024-01-01T11:00:00Z"),
  seg(9, 2, "2024-01-01T09:00:00Z"),
  seg(8, 2, "2024-01-01T13:00:00Z"),
];

describe("clipSequence", () => {
  it("orders the selected clip's camera chronologically and locates the index", () => {
    expect(clipSequence(segments, 2)).toEqual({ ids: [1, 2, 3], index: 1 });
  });

  it("only includes clips from the same camera as the selection", () => {
    expect(clipSequence(segments, 9)).toEqual({ ids: [9, 8], index: 0 });
  });

  it("returns an empty sequence when the id isn't present", () => {
    expect(clipSequence(segments, 999)).toEqual({ ids: [], index: -1 });
    expect(clipSequence(segments, null)).toEqual({ ids: [], index: -1 });
    expect(clipSequence(undefined, 1)).toEqual({ ids: [], index: -1 });
  });
});

describe("neighborRecordingId", () => {
  it("steps forward and backward within the camera's time order", () => {
    expect(neighborRecordingId(segments, 1, 1)).toBe(2);
    expect(neighborRecordingId(segments, 2, 1)).toBe(3);
    expect(neighborRecordingId(segments, 2, -1)).toBe(1);
  });

  it("returns null at the ends of the sequence", () => {
    expect(neighborRecordingId(segments, 1, -1)).toBeNull(); // first clip, no prev
    expect(neighborRecordingId(segments, 3, 1)).toBeNull(); // last clip, no next
  });

  it("does not cross camera boundaries", () => {
    // 8 is the last (by time) clip of camera 2; there is no next within camera 2.
    expect(neighborRecordingId(segments, 8, 1)).toBeNull();
    expect(neighborRecordingId(segments, 8, -1)).toBe(9);
  });

  it("returns null for an unknown or missing selection", () => {
    expect(neighborRecordingId(segments, 999, 1)).toBeNull();
    expect(neighborRecordingId(segments, null, 1)).toBeNull();
  });
});
