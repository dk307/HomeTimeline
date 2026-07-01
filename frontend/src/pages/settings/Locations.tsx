
import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { locationsApi } from "@/api/locations";

export default function LocationsSettings() {
  const qc = useQueryClient();
  const [name, setName] = useState("");
  const [desc, setDesc] = useState("");
  const [editing, setEditing] = useState<number | null>(null);
  const [editName, setEditName] = useState("");
  const [editDesc, setEditDesc] = useState("");

  const { data: locations } = useQuery({ queryKey: ["locations"], queryFn: locationsApi.list });

  const create = useMutation({
    mutationFn: () => locationsApi.create({ name, description: desc || undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["locations"] }); setName(""); setDesc(""); },
  });

  const update = useMutation({
    mutationFn: (id: number) => locationsApi.update(id, { name: editName, description: editDesc || undefined }),
    onSuccess: () => { qc.invalidateQueries({ queryKey: ["locations"] }); setEditing(null); },
  });

  const remove = useMutation({
    mutationFn: locationsApi.delete,
    onSuccess: () => qc.invalidateQueries({ queryKey: ["locations"] }),
  });

  const startEdit = (loc: { id: number; name: string; description?: string | null }) => {
    setEditing(loc.id);
    setEditName(loc.name);
    setEditDesc(loc.description ?? "");
  };

  return (
    <div className="p-6 space-y-4">
      <h1 className="text-2xl font-bold">Locations</h1>

      <div className="border rounded-lg p-4 bg-card space-y-3">
        <h2 className="text-sm font-semibold">Add Location</h2>
        <div className="flex gap-2">
          <input
            className="flex-1 border rounded px-2 py-1 text-sm bg-background"
            placeholder="Name"
            value={name}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => e.key === "Enter" && name.trim() && create.mutate()}
          />
          <input
            className="flex-1 border rounded px-2 py-1 text-sm bg-background"
            placeholder="Description (optional)"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
          />
          <button
            onClick={() => create.mutate()}
            disabled={!name.trim()}
            className="flex items-center gap-1 px-3 py-1 text-sm rounded bg-primary text-primary-foreground hover:bg-primary/90 disabled:opacity-50"
          >
            <Plus size={14} /> Add
          </button>
        </div>
      </div>

      <div className="space-y-2">
        {locations?.map((loc) =>
          editing === loc.id ? (
            <div key={loc.id} className="flex items-center gap-2 border rounded-lg px-4 py-3 bg-card">
              <input
                className="flex-1 border rounded px-2 py-1 text-sm bg-background"
                value={editName}
                onChange={(e) => setEditName(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && editName.trim() && update.mutate(loc.id)}
                autoFocus
              />
              <input
                className="flex-1 border rounded px-2 py-1 text-sm bg-background"
                value={editDesc}
                placeholder="Description (optional)"
                onChange={(e) => setEditDesc(e.target.value)}
              />
              <button onClick={() => update.mutate(loc.id)} disabled={!editName.trim()} className="p-1 rounded hover:bg-accent text-green-600">
                <Check size={14} />
              </button>
              <button onClick={() => setEditing(null)} className="p-1 rounded hover:bg-accent text-muted-foreground">
                <X size={14} />
              </button>
            </div>
          ) : (
            <div key={loc.id} className="flex items-center justify-between border rounded-lg px-4 py-3 bg-card">
              <div>
                <p className="font-medium text-sm">{loc.name}</p>
                {loc.description && <p className="text-xs text-muted-foreground">{loc.description}</p>}
              </div>
              <div className="flex gap-1">
                <button onClick={() => startEdit(loc)} className="p-1 rounded hover:bg-accent text-muted-foreground">
                  <Pencil size={14} />
                </button>
                <button onClick={() => remove.mutate(loc.id)} className="p-1 rounded hover:bg-accent text-destructive">
                  <Trash2 size={14} />
                </button>
              </div>
            </div>
          )
        )}
        {!locations?.length && (
          <div className="text-center py-12 text-muted-foreground text-sm">No locations yet.</div>
        )}
      </div>
    </div>
  );
}
