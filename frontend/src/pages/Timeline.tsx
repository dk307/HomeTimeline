import { useRef, useState, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { format, addDays, subDays, parseISO, differenceInCalendarDays } from "date-fns";

import { ZoomIn, ZoomOut } from "lucide-react";
import { useUIStore } from "@/store/ui";
import { timelineApi } from "@/api/recordings";
import { camerasApi } from "@/api/cameras";
import VideoPlayer from "@/components/VideoPlayer";
import {
  DatePicker,
  MAX_SPAN_DAYS,
  PRESETS,
  ZOOM_LEVELS,
  daysAgoStr,
  tickInterval,
  tickLabel,
  type PresetId,
} from "@/components/TimelineControls";

export default function Timeline() {
  const { selectedDate, setSelectedDate, selectedRecordingId, setSelectedRecording } = useUIStore();
  const [days, setDays]     = useState(7);
  const [zoom, setZoom]     = useState(1);
  const [preset, setPreset] = useState<PresetId>("7d");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!selectedDate) setSelectedDate(daysAgoStr(6));
  }, []);

  const { data: cameras } = useQuery({ queryKey: ["cameras", { enabled: true }], queryFn: () => camerasApi.list(true) });
  const { data: segments, isLoading } = useQuery({
    queryKey: ["timeline", selectedDate, days],
    queryFn: () => timelineApi.get(selectedDate, days),
    enabled: !!selectedDate,
  });

  function applyPreset(p: typeof PRESETS[number]) {
    setPreset(p.id);
    if (p.id !== "custom") { setSelectedDate(p.date()); setDays(p.days); }
  }
  function goPrev() { setPreset("custom"); if (selectedDate) setSelectedDate(format(subDays(parseISO(selectedDate), days), "yyyy-MM-dd")); }
  function goNext() { setPreset("custom"); if (selectedDate) setSelectedDate(format(addDays(parseISO(selectedDate), days), "yyyy-MM-dd")); }
  function onSelectRange(f: Date, t: Date) {
    setPreset("custom");
    setSelectedDate(format(f, "yyyy-MM-dd"));
    setDays(Math.min(differenceInCalendarDays(t, f) + 1, MAX_SPAN_DAYS));
  }

  const zoomIn  = () => { const i = ZOOM_LEVELS.indexOf(zoom); if (i < ZOOM_LEVELS.length - 1) setZoom(ZOOM_LEVELS[i + 1]); };
  const zoomOut = () => { const i = ZOOM_LEVELS.indexOf(zoom); if (i > 0) setZoom(ZOOM_LEVELS[i - 1]); };

  const startDate  = selectedDate ? parseISO(selectedDate) : new Date();
  const endDate    = addDays(startDate, days - 1);
  const totalHours = days * 24;
  const rangeMs    = totalHours * 3600000;
  const rangeStart = startDate.getTime();

  const byCamera = cameras?.map((cam) => ({
    camera: cam,
    segments: (segments ?? []).filter((s) => s.camera_id === cam.id),
  }));

  const interval = tickInterval(zoom);
  const ticks: number[] = [];
  for (let h = 0; h <= totalHours; h += interval) ticks.push(h);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <h1 className="text-2xl font-bold">Timeline</h1>
        <div className="flex items-center gap-1 border rounded px-1">
          <button onClick={zoomOut} disabled={zoom === ZOOM_LEVELS[0]} className="p-1 hover:bg-accent rounded disabled:opacity-40"><ZoomOut size={14} /></button>
          <span className="text-xs w-8 text-center">{zoom}x</span>
          <button onClick={zoomIn} disabled={zoom === ZOOM_LEVELS[ZOOM_LEVELS.length - 1]} className="p-1 hover:bg-accent rounded disabled:opacity-40"><ZoomIn size={14} /></button>
        </div>
      </div>

      <div className="flex items-center gap-3 flex-wrap">
        <DatePicker
          preset={preset}
          from={startDate}
          to={endDate}
          onApplyPreset={applyPreset}
          onSelectRange={onSelectRange}
          onPrev={goPrev}
          onNext={goNext}
        />
      </div>

      <div className="rounded-lg border bg-card">
        <div className="overflow-x-auto overflow-hidden" ref={scrollRef}>
          <div style={{ minWidth: zoom * 100 + "%" }}>
            <div className="flex border-b bg-muted/50 sticky top-0 z-10">
              <div className="w-36 flex-shrink-0 px-3 py-1 text-xs text-muted-foreground font-medium">Camera</div>
              <div className="flex-1 relative h-7">
                {ticks.map((h) => (
                  <span key={h} className="absolute flex items-center text-xs text-muted-foreground leading-tight whitespace-nowrap" style={{ left: (h / totalHours * 100) + "%", transform: "translateX(-50%)" }}>
                    {tickLabel(h, zoom, startDate)}
                  </span>
                ))}
              </div>
            </div>

            {isLoading && <div className="p-8 text-center text-muted-foreground text-sm">Loading...</div>}
            {!isLoading && !selectedDate && <div className="p-8 text-center text-muted-foreground text-sm">Select a date above to view the timeline.</div>}

            {byCamera?.map(({ camera, segments: segs }) => (
              <div key={camera.id} className="flex border-b last:border-0 hover:bg-muted/20">
                <div className="w-36 flex-shrink-0 px-3 flex items-center text-sm font-medium truncate sticky left-0 bg-card z-10 border-r">{camera.name}</div>
                <div className="flex-1 relative h-16 my-auto">
                  {ticks.slice(1).map((h) => (
                    <div key={h} className="absolute top-0 bottom-0 border-l border-border/30" style={{ left: (h / totalHours * 100) + "%" }} />
                  ))}
                  {segs.map((seg) => {
                    const segStart  = new Date(seg.start_time).getTime();
                    const segEnd    = new Date(seg.end_time).getTime();
                    const left      = ((segStart - rangeStart) / rangeMs) * 100;
                    const width     = Math.max(((segEnd - segStart) / rangeMs) * 100, 0.1);
                    const isSel     = selectedRecordingId === seg.recording_id;
                    const clampedL  = Math.max(0, left);
                    const clampedW  = Math.min(width, 100 - clampedL);
                    const thumbName = seg.thumbnail_path ? seg.thumbnail_path.split(/[\\/]/).pop() : null;
                    const thumbUrl  = thumbName && clampedW * zoom > 0.5 ? `/thumbnails/${thumbName}` : null;
                    return (
                      <button
                        key={seg.recording_id}
                        onClick={() => setSelectedRecording(isSel ? null : seg.recording_id)}
                        title={format(new Date(seg.start_time), "MM/dd HH:mm") + (seg.duration_secs ? " · " + Math.round(seg.duration_secs / 60) + "m" : "")}
                        className={"absolute top-1 bottom-1 rounded overflow-hidden transition-all border " + (isSel ? "border-primary ring-2 ring-primary ring-offset-1 bg-primary/40" : "border-primary/30 bg-primary/50 hover:bg-primary/70")}
                        style={{
                          left: clampedL + "%",
                          width: clampedW + "%",
                          ...(thumbUrl ? {
                            backgroundImage: `url(${thumbUrl})`,
                            backgroundSize: 'cover',
                            backgroundPosition: 'center',
                          } : {}),
                        }}
                      />
                    );
                  })}
                </div>
              </div>
            ))}

            {byCamera?.length === 0 && <div className="p-8 text-center text-muted-foreground text-sm">No cameras configured.</div>}
          </div>
        </div>
      </div>

      {selectedRecordingId && (
        <div className="rounded-lg border bg-card overflow-hidden">
          <VideoPlayer recordingId={selectedRecordingId} />
        </div>
      )}
    </div>
  );
}
