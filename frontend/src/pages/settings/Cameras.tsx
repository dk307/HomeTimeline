import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Loader, Pencil, Plus, RefreshCw, Trash2 } from "lucide-react";
import { camerasApi, type Camera, type CameraCreate } from "@/api/cameras";
import { locationsApi } from "@/api/locations";

const TIME_SOURCE_OPTIONS = [
  { value: "mtime", label: "File mtime as end time (default)" },
  { value: "folder_date", label: "Folder date (YYYY-MM-DD)" },
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
    camera_type: initial?.camera_type ?? "generic",
    location_id: initial?.location_id ?? "",
    recording_path: initial?.recording_path ?? "",
    enabled: initial?.enabled ?? true,
    display_order: initial?.display_order ?? 0,
    time_source: initial?.time_source ?? "mtime",
  });

  const set = (k: string, v: unknown) => setForm((f) => ({ ...f, [k]: v }));

  return (
    <div className="border rounded-lg p-4 bg-card space-y-3">
      <h3 className="font-semibold text-sm">{initial?.id ? "Edit Camera" : "New Camera"}</h3>
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="text-xs text-muted-foreground">Name *</label>
          <input className="w-full mt-1 border rounded px-2 py-1 text-sm bg-background" value={form.name} onChange={(e) => set("name", e.target.value)} placeholder="e.g. Garage Cam" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Type</label>
          <input className="w-full mt-1 border rounded px-2 py-1 text-sm bg-background" value={form.camera_type} onChange={(e) => set("camera_type", e.target.value)} />
        </div>
        <div className="col-span-2">
          <label className="text-xs text-muted-foreground">Recording Path *</label>
          <input className="w-full mt-1 border rounded px-2 py-1 text-sm bg-background font-mono" value={form.recording_path} onChange={(e) => set("recording_path", e.target.value)} placeholder="/nas/camera/Garage" />
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Location</label>
          <select className="w-full mt-1 border rounded px-2 py-1 text-sm bg-background" value={form.location_id} onChange={(e) => set("location_id", e.target.value ? Number(e.target.value) : "")}>
            <option value="">None</option>
            {locationOptions.map((l) => <option key={l.id} value={l.id}>{l.name}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Time Source</label>
          <select className="w-full mt-1 border rounded px-2 py-1 text-sm bg-background" value={form.time_source} onChange={(e) => set("time_source", e.target.value)}>
            {TIME_SOURCE_OPTIONS.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </select>
        </div>
        <div>
          <label className="text-xs text-muted-foreground">Display Order</label>
          <input type="number" className="w-full mt-1 border rounded px-2 py-1 text-sm bg-background" value={form.display_order} onChange={(e) => set("display_order", Number(e.target.value))} />
        </div>
        <div className="col-span-2">
          <label className="text-xs text-muted-foreground">Description</label>
          <textarea className="w-full mt-1 border rounded px-2 py-1 text-sm bg-background resize-none" rows={2} value={form.description} onChange={(e) => set("description", e.target.value)} />
        </div>
        <div className="flex items-center gap-2">
          <input type="checkbox" id="enabled" checked={form.enabled} onChange={(e) => set("enabled", e.target.checked)} />
          <label htmlFor="enabled" className="text-sm">Enabled</label>
        </div>
      </div>
      <div className="flex gap-2 justify-end">
        <button onClick={onCancel} className="px-3 py-1 text-sm rounded border hover:bg-accent">Cancel</button>
        <button
          onClick={() => onSubmit({
            name: form.name,
            description: form.description || undefined,
            camera_type: form.camera_type,
            location_id: form.location_id ? Number(form.location_id) : undefined,
            recording_path: form.recording_path,
            enabled: form.enabled,
            display_order: form.display_order,
            time_source: form.time_source,
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
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState<Camera | null>(null);
  const [reindexing, setReindexing] = useState<number | null>(null);

  const { data: cameras } = useQuery({ queryKey: ["cameras"], queryFn: () => camerasApi.list() });
  const { data: locations } = useQuery({ queryKey: ["locations"], queryFn: locationsApi.list });

  const create = useMutation({ mutationFn: camerasApi.create, onSuccess: () => { qc.invalidateQueries({ queryKey: ["cameras"] }); setShowForm(false); } });
  const update = useMutation({ mutationFn: ({ id, data }: { id: number; data: CameraCreate }) => camerasApi.update(id, data), onSuccess: () => { qc.invalidateQueries({ queryKey: ["cameras"] }); setEditing(null); } });
  const remove = useMutation({ mutationFn: camerasApi.delete, onSuccess: () => qc.invalidateQueries({ queryKey: ["cameras"] }) });

  const handleReindex = async (cam: Camera) => {
    if (!confirm(`Drop all indexed recordings for "${cam.name}" and reindex from scratch?`)) return;
    setReindexing(cam.id);
    try {
      await camerasApi.reindex(cam.id);
      qc.invalidateQueries({ queryKey: ["activity"] });
    } finally {
      setTimeout(() => setReindexing(null), 2000);
    }
  };

  const locationOptions = locations?.map((l) => ({ id: l.id, name: l.name })) ?? [];

  return (
    <div className="p-6 space-y-4">
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
                <p className="font-medium text-sm">{cam.name}</p>
                <p className="text-xs text-muted-foreground font-mono">{cam.recording_path}</p>
                <p className="text-xs text-muted-foreground mt-0.5">Time source: {TIME_SOURCE_OPTIONS.find((o) => o.value === cam.time_source)?.label ?? cam.time_source}</p>
              </div>
              <div className="flex items-center gap-2">
                <span className={`text-xs px-2 py-0.5 rounded ${cam.enabled ? "bg-green-100 text-green-700" : "bg-muted text-muted-foreground"}`}>
                  {cam.enabled ? "Active" : "Disabled"}
                </span>
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
                <button onClick={() => remove.mutate(cam.id)} className="p-1 rounded hover:bg-accent text-destructive"><Trash2 size={14} /></button>
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
