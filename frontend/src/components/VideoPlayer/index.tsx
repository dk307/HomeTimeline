import { useQuery } from "@tanstack/react-query";
import { Download, X } from "lucide-react";
import { format } from "date-fns";
import { recordingsApi } from "@/api/recordings";
import { formatDuration } from "@/lib/utils";
import { useUIStore, type UIState } from "@/store/ui";

export default function VideoPlayer({
  recordingId,
  onClose,
}: {
  recordingId: number;
  onClose?: () => void;
}) {
  const setSelectedRecording = useUIStore((s: UIState) => s.setSelectedRecording);
  // Each page owns the open/close state differently (store vs. local), so prefer
  // the caller's handler; fall back to the shared store for the store-driven page.
  const close = onClose ?? (() => setSelectedRecording(null));
  const { data: rec } = useQuery({
    queryKey: ["recording", recordingId],
    queryFn: () => recordingsApi.get(recordingId),
  });

  const streamUrl  = recordingsApi.streamUrl(recordingId);
  const downloadUrl = recordingsApi.downloadUrl(recordingId);

  return (
    <div>
      <div className="flex items-center justify-between px-4 py-2 border-b bg-muted/30">
        <div className="text-sm">
          <span className="font-medium">Recording #{recordingId}</span>
          {rec && (
            <span className="text-muted-foreground ml-2">
              {format(new Date(rec.start_time), "MMM d, HH:mm")} · {formatDuration(rec.duration_secs)}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          <a
            href={downloadUrl}
            download
            className="flex items-center gap-1 px-2 py-1 text-xs rounded border hover:bg-accent"
            title="Download"
          >
            <Download size={13} /> Download
          </a>
          <button onClick={close} className="p-1 rounded hover:bg-accent">
            <X size={14} />
          </button>
        </div>
      </div>
      <div className="bg-black">
        <video
          key={streamUrl}
          src={streamUrl}
          controls
          autoPlay
          preload="metadata"
          className="w-full max-h-[60vh]"
        >
          <source src={streamUrl} type="video/mp4" />
          <source src={streamUrl} type="video/x-matroska" />
        </video>
      </div>
    </div>
  );
}
