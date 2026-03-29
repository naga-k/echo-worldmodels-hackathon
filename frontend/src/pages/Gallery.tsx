import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { listGenerations } from "@/lib/api";
import type { GenerationSummary } from "@/types/pipeline";
import { ArrowLeft, Globe, Loader2, AlertCircle, Check } from "lucide-react";
import { Badge } from "@/components/ui/badge";

const statusConfig: Record<string, { label: string; color: string; icon: React.ReactNode }> = {
  pending: { label: "Pending", color: "bg-muted text-muted-foreground", icon: <Loader2 className="w-3 h-3" /> },
  extracting: { label: "Extracting", color: "bg-blue-500/20 text-blue-400", icon: <Loader2 className="w-3 h-3 animate-spin" /> },
  generating_speech: { label: "Narrating", color: "bg-blue-500/20 text-blue-400", icon: <Loader2 className="w-3 h-3 animate-spin" /> },
  building_worlds: { label: "Building", color: "bg-purple-500/20 text-purple-400", icon: <Loader2 className="w-3 h-3 animate-spin" /> },
  polling: { label: "Rendering", color: "bg-purple-500/20 text-purple-400", icon: <Loader2 className="w-3 h-3 animate-spin" /> },
  completed: { label: "Ready", color: "bg-primary/20 text-primary", icon: <Check className="w-3 h-3" /> },
  failed: { label: "Failed", color: "bg-destructive/20 text-destructive", icon: <AlertCircle className="w-3 h-3" /> },
};

const Gallery = () => {
  const [generations, setGenerations] = useState<GenerationSummary[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    listGenerations()
      .then(setGenerations)
      .catch(() => setGenerations([]))
      .finally(() => setLoading(false));
  }, []);

  const formatDate = (iso: string) => {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit" });
  };

  return (
    <div className="min-h-screen px-4 py-16 max-w-3xl mx-auto">
      <div className="flex items-center gap-4 mb-10">
        <Link to="/" className="text-muted-foreground hover:text-foreground transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <h1 className="font-display text-3xl font-bold text-foreground">Gallery</h1>
      </div>

      {loading ? (
        <div className="flex items-center justify-center py-20">
          <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
        </div>
      ) : generations.length === 0 ? (
        <div className="text-center py-20">
          <Globe className="w-12 h-12 text-muted-foreground/30 mx-auto mb-4" />
          <p className="text-muted-foreground">No generations yet.</p>
          <Link to="/" className="text-primary text-sm hover:underline mt-2 inline-block">
            Create your first experience
          </Link>
        </div>
      ) : (
        <div className="grid gap-3">
          {generations.map((gen) => {
            const config = statusConfig[gen.status] || statusConfig.pending;
            const href = gen.status === "completed"
              ? `/experience/${gen.id}`
              : gen.status === "failed"
              ? "#"
              : `/processing/${gen.id}`;

            return (
              <Link
                key={gen.id}
                to={href}
                className="group rounded-lg bg-card border border-border p-4 hover:border-primary/40 transition-all duration-200 hover:shadow-[var(--shadow-glow)] block"
              >
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <p className="text-sm font-medium text-foreground truncate">
                      {gen.title || "Untitled"}
                    </p>
                    <div className="flex items-center gap-3 mt-1.5">
                      <span className="text-xs text-muted-foreground">{formatDate(gen.created_at)}</span>
                      {gen.scene_count > 0 && (
                        <span className="text-xs text-muted-foreground">{gen.scene_count} scenes</span>
                      )}
                    </div>
                  </div>
                  <Badge className={`${config.color} flex items-center gap-1 text-[10px] shrink-0`}>
                    {config.icon}
                    {config.label}
                  </Badge>
                </div>
              </Link>
            );
          })}
        </div>
      )}
    </div>
  );
};

export default Gallery;
