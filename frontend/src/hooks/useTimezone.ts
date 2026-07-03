import { useQuery } from "@tanstack/react-query";
import { settingsApi } from "@/api/settings";

/** Returns the configured app timezone (IANA name). Falls back to "UTC". */
export function useTimezone(): string {
  const { data } = useQuery({
    queryKey: ["app-settings"],
    queryFn: settingsApi.get,
    staleTime: 5 * 60 * 1000,
  });
  return data?.timezone ?? "UTC";
}
