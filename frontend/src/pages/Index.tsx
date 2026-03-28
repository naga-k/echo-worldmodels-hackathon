import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { usePipeline } from "@/context/PipelineContext";
import { sampleStories } from "@/lib/samples";
import { Button } from "@/components/ui/button";
import { BookOpen } from "lucide-react";

const Index = () => {
  const navigate = useNavigate();
  const { setInputText } = usePipeline();
  const [text, setText] = useState("");

  const handleSubmit = () => {
    if (!text.trim()) return;
    setInputText(text.trim());
    navigate("/processing");
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
        />

        <Button
          variant="hero"
          size="lg"
          onClick={handleSubmit}
          disabled={!text.trim()}
          className="w-full sm:w-auto min-w-[200px] mb-14"
        >
          Step Inside
        </Button>

        {/* Sample stories */}
        <div className="w-full">
          <p className="text-muted-foreground text-xs uppercase tracking-widest mb-4 text-center">
            Or try a classic
          </p>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {sampleStories.map((story) => (
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
        </div>
      </div>
    </div>
  );
};

export default Index;
