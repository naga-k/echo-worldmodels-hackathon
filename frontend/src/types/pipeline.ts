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
  spz_url?: string;
  collider_mesh_url?: string;
  semantics?: {
    ground_plane_offset?: number;
    metric_scale_factor?: number;
  };
}

export interface ExtractScenesResponse {
  title: string;
  narration_text: string;
  scenes: Scene[];
}

export interface Operation {
  scene_id: string;
  operation_id: string;
}

export interface GenerateWorldsResponse {
  operations: Operation[];
}

export interface PollScene {
  operation_id: string;
  status: "generating" | "ready" | "failed" | "error";
  spz_url?: string;
  collider_mesh_url?: string;
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
