import { create } from "zustand";
import { format } from "date-fns";

interface UIState {
  selectedDate: string; // YYYY-MM-DD
  selectedCameraIds: number[];
  selectedRecordingId: number | null;
  setSelectedDate: (date: string) => void;
  toggleCamera: (id: number) => void;
  selectAllCameras: (ids: number[]) => void;
  setSelectedRecording: (id: number | null) => void;
}

export const useUIStore = create<UIState>((set) => ({
  selectedDate: format(new Date(), "yyyy-MM-dd"),
  selectedCameraIds: [],
  selectedRecordingId: null,
  setSelectedDate: (date) => set({ selectedDate: date, selectedRecordingId: null }),
  toggleCamera: (id) =>
    set((s) => ({
      selectedCameraIds: s.selectedCameraIds.includes(id)
        ? s.selectedCameraIds.filter((c) => c !== id)
        : [...s.selectedCameraIds, id],
    })),
  selectAllCameras: (ids) => set({ selectedCameraIds: ids }),
  setSelectedRecording: (id) => set({ selectedRecordingId: id }),
}));
