import { useState, useEffect } from "react";
import { useNavigate, Link } from "react-router-dom";
import { sampleStories } from "@/lib/samples";
import { fetchSamples, createGeneration, listGenerations, type SampleStory } from "@/lib/api";
import type { GenerationSummary } from "@/types/pipeline";
import { Button } from "@/components/ui/button";
import { BookOpen, Globe, ChevronRight } from "lucide-react";

type Tab = "classics" | "worlds";

const Index = () => {
  const navigate = useNavigate();
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [samples, setSamples] = useState<SampleStory[]>([]);
  const [recentWorlds, setRecentWorlds] = useState<GenerationSummary[]>([]);
  const [activeTab, setActiveTab] = useState<Tab>("classics");

  useEffect(() => {
    fetchSamples()
      .then(setSamples)
      .catch(() => setSamples([]));
    listGenerations()
      .then((gens) => setRecentWorlds(gens.filter((g) => g.status === "completed").slice(0, 4)))
      .catch(() => setRecentWorlds([]));
  }, []);

  const handleSubmit = async () => {
    if (!text.trim() || submitting) return;
    setSubmitting(true);
    try {
      const { id } = await createGeneration(text.trim());
      navigate(`/processing/${id}`);
    } catch (err) {
      console.error("Failed to create generation:", err);
      setSubmitting(false);
    }
  };

  return (
    <div className="min-h-screen flex flex-col items-center justify-center px-4 py-16 relative overflow-hidden">
      {/* Ambient glow */}
      <div className="absolute top-1/4 left-1/2 -translate-x-1/2 -translate-y-1/2 w-[600px] h-[400px] bg-primary/5 rounded-full blur-[120px] pointer-events-none" />

      <div className="w-full max-w-2xl mx-auto relative z-10 flex flex-col items-center">
        {/* Hero */}
        <h1 className="font-display text-7xl md:text-8xl font-bold text-gradient tracking-tight mb-3">
          Echo
        </h1>
        <p className="text-muted-foreground text-lg md:text-xl mb-10 text-center">
          Paste a story. Step inside it.
        </p>

        {/* Textarea */}
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="Paste a story, transcript, or description here..."
          rows={7}
          className="w-full rounded-lg bg-card border border-border p-4 text-foreground placeholder:text-muted-foreground resize-none focus:outline-none focus:ring-2 focus:ring-ring transition-shadow text-sm leading-relaxed mb-4"
          disabled={submitting}
        />

        <Button
          variant="hero"
          size="lg"
          onClick={handleSubmit}
          disabled={!text.trim() || submitting}
          className="w-full sm:w-auto min-w-[200px] mb-14"
        >
          {submitting ? "Creating..." : "Step Inside"}
        </Button>

        {/* Tabs */}
        <div className="w-full">
          <div className="flex items-center justify-center gap-6 mb-5">
            <button
              onClick={() => setActiveTab("classics")}
              className={`text-xs uppercase tracking-widest pb-1.5 border-b-2 transition-colors ${
                activeTab === "classics"
                  ? "text-foreground border-primary"
                  : "text-muted-foreground border-transparent hover:text-foreground/70"
              }`}
            >
              Try a classic
            </button>
            {recentWorlds.length > 0 && (
              <button
                onClick={() => setActiveTab("worlds")}
                className={`text-xs uppercase tracking-widest pb-1.5 border-b-2 transition-colors ${
                  activeTab === "worlds"
                    ? "text-foreground border-primary"
                    : "text-muted-foreground border-transparent hover:text-foreground/70"
                }`}
              >
                Past experiences
              </button>
            )}
          </div>

          {activeTab === "classics" && (
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
              {(samples.length > 0 ? samples : sampleStories).map((story) => (
                <button
                  key={story.title}
                  onClick={() => setText(story.text)}
                  className="group text-left rounded-lg bg-card border border-border p-4 hover:border-primary/40 transition-all duration-200 hover:shadow-[var(--shadow-glow)]"
                >
                  <div className="flex items-start gap-3">
                    <BookOpen className="w-4 h-4 text-primary mt-1 shrink-0 opacity-60 group-hover:opacity-100 transition-opacity" />
                    <div>
                      <p className="text-sm font-medium text-foreground leading-snug">{story.title}</p>
                      <p className="text-xs text-muted-foreground mt-0.5">{story.author}</p>
                      <p className="text-xs text-muted-foreground mt-1.5 leading-relaxed">{story.description}</p>
                    </div>
                  </div>
                </button>
              ))}
            </div>
          )}

          {activeTab === "worlds" && recentWorlds.length > 0 && (
            <div>
              <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                {recentWorlds.map((gen) => (
                  <Link
                    key={gen.id}
                    to={`/processing/${gen.id}`}
                    className="group relative rounded-lg glass p-4 hover:border-primary/40 transition-all duration-300 hover:shadow-[var(--shadow-glow)] overflow-hidden"
                  >
                    <div className="absolute inset-0 bg-primary/0 group-hover:bg-primary/5 transition-colors duration-300 rounded-lg" />
                    <div className="relative">
                      <Globe className="w-5 h-5 text-primary/40 group-hover:text-primary/80 transition-colors mb-3" />
                      <p className="text-sm font-medium text-foreground truncate leading-snug">
                        {gen.title || "Untitled"}
                      </p>
                      <p className="text-[10px] text-muted-foreground mt-1">
                        {gen.scene_count} scene{gen.scene_count !== 1 ? "s" : ""}
                      </p>
                    </div>
                  </Link>
                ))}
              </div>
              <div className="flex justify-center mt-4">
                <Link
                  to="/gallery"
                  className="flex items-center gap-1 text-xs text-muted-foreground hover:text-primary transition-colors group"
                >
                  View all
                  <ChevronRight className="w-3 h-3 group-hover:translate-x-0.5 transition-transform" />
                </Link>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};

export default Index;
