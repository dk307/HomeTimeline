import { useRef, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Search, Download, Pause, Play } from "lucide-react";
import { fmtDt, FMT_DATETIME } from "@/lib/tz";
import { useTimezone } from "@/hooks/useTimezone";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";

const LEVELS = ["ALL", "DEBUG", "INFO", "WARNING", "ERROR"] as const;
type Level = (typeof LEVELS)[number];

const LEVEL_BADGE: Record<string, string> = {
  DEBUG: "secondary",
  INFO: "success",
  WARNING: "warning",
  ERROR: "destructive",
};

interface LogEntry {
  ts: string;
  level: string;
  logger: string;
  camera_name: string | null;
  msg: string;
}

async function fetchLogs(level: Level, search: string): Promise<LogEntry[]> {
  const params = new URLSearchParams();
  if (level !== "ALL") params.set("level", level);
  if (search) params.set("search", search);
  const qs = params.toString();
  const r = await fetch(`/api/v1/logs${qs ? `?${qs}` : ""}`);
  if (!r.ok) throw new Error("Failed to fetch logs");
  return r.json();
}

export default function Logs() {
  const tz = useTimezone();
  const [level, setLevel] = useState<Level>("ALL");
  const [search, setSearch] = useState("");
  const [paused, setPaused] = useState(false);
  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const [debouncedSearch, setDebouncedSearch] = useState("");

  const handleSearch = (val: string) => {
    setSearch(val);
    clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setDebouncedSearch(val), 300);
  };

  const { data = [], dataUpdatedAt } = useQuery({
    queryKey: ["logs", level, debouncedSearch],
    queryFn: () => fetchLogs(level, debouncedSearch),
    refetchInterval: paused ? false : 5000,
  });

  const updated = dataUpdatedAt
    ? fmtDt(new Date(dataUpdatedAt), tz, FMT_DATETIME)
    : "—";

  const handleDownload = async () => {
    const params = new URLSearchParams();
    if (level !== "ALL") params.set("level", level);
    if (debouncedSearch) params.set("search", debouncedSearch);
    const qs = params.toString();
    const r = await fetch(`/api/v1/logs/download${qs ? `?${qs}` : ""}`);
    if (!r.ok) return;
    const blob = await r.blob();
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `logs-${new Date().toISOString().slice(0, 19)}.tsv`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Logs</h1>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">Updated {updated}</span>
          <button
            onClick={() => setPaused((p) => !p)}
            className="p-1.5 rounded-md border hover:bg-accent transition-colors"
            title={paused ? "Resume auto-refresh" : "Pause auto-refresh"}
          >
            {paused ? <Play size={14} /> : <Pause size={14} />}
          </button>
          <button
            onClick={handleDownload}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-md border text-xs font-medium hover:bg-accent transition-colors"
          >
            <Download size={14} /> Download
          </button>
          <div className="flex gap-1">
            {LEVELS.map((l) => (
              <button
                key={l}
                onClick={() => setLevel(l)}
                className={`px-2 py-1 text-xs rounded font-medium transition-colors ${
                  level === l
                    ? "bg-primary text-primary-foreground"
                    : "bg-muted text-muted-foreground hover:text-foreground"
                }`}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="relative">
        <Search size={14} className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground" />
        <Input
          value={search}
          onChange={(e) => handleSearch(e.target.value)}
          placeholder="Search messages…"
          className="pl-8 h-8 text-xs"
        />
      </div>

      {data.length === 0 ? (
        <div className="rounded-lg border bg-card p-8 text-center text-muted-foreground text-sm">
          No log entries.
        </div>
      ) : (
        <div className="rounded-lg border bg-card overflow-auto">
          <table className="w-full text-xs font-mono">
            <thead>
              <tr className="border-b text-muted-foreground">
                <th className="px-3 py-2 text-left font-medium whitespace-nowrap">Time</th>
                <th className="px-3 py-2 text-left font-medium">Level</th>
                <th className="px-3 py-2 text-left font-medium">Logger</th>
                <th className="px-3 py-2 text-left font-medium w-full">Message</th>
              </tr>
            </thead>
            <tbody className="divide-y">
              {data.slice().reverse().map((e, i) => (
                <tr key={i} className="hover:bg-muted/30">
                  <td className="px-3 py-1.5 whitespace-nowrap text-muted-foreground">
                    {fmtDt(e.ts, tz, FMT_DATETIME)}
                  </td>
                  <td className="px-3 py-1.5">
                    <Badge variant={(LEVEL_BADGE[e.level] ?? "secondary") as any}>
                      {e.level}
                    </Badge>
                  </td>
                  <td className="px-3 py-1.5 text-muted-foreground truncate max-w-40">{e.logger}</td>
                  <td className="px-3 py-1.5 break-all">{e.msg}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <div className="text-xs text-muted-foreground text-right">
        Showing {data.length} of 500 entries
      </div>
    </div>
  );
}