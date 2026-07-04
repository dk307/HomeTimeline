import { api } from "./client";

export interface AppSettings {
  timezone: string;
}

export const settingsApi = {
  get: (): Promise<AppSettings> => api.get<AppSettings>("/settings"),
  update: (data: Partial<AppSettings>): Promise<AppSettings> =>
    api.patch<AppSettings>("/settings", data),
};
