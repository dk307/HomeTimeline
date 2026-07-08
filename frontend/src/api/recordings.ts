import { api } from "./client";

export interface Recording {
  id: number;
  camera_id: number;
  file_path: string;
  start_time: string;
  end_time: string | null;
  duration_secs: number | null;
  file_size_bytes: number | null;
  thumbnail_path: string | null;
  notes: string | null;
  status: string;
  created_at: string;
}

export interface TimelineSegment {
  camera_id: number;
  camera_name: string;
  recording_id: number;
  start_time: string;
  end_time: string;
  duration_secs: number | null;
  thumbnail_path: string | null;
  status: string;
}

export interface CameraStats {
  id: number;
  name: string;
  enabled: boolean;
  recordings: number;
  indexed_duration_secs: number;
  indexed_size_bytes: number;
  latest_video_at: string | null;
}

export interface StorageStats {
  indexed_recordings: number;
  indexed_size_bytes: number;
  indexed_duration_secs: number;
  last_scan_finished: string | null;
  cameras: CameraStats[];
}

export const recordingsApi = {
  list: (params: { camera_id?: number; date?: string; days?: number; status?: string }) => {
    const q = new URLSearchParams();
    if (params.camera_id) q.set("camera_id", String(params.camera_id));
    if (params.date) q.set("date", params.date);
    if (params.days && params.days > 1) q.set("days", String(params.days));
    if (params.status) q.set("status", params.status);
    return api.get<Recording[]>(`/recordings?${q}`);
  },
  dailyCounts: (days = 30, camera_id?: number) => {
    const q = new URLSearchParams({ days: String(days) });
    if (camera_id) q.set("camera_id", String(camera_id));
    return api.get<{ date: string; count: number; total_secs: number }[]>(
      `/recordings/daily-counts?${q}`,
    );
  },
  get: (id: number) => api.get<Recording>(`/recordings/${id}`),
  update: (id: number, body: { notes?: string }) => api.patch<Recording>(`/recordings/${id}`, body),
  delete: (id: number) => api.delete<void>(`/recordings/${id}`),
  streamUrl:   (id: number) => `/api/v1/recordings/${id}/stream`,
  downloadUrl: (id: number) => `/api/v1/recordings/${id}/download`,
};

export const timelineApi = {
  get: (date: string, days = 1, cameraIds?: number[], signal?: AbortSignal) => {
    const q = new URLSearchParams({ date, days: String(days) });
    if (cameraIds?.length) q.set("camera_ids", cameraIds.join(","));
    return api.get<TimelineSegment[]>(`/timeline?${q}`, signal);
  },
};

export const storageApi = {
  stats: () => api.get<StorageStats>("/storage/stats"),
};

export const scannerApi = {
  trigger: () => api.post<{ status: string }>("/scanner/scan"),
  status: () =>
    api.get<{ running: boolean; last_run: string | null; last_result: Record<string, number> | null }>(
      "/scanner/status"
    ),
};
