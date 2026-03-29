import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getGeneration } from "@/lib/api";
import { Button } from "@/components/ui/button";
import { PanelRightOpen, PanelRightClose, BookOpen, Share2, Check, ChevronLeft, ChevronRight } from "lucide-react";
import type { Generation } from "@/types/pipeline";
import SceneViewer from "@/components/SceneViewer";
import VoiceChatButton from "@/components/VoiceChatButton";
import { useGeminiLive } from "@/hooks/useGeminiLive";

const Experience = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const [activeSceneIndex, setActiveSceneIndex] = useState(0);
  const [panelOpen, setPanelOpen] = useState(false);
  const [generation, setGeneration] = useState<Generation | null>(null);
  const [loading, setLoading] = useState(true);
  const [copied, setCopied] = useState(false);

  const scenes = generation?.scenes ?? [];
  const activeScene = scenes[activeSceneIndex];

  const gemini = useGeminiLive({
    storyText: generation?.narration_text ?? "",
    scenes: scenes,
    currentSceneId: activeScene?.id ?? "",
    canvasRef,
  });

  // Load generation data
  useEffect(() => {
    if (!id) {
      navigate("/");
      return;
    }

    const load = async () => {
      try {
        const gen = await getGeneration(id);
        if (gen.status !== "completed") {
          navigate(`/processing/${id}`);
          return;
        }
        setGeneration(gen);
      } catch {
        navigate("/");
      } finally {
        setLoading(false);
      }
    };

    load();
  }, [id, navigate]);

  const prevScene = () => setActiveSceneIndex((i) => Math.max(0, i - 1));
  const nextScene = () => setActiveSceneIndex((i) => Math.min(scenes.length - 1, i + 1));

  const shareLink = () => {
    navigator.clipboard.writeText(window.location.href);
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  };

  if (loading || !generation) {
    return (
      <div className="h-screen flex items-center justify-center">
        <p className="text-muted-foreground">Loading experience...</p>
      </div>
    );
  }

  return (
    <div className="h-screen w-screen relative overflow-hidden bg-background">
      {/* 3D Viewer */}
      <div className="absolute inset-0">
        {activeScene?.spz_url ? (
          <SceneViewer
            spzUrl={activeScene.spz_url}
            colliderMeshUrl={activeScene.collider_mesh_url}
            showDebug={false}
            onCanvasReady={(canvas) => { canvasRef.current = canvas; }}
          />
        ) : (
          <div className="flex items-center justify-center h-full">
            <p className="text-2xl font-display text-foreground/60">Loading world: {activeScene?.title}</p>
          </div>
        )}
      </div>

      {/* Top bar */}
      <div className="absolute top-4 left-4 right-4 flex items-center justify-between z-20 pointer-events-none">
        <Button variant="glass" size="sm" onClick={() => navigate("/")} className="pointer-events-auto">
          <BookOpen className="w-4 h-4 mr-1.5" /> New Story
        </Button>
        <div className="flex items-center gap-2 pointer-events-auto">
          <Button variant="glass" size="sm" onClick={shareLink}>
            {copied ? <Check className="w-4 h-4 mr-1.5" /> : <Share2 className="w-4 h-4 mr-1.5" />}
            {copied ? "Copied!" : "Share"}
          </Button>
          <Button
            variant="glass"
            size="icon"
            onClick={() => setPanelOpen(!panelOpen)}
          >
            {panelOpen ? <PanelRightClose className="w-4 h-4" /> : <PanelRightOpen className="w-4 h-4" />}
          </Button>
        </div>
      </div>

      {/* Side panel */}
      {panelOpen && (
        <div className="absolute top-0 right-0 h-full w-80 glass z-10 animate-slide-in-right overflow-y-auto">
          <div className="p-5 pt-16 space-y-6">
            <div>
              <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-3">Narration</h3>
              <p className="text-sm text-secondary-foreground leading-relaxed whitespace-pre-line">
                {scenes.map((s, i) => (
                  <span key={s.id} className={i === activeSceneIndex ? "text-primary font-medium" : "text-muted-foreground"}>
                    {s.narration_text}{" "}
                  </span>
                ))}
              </p>
            </div>
            <div>
              <h3 className="text-xs uppercase tracking-widest text-muted-foreground mb-3">Scenes</h3>
              <div className="space-y-1">
                {scenes.map((s, i) => (
                  <button
                    key={s.id}
                    onClick={() => setActiveSceneIndex(i)}
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

      {/* Bottom bar — scene nav */}
      <div className="absolute bottom-0 left-0 right-0 z-20 glass">
        <div className="px-5 py-3 flex items-center gap-4">
          {/* Scene nav */}
          <Button variant="ghost" size="icon" onClick={prevScene} disabled={activeSceneIndex === 0} className="shrink-0">
            <ChevronLeft className="w-5 h-5" />
          </Button>

          {/* Scene dots + title */}
          <div className="flex-1 flex items-center justify-center gap-3">
            <div className="flex gap-1.5">
              {scenes.map((_, i) => (
                <button
                  key={i}
                  onClick={() => setActiveSceneIndex(i)}
                  className={`w-2.5 h-2.5 rounded-full transition-colors ${
                    i === activeSceneIndex ? "bg-primary" : "bg-muted-foreground/30 hover:bg-muted-foreground/50"
                  }`}
                />
              ))}
            </div>
            <span className="text-sm text-muted-foreground truncate max-w-[200px]">
              {activeScene?.title}
            </span>
          </div>

          <Button variant="ghost" size="icon" onClick={nextScene} disabled={activeSceneIndex === scenes.length - 1} className="shrink-0">
            <ChevronRight className="w-5 h-5" />
          </Button>

          {/* Gemini voice chat */}
          <div className="ml-2 shrink-0">
            <VoiceChatButton
              status={gemini.status}
              error={gemini.error}
              onStart={gemini.start}
              onStop={gemini.stop}
            />
          </div>
        </div>
      </div>
    </div>
  );
};

export default Experience;
