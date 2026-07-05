import { beforeEach, describe, it, expect } from "vitest";
import { useUIStore } from "./ui";

const initial = {
  selectedDate: "",
  selectedCameraIds: [] as number[],
  selectedRecordingId: null as number | null,
};

describe("useUIStore", () => {
  beforeEach(() => {
    useUIStore.setState(initial);
  });

  it("toggleCamera adds an id, then removes it", () => {
    const { toggleCamera } = useUIStore.getState();
    toggleCamera(3);
    expect(useUIStore.getState().selectedCameraIds).toEqual([3]);
    toggleCamera(3);
    expect(useUIStore.getState().selectedCameraIds).toEqual([]);
  });

  it("toggleCamera preserves other selected ids", () => {
    useUIStore.setState({ selectedCameraIds: [1, 2] });
    useUIStore.getState().toggleCamera(3);
    expect(useUIStore.getState().selectedCameraIds).toEqual([1, 2, 3]);
    useUIStore.getState().toggleCamera(1);
    expect(useUIStore.getState().selectedCameraIds).toEqual([2, 3]);
  });

  it("selectAllCameras replaces the selection wholesale", () => {
    useUIStore.setState({ selectedCameraIds: [9] });
    useUIStore.getState().selectAllCameras([1, 2, 3]);
    expect(useUIStore.getState().selectedCameraIds).toEqual([1, 2, 3]);
  });

  it("setSelectedDate updates the date and clears the open recording", () => {
    useUIStore.setState({ selectedRecordingId: 42 });
    useUIStore.getState().setSelectedDate("2024-05-01");
    const s = useUIStore.getState();
    expect(s.selectedDate).toBe("2024-05-01");
    expect(s.selectedRecordingId).toBeNull();
  });

  it("setSelectedRecording sets and clears the recording id", () => {
    useUIStore.getState().setSelectedRecording(7);
    expect(useUIStore.getState().selectedRecordingId).toBe(7);
    useUIStore.getState().setSelectedRecording(null);
    expect(useUIStore.getState().selectedRecordingId).toBeNull();
  });
});
