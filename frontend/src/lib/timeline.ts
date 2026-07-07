import type { TimelineSegment } from "@/api/recordings";

/** The clips of one camera, ordered in time — the sequence prev/next steps through. */
export interface ClipSequence {
  /** recording ids for the selected clip's camera, ascending by start time */
  ids: number[];
  /** index of the current clip within `ids`, or -1 if not found */
  index: number;
}

/**
 * Build the ordered play sequence for whichever camera owns `currentId`.
 *
 * Prev/next navigation stays within a single camera (you're reviewing one
 * feed), stepping chronologically. Segments from other cameras and any that
 * share the selected clip's camera are sorted by start time; ties break on
 * recording id so the order is stable.
 */
export function clipSequence(
  segments: TimelineSegment[] | undefined,
  currentId: number | null,
): ClipSequence {
  const current = segments?.find((s) => s.recording_id === currentId);
  if (!current) return { ids: [], index: -1 };

  const ids = segments!
    .filter((s) => s.camera_id === current.camera_id)
    .sort(
      (a, b) =>
        new Date(a.start_time).getTime() - new Date(b.start_time).getTime() ||
        a.recording_id - b.recording_id,
    )
    .map((s) => s.recording_id);

  return { ids, index: ids.indexOf(current.recording_id) };
}

/**
 * The recording `delta` steps from `currentId` in its camera's time-ordered
 * sequence (-1 = previous, +1 = next), or null if there's no such clip.
 */
export function neighborRecordingId(
  segments: TimelineSegment[] | undefined,
  currentId: number | null,
  delta: number,
): number | null {
  const { ids, index } = clipSequence(segments, currentId);
  if (index < 0) return null;
  const target = index + delta;
  return target >= 0 && target < ids.length ? ids[target] : null;
}
