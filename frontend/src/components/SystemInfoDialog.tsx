import { useQuery } from "@tanstack/react-query";
import * as Dialog from "@radix-ui/react-dialog";
import { X } from "lucide-react";
import { api } from "@/api/client";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";

interface SystemInfo {
  components: Record<string, string>;
  build: Record<string, string>;
  system: {
    os: string;
    kernel: string;
    sqlite: string;
    python_impl: string;
    hwaccels: string[];
    hw_available: Record<string, boolean>;
    cpu_features: string[];
  };
  ffmpeg: {
    version: string;
    build_date: string;
    config: string;
    encoders: string[];
    decoders: string[];
    hw_encoders: string[];
    hw_decoders: string[];
  };
  storage: {
    recordings_path: string;
    disk_free_gb: number;
    disk_total_gb: number;
    db_size_mb: number;
    thumbnail_count: number;
    thumbnail_size_mb: number;
  };
}

function Row({ label, value }: { label: string; value: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-sm">
      <span className="font-medium text-muted-foreground">{label}</span>
      <span className="min-w-0 break-all">{value ?? "—"}</span>
    </div>
  );
}

function ChipList({ items }: { items: string[] }) {
  if (items.length === 0) return <span className="text-muted-foreground">none</span>;
  return (
    <div className="flex flex-wrap gap-1">
      {items.map((item) => (
        <span
          key={item}
          className="inline-block rounded bg-muted px-1.5 py-0.5 text-xs font-mono"
        >
          {item}
        </span>
      ))}
    </div>
  );
}

