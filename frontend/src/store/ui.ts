import { create, type StoreApi } from "zustand";

export interface UIState {
  selectedDate: string; // YYYY-MM-DD
  selectedCameraIds: number[];
  selectedRecordingId: number | null;
  setSelectedDate: (date: string) => void;
  toggleCamera: (id: number) => void;
  selectAllCameras: (ids: number[]) => void;
  setSelectedRecording: (id: number | null) => void;
}

type SetFn = StoreApi<UIState>["setState"];

export const useUIStore = create<UIState>()((set: SetFn) => ({
  // Empty until a page sets it; the Timeline defaults this to the last 7 days
  // (see Timeline.tsx). Seeding it with today here would make that page open on
  // a today→+6d window that shows nothing beyond today.
  selectedDate: "",
  selectedCameraIds: [],
  selectedRecordingId: null,
  setSelectedDate: (date: string) => set({ selectedDate: date, selectedRecordingId: null }),
  toggleCamera: (id: number) =>
    set((s: UIState) => ({
      selectedCameraIds: s.selectedCameraIds.includes(id)
        ? s.selectedCameraIds.filter((c: number) => c !== id)
        : [...s.selectedCameraIds, id],
    })),
  selectAllCameras: (ids: number[]) => set({ selectedCameraIds: ids }),
  setSelectedRecording: (id: number | null) => set({ selectedRecordingId: id }),
}));
