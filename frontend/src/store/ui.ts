import { create, type StoreApi } from "zustand";
import { format } from "date-fns";

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
  selectedDate: format(new Date(), "yyyy-MM-dd"),
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
