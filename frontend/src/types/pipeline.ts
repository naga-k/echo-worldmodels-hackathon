export type MarbleModel = "Marble 0.1-mini" | "Marble 0.1-plus";
export type SpzTier = "full_res" | "500k" | "100k" | "legacy";
export type ViewerMode = "split" | "echo" | "reference";
export type DiagnosticClassification =
  | "bad_pano"
  | "good_pano_bad_echo"
  | "good_marble_bad_echo"
  | "bad_everywhere";

export interface DiagnosticRecord {
  generation_id: string;
  scene_id: string;
  classification?: DiagnosticClassification | null;
  viewer_mode?: ViewerMode | null;
  asset_tier?: SpzTier | null;
  echo_screenshot_url?: string | null;
  reference_screenshot_url?: string | null;
  notes?: string | null;
  updated_at?: string | null;
}

export interface PromptAnalysis {
  warnings: string[];
  metrics: {
    word_count: number;
    sentence_count: number;
    comma_count: number;
    layout_hits: number;
    boundary_hits: number;
    rear_hits: number;
    prop_hits: number;
    recaption_ratio?: number | null;
  };
  comparisons: {
    extracted_prompt?: string | null;
    caption?: string | null;
    world_prompt_text?: string | null;
  };
}

export interface Scene {
  id: string;
  title: string;
  source_ref: string;
  marble_prompt: string;
  narration_text: string;
  time_start: number;
  time_end: number;
  camera_direction: string;
  mood: string;
  music_description?: string;
  original_marble_prompt?: string;
  rewrite_applied?: boolean;
  rewrite_retry_count?: number;
  rewrite_error?: string | null;
  prompt_analysis_before?: PromptAnalysis;
  prompt_analysis_after?: PromptAnalysis;
  bgm_path?: string;
  spz_url?: string;
  spz_urls?: Partial<Record<SpzTier, string>>;
  selected_spz_tier?: SpzTier;
  collider_mesh_url?: string;
  world_id?: string;
  model?: MarbleModel | string | null;
  world_marble_url?: string | null;
  thumbnail_url?: string | null;
  pano_url?: string | null;
  caption?: string | null;
  world_prompt_text?: string | null;
  semantics?: {
    ground_plane_offset?: number;
    metric_scale_factor?: number;
  };
  diagnostic_record?: DiagnosticRecord | null;
  prompt_analysis?: PromptAnalysis;
  source_excerpt?: string;
}

export interface ExtractScenesResponse {
  title: string;
  narration_text: string;
  scenes: Scene[];
}

export interface Operation {
  scene_id: string;
  operation_id: string;
  requested_model?: MarbleModel | string;
}

export interface GenerateWorldsResponse {
  operations: Operation[];
  model?: MarbleModel | string;
  asset_tier?: SpzTier | string;
}

export interface PollScene {
  operation_id: string;
  status: "generating" | "ready" | "failed" | "error";
  spz_url?: string;
  spz_urls?: Partial<Record<SpzTier, string>>;
  selected_spz_tier?: SpzTier;
  collider_mesh_url?: string;
  world_id?: string | null;
  model?: MarbleModel | string | null;
  world_marble_url?: string | null;
  thumbnail_url?: string | null;
  pano_url?: string | null;
  caption?: string | null;
  world_prompt_text?: string | null;
  semantics?: {
    ground_plane_offset?: number;
    metric_scale_factor?: number;
  };
  error?: string;
}

export interface PollWorldsResponse {
  scenes: PollScene[];
}

export interface PipelineData {
  title: string;
  narration_text: string;
  scenes: Scene[];
  audioBlobUrl: string;
}

export type GenerationStatus =
  | "pending"
  | "extracting"
  | "generating_speech"
  | "building_worlds"
  | "polling"
  | "completed"
  | "failed";

export interface Generation {
  id: string;
  status: GenerationStatus;
  title: string | null;
  input_text: string;
  marble_model?: MarbleModel | string | null;
  asset_tier?: SpzTier | string | null;
  narration_text: string | null;
  scenes: Scene[];
  operations: any[];
  audio_path: string | null;
  error: string | null;
  created_at: string;
  updated_at: string;
  diagnostics_summary?: {
    scene_count: number;
    classified_count: number;
    classification_counts: Record<string, number>;
  };
}

export interface GenerationSummary {
  id: string;
  status: GenerationStatus;
  title: string | null;
  marble_model?: MarbleModel | string | null;
  asset_tier?: SpzTier | string | null;
  created_at: string;
  updated_at: string;
  scene_count: number;
  classified_count?: number;
  classification_counts?: Record<string, number>;
}
