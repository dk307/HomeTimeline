import { api } from "./client";

export interface Camera {
  id: number;
  name: string;
  description: string | null;
  camera_type: string;
  location_id: number | null;
  recording_path: string;
  enabled: boolean;
  display_order: number;
  time_source: string;
  scan_interval_minutes: number | null;
  created_at: string;
  updated_at: string;
}

export interface CameraCreate {
  name: string;
  description?: string;
  camera_type?: string;
  location_id?: number;
  recording_path: string;
  enabled?: boolean;
  display_order?: number;
  time_source?: string;
  scan_interval_minutes?: number | null;
}

export interface CameraUpdate extends Partial<CameraCreate> {}

export interface CameraDetailStats {
  id: number;
  name: string;
  enabled: boolean;
  total_recordings: number;
  total_duration_secs: number;
  indexed_size_bytes: number;
  last_video_at: string | null;
}

export const camerasApi = {
  list: (enabled?: boolean) => {
    const q = enabled !== undefined ? `?enabled=${enabled}` : "";
    return api.get<Camera[]>(`/cameras${q}`);
  },
  get: (id: number) => api.get<Camera>(`/cameras/${id}`),
  stats: (id: number) => api.get<CameraDetailStats>(`/cameras/${id}/stats`),
  create: (body: CameraCreate) => api.post<Camera>("/cameras", body),
  update: (id: number, body: CameraUpdate) => api.patch<Camera>(`/cameras/${id}`, body),
  delete: (id: number) => api.delete<void>(`/cameras/${id}`),
  dropIndex: (id: number) => api.delete<{ deleted: number }>(`/cameras/${id}/recordings`),
  reindex: (id: number) => api.post<{ status: string; camera: string }>(`/cameras/${id}/reindex`),
  scan: (id: number) => api.post<{ status: string; camera: string }>(`/cameras/${id}/scan`),
};
