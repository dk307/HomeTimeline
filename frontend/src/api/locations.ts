import { api } from "./client";

export interface Location {
  id: number;
  name: string;
  description: string | null;
  created_at: string;
}

export const locationsApi = {
  list: () => api.get<Location[]>("/locations"),
  create: (body: { name: string; description?: string }) => api.post<Location>("/locations", body),
  update: (id: number, body: { name?: string; description?: string }) =>
    api.patch<Location>(`/locations/${id}`, body),
  delete: (id: number) => api.delete<void>(`/locations/${id}`),
};
