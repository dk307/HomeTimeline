import { useState } from "react";
import { useQuery } from "@tanstack/react-query";

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
  const [level, setLevel] = useState<Level>("ALL");

  const { data = [], dataUpdatedAt } = useQuery({
    queryKey: ["logs", level],
    queryFn: () => fetchLogs(level),
    refetchInterval: 5000,
  });

  const updated = dataUpdatedAt
    ? new Date(dataUpdatedAt).toLocaleTimeString()
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
                className={[
                  "px-2 py-1 rounded text-xs font-medium border transition-colors",
                  level === l
                    ? "bg-primary text-primary-foreground border-primary"
                    : "border-border text-muted-foreground hover:bg-accent",
                ].join(" ")}
              >
                {l}
              </button>
            ))}
          </div>
        </div>
      </div>

      <div className="rounded-lg border bg-card font-mono text-xs overflow-auto max-h-[calc(100vh-160px)]">
        {data.length === 0 ? (
          <p className="p-4 text-muted-foreground">No log entries.</p>
        ) : (
          <table className="w-full">
            <tbody>
              {[...data].reverse().map((entry, i) => (
                <tr
                  key={i}
                  className="border-b last:border-0 hover:bg-muted/40 align-top"
                >
                  <td className="px-3 py-1 whitespace-nowrap text-muted-foreground w-40">
                    {new Date(entry.ts).toLocaleTimeString()}
                  </td>
                  <td className={`px-2 py-1 whitespace-nowrap w-20 ${LEVEL_STYLES[entry.level] ?? ""}`}>
                    {entry.level}
                  </td>
                  <td className="px-2 py-1 whitespace-nowrap text-muted-foreground w-48 truncate">
                    {entry.logger}
                  </td>
                  <td className="px-3 py-1 break-all">{entry.msg}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
