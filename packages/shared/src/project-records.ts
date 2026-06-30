import type { GeneratedAsset, GalleryImageItem } from "./generation.js";

export const CREATIVE_PROJECT_RECORD_TYPES = ["prompt", "image_set", "video_plan", "asset_package"] as const;
export const CREATIVE_PROJECT_RECORD_STAGES = ["prompt", "reference", "image", "curation", "video", "export"] as const;
export const CREATIVE_PROJECT_RECORD_STATUSES = ["draft", "active", "ready", "archived"] as const;
export const PROJECT_RECORD_LINK_TYPES = ["generation", "output", "asset", "reference", "prompt_favorite", "manifest"] as const;
export const PROJECT_RECORD_CURATION_STATUSES = ["usable", "rejected", "needs_regeneration", "reference_only"] as const;
export const PROJECT_RECORD_REJECT_REASONS = [
  "no_logo",
  "wrong_logo",
  "logo_position_wrong",
  "wrong_ratio",
  "bad_composition",
  "too_ugly",
  "fake_text",
  "fake_score_or_data",
  "brand_risk",
  "real_person_risk",
  "trademark_risk",
  "too_aggressive",
  "gambling_vibe",
  "not_video_friendly",
  "other"
] as const;

export type CreativeProjectRecordType = (typeof CREATIVE_PROJECT_RECORD_TYPES)[number];
export type CreativeProjectRecordStage = (typeof CREATIVE_PROJECT_RECORD_STAGES)[number];
export type CreativeProjectRecordStatus = (typeof CREATIVE_PROJECT_RECORD_STATUSES)[number];
export type ProjectRecordLinkType = (typeof PROJECT_RECORD_LINK_TYPES)[number];
export type ProjectRecordCurationStatus = (typeof PROJECT_RECORD_CURATION_STATUSES)[number];
export type ProjectRecordRejectReason = (typeof PROJECT_RECORD_REJECT_REASONS)[number];

export interface CreativeProject {
  id: string;
  slug: string;
  name: string;
  description: string;
  recordCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface CreativeProjectsResponse {
  projects: CreativeProject[];
}

export interface CreativeProjectDetailResponse {
  project: CreativeProject;
  records: ProjectRecordSummary[];
}

export interface ProjectRecordSummary {
  id: string;
  projectId: string;
  title: string;
  type: CreativeProjectRecordType;
  stage: CreativeProjectRecordStage;
  status: CreativeProjectRecordStatus;
  updatedAt: string;
  createdAt: string;
}

export interface ProjectRecord extends ProjectRecordSummary {
  briefJson: string;
  prompt: string;
  notes: string;
  links: ProjectRecordLink[];
}

export interface ProjectRecordDetailResponse {
  project: CreativeProject;
  record: ProjectRecord;
  gallery: GalleryImageItem[];
}

export interface ProjectRecordLink {
  id: string;
  recordId: string;
  linkType: ProjectRecordLinkType;
  targetId: string;
  targetPath: string;
  title: string;
  curationStatus: ProjectRecordCurationStatus;
  rejectReasons: ProjectRecordRejectReason[];
  notes: string;
  metadataJson: string;
  asset?: GeneratedAsset;
  createdAt: string;
  updatedAt: string;
}

export interface CreateProjectRecordRequest {
  title: string;
  type: CreativeProjectRecordType;
  stage: CreativeProjectRecordStage;
  status: CreativeProjectRecordStatus;
  briefJson?: string;
  prompt?: string;
  notes?: string;
}

export type UpdateProjectRecordRequest = Partial<CreateProjectRecordRequest>;

export interface CreateProjectRecordLinkRequest {
  linkType: ProjectRecordLinkType;
  targetId?: string;
  targetPath?: string;
  title?: string;
  curationStatus?: ProjectRecordCurationStatus;
  rejectReasons?: ProjectRecordRejectReason[];
  notes?: string;
  metadataJson?: string;
}

export type UpdateProjectRecordLinkRequest = Partial<CreateProjectRecordLinkRequest>;
