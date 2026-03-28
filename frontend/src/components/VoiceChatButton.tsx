import { Mic, MicOff, Loader2 } from "lucide-react";
import type { GeminiLiveStatus } from "@/hooks/useGeminiLive";

interface VoiceChatButtonProps {
  status: GeminiLiveStatus;
  onStart: () => void;
  onStop: () => void;
  error: string | null;
}

export default function VoiceChatButton({ status, onStart, onStop, error }: VoiceChatButtonProps) {
  const isActive = status !== "disconnected";

  function handleClick() {
    if (isActive) {
      onStop();
    } else {
      onStart();
    }
  }

  const label = {
    disconnected: "Talk to Echo",
    connecting: "Connecting…",
    connected: "Listening — click to stop",
    error: error ?? "Error — click to retry",
  }[status];

  return (
    <div className="relative flex flex-col items-center gap-1.5">
      {/* Tooltip */}
      <span className="text-xs text-muted-foreground whitespace-nowrap">{label}</span>

      {/* Outer pulse ring — visible when connected */}
      {status === "connected" && (
        <span className="absolute top-5 w-12 h-12 rounded-full bg-primary/20 animate-ping pointer-events-none" />
      )}

      <button
        onClick={handleClick}
        aria-label={label}
        className={[
          "relative z-10 w-11 h-11 rounded-full flex items-center justify-center transition-all duration-200",
          "border focus:outline-none focus-visible:ring-2 focus-visible:ring-primary",
          status === "disconnected"
            ? "glass border-white/10 hover:bg-white/10 text-foreground"
            : status === "connecting"
            ? "bg-primary/20 border-primary/30 text-primary cursor-wait"
            : status === "connected"
            ? "bg-primary border-primary text-primary-foreground shadow-lg shadow-primary/30"
            : /* error */ "bg-destructive/20 border-destructive/40 text-destructive hover:bg-destructive/30",
        ].join(" ")}
      >
        {status === "connecting" ? (
          <Loader2 className="w-5 h-5 animate-spin" />
        ) : status === "error" ? (
          <MicOff className="w-5 h-5" />
        ) : (
          <Mic className="w-5 h-5" />
        )}
      </button>
    </div>
  );
}
