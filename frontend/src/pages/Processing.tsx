import { useEffect, useState, useRef } from "react";
import { useNavigate } from "react-router-dom";
import { usePipeline } from "@/context/PipelineContext";
import { extractScenes, generateSpeech, generateWorlds, pollWorlds } from "@/lib/api";
import type { Scene } from "@/types/pipeline";
import { Check, Loader2, Music, Globe, Eye, Sparkles } from "lucide-react";
import { Badge } from "@/components/ui/badge";

type StepStatus = "pending" | "active" | "done" | "error";

interface Step {
  label: string;
  description: string;
  icon: React.ReactNode;
  status: StepStatus;
  error?: string;
}

const Processing = () => {
  const navigate = useNavigate();
  const { inputText, setPipelineData } = usePipeline();
  const [steps, setSteps] = useState<Step[]>([
    { label: "Extracting scenes", description: "Analyzing your story...", icon: <Sparkles className="w-4 h-4" />, status: "pending" },
    { label: "Generating narration", description: "Creating voice-over...", icon: <Music className="w-4 h-4" />, status: "pending" },
    { label: "Building worlds", description: "Constructing 3D environments...", icon: <Globe className="w-4 h-4" />, status: "pending" },
    { label: "Waiting for worlds", description: "Rendering scenes...", icon: <Eye className="w-4 h-4" />, status: "pending" },
  ]);
  const [scenes, setScenes] = useState<Scene[]>([]);
  const [storyTitle, setStoryTitle] = useState("");
  const hasStarted = useRef(false);

  const updateStep = (index: number, update: Partial<Step>) => {
    setSteps((prev) => prev.map((s, i) => (i === index ? { ...s, ...update } : s)));
  };

  useEffect(() => {
    if (!inputText || hasStarted.current) {
      if (!inputText) navigate("/");
      return;
    }
    hasStarted.current = true;

    const run = async () => {
      try {
        // Step 1
        updateStep(0, { status: "active" });
        const extracted = await extractScenes(inputText);
        setScenes(extracted.scenes);
        setStoryTitle(extracted.title);
        updateStep(0, { status: "done", description: `${extracted.scenes.length} scenes found` });

        // Step 2
        updateStep(1, { status: "active" });
        const audioBlobUrl = await generateSpeech(extracted.narration_text);
        updateStep(1, { status: "done", description: "Audio ready" });

        // Step 3
        updateStep(2, { status: "active" });
        const worldsRes = await generateWorlds(
          extracted.scenes.map((s) => ({ id: s.id, marble_prompt: s.marble_prompt })),
          "Marble 0.1-plus"
        );
        updateStep(2, { status: "done", description: `${worldsRes.operations.length} worlds queued` });

        // Step 4
        updateStep(3, { status: "active" });
        const opIds = worldsRes.operations.map((o) => o.operation_id);
        const opToScene = new Map(worldsRes.operations.map((o) => [o.operation_id, o.scene_id]));

        let allReady = false;
        let finalScenes = [...extracted.scenes];

        while (!allReady) {
          const pollRes = await pollWorlds(opIds);
          allReady = pollRes.scenes.every((s) => s.status !== "generating");

          for (const ps of pollRes.scenes) {
            if (ps.spz_url) {
              const sceneId = opToScene.get(ps.operation_id);
              finalScenes = finalScenes.map((s) =>
                s.id === sceneId ? {
                  ...s,
                  spz_url: ps.spz_url,
                  collider_mesh_url: ps.collider_mesh_url,
                  semantics: ps.semantics,
                } : s
              );
            }
          }
          setScenes(finalScenes);

          const readyCount = pollRes.scenes.filter((s) => s.status === "ready").length;
          updateStep(3, { description: `${readyCount}/${pollRes.scenes.length} worlds ready` });

          if (!allReady) await new Promise((r) => setTimeout(r, 5000));
        }

        updateStep(3, { status: "done", description: "All worlds ready" });

        setPipelineData({
          title: extracted.title,
          narration_text: extracted.narration_text,
          scenes: finalScenes,
          audioBlobUrl,
        });

        setTimeout(() => navigate("/experience"), 800);
      } catch (err: any) {
        const activeIdx = steps.findIndex((s) => s.status === "active");
        if (activeIdx >= 0) {
          updateStep(activeIdx, { status: "error", description: err.message || "Something went wrong" });
        }
      }
    };

    run();
  }, [inputText]);

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-16">
      <div className="w-full max-w-xl mx-auto">
        {storyTitle && (
          <h2 className="font-display text-2xl text-foreground mb-8 text-center animate-fade-in-up">
            {storyTitle}
          </h2>
        )}

        {/* Stepper */}
        <div className="space-y-1 mb-10">
          {steps.map((step, i) => (
            <div key={i} className="flex items-start gap-4">
              {/* Icon column */}
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

              {/* Text */}
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

        {/* Scene preview cards */}
        {scenes.length > 0 && (
          <div className="animate-fade-in-up">
            <p className="text-xs uppercase tracking-widest text-muted-foreground mb-3">Scenes</p>
            <div className="grid gap-2">
              {scenes.map((scene) => (
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