export function SystemInfoDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const { data, isLoading, error } = useQuery<SystemInfo>({
    queryKey: ["system-info"],
    queryFn: () => api.get<SystemInfo>("/system_info"),
    enabled: open,
    staleTime: 60_000,
  });

  return (
    <Dialog.Root open={open} onOpenChange={onOpenChange}>
      <Dialog.Portal>
        <Dialog.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=open]:animate-in data-[state=closed]:animate-out" />
        <Dialog.Content className="fixed left-1/2 top-1/2 z-50 w-[90vw] max-w-2xl -translate-x-1/2 -translate-y-1/2 rounded-lg border bg-popover p-6 shadow-lg data-[state=open]:animate-in data-[state=closed]:animate-out">
          <div className="flex items-center justify-between">
            <Dialog.Title className="text-base font-semibold">System Information</Dialog.Title>
            <Dialog.Close
              aria-label="Close"
              className="shrink-0 rounded p-0.5 text-muted-foreground hover:text-foreground transition-colors"
            >
              <X size={14} />
            </Dialog.Close>
          </div>

          {isLoading && (
            <div className="mt-6 text-sm text-muted-foreground">Loading…</div>
          )}
          {error && (
            <div className="mt-6 text-sm text-red-500">
              Failed to load system info
            </div>
          )}

          {data && (
            <Tabs defaultValue="app" className="mt-4">
              <TabsList className="w-full justify-start">
                <TabsTrigger value="app">App &amp; Build</TabsTrigger>
                <TabsTrigger value="system">System</TabsTrigger>
                <TabsTrigger value="ffmpeg">FFmpeg</TabsTrigger>
                <TabsTrigger value="storage">Storage</TabsTrigger>
              </TabsList>

              <TabsContent value="app" className="max-h-[50vh] space-y-3 overflow-y-auto pr-1">
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b pb-1">
                  Application
                </h3>
                <Row label="App" value={data.components.app} />
                <Row label="Python" value={data.components.python} />
                <Row label="FastAPI" value={data.components.fastapi} />
                <Row label="Uvicorn" value={data.components.uvicorn} />
                <Row label="Peewee" value={data.components.peewee} />
                <Row label="go2rtc" value={data.components.go2rtc} />
                <Row label="Node.js" value={data.components.node} />
                <h3 className="text-xs font-semibold uppercase tracking-wider text-muted-foreground border-b pt-2 pb-1">
                  Build
                </h3>
                <Row label="Git SHA" value={<code className="font-mono text-xs">{data.build.git_sha}</code>} />
                <Row label="Build Time" value={data.build.build_time} />
                <Row label="Target Arch" value={data.build.arch} />
              </TabsContent>

              <TabsContent value="system" className="max-h-[50vh] space-y-3 overflow-y-auto pr-1">
                <Row label="OS" value={data.system.os} />
                <Row label="Kernel" value={data.system.kernel} />
                <Row label="SQLite" value={data.system.sqlite} />
                <Row label="Python Impl" value={data.system.python_impl} />
                <Row label="HW Accel" value={<ChipList items={data.system.hwaccels} />} />
                <Row label="HW Available" value={
                  <div className="flex flex-wrap gap-1">
                    {Object.entries(data.system.hw_available).map(([key, ok]) => (
                      <span
                        key={key}
                        className={`inline-block rounded px-1.5 py-0.5 text-xs font-mono ${ok ? "bg-green-900/40 text-green-300" : "bg-muted text-muted-foreground"}`}
                      >
                        {key}{ok ? " ✓" : ""}
                      </span>
                    ))}
                  </div>
                } />
                <Row label="CPU Features" value={<ChipList items={data.system.cpu_features} />} />
              </TabsContent>

              <TabsContent value="ffmpeg" className="max-h-[50vh] space-y-3 overflow-y-auto pr-1">
                <Row label="Version" value={data.ffmpeg.version} />
                <Row label="Build Date" value={data.ffmpeg.build_date} />
                {data.ffmpeg.config && (
                  <div className="space-y-1">
                    <span className="text-sm font-medium text-muted-foreground">Configuration</span>
                    <p className="text-xs font-mono break-all leading-relaxed text-muted-foreground">
                      {data.ffmpeg.config}
                    </p>
                  </div>
                )}
                <Row label="Encoders" value={<ChipList items={data.ffmpeg.encoders} />} />
                <Row label="Decoders" value={<ChipList items={data.ffmpeg.decoders} />} />
                <Row label="HW Encoders (compiled)" value={<ChipList items={data.ffmpeg.hw_encoders} />} />
                <Row label="HW Decoders (compiled)" value={<ChipList items={data.ffmpeg.hw_decoders} />} />
                {(() => {
                  const hw = data.system.hw_available;
                  const availableEnc = data.ffmpeg.hw_encoders.filter(e => Object.entries(hw).some(([k, v]) => v && e.includes(k)));
                  const availableDec = data.ffmpeg.hw_decoders.filter(e => Object.entries(hw).some(([k, v]) => v && e.includes(k)));
                  return (
                    <>
                      <Row label="HW Encoders (available)" value={availableEnc.length > 0 ? <ChipList items={availableEnc} /> : <span className="text-muted-foreground text-xs">none</span>} />
                      <Row label="HW Decoders (available)" value={availableDec.length > 0 ? <ChipList items={availableDec} /> : <span className="text-muted-foreground text-xs">none</span>} />
                    </>
                  );
                })()}
              </TabsContent>

              <TabsContent value="storage" className="max-h-[50vh] space-y-3 overflow-y-auto pr-1">
                <Row label="Recordings" value={<code className="font-mono text-xs break-all">{data.storage.recordings_path}</code>} />
                <Row label="Disk Free" value={`${data.storage.disk_free_gb} GB`} />
                <Row label="Disk Total" value={`${data.storage.disk_total_gb} GB`} />
                <Row label="Database" value={`${data.storage.db_size_mb} MB`} />
                <Row
                  label="Thumbnails"
                  value={`${data.storage.thumbnail_count.toLocaleString()} files (${data.storage.thumbnail_size_mb.toLocaleString()} MB)`}
                />
              </TabsContent>
            </Tabs>
          )}
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
