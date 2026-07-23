import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { camerasApi, type Camera, type CameraCreate } from "@/api/cameras";
import { locationsApi } from "@/api/locations";
import { Input } from "@/components/ui/input";
import { Switch } from "@/components/ui/switch";
import { Badge } from "@/components/ui/badge";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { toErrorMessage } from "@/lib/utils";
import { useToast } from "@/hooks/useToast";
import { useConfirm } from "@/components/ui/confirm-dialog";

const NO_LOCATION = "none";
const fieldLabel = "text-xs font-medium text-muted-foreground";

const CAMERA_TYPE_OPTIONS = [
  { value: "hikvision", label: "Hikvision (download + scan)" },
  { value: "aqura", label: "Aqura (scan folder)" },
];

const CLIP_STRATEGY_OPTIONS = [
  { value: "daily_folder", label: "Daily folders (YYYY-MM-DD)" },
  { value: "aqura_nas_upload", label: "Aqura NAS Upload (YYYYMMDD)" },
];

function CameraForm({
  initial,
  locationOptions,
  onSubmit,
  onCancel,
}: {
  initial?: Partial<Camera>;
  locationOptions: { id: number; name: string }[];
  onSubmit: (data: CameraCreate) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState({
    name: initial?.name ?? "",
    description: initial?.description ?? "",
    camera_type: initial?.camera_type ?? "hikvision",
    location_id: initial?.location_id ?? "",
    recording_path: initial?.recording_path ?? "",
    enabled: initial?.enabled ?? true,
    display_order: initial?.display_order ?? 0,
    clip_strategy: initial?.clip_strategy ?? "daily_folder",
    scan_interval_minutes: initial?.scan_interval_minutes ?? null,
    host: initial?.host ?? "",
    username: initial?.username ?? "",
    password: "", // never prefilled; blank = keep existing on edit
    download_interval_minutes: initial?.download_interval_minutes ?? null,
    purge_older_than_days: initial?.purge_older_than_days ?? null,
    purge_interval_minutes: initial?.purge_interval_minutes ?? null,
    stream_url_1: initial?.stream_url_1 ?? "",
    stream_url_2: initial?.stream_url_2 ?? "",
    stream_url_3: initial?.stream_url_3 ?? "",
    aqura_username: initial?.aqura_username ?? "",
    aqura_password: "", // never prefilled; blank = keep existing on edit
  });

  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));
  const isHikvision = form.camera_type === "hikvision";
  const isAqura = form.camera_type === "aqura";

  return (
    <div className="border rounded-lg p-4 bg-card space-y-3">
      <h3 className="font-semibold text-sm">{initial?.id ? "Edit Camera" : "New Camera"}</h3>
      <div className="grid grid-cols-2 gap-3">
        <div className="space-y-1">
          <label className={fieldLabel}>Name *</label>
          <Input value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Garage Cam" />
        </div>
        <div className="space-y-1">
          <label className={fieldLabel}>Type</label>
          <Select value={form.camera_type} onValueChange={(v) => set("camera_type", v)}>
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              {CAMERA_TYPE_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="col-span-2 space-y-1">
          <label className={fieldLabel}>Recording Path *</label>
          <Input className="font-mono" value={form.recording_path} onChange={(e) => set("recording_path", e.target.value)} placeholder="/nas/camera/Garage" />
        </div>
        <div className="space-y-1">
          <label className={fieldLabel}>Location</label>
          <Select
            value={form.location_id ? String(form.location_id) : NO_LOCATION}
            onValueChange={(v) => set("location_id", v === NO_LOCATION ? "" : Number(v))}
          >
            <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
            <SelectContent>
              <SelectItem value={NO_LOCATION}>None</SelectItem>
              {locationOptions.map((l) => <SelectItem key={l.id} value={String(l.id)}>{l.name}</SelectItem>)}
            </SelectContent>
          </Select>
        </div>
        <div className="space-y-1">
          <label className={fieldLabel}>Clip Storage Strategy</label>
          {isAqura ? (
            <>
              <Input className="font-mono" value="Aqura NAS Upload (YYYYMMDD)" readOnly />
              <p className="text-xs text-muted-foreground">
                Always set to Aqura NAS Upload for Aqura cameras.
              </p>
            </>
          ) : (
            <>
              <Select value={form.clip_strategy} onValueChange={(v) => set("clip_strategy", v)}>
                <SelectTrigger className="w-full"><SelectValue /></SelectTrigger>
                <SelectContent>
                  {CLIP_STRATEGY_OPTIONS.map((o) => <SelectItem key={o.value} value={o.value}>{o.label}</SelectItem>)}
                </SelectContent>
              </Select>
              <p className="text-xs text-muted-foreground">
                Clips are stored in per-day folders; each clip's time is taken from the end of the file.
              </p>
            </>
          )}
        </div>
        <div className="space-y-1">
          <label className={fieldLabel}>Display Order</label>
          <Input type="number" value={form.display_order} onChange={(e) => set("display_order", Number(e.target.value))} />
        </div>
        <div className="col-span-2 space-y-1">
          <label className={fieldLabel}>Scan file system</label>
          <div className="flex items-center gap-3">
            <Switch
              id="scan-enabled"
              checked={form.scan_interval_minutes != null}
              onCheckedChange={(v) => set("scan_interval_minutes", v ? 15 : null)}
            />
            {form.scan_interval_minutes != null ? (
              <div className="flex items-center gap-2">
                <span className="text-sm">every</span>
                <Input
                  type="number"
                  min={1}
                  max={1440}
                  value={form.scan_interval_minutes}
                  onChange={(e) =>
                    set("scan_interval_minutes", e.target.value === "" ? 1 : Number(e.target.value))
                  }
                  className="w-24 tabular-nums"
                />
                <span className="text-sm text-muted-foreground">minutes</span>
              </div>
            ) : (
              <span className="text-sm text-muted-foreground">Never — scan manually only</span>
            )}
          </div>
        </div>
        {isAqura && (
          <>
            <div className="col-span-2 space-y-1">
              <label className={fieldLabel}>Stream URL 1</label>
              <Input className="font-mono" value={form.stream_url_1} onChange={(e) => set("stream_url_1", e.target.value)} placeholder="rtsp://192.168.1.10:554/Streaming/Channels/101" />
            </div>
            <div className="col-span-2 space-y-1">
              <label className={fieldLabel}>Stream URL 2</label>
              <Input className="font-mono" value={form.stream_url_2} onChange={(e) => set("stream_url_2", e.target.value)} placeholder="rtsp://192.168.1.10:554/Streaming/Channels/102" />
            </div>
            <div className="col-span-2 space-y-1">
              <label className={fieldLabel}>Stream URL 3</label>
              <Input className="font-mono" value={form.stream_url_3} onChange={(e) => set("stream_url_3", e.target.value)} placeholder="rtsp://192.168.1.10:554/Streaming/Channels/103" />
            </div>
            <div className="space-y-1">
              <label className={fieldLabel}>RTSP Username</label>
              <Input value={form.aqura_username} onChange={(e) => set("aqura_username", e.target.value)} placeholder="admin" />
            </div>
            <div className="space-y-1">
              <label className={fieldLabel}>RTSP Password</label>
              <Input
                type="password"
                value={form.aqura_password}
                onChange={(e) => set("aqura_password", e.target.value)}
                placeholder={initial?.aqura_has_password ? "•••• (unchanged)" : ""}
              />
            </div>
          </>
        )}
        {isHikvision && (
          <>
            <div className="space-y-1">
              <label className={fieldLabel}>Host</label>
              <Input value={form.host} onChange={(e) => set("host", e.target.value)} placeholder="192.168.1.10 or http://192.168.1.10:80" />
            </div>
            <div className="space-y-1">
              <label className={fieldLabel}>Username</label>
              <Input value={form.username} onChange={(e) => set("username", e.target.value)} placeholder="admin" />
            </div>
            <div className="space-y-1">
              <label className={fieldLabel}>Password</label>
              <Input
                type="password"
                value={form.password}
                onChange={(e) => set("password", e.target.value)}
                placeholder={initial?.has_password ? "•••• (unchanged)" : ""}
              />
            </div>
            <div className="col-span-2 space-y-1">
              <label className={fieldLabel}>Download videos</label>
              <div className="flex items-center gap-3">
                <Switch
                  id="download-enabled"
                  checked={form.download_interval_minutes != null}
                  onCheckedChange={(v) => set("download_interval_minutes", v ? 60 : null)}
                />
                {form.download_interval_minutes != null ? (
                  <div className="flex items-center gap-2">
                    <span className="text-sm">every</span>
                    <Input
                      type="number"
                      min={1}
                      max={1440}
                      value={form.download_interval_minutes}
                      onChange={(e) =>
                        set("download_interval_minutes", e.target.value === "" ? 1 : Number(e.target.value))
                      }
                      className="w-24 tabular-nums"
                    />
                    <span className="text-sm text-muted-foreground">minutes</span>
                  </div>
                ) : (
                  <span className="text-sm text-muted-foreground">Never — download manually only</span>
                )}
              </div>
            </div>
            <div className="col-span-2 space-y-1">
              <label className={fieldLabel}>Purge old videos</label>
              <div className="flex items-center gap-3">
                <Switch
                  id="purge-enabled"
                  checked={form.purge_older_than_days != null}
                  onCheckedChange={(v) => {
                    // Turning purge off clears both the retention window and its
                    // schedule; turning it on defaults to 30-day retention.
                    set("purge_older_than_days", v ? 30 : null);
                    if (!v) set("purge_interval_minutes", null);
                  }}
                />
                {form.purge_older_than_days != null ? (
                  <div className="flex items-center gap-2">
                    <span className="text-sm">delete clips older than</span>
                    <Input
                      type="number"
                      min={1}
                      max={3650}
                      value={form.purge_older_than_days}
                      onChange={(e) =>
                        set("purge_older_than_days", e.target.value === "" ? 1 : Number(e.target.value))
                      }
                      className="w-24 tabular-nums"
                    />
                    <span className="text-sm text-muted-foreground">days</span>
                  </div>
                ) : (
                  <span className="text-sm text-muted-foreground">Never — keep all videos</span>
                )}
              </div>
              {form.purge_older_than_days != null && (
                <div className="flex items-center gap-3 pl-11 pt-1">
                  <Switch
                    id="purge-auto"
                    checked={form.purge_interval_minutes != null}
                    onCheckedChange={(v) => set("purge_interval_minutes", v ? 1440 : null)}
                  />
                  {form.purge_interval_minutes != null ? (
                    <div className="flex items-center gap-2">
                      <span className="text-sm">automatically, every</span>
                      <Input
                        type="number"
                        min={1}
                        max={1440}
                        value={form.purge_interval_minutes}
                        onChange={(e) =>
                          set("purge_interval_minutes", e.target.value === "" ? 1 : Number(e.target.value))
                        }
                        className="w-24 tabular-nums"
                      />
                      <span className="text-sm text-muted-foreground">minutes</span>
                    </div>
                  ) : (
                    <span className="text-sm text-muted-foreground">Purge manually only</span>
                  )}
                </div>
              )}
            </div>
          </>
        )}
        <div className="col-span-2 space-y-1">
          <label className={fieldLabel}>Description</label>
          <textarea className="w-full flex rounded-md border border-input bg-background px-3 py-2 text-sm shadow-sm resize-none focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-1 focus-visible:ring-offset-background" rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} />
        </div>
        <div className="flex items-center gap-2">
          <Switch id="enabled" checked={form.enabled} onCheckedChange={(v) => set("enabled", v)} />
          <label htmlFor="enabled" className="text-sm select-none">Enabled</label>
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="px-3 py-1 text-sm rounded border hover:bg-accent">Cancel</button>
        <button
          onClick={() => onSubmit({
            name: form.name,
            description: form.description || undefined,
            camera_type: form.camera_type as CameraCreate["camera_type"],
            location_id: form.location_id ? Number(form.location_id) : undefined,
            recording_path: form.recording_path,
            enabled: form.enabled,
            display_order: form.display_order,
            clip_strategy: isAqura ? "aqura_nas_upload" : form.clip_strategy as CameraCreate["clip_strategy"],
            scan_interval_minutes: form.scan_interval_minutes,
            ...(isHikvision
              ? {
                  host: form.host,
                  username: form.username,
                  password: form.password || undefined,
                  download_interval_minutes: form.download_interval_minutes,
                  purge_older_than_days: form.purge_older_than_days,
                  purge_interval_minutes: form.purge_interval_minutes,
                }
              : {}),
            ...(isAqura
              ? {
                  stream_url_1: form.stream_url_1 || undefined,
                  stream_url_2: form.stream_url_2 || undefined,
                  stream_url_3: form.stream_url_3 || undefined,
                  aqura_username: form.aqura_username || undefined,
                  aqura_password: form.aqura_password || undefined,
                }
              : {}),
          })}
          className="px-3 py-1 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90"
        >
          Save
        </button>
      </div>
    </div>
  );
}

