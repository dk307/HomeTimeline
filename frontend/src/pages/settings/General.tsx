import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { settingsApi } from "@/api/settings";

export default function GeneralSettings() {
  const qc = useQueryClient();
  const { data: settings, isLoading } = useQuery({
    queryKey: ["app-settings"],
    queryFn: settingsApi.get,
  });

  const [scanInterval, setScanInterval] = useState<number | "">("");
  const [saved, setSaved] = useState(false);

  // Sync input to loaded value (only on first load)
  if (settings && scanInterval === "") {
    setScanInterval(settings.scan_interval_minutes);
  }

  const save = useMutation({
    mutationFn: () =>
      settingsApi.update({ scan_interval_minutes: Number(scanInterval) }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["app-settings"] });
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
  });

  if (isLoading) return <div className="p-6 text-muted-foreground text-sm">Loading...</div>;

  return (
    <div className="p-6 space-y-6 max-w-lg">
      <h1 className="text-2xl font-bold">General Settings</h1>

      <div className="rounded-lg border bg-card p-5 space-y-4">
        <h2 className="font-semibold text-sm">Scanning</h2>

        <div className="space-y-1">
          <label className="text-sm font-medium">Scan frequency (minutes)</label>
          <p className="text-xs text-muted-foreground">
            How often the app scans camera folders for new recordings. Changes take effect immediately.
          </p>
          <div className="flex items-center gap-3 mt-2">
            <input
              type="number"
              min={1}
              max={1440}
              value={scanInterval}
              onChange={(e) => { setScanInterval(e.target.value === "" ? "" : Number(e.target.value)); setSaved(false); }}
              className="w-28 border rounded px-3 py-1.5 text-sm bg-background tabular-nums"
            />
            <span className="text-sm text-muted-foreground">minutes</span>
          </div>
        </div>

        <div className="flex items-center gap-3 pt-2">
          <button
            onClick={() => save.mutate()}
            disabled={save.isPending || !scanInterval || Number(scanInterval) < 1}
            className="px-4 py-1.5 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            {save.isPending ? "Saving…" : "Save"}
          </button>
          {saved && <span className="text-sm text-green-600">Saved</span>}
        </div>
      </div>
    </div>
  );
}
