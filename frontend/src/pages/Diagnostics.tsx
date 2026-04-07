import { useEffect, useMemo, useRef, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { ArrowLeft, ExternalLink, Image as ImageIcon, RefreshCcw, Save } from "lucide-react";
import SceneViewer from "@/components/SceneViewer";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { downloadCanvas, selectSceneSpz } from "@/lib/diagnostics";
import { getDiagnosticGeneration, listDiagnosticGenerations, updateSceneDiagnostics } from "@/lib/api";
import type { DiagnosticClassification, Generation, GenerationSummary, Scene, SpzTier, ViewerMode } from "@/types/pipeline";

const classificationOptions: Array<{ value: DiagnosticClassification; label: string }> = [
  { value: "bad_pano", label: "Bad pano" },
  { value: "good_pano_bad_echo", label: "Good pano, bad Echo" },
  { value: "good_marble_bad_echo", label: "Good Marble, bad Echo" },
  { value: "bad_everywhere", label: "Bad everywhere" },
];

const Diagnostics = () => {
  const [searchParams, setSearchParams] = useSearchParams();
  const [generations, setGenerations] = useState<GenerationSummary[]>([]);
  const [generation, setGeneration] = useState<Generation | null>(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const generationId = searchParams.get("gen") ?? "";
  const selectedSceneId = searchParams.get("scene") ?? "";
  const assetTier = (searchParams.get("tier") as SpzTier | null) ?? "full_res";
  const viewerMode = (searchParams.get("view") as ViewerMode | null) ?? "split";

  const [classification, setClassification] = useState<DiagnosticClassification | "">("");
  const [notes, setNotes] = useState("");
  const [echoScreenshotUrl, setEchoScreenshotUrl] = useState("");
  const [referenceScreenshotUrl, setReferenceScreenshotUrl] = useState("");

  const echoCanvasRef = useRef<HTMLCanvasElement | null>(null);
  const referenceCanvasRef = useRef<HTMLCanvasElement | null>(null);

  useEffect(() => {
    listDiagnosticGenerations(40)
      .then((items) => {
        setGenerations(items);
        if (!generationId && items[0]?.id) {
          setSearchParams((prev) => {
            const next = new URLSearchParams(prev);
            next.set("gen", items[0].id);
            next.set("view", viewerMode);
            next.set("tier", assetTier);
            return next;
          });
        }
      })
      .finally(() => setLoading(false));
  }, [assetTier, generationId, setSearchParams, viewerMode]);

  useEffect(() => {
    if (!generationId) return;
    getDiagnosticGeneration(generationId).then((data) => {
      setGeneration(data);
      if (!selectedSceneId && data.scenes[0]?.id) {
        setSearchParams((prev) => {
          const next = new URLSearchParams(prev);
          next.set("gen", generationId);
          next.set("scene", data.scenes[0].id);
          next.set("view", viewerMode);
          next.set("tier", assetTier);
          return next;
        });
      }
    });
  }, [assetTier, generationId, selectedSceneId, setSearchParams, viewerMode]);

  const selectedScene = useMemo(
    () => generation?.scenes.find((scene) => scene.id === selectedSceneId) ?? generation?.scenes[0],
    [generation, selectedSceneId],
  );

  useEffect(() => {
    const record = selectedScene?.diagnostic_record;
    setClassification((record?.classification as DiagnosticClassification | undefined) ?? "");
    setNotes(record?.notes ?? "");
    setEchoScreenshotUrl(record?.echo_screenshot_url ?? "");
    setReferenceScreenshotUrl(record?.reference_screenshot_url ?? "");
  }, [selectedScene]);

  const spzSelection = useMemo(() => selectSceneSpz(selectedScene, assetTier), [assetTier, selectedScene]);

  const updateParams = (patch: Record<string, string>) => {
    setSearchParams((prev) => {
      const next = new URLSearchParams(prev);
      Object.entries(patch).forEach(([key, value]) => next.set(key, value));
      return next;
    });
  };

  const saveDiagnostics = async () => {
    if (!generation || !selectedScene) return;
    setSaving(true);
    try {
      const record = await updateSceneDiagnostics(generation.id, selectedScene.id, {
        classification: classification || null,
        viewer_mode: viewerMode,
        asset_tier: assetTier,
        echo_screenshot_url: echoScreenshotUrl || null,
        reference_screenshot_url: referenceScreenshotUrl || null,
        notes: notes || null,
      });
      setGeneration((current) => {
        if (!current) return current;
        return {
          ...current,
          scenes: current.scenes.map((scene) =>
            scene.id === selectedScene.id ? { ...scene, diagnostic_record: record } : scene,
          ),
        };
      });
    } finally {
      setSaving(false);
    }
  };

  const captureScreenshot = (kind: "echo" | "reference") => {
    if (!generation || !selectedScene) return;
    const filename = `${generation.id}_${selectedScene.id}_${kind}_${assetTier}.png`;
    downloadCanvas(kind === "echo" ? echoCanvasRef.current : referenceCanvasRef.current, filename);
    if (kind === "echo") {
      setEchoScreenshotUrl(`capture:${filename}`);
      return;
    }
    setReferenceScreenshotUrl(`capture:${filename}`);
  };

  if (loading) {
    return <div className="min-h-screen flex items-center justify-center text-muted-foreground">Loading diagnostics…</div>;
  }

  return (
    <div className="min-h-screen bg-background px-6 py-8">
      <div className="max-w-[1600px] mx-auto space-y-6">
        <div className="flex items-center justify-between gap-4">
          <div className="flex items-center gap-3">
            <Link to="/" className="text-muted-foreground hover:text-foreground transition-colors">
              <ArrowLeft className="w-5 h-5" />
            </Link>
            <div>
              <h1 className="text-3xl font-display font-bold">Diagnostics</h1>
              <p className="text-sm text-muted-foreground">Compare Marble output quality against Echo and reference viewer modes.</p>
            </div>
          </div>
          <Button variant="outline" size="sm" onClick={() => generationId && getDiagnosticGeneration(generationId).then(setGeneration)}>
            <RefreshCcw className="w-4 h-4 mr-2" />
            Refresh
          </Button>
        </div>

        <div className="grid gap-4 md:grid-cols-4">
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Generations</div>
            <div className="mt-2 text-2xl font-semibold">{generations.length}</div>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Scene Count</div>
            <div className="mt-2 text-2xl font-semibold">{generation?.diagnostics_summary?.scene_count ?? 0}</div>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Classified</div>
            <div className="mt-2 text-2xl font-semibold">{generation?.diagnostics_summary?.classified_count ?? 0}</div>
          </div>
          <div className="rounded-lg border border-border bg-card p-4">
            <div className="text-xs uppercase tracking-widest text-muted-foreground">Warnings</div>
            <div className="mt-2 text-2xl font-semibold">{selectedScene?.prompt_analysis?.warnings.length ?? 0}</div>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <div className="grid gap-4 lg:grid-cols-[280px,220px,180px,180px]">
            <div>
              <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Generation</div>
              <Select value={generationId} onValueChange={(value) => updateParams({ gen: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select generation" />
                </SelectTrigger>
                <SelectContent>
                  {generations.map((item) => (
                    <SelectItem key={item.id} value={item.id}>
                      {item.title || item.id}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Scene</div>
              <Select value={selectedScene?.id ?? ""} onValueChange={(value) => updateParams({ scene: value })}>
                <SelectTrigger>
                  <SelectValue placeholder="Select scene" />
                </SelectTrigger>
                <SelectContent>
                  {generation?.scenes.map((scene) => (
                    <SelectItem key={scene.id} value={scene.id}>
                      {scene.title}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>

            <div>
              <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Asset Tier</div>
              <Select value={assetTier} onValueChange={(value) => updateParams({ tier: value })}>
                <SelectTrigger>
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="full_res">full_res</SelectItem>
                  <SelectItem value="500k">500k</SelectItem>
                  <SelectItem value="100k">100k</SelectItem>
                </SelectContent>
              </Select>
            </div>

            <div>
              <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Viewer Layout</div>
              <Tabs value={viewerMode} onValueChange={(value) => updateParams({ view: value })}>
                <TabsList className="w-full">
                  <TabsTrigger value="split" className="flex-1">Split</TabsTrigger>
                  <TabsTrigger value="echo" className="flex-1">Echo</TabsTrigger>
                  <TabsTrigger value="reference" className="flex-1">Ref</TabsTrigger>
                </TabsList>
              </Tabs>
            </div>
          </div>
        </div>

        <div className="grid gap-6 xl:grid-cols-[1.4fr,1fr]">
          <div className="rounded-xl border border-border bg-card p-4 space-y-4">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-lg font-semibold">{selectedScene?.title || "No scene selected"}</div>
                <div className="text-sm text-muted-foreground">
                  World {selectedScene?.world_id || "pending"} · model {selectedScene?.model || generation?.marble_model || "unknown"} · tier {spzSelection.tier || "n/a"}
                </div>
              </div>
              {selectedScene?.world_marble_url && (
                <a href={selectedScene.world_marble_url} target="_blank" rel="noreferrer" className="text-sm text-primary inline-flex items-center gap-1">
                  Marble
                  <ExternalLink className="w-4 h-4" />
                </a>
              )}
            </div>

            {viewerMode === "split" ? (
              <div className="grid gap-4 xl:grid-cols-2">
                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium">Echo Viewer</div>
                    <Button variant="outline" size="sm" onClick={() => captureScreenshot("echo")}>Capture</Button>
                  </div>
                  <div className="h-[420px] rounded-lg overflow-hidden border border-border">
                    {spzSelection.url ? (
                      <SceneViewer
                        spzUrl={spzSelection.url}
                        colliderMeshUrl={selectedScene?.collider_mesh_url}
                        semantics={selectedScene?.semantics}
                        showDebug={false}
                        variant="echo"
                        onCanvasReady={(canvas) => { echoCanvasRef.current = canvas; }}
                      />
                    ) : (
                      <div className="h-full flex items-center justify-center text-muted-foreground">No SPZ available</div>
                    )}
                  </div>
                </div>

                <div className="space-y-2">
                  <div className="flex items-center justify-between">
                    <div className="text-sm font-medium">Reference Viewer</div>
                    <Button variant="outline" size="sm" onClick={() => captureScreenshot("reference")}>Capture</Button>
                  </div>
                  <div className="h-[420px] rounded-lg overflow-hidden border border-border">
                    {spzSelection.url ? (
                      <SceneViewer
                        spzUrl={spzSelection.url}
                        colliderMeshUrl={selectedScene?.collider_mesh_url}
                        semantics={selectedScene?.semantics}
                        showDebug={false}
                        variant="reference"
                        onCanvasReady={(canvas) => { referenceCanvasRef.current = canvas; }}
                      />
                    ) : (
                      <div className="h-full flex items-center justify-center text-muted-foreground">No SPZ available</div>
                    )}
                  </div>
                </div>
              </div>
            ) : (
              <div className="space-y-2">
                <div className="flex items-center justify-between">
                  <div className="text-sm font-medium">{viewerMode === "echo" ? "Echo Viewer" : "Reference Viewer"}</div>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() => captureScreenshot(viewerMode === "echo" ? "echo" : "reference")}
                  >
                    Capture
                  </Button>
                </div>
                <div className="h-[520px] rounded-lg overflow-hidden border border-border">
                  {spzSelection.url ? (
                    <SceneViewer
                      spzUrl={spzSelection.url}
                      colliderMeshUrl={selectedScene?.collider_mesh_url}
                      semantics={selectedScene?.semantics}
                      showDebug={false}
                      variant={viewerMode === "echo" ? "echo" : "reference"}
                      onCanvasReady={(canvas) => {
                        if (viewerMode === "echo") echoCanvasRef.current = canvas;
                        else referenceCanvasRef.current = canvas;
                      }}
                    />
                  ) : (
                    <div className="h-full flex items-center justify-center text-muted-foreground">No SPZ available</div>
                  )}
                </div>
              </div>
            )}

            <div className="grid gap-4 lg:grid-cols-2">
              <div className="rounded-lg border border-border bg-background p-3">
                <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Thumbnail</div>
                {selectedScene?.thumbnail_url ? (
                  <img src={selectedScene.thumbnail_url} alt="Thumbnail" className="w-full rounded-md border border-border" />
                ) : (
                  <div className="h-36 flex items-center justify-center text-muted-foreground text-sm"><ImageIcon className="w-4 h-4 mr-2" />No thumbnail</div>
                )}
              </div>
              <div className="rounded-lg border border-border bg-background p-3">
                <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Pano</div>
                {selectedScene?.pano_url ? (
                  <img src={selectedScene.pano_url} alt="Pano" className="w-full rounded-md border border-border" />
                ) : (
                  <div className="h-36 flex items-center justify-center text-muted-foreground text-sm"><ImageIcon className="w-4 h-4 mr-2" />No pano</div>
                )}
              </div>
            </div>
          </div>

          <div className="space-y-4">
            <div className="rounded-xl border border-border bg-card p-4 space-y-4">
              <div>
                <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Classification</div>
                <Select value={classification} onValueChange={(value) => setClassification(value as DiagnosticClassification)}>
                  <SelectTrigger>
                    <SelectValue placeholder="Choose classification" />
                  </SelectTrigger>
                  <SelectContent>
                    {classificationOptions.map((option) => (
                      <SelectItem key={option.value} value={option.value}>{option.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div>
                <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Warnings</div>
                <div className="flex flex-wrap gap-2">
                  {selectedScene?.prompt_analysis?.warnings.length ? selectedScene.prompt_analysis.warnings.map((warning) => (
                    <Badge key={warning} variant="secondary">{warning}</Badge>
                  )) : <span className="text-sm text-muted-foreground">No warnings detected</span>}
                </div>
              </div>

              <div>
                <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Source Excerpt</div>
                <p className="text-sm text-muted-foreground leading-relaxed">{selectedScene?.source_excerpt || "No excerpt available."}</p>
              </div>

              <div>
                <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Extracted Prompt</div>
                <p className="text-sm leading-relaxed whitespace-pre-line">{selectedScene?.marble_prompt || "No prompt available."}</p>
              </div>

              <div>
                <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">World Labs Caption</div>
                <p className="text-sm leading-relaxed whitespace-pre-line">{selectedScene?.caption || "No caption returned."}</p>
              </div>

              <div>
                <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">World Prompt</div>
                <p className="text-sm leading-relaxed whitespace-pre-line">{selectedScene?.world_prompt_text || "No stored world prompt."}</p>
              </div>

              <div className="grid gap-3">
                <div>
                  <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Echo Screenshot Artifact</div>
                  <input value={echoScreenshotUrl} onChange={(e) => setEchoScreenshotUrl(e.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
                </div>
                <div>
                  <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Reference Screenshot Artifact</div>
                  <input value={referenceScreenshotUrl} onChange={(e) => setReferenceScreenshotUrl(e.target.value)} className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm" />
                </div>
                <div>
                  <div className="text-xs uppercase tracking-widest text-muted-foreground mb-2">Notes</div>
                  <textarea
                    value={notes}
                    onChange={(e) => setNotes(e.target.value)}
                    rows={5}
                    className="w-full rounded-md border border-border bg-background px-3 py-2 text-sm"
                    placeholder="Record what looked wrong and where."
                  />
                </div>
              </div>

              <Button onClick={saveDiagnostics} disabled={!selectedScene || saving} className="w-full">
                <Save className="w-4 h-4 mr-2" />
                {saving ? "Saving…" : "Save Diagnostics"}
              </Button>
            </div>

            <div className="rounded-xl border border-border bg-card p-4">
              <div className="text-sm font-medium mb-3">Scene Summary</div>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Scene</TableHead>
                    <TableHead>Classification</TableHead>
                    <TableHead>Warnings</TableHead>
                    <TableHead>Model</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {generation?.scenes.map((scene) => (
                    <TableRow key={scene.id} className={scene.id === selectedScene?.id ? "bg-muted/40" : ""} onClick={() => updateParams({ scene: scene.id })}>
                      <TableCell>{scene.title}</TableCell>
                      <TableCell>{scene.diagnostic_record?.classification || "—"}</TableCell>
                      <TableCell>{scene.prompt_analysis?.warnings.join(", ") || "—"}</TableCell>
                      <TableCell>{scene.model || generation.marble_model || "—"}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          </div>
        </div>

        <div className="rounded-xl border border-border bg-card p-4">
          <div className="text-sm font-medium mb-3">Generation Summary</div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>Generation</TableHead>
                <TableHead>Scenes</TableHead>
                <TableHead>Classified</TableHead>
                <TableHead>Model</TableHead>
                <TableHead>Created</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {generations.map((item) => (
                <TableRow key={item.id} className={item.id === generationId ? "bg-muted/40" : ""} onClick={() => updateParams({ gen: item.id })}>
                  <TableCell>{item.title || item.id}</TableCell>
                  <TableCell>{item.scene_count}</TableCell>
                  <TableCell>{item.classified_count ?? 0}</TableCell>
                  <TableCell>{item.marble_model || "—"}</TableCell>
                  <TableCell>{new Date(item.created_at).toLocaleString()}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>
      </div>
    </div>
  );
};

export default Diagnostics;