export default function CamerasSettings() {
  const qc = useQueryClient();
  const { toast } = useToast();
  const { confirm, dialog: confirmDialog } = useConfirm();
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Camera | null>(null);
  const [reindexing, setReindexing] = useState<number | null>(null);

  const { data: cameras } = useQuery({ queryKey: ["cameras"], queryFn: () => camerasApi.list() });
  const { data: locations } = useQuery({ queryKey: ["locations"], queryFn: locationsApi.list });

  const create = useMutation({
    mutationFn: camerasApi.create,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["cameras"] }); setShowForm(false); toast("Camera created"); },
    onError: (e) => toast("Failed to create camera", { description: toErrorMessage(e), variant: "error" }),
  });
  const update = useMutation({
    mutationFn: ({ id, data }: { id: number; data: CameraCreate }) => camerasApi.update(id, data),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["cameras"] }); setEditing(null); toast("Camera updated", { variant: "success" }); },
    onError: (e) => toast("Failed to update camera", { description: toErrorMessage(e), variant: "error" }),
  });
  const remove = useMutation({
    mutationFn: camerasApi.delete,
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["cameras"] }); toast("Camera deleted", { variant: "success" }); },
    onError: (e) => toast("Failed to delete camera", { description: toErrorMessage(e), variant: "error" }),
  });

  const handleReindex = async (cam: Camera) => {
    const ok = await confirm({
      title: `Reindex "${cam.name}"?`,
      message: "All indexed recordings will be dropped and reindexed from scratch.",
      confirmLabel: "Reindex",
    });
    if (!ok) return;
    setReindexing(cam.id);
    try {
      await camerasApi.reindex(cam.id);
      qc.invalidateQueries({ queryKey: ["activity"] });
      toast("Reindex started", { description: `Reindexing "${cam.name}".` });
    } catch (e) {
      toast("Reindex failed", { description: "Please try again.", variant: "error" });
    } finally {
      setTimeout(() => setReindexing(null), 2000);
    }
  };

  const handleDelete = async (cam: Camera) => {
    const ok = await confirm({
      title: `Delete "${cam.name}"?`,
      message: "This camera and its index will be permanently removed. Video files are kept on disk.",
      confirmLabel: "Delete",
      destructive: true,
    });
    if (!ok) return;
    remove.mutate(cam.id);
  };

  const locationOptions = locations?.map((l) => ({ id: l.id, name: l.name })) ?? [];

  return (
    <div className="p-6 space-y-4">
      {confirmDialog}
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold">Cameras</h1>
        <button onClick={() => { setShowForm(true); setEditing(null); }} className="flex items-center gap-2 px-3 py-1.5 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90">
          <Plus size={14} /> Add Camera
        </button>
      </div>

      {showForm && !editing && (
        <CameraForm locationOptions={locationOptions} onSubmit={(d) => create.mutate(d)} onCancel={() => setShowForm(false)} />
      )}

      <div className="space-y-2">
        {cameras?.map((cam) =>
          editing?.id === cam.id ? (
            <CameraForm key={cam.id} initial={cam} locationOptions={locationOptions} onSubmit={(d) => update.mutate({ id: cam.id, data: d })} onCancel={() => setEditing(null)} />
          ) : (
            <div key={cam.id} className="flex items-center justify-between border rounded-lg px-4 py-3 bg-card hover:bg-muted/20">
              <div>
                <p className="font-medium text-sm">
                  {cam.name}
                  {cam.camera_type === "hikvision" && (
                    <Badge variant="secondary" className="ml-2 align-middle">Hikvision</Badge>
                  )}
                  {cam.camera_type === "aqura" && (
                    <Badge variant="secondary" className="ml-2 align-middle">Aqura</Badge>
                  )}
                </p>
                <p className="text-xs text-muted-foreground font-mono">{cam.recording_path}</p>
                <p className="text-xs text-muted-foreground mt-0.5">
                  Scan file system: {cam.scan_interval_minutes != null ? `every ${cam.scan_interval_minutes} min` : "Never"}
                </p>
                {cam.camera_type === "hikvision" && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Download videos: {cam.download_interval_minutes != null ? `every ${cam.download_interval_minutes} min` : "Never"}
                  </p>
                )}
                {cam.camera_type === "hikvision" && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    Purge old videos:{" "}
                    {cam.purge_older_than_days != null
                      ? `older than ${cam.purge_older_than_days} days` +
                        (cam.purge_interval_minutes != null
                          ? `, every ${cam.purge_interval_minutes} min`
                          : ", manual only")
                      : "Never"}
                  </p>
                )}
                {cam.camera_type === "aqura" && (
                  <p className="text-xs text-muted-foreground mt-0.5">
                    3 RTSP streams configured
                  </p>
                )}
              </div>
              <div className="flex items-center gap-2">
                <Badge variant={cam.enabled ? "success" : "secondary"}>
                  {cam.enabled ? "Active" : "Disabled"}
                </Badge>
                <button
                  onClick={() => handleReindex(cam)}
                  disabled={reindexing === cam.id}
                  title="Drop index and reindex this camera"
                  className="flex items-center gap-1 px-2 py-1 text-xs rounded border hover:bg-accent disabled:opacity-50"
                >
                  {reindexing === cam.id ? <Loader size={12} className="animate-spin" /> : <RefreshCw size={12} />}
                  Reindex
                </button>
                <button onClick={() => setEditing(cam)} className="p-1 rounded hover:bg-accent"><Pencil size={14} /></button>
                <button onClick={() => handleDelete(cam)} className="p-1 rounded hover:bg-accent text-destructive"><Trash2 size={14} /></button>
              </div>
            </div>
          )
        )}
        {!cameras?.length && (
          <div className="text-center py-12 text-muted-foreground text-sm">No cameras yet. Add one to get started.</div>
        )}
      </div>
    </div>
  );
}
