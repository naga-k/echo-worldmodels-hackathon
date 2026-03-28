import { useEffect, useRef, useState, useCallback } from "react";
import { useNavigate } from "react-router-dom";
import { usePipeline } from "@/context/PipelineContext";
import { Button } from "@/components/ui/button";
import { Play, Pause, PanelRightOpen, PanelRightClose, BookOpen } from "lucide-react";
import type { Scene } from "@/types/pipeline";

const Experience = () => {
  const navigate = useNavigate();
  const { pipelineData } = usePipeline();
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const [isPlaying, setIsPlaying] = useState(false);
  const [currentTime, setCurrentTime] = useState(0);
  const [duration, setDuration] = useState(0);
  const [activeSceneIndex, setActiveSceneIndex] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);

  useEffect(() => {
    if (!pipelineData) {
      navigate("/");
      return;
    }
    const audio = new Audio(pipelineData.audioBlobUrl);
    audioRef.current = audio;

    audio.addEventListener("loadedmetadata", () => setDuration(audio.duration));
    audio.addEventListener("timeupdate", () => setCurrentTime(audio.currentTime));
    audio.addEventListener("ended", () => setIsPlaying(false));

    return () => {
      audio.pause();
      audio.src = "";
    };
  }, [pipelineData]);

  // Sync scene to audio time
  useEffect(() => {
    if (!pipelineData || !duration) return;
    const scenes = pipelineData.scenes;
    const frac = currentTime / duration;
    const idx = scenes.findIndex((s) => frac >= s.time_start && frac < s.time_end);
    if (idx >= 0) setActiveSceneIndex(idx);
  }, [currentTime, duration, pipelineData]);

  const togglePlay = useCallback(() => {
    if (!audioRef.current) return;
    if (isPlaying) {
      audioRef.current.pause();
    } else {
      audioRef.current.play();
    }
    setIsPlaying(!isPlaying);
  }, [isPlaying]);

  const seekTo = (frac: number) => {
    if (!audioRef.current || !duration) return;
    audioRef.current.currentTime = frac * duration;
  };

  const jumpToScene = (scene: Scene) => {
    seekTo(scene.time_start);
    if (!isPlaying) {
      audioRef.current?.play();
      setIsPlaying(true);
    }
  };

  const formatTime = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${sec.toString().padStart(2, "0")}`;
  };

  if (!pipelineData) return null;

  const activeScene = pipelineData.scenes[activeSceneIndex];

  return (
    <div className="h-screen w-screen relative overflow-hidden bg-background">
      {/* 3D Placeholder */}
      <div className="absolute inset-0 flex flex-col items-center justify-center">
        <p className="text-2xl font-display text-foreground/60">3D World: {activeScene?.title}</p>
        {activeScene?.spz_url && (
          <p className="text-xs text-muted-foreground mt-2 font-mono">{activeScene.spz_url}</p>
        )}
      </div>

      {/* Top bar */}
      <div className="absolute top-4 left-4 right-4 flex items-center justify-between z-20 pointer-events-none">
        <Button variant="glass" size="sm" onClick={() => navigate("/")} className="pointer-events-auto">
          <BookOpen className="w-4 h-4 mr-1.5" /> New Story
        </Button>
        <Button
          variant="glass"
          size="icon"
          onClick={() => setPanelOpen(!panelOpen)}
          className="pointer-events-auto"
        >
          {panelOpen ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
        </Button>
      </div>

      {/* Side panel */}
      {panelOpen && (
        <div className="absolute top-0 right-0 h-full w-80 glass z-10 animate-slide-in-right overflow-y-auto">
          <div className="p-5 pt-16 space-y-6">
            <div>
              <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-3">Narration</h3>
              <p className="text-sm text-secondary-foreground leading-relaxed whitespace-pre-line">
                {pipelineData.scenes.map((s, i) => (
                  <span key={s.id} className={i === activeSceneIndex ? "text-primary font-medium" : "text-muted-foreground"}>
                    {s.narration_text}{" "}
                  </span>
                ))}
              </p>
            </div>
            <div>
              <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-3">Scenes</h3>
              <div className="space-y-1">
                {pipelineData.scenes.map((s, i) => (
                  <button
                    key={s.id}
                    onClick={() => jumpToScene(s)}
                    className={`w-full text-left rounded-md px-3 py-2 text-sm transition-colors ${
                      i === activeSceneIndex
                        ? "bg-primary/15 text-primary"
                        : "text-muted-foreground hover:text-foreground hover:bg-muted/30"
                    }`}
                  >
                    {s.title}
                  </button>
                ))}
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Bottom overlay */}
      <div className="absolute bottom-0 left-0 right-0 z-20 glass">
        <div className="px-5 py-3 flex items-center gap-4">
          {/* Play/pause */}
          <Button variant="ghost" size="icon" onClick={togglePlay} className="shrink-0">
            {isPlaying ? <Pause className="w-5 h-5" /> : <Play className="w-5 h-5" />}
          </Button>

          {/* Time */}
          <span className="text-xs text-muted-foreground font-mono w-10 text-right shrink-0">
            {formatTime(currentTime)}
          </span>

          {/* Scrubber */}
          <div className="flex-1 relative h-8 flex items-center group cursor-pointer"
            onClick={(e) => {
              const rect = e.currentTarget.getBoundingClientRect();
              const frac = (e.clientX - rect.left) / rect.width;
              seekTo(frac);
            }}
          >
            <div className="w-full h-1 rounded-full bg-muted relative">
              <div
                className="absolute inset-y-0 left-0 rounded-full bg-primary transition-all duration-100"
                style={{ width: duration ? `${(currentTime / duration) * 100}%` : "0%" }}
              />
              {/* Scene markers */}
              {pipelineData.scenes.map((s, i) => (
                <div
                  key={s.id}
                  className={`absolute top-1/2 -translate-y-1/2 w-1.5 h-1.5 rounded-full transition-colors ${
                    i === activeSceneIndex ? "bg-primary" : "bg-muted-foreground/40"
                  }`}
                  style={{ left: `${s.time_start * 100}%` }}
                />
              ))}
            </div>
          </div>

          <span className="text-xs text-muted-foreground font-mono w-10 shrink-0">
            {formatTime(duration)}
          </span>

          {/* Scene indicator */}
          <div className="hidden md:flex items-center gap-2 ml-2 shrink-0">
            <div className="flex gap-1">
              {pipelineData.scenes.map((_, i) => (
                <div
                  key={i}
                  className={`w-2 h-2 rounded-full transition-colors ${
                    i === activeSceneIndex ? "bg-primary" : "bg-muted-foreground/30"
                  }`}
                />
              ))}
            </div>
            <span className="text-xs text-muted-foreground truncate max-w-[120px]">
              {activeScene?.title}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
};

export default Experience;
