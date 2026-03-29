import { useEffect, useState, useRef } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { getGeneration } from "@/lib/api";
import type { Generation, Scene } from "@/types/pipeline";
import { Check, Loader2, Globe, Eye, Sparkles, AlertCircle, Music } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";

type StepStatus = "pending" | "active" | "done" | "error";

interface Step {
  label: string;
  description: string;
  icon: React.ReactNode;
  status: StepStatus;
}

const STATUS_TO_STEP: Record<string, number> = {
  pending: 0,
  extracting: 0,
  generating_speech: 1,
  building_worlds: 1,
  polling: 2,
  completed: 4,
  failed: -1,
};

const Processing = () => {
  const navigate = useNavigate();
  const { id } = useParams<{ id: string }>();
  const [generation, setGeneration] = useState<Generation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null);

  const steps: Step[] = (() => {
    const activeStep = generation ? STATUS_TO_STEP[generation.status] ?? -1 : -1;
    const isFailed = generation?.status === "failed";

    const bgmCount = generation?.scenes?.filter((s) => s.bgm_path).length || 0;
    const sceneCount = generation?.scenes?.length || 0;
    const worldsReady = generation?.scenes?.filter((s) => s.spz_url).length || 0;

    return [
      {
        label: "Extracting scenes",
        description: activeStep > 0 ? `${sceneCount} scenes found` : "Analyzing your story...",
        icon: <Sparkles className="w-4 h-4" />,
        status: isFailed && activeStep === -1 ? "error" : activeStep > 0 ? "done" : activeStep === 0 ? "active" : "pending",
      },
      {
        label: "Building worlds + music",
        description: activeStep > 1 ? `${sceneCount} worlds queued, ${bgmCount} BGM tracks` : "Constructing 3D environments & generating music...",
        icon: <Globe className="w-4 h-4" />,
        status: activeStep > 1 ? "done" : activeStep === 1 ? "active" : "pending",
      },
      {
        label: "Waiting for worlds",
        description: activeStep >= 3
          ? "All worlds ready"
          : activeStep === 2
          ? `${worldsReady}/${sceneCount} worlds ready`
          : "Rendering scenes...",
        icon: <Eye className="w-4 h-4" />,
        status: activeStep >= 3 ? "done" : activeStep === 2 ? "active" : "pending",
      },
      {
        label: "Experience ready",
        description: activeStep >= 4 ? `${sceneCount} scenes, ${bgmCount} BGM tracks` : "Preparing your world...",
        icon: <Music className="w-4 h-4" />,
        status: activeStep >= 4 ? "done" : activeStep === 3 ? "active" : "pending",
      },
    ];
  })();

  useEffect(() => {
    if (!id) {
      navigate("/");
      return;
    }

    const poll = async () => {
      try {
        const gen = await getGeneration(id);
        setGeneration(gen);

        if (gen.status === "completed") {
          if (pollRef.current) clearInterval(pollRef.current);
          setTimeout(() => navigate(`/experience/${id}`), 800);
        } else if (gen.status === "failed") {
          if (pollRef.current) clearInterval(pollRef.current);
          setError(gen.error || "Generation failed");
        }
      } catch (err) {
        if (pollRef.current) clearInterval(pollRef.current);
        setError("Failed to load generation");
      }
    };

    poll();
    pollRef.current = setInterval(poll, 3000);

    return () => {
      if (pollRef.current) clearInterval(pollRef.current);
    };
  }, [id, navigate]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-16">
      <div className="w-full max-w-xl mx-auto">
        {generation?.title && (
          <h2 className="font-display text-2xl text-foreground mb-8 text-center animate-fade-in-up">
            {generation.title}
          </h2>
        )}

        {/* Stepper */}
        <div className="space-y-1 mb-10">
          {steps.map((step, i) => (
            <div key={i} className="flex items-start gap-4">
              <div className="flex flex-col items-center">
                <div
                  className={`w-9 h-9 rounded-full flex items-center justify-center border transition-all duration-300 ${
                    step.status === "done"
                      ? "bg-primary/20 border-primary text-primary"
                      : step.status === "active"
                      ? "border-primary text-primary animate-pulse-glow"
                      : step.status === "error"
                      ? "border-destructive text-destructive"
                      : "border-border text-muted-foreground"
                  }`}
                >
                  {step.status === "done" ? (
                    <Check className="w-4 h-4" />
                  ) : step.status === "active" ? (
                    <Loader2 className="w-4 h-4 animate-spin" />
                  ) : step.status === "error" ? (
                    <AlertCircle className="w-4 h-4" />
                  ) : (
                    step.icon
                  )}
                </div>
                {i < steps.length - 1 && (
                  <div className={`w-px h-8 transition-colors duration-300 ${
                    step.status === "done" ? "bg-primary/40" : "bg-border"
                  }`} />
                )}
              </div>
              <div className="pt-1.5">
                <p className={`text-sm font-medium ${
                  step.status === "active" ? "text-foreground" :
                  step.status === "done" ? "text-foreground" :
                  step.status === "error" ? "text-destructive" :
                  "text-muted-foreground"
                }`}>
                  {step.label}
                </p>
                <p className="text-xs text-muted-foreground mt-0.5">{step.description}</p>
              </div>
            </div>
          ))}
        </div>

        {/* Error state */}
        {error && (
          <div className="rounded-lg bg-destructive/10 border border-destructive/30 p-4 mb-6 text-center">
            <p className="text-sm text-destructive mb-3">{error}</p>
            <Button variant="outline" size="sm" onClick={() => navigate("/")}>
              Try Again
            </Button>
          </div>
        )}

        {/* Scene preview cards */}
        {generation?.scenes && generation.scenes.length > 0 && (
          <div className="animate-fade-in-up">
            <p className="text-xs uppercase tracking-widest text-muted-foreground mb-3">Scenes</p>
            <div className="grid gap-2">
              {generation.scenes.map((scene) => (
                <div
                  key={scene.id}
                  className="rounded-lg bg-card border border-border p-3 flex items-start justify-between gap-3"
                >
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">{scene.title}</p>
                    <p className="text-xs text-muted-foreground mt-1 line-clamp-2">{scene.marble_prompt}</p>
                  </div>
                  <div className="flex items-center gap-1.5 shrink-0">
                    <Badge variant="secondary" className="text-[10px]">{scene.mood}</Badge>
                    {scene.bgm_path && <Music className="w-3.5 h-3.5 text-muted-foreground" />}
                    {scene.spz_url && <Check className="w-3.5 h-3.5 text-primary" />}
                  </div>
                </div>
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default Processing;
