import { api } from "./client";

export type CameraType = "generic" | "hikvision";
export type ClipStrategy = "daily_folder";

export interface Camera {
  id: number;
  name: string;
  description: string | null;
  camera_type: CameraType;
  location_id: number | null;
  recording_path: string;
  enabled: boolean;
  display_order: number;
  clip_strategy: ClipStrategy;
  scan_interval_minutes: number | null;
  host: string | null;
  username: string | null;
  download_interval_minutes: number | null;
  purge_older_than_days: number | null;
  purge_interval_minutes: number | null;
  has_password: boolean;
  last_downloaded_at: string | null;
  last_purged_at: string | null;
  created_at: string;
  updated_at: string;
}

export interface CameraCreate {
  name: string;
  description?: string;
  camera_type?: CameraType;
  location_id?: number;
  recording_path: string;
  enabled?: boolean;
  display_order?: number;
  clip_strategy?: ClipStrategy;
  scan_interval_minutes?: number | null;
  host?: string;
  username?: string;
  password?: string;
  download_interval_minutes?: number | null;
  purge_older_than_days?: number | null;
  purge_interval_minutes?: number | null;
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
  last_downloaded_at: string | null;
}

export interface DownloadStatus {
  running: boolean;
  last_downloaded_at: string | null;
}

export interface PurgeStatus {
  running: boolean;
  last_purged_at: string | null;
}

// Global state for a bulk Hikvision action: whether one is running, and whether
// the action applies to any camera (so the Dashboard can disable it otherwise).
export interface BulkStatus {
  running: boolean;
  available: boolean;
}

export interface DeviceInfo {
  available: boolean;
  error?: string;
  info?: Record<string, string>;
  rtsp_url?: string;
  snapshot_url?: string;
}

export interface CameraStream {
  quality: "main" | "sub";
  name: string;
  label: string;
}

export interface StreamsResponse {
  available: boolean;
  reason?: string;
  streams?: CameraStream[];
}

export interface DownloadEvent {
  id: number;
  started_at: string | null;
  finished_at: string | null;
  downloaded: number;
  indexed: number;
  status: string;
  detail: string | null;
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
  scanStatus: (id: number) => api.get<{ running: boolean }>(`/cameras/${id}/scan-status`),
  stopScan: (id: number) => api.post<{ status: string }>(`/cameras/${id}/scan/stop`),
  download: (id: number) =>
    api.post<{ status: string; camera: string }>(`/cameras/${id}/download`),
  downloadStatus: (id: number) => api.get<DownloadStatus>(`/cameras/${id}/download-status`),
  stopDownload: (id: number) => api.post<{ status: string }>(`/cameras/${id}/download/stop`),
  purge: (id: number) => api.post<{ status: string; camera: string }>(`/cameras/${id}/purge`),
  purgeStatus: (id: number) => api.get<PurgeStatus>(`/cameras/${id}/purge-status`),
  stopPurge: (id: number) => api.post<{ status: string }>(`/cameras/${id}/purge/stop`),
  deviceInfo: (id: number) => api.get<DeviceInfo>(`/cameras/${id}/device-info`),
  streams: (id: number) => api.get<StreamsResponse>(`/cameras/${id}/streams`),
  downloadEvents: (id: number) => api.get<DownloadEvent[]>(`/cameras/${id}/download-events`),
  // Bulk (all-camera) Hikvision operations, used by the Dashboard.
  downloadAll: () => api.post<{ status: string }>("/cameras/download-all"),
  downloadAllStatus: () => api.get<BulkStatus>("/cameras/download-all/status"),
  purgeAll: () => api.post<{ status: string }>("/cameras/purge-all"),
  purgeAllStatus: () => api.get<BulkStatus>("/cameras/purge-all/status"),
};
