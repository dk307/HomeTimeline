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
}

export interface CameraUpdate extends Partial<CameraCreate> {}

export const camerasApi = {
  list: (enabled?: boolean) => {
    const q = enabled !== undefined ? `?enabled=${enabled}` : "";
    return api.get<Camera[]>(`/cameras${q}`);
  },
  get: (id: number) => api.get<Camera>(`/cameras/${id}`),
  create: (body: CameraCreate) => api.post<Camera>("/cameras", body),
  update: (id: number, body: CameraUpdate) => api.patch<Camera>(`/cameras/${id}`, body),
  delete: (id: number) => api.delete<void>(`/cameras/${id}`),
  dropIndex: (id: number) => api.delete<{ deleted: number }>(`/cameras/${id}/recordings`),
  reindex: (id: number) => api.post<{ status: string; camera: string }>(`/cameras/${id}/reindex`),
};
