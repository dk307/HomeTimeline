import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { settingsApi } from "@/api/settings";

const TIMEZONES: { group: string; zones: string[] }[] = [
  {
    group: "UTC",
    zones: ["UTC"],
  },
  {
    group: "Americas",
    zones: [
      "America/New_York",
      "America/Detroit",
      "America/Indiana/Indianapolis",
      "America/Chicago",
      "America/Denver",
      "America/Phoenix",
      "America/Los_Angeles",
      "America/Anchorage",
      "America/Toronto",
      "America/Vancouver",
      "America/Winnipeg",
      "America/Halifax",
      "America/St_Johns",
      "America/Sao_Paulo",
      "America/Argentina/Buenos_Aires",
      "America/Santiago",
      "America/Bogota",
      "America/Lima",
      "America/Mexico_City",
      "America/Monterrey",
      "America/Caracas",
    ],
  },
  {
    group: "Europe",
    zones: [
      "Europe/London",
      "Europe/Dublin",
      "Europe/Lisbon",
      "Europe/Paris",
      "Europe/Berlin",
      "Europe/Madrid",
      "Europe/Rome",
      "Europe/Amsterdam",
      "Europe/Brussels",
      "Europe/Vienna",
      "Europe/Zurich",
      "Europe/Stockholm",
      "Europe/Oslo",
      "Europe/Copenhagen",
      "Europe/Warsaw",
      "Europe/Prague",
      "Europe/Budapest",
      "Europe/Bucharest",
      "Europe/Athens",
      "Europe/Helsinki",
      "Europe/Riga",
      "Europe/Tallinn",
      "Europe/Vilnius",
      "Europe/Kiev",
      "Europe/Moscow",
      "Europe/Istanbul",
    ],
  },
  {
    group: "Middle East & Africa",
    zones: [
      "Asia/Dubai",
      "Asia/Riyadh",
      "Asia/Baghdad",
      "Asia/Beirut",
      "Asia/Jerusalem",
      "Asia/Kuwait",
      "Asia/Qatar",
      "Africa/Cairo",
      "Africa/Johannesburg",
      "Africa/Lagos",
      "Africa/Nairobi",
      "Africa/Casablanca",
      "Africa/Tunis",
      "Africa/Accra",
    ],
  },
  {
    group: "Asia & Pacific",
    zones: [
      "Asia/Kolkata",
      "Asia/Colombo",
      "Asia/Kathmandu",
      "Asia/Dhaka",
      "Asia/Almaty",
      "Asia/Tashkent",
      "Asia/Karachi",
      "Asia/Kabul",
      "Asia/Tehran",
      "Asia/Bangkok",
      "Asia/Ho_Chi_Minh",
      "Asia/Jakarta",
      "Asia/Singapore",
      "Asia/Kuala_Lumpur",
      "Asia/Hong_Kong",
      "Asia/Shanghai",
      "Asia/Taipei",
      "Asia/Manila",
      "Asia/Tokyo",
      "Asia/Seoul",
      "Asia/Yakutsk",
      "Asia/Vladivostok",
      "Australia/Perth",
      "Australia/Darwin",
      "Australia/Adelaide",
      "Australia/Brisbane",
      "Australia/Sydney",
      "Australia/Melbourne",
      "Australia/Hobart",
      "Pacific/Auckland",
      "Pacific/Fiji",
      "Pacific/Honolulu",
      "Pacific/Tahiti",
      "Pacific/Guam",
    ],
  },
];

export default function GeneralSettings() {
  const qc = useQueryClient();
  const { data: settings, isLoading } = useQuery({
    queryKey: ["app-settings"],
    queryFn: settingsApi.get,
  });

  const [scanInterval, setScanInterval] = useState<number | "">("");
  const [timezone, setTimezone] = useState<string>("");
  const [tzError, setTzError] = useState<string>("");
  const [saved, setSaved] = useState(false);

  // Sync inputs to loaded values (only on first load)
  if (settings && scanInterval === "") setScanInterval(settings.scan_interval_minutes);
  if (settings && timezone === "") setTimezone(settings.timezone);

  const save = useMutation({
    mutationFn: () =>
      settingsApi.update({
        scan_interval_minutes: Number(scanInterval),
        timezone: timezone || undefined,
      }),
    onSuccess: () => {
      qc.invalidateQueries({ queryKey: ["app-settings"] });
      setTzError("");
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    },
    onError: (err: unknown) => {
      const msg = err instanceof Error ? err.message : String(err);
      if (msg.toLowerCase().includes("timezone")) {
        setTzError(`Invalid timezone: "${timezone}"`);
      } else {
        setTzError(msg || "Failed to save settings");
      }
    },
  });

  if (isLoading) return <div className="p-6 text-muted-foreground text-sm">Loading...</div>;

  return (
    <div className="p-6 space-y-6 max-w-lg">
      <h1 className="text-2xl font-bold">General Settings</h1>

      <div className="rounded-lg border bg-card p-5 space-y-4">
        <h2 className="font-semibold text-sm">Scanning</h2>
        <div className="space-y-1">
          <label htmlFor="scan-interval" className="text-sm font-medium">
            Scan frequency (minutes)
          </label>
          <p className="text-xs text-muted-foreground">
            How often the app scans camera folders for new recordings. Changes take effect immediately.
          </p>
          <div className="flex items-center gap-3 mt-2">
            <input
              id="scan-interval"
              type="number"
              min={1}
              max={1440}
              value={scanInterval}
              onChange={(e) => {
                setScanInterval(e.target.value === "" ? "" : Number(e.target.value));
                setSaved(false);
              }}
              className="w-28 border rounded px-3 py-1.5 text-sm bg-background tabular-nums"
            />
            <span className="text-sm text-muted-foreground">minutes</span>
          </div>
        </div>
      </div>

      <div className="rounded-lg border bg-card p-5 space-y-4">
        <h2 className="font-semibold text-sm">Display</h2>
        <div className="space-y-1">
          <label htmlFor="timezone" className="text-sm font-medium">
            Timezone
          </label>
          <p className="text-xs text-muted-foreground">
            All timestamps in the UI are displayed in this timezone.
          </p>
          <select
            id="timezone"
            value={timezone}
            onChange={(e) => { setTimezone(e.target.value); setSaved(false); setTzError(""); }}
            className="mt-2 w-full border rounded px-3 py-1.5 text-sm bg-background font-mono"
          >
            {TIMEZONES.map(({ group, zones }) => (
              <optgroup key={group} label={group}>
                {zones.map((tz) => (
                  <option key={tz} value={tz}>{tz.replace(/_/g, " ")}</option>
                ))}
              </optgroup>
            ))}
          </select>
          {tzError && <p className="text-xs text-red-500">{tzError}</p>}
        </div>
      </div>

      <div className="flex items-center gap-3">
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
  );
}
