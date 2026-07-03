import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { fmtDt, FMT_DATETIME } from "@/lib/tz";
import { useTimezone } from "@/hooks/useTimezone";

const LEVELS = ["ALL", "DEBUG", "INFO", "WARNING", "ERROR"] as const;
type Level = (typeof LEVELS)[number];

const LEVEL_STYLES: Record<string, string> = {
  DEBUG:   "text-muted-foreground",
  INFO:    "text-blue-500",
  WARNING: "text-yellow-500",
  ERROR:   "text-red-500 font-semibold",
};

interface LogEntry {
  ts: string;
  level: string;
  logger: string;
  msg: string;
}

async function fetchLogs(level: Level): Promise<LogEntry[]> {
  const q = level !== "ALL" ? `?level=${level}` : "";
  const r = await fetch(`/api/v1/logs${q}`);
  if (!r.ok) throw new Error("Failed to fetch logs");
  return r.json();
}

export default function Logs() {
  const tz = useTimezone();
  const [level, setLevel] = useState<Level>("ALL");

  const { data = [], dataUpdatedAt } = useQuery({
    queryKey: ["logs", level],
    queryFn: () => fetchLogs(level),
    refetchInterval: 5000,
  });

  const updated = dataUpdatedAt
    ? fmtDt(new Date(dataUpdatedAt), tz, FMT_DATETIME)
    : "—";

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Logs</h1>
        <div className="flex items-center gap-3">
          <span className="text-xs text-muted-foreground">Updated {updated}</span>
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
                  <td className={`px-3 py-1.5 ${LEVEL_STYLES[e.level] ?? ""}`}>{e.level}</td>
                  <td className="px-3 py-1.5 text-muted-foreground truncate max-w-40">{e.logger}</td>
                  <td className="px-3 py-1.5 break-all">{e.msg}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
