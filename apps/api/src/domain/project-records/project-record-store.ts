import { randomUUID } from "node:crypto";
import { and, desc, eq, sql } from "drizzle-orm";
import {
  CREATIVE_PROJECT_RECORD_STAGES,
  CREATIVE_PROJECT_RECORD_STATUSES,
  CREATIVE_PROJECT_RECORD_TYPES,
  PROJECT_RECORD_CURATION_STATUSES,
  PROJECT_RECORD_LINK_TYPES,
  PROJECT_RECORD_REJECT_REASONS,
  type CreateProjectRecordLinkRequest,
  type CreateProjectRecordRequest,
  type CreativeProject,
  type CreativeProjectDetailResponse,
  type CreativeProjectRecordStage,
  type CreativeProjectRecordStatus,
  type CreativeProjectRecordType,
  type CreativeProjectsResponse,
  type GeneratedAsset,
  type ProjectRecord,
  type ProjectRecordCurationStatus,
  type ProjectRecordDetailResponse,
  type ProjectRecordLink,
  type ProjectRecordLinkType,
  type ProjectRecordRejectReason,
  type ProjectRecordSummary,
  type UpdateProjectRecordLinkRequest,
  type UpdateProjectRecordRequest
} from "../contracts.js";
import { getGalleryImages } from "../project/project-store.js";
import { db } from "../../infrastructure/database.js";
import {
  assets,
  creativeProjects,
  generationOutputs,
  projectRecordLinks,
  projectRecords
} from "../../infrastructure/schema.js";

const MAVOSPORT_PROJECT_ID = "mavosport";
const DEFAULT_BRIEF_JSON = "{}";
const DEFAULT_LINK_METADATA_JSON = "{}";
const MAX_TITLE_LENGTH = 160;
const MAX_TEXT_LENGTH = 60_000;
const MAX_JSON_LENGTH = 240_000;

export class ProjectRecordValidationError extends Error {
  readonly code = "invalid_project_record";

  constructor(message: string) {
    super(message);
    this.name = "ProjectRecordValidationError";
  }
}

export class ProjectRecordNotFoundError extends Error {
  readonly code = "project_record_not_found";
}

function nowIso(): string {
  return new Date().toISOString();
}

export function ensureMavoSportProject(): void {
  const now = nowIso();
  db.insert(creativeProjects)
    .values({
      id: MAVOSPORT_PROJECT_ID,
      slug: "mavosport",
      name: "MavoSport",
      description: "MavoSport 圖片 → 影片 reference 創作紀錄",
      createdAt: now,
      updatedAt: now
    })
    .onConflictDoNothing()
    .run();
}

export function listCreativeProjects(): CreativeProjectsResponse {
  ensureMavoSportProject();

  const rows = db
    .select({
      project: creativeProjects,
      recordCount: sql<number>`count(${projectRecords.id})`
    })
    .from(creativeProjects)
    .leftJoin(projectRecords, eq(projectRecords.projectId, creativeProjects.id))
    .groupBy(creativeProjects.id)
    .orderBy(creativeProjects.name)
    .all();

  return {
    projects: rows.map(({ project, recordCount }) => toCreativeProject(project, Number(recordCount) || 0))
  };
}

export function getCreativeProjectDetail(projectIdOrSlug: string): CreativeProjectDetailResponse {
  const project = requireCreativeProject(projectIdOrSlug);
  return {
    project: toCreativeProject(project, countRecords(project.id)),
    records: listProjectRecordRows(project.id).map(toProjectRecordSummary)
  };
}

export function createProjectRecord(projectIdOrSlug: string, request: CreateProjectRecordRequest): ProjectRecordDetailResponse {
  const project = requireCreativeProject(projectIdOrSlug);
  const normalized = normalizeRecordRequest(request);
  const now = nowIso();
  const id = randomUUID();

  db.insert(projectRecords)
    .values({
      id,
      projectId: project.id,
      title: normalized.title,
      type: normalized.type,
      stage: normalized.stage,
      status: normalized.status,
      briefJson: normalized.briefJson,
      prompt: normalized.prompt,
      notes: normalized.notes,
      createdAt: now,
      updatedAt: now
    })
    .run();

  return getProjectRecordDetail(id);
}

export function getProjectRecordDetail(recordId: string): ProjectRecordDetailResponse {
  ensureMavoSportProject();
  const row = db.select().from(projectRecords).where(eq(projectRecords.id, recordId)).get();
  if (!row) {
    throw new ProjectRecordNotFoundError("Project record not found.");
  }

  const project = requireCreativeProject(row.projectId);
  const links = db
    .select()
    .from(projectRecordLinks)
    .where(eq(projectRecordLinks.recordId, row.id))
    .orderBy(desc(projectRecordLinks.updatedAt))
    .all();

  return {
    project: toCreativeProject(project, countRecords(project.id)),
    record: toProjectRecord(row, links.map(toProjectRecordLink)),
    gallery: getGalleryImages().items
  };
}

export function updateProjectRecord(recordId: string, request: UpdateProjectRecordRequest): ProjectRecordDetailResponse {
  const existing = db.select().from(projectRecords).where(eq(projectRecords.id, recordId)).get();
  if (!existing) {
    throw new ProjectRecordNotFoundError("Project record not found.");
  }

  const normalized = normalizeRecordRequest({
    title: request.title ?? existing.title,
    type: request.type ?? (existing.type as CreativeProjectRecordType),
    stage: request.stage ?? (existing.stage as CreativeProjectRecordStage),
    status: request.status ?? (existing.status as CreativeProjectRecordStatus),
    briefJson: request.briefJson ?? existing.briefJson,
    prompt: request.prompt ?? existing.prompt,
    notes: request.notes ?? existing.notes
  });

  db.update(projectRecords)
    .set({
      title: normalized.title,
      type: normalized.type,
      stage: normalized.stage,
      status: normalized.status,
      briefJson: normalized.briefJson,
      prompt: normalized.prompt,
      notes: normalized.notes,
      updatedAt: nowIso()
    })
    .where(eq(projectRecords.id, recordId))
    .run();

  return getProjectRecordDetail(recordId);
}

export function createProjectRecordLink(recordId: string, request: CreateProjectRecordLinkRequest): ProjectRecordDetailResponse {
  const record = db.select().from(projectRecords).where(eq(projectRecords.id, recordId)).get();
  if (!record) {
    throw new ProjectRecordNotFoundError("Project record not found.");
  }

  const normalized = normalizeLinkRequest(request);
  const now = nowIso();
  const existingLink = normalized.targetId
    ? db
        .select()
        .from(projectRecordLinks)
        .where(
          and(
            eq(projectRecordLinks.recordId, recordId),
            eq(projectRecordLinks.linkType, normalized.linkType),
            eq(projectRecordLinks.targetId, normalized.targetId)
          )
        )
        .get()
    : undefined;

  if (existingLink) {
    db.update(projectRecordLinks)
      .set({
        targetPath: normalized.targetPath,
        title: normalized.title,
        curationStatus: normalized.curationStatus,
        rejectReasonsJson: JSON.stringify(normalized.rejectReasons),
        notes: normalized.notes,
        metadataJson: normalized.metadataJson,
        updatedAt: now
      })
      .where(eq(projectRecordLinks.id, existingLink.id))
      .run();

    touchProjectRecord(recordId);
    return getProjectRecordDetail(recordId);
  }

  db.insert(projectRecordLinks)
    .values({
      id: randomUUID(),
      recordId,
      linkType: normalized.linkType,
      targetId: normalized.targetId,
      targetPath: normalized.targetPath,
      title: normalized.title,
      curationStatus: normalized.curationStatus,
      rejectReasonsJson: JSON.stringify(normalized.rejectReasons),
      notes: normalized.notes,
      metadataJson: normalized.metadataJson,
      createdAt: now,
      updatedAt: now
    })
    .run();

  touchProjectRecord(recordId);
  return getProjectRecordDetail(recordId);
}

export function updateProjectRecordLink(linkId: string, request: UpdateProjectRecordLinkRequest): ProjectRecordDetailResponse {
  const existing = db.select().from(projectRecordLinks).where(eq(projectRecordLinks.id, linkId)).get();
  if (!existing) {
    throw new ProjectRecordNotFoundError("Project record link not found.");
  }

  const normalized = normalizeLinkRequest({
    linkType: request.linkType ?? (existing.linkType as ProjectRecordLinkType),
    targetId: request.targetId ?? existing.targetId,
    targetPath: request.targetPath ?? existing.targetPath,
    title: request.title ?? existing.title,
    curationStatus: request.curationStatus ?? (existing.curationStatus as ProjectRecordCurationStatus),
    rejectReasons: request.rejectReasons ?? parseRejectReasons(existing.rejectReasonsJson),
    notes: request.notes ?? existing.notes,
    metadataJson: request.metadataJson ?? existing.metadataJson
  });

  db.update(projectRecordLinks)
    .set({
      linkType: normalized.linkType,
      targetId: normalized.targetId,
      targetPath: normalized.targetPath,
      title: normalized.title,
      curationStatus: normalized.curationStatus,
      rejectReasonsJson: JSON.stringify(normalized.rejectReasons),
      notes: normalized.notes,
      metadataJson: normalized.metadataJson,
      updatedAt: nowIso()
    })
    .where(eq(projectRecordLinks.id, linkId))
    .run();

  touchProjectRecord(existing.recordId);
  return getProjectRecordDetail(existing.recordId);
}

function requireCreativeProject(projectIdOrSlug: string): typeof creativeProjects.$inferSelect {
  ensureMavoSportProject();

  const trimmed = projectIdOrSlug.trim();
  const project = db
    .select()
    .from(creativeProjects)
    .where(eq(creativeProjects.id, trimmed))
    .get() ??
    db
      .select()
      .from(creativeProjects)
      .where(eq(creativeProjects.slug, trimmed))
      .get();
  if (!project) {
    throw new ProjectRecordNotFoundError("Creative project not found.");
  }

  return project;
}

function listProjectRecordRows(projectId: string): Array<typeof projectRecords.$inferSelect> {
  return db
    .select()
    .from(projectRecords)
    .where(eq(projectRecords.projectId, projectId))
    .orderBy(desc(projectRecords.updatedAt))
    .all();
}

function countRecords(projectId: string): number {
  const row = db
    .select({ count: sql<number>`count(${projectRecords.id})` })
    .from(projectRecords)
    .where(eq(projectRecords.projectId, projectId))
    .get();
  return Number(row?.count) || 0;
}

function touchProjectRecord(recordId: string): void {
  db.update(projectRecords).set({ updatedAt: nowIso() }).where(eq(projectRecords.id, recordId)).run();
}

function normalizeRecordRequest(request: CreateProjectRecordRequest): Required<CreateProjectRecordRequest> {
  const title = normalizeRequiredText(request.title, "Record title is required.", MAX_TITLE_LENGTH);
  const type = normalizeEnum(request.type, CREATIVE_PROJECT_RECORD_TYPES, "Record type is unsupported.");
  const stage = normalizeEnum(request.stage, CREATIVE_PROJECT_RECORD_STAGES, "Record stage is unsupported.");
  const status = normalizeEnum(request.status, CREATIVE_PROJECT_RECORD_STATUSES, "Record status is unsupported.");
  const briefJson = normalizeJsonText(request.briefJson ?? DEFAULT_BRIEF_JSON, "briefJson must be valid JSON.");

  return {
    title,
    type,
    stage,
    status,
    briefJson,
    prompt: normalizeOptionalText(request.prompt ?? "", MAX_TEXT_LENGTH),
    notes: normalizeOptionalText(request.notes ?? "", MAX_TEXT_LENGTH)
  };
}

function normalizeLinkRequest(request: CreateProjectRecordLinkRequest): Required<CreateProjectRecordLinkRequest> {
  const linkType = normalizeEnum(request.linkType, PROJECT_RECORD_LINK_TYPES, "Link type is unsupported.");
  const curationStatus = normalizeEnum(
    request.curationStatus ?? "usable",
    PROJECT_RECORD_CURATION_STATUSES,
    "Curation status is unsupported."
  );
  const rejectReasons = normalizeRejectReasons(request.rejectReasons ?? [], curationStatus);

  const targetId = normalizeOptionalText(request.targetId ?? "", MAX_TITLE_LENGTH);
  const targetPath = normalizeOptionalText(request.targetPath ?? "", MAX_TEXT_LENGTH);
  if (!targetId && !targetPath) {
    throw new ProjectRecordValidationError("Project record links must include targetId or targetPath.");
  }

  return {
    linkType,
    targetId,
    targetPath,
    title: normalizeOptionalText(request.title ?? "", MAX_TITLE_LENGTH),
    curationStatus,
    rejectReasons,
    notes: normalizeOptionalText(request.notes ?? "", MAX_TEXT_LENGTH),
    metadataJson: normalizeJsonText(request.metadataJson ?? DEFAULT_LINK_METADATA_JSON, "metadataJson must be valid JSON.")
  };
}

function normalizeRejectReasons(
  rejectReasons: ProjectRecordRejectReason[],
  curationStatus: ProjectRecordCurationStatus
): ProjectRecordRejectReason[] {
  if (!Array.isArray(rejectReasons)) {
    throw new ProjectRecordValidationError("rejectReasons must be an array.");
  }

  const normalized = rejectReasons.flatMap((reason) =>
    PROJECT_RECORD_REJECT_REASONS.includes(reason) ? [reason] : []
  );
  const unique = [...new Set(normalized)];
  if (curationStatus === "rejected" && unique.length === 0) {
    throw new ProjectRecordValidationError("Rejected links must include at least one reject reason.");
  }

  return curationStatus === "rejected" ? unique : [];
}

function normalizeRequiredText(value: unknown, message: string, maxLength: number): string {
  if (typeof value !== "string") {
    throw new ProjectRecordValidationError(message);
  }

  const trimmed = value.trim();
  if (!trimmed || trimmed.length > maxLength) {
    throw new ProjectRecordValidationError(message);
  }

  return trimmed;
}

function normalizeOptionalText(value: unknown, maxLength: number): string {
  if (typeof value !== "string") {
    return "";
  }

  return value.trim().slice(0, maxLength);
}

function normalizeJsonText(value: unknown, message: string): string {
  if (typeof value !== "string") {
    throw new ProjectRecordValidationError(message);
  }

  const trimmed = value.trim() || "{}";
  if (trimmed.length > MAX_JSON_LENGTH) {
    throw new ProjectRecordValidationError(message);
  }

  try {
    JSON.parse(trimmed);
  } catch {
    throw new ProjectRecordValidationError(message);
  }

  return trimmed;
}

function normalizeEnum<T extends string>(value: unknown, allowed: readonly T[], message: string): T {
  if (typeof value !== "string" || !allowed.includes(value as T)) {
    throw new ProjectRecordValidationError(message);
  }

  return value as T;
}

function parseRejectReasons(value: string): ProjectRecordRejectReason[] {
  try {
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed)
      ? parsed.filter((reason): reason is ProjectRecordRejectReason =>
          PROJECT_RECORD_REJECT_REASONS.includes(reason as ProjectRecordRejectReason)
        )
      : [];
  } catch {
    return [];
  }
}

function parseMetadataJson(value: string): string {
  try {
    JSON.parse(value);
    return value;
  } catch {
    return DEFAULT_LINK_METADATA_JSON;
  }
}

function toCreativeProject(row: typeof creativeProjects.$inferSelect, recordCount: number): CreativeProject {
  return {
    id: row.id,
    slug: row.slug,
    name: row.name,
    description: row.description,
    recordCount,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function toProjectRecordSummary(row: typeof projectRecords.$inferSelect): ProjectRecordSummary {
  return {
    id: row.id,
    projectId: row.projectId,
    title: row.title,
    type: row.type as CreativeProjectRecordType,
    stage: row.stage as CreativeProjectRecordStage,
    status: row.status as CreativeProjectRecordStatus,
    updatedAt: row.updatedAt,
    createdAt: row.createdAt
  };
}

function toProjectRecord(row: typeof projectRecords.$inferSelect, links: ProjectRecordLink[]): ProjectRecord {
  return {
    ...toProjectRecordSummary(row),
    briefJson: row.briefJson,
    prompt: row.prompt,
    notes: row.notes,
    links
  };
}

function toProjectRecordLink(row: typeof projectRecordLinks.$inferSelect): ProjectRecordLink {
  return {
    id: row.id,
    recordId: row.recordId,
    linkType: row.linkType as ProjectRecordLinkType,
    targetId: row.targetId,
    targetPath: row.targetPath,
    title: row.title,
    curationStatus: row.curationStatus as ProjectRecordCurationStatus,
    rejectReasons: parseRejectReasons(row.rejectReasonsJson),
    notes: row.notes,
    metadataJson: parseMetadataJson(row.metadataJson),
    asset: findLinkedAsset(row),
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

function findLinkedAsset(row: typeof projectRecordLinks.$inferSelect): GeneratedAsset | undefined {
  if (row.linkType === "asset") {
    return toGeneratedAsset(db.select().from(assets).where(eq(assets.id, row.targetId)).get());
  }

  if (row.linkType !== "output") {
    return undefined;
  }

  const joined = db
    .select({ asset: assets })
    .from(generationOutputs)
    .innerJoin(assets, eq(generationOutputs.assetId, assets.id))
    .where(eq(generationOutputs.id, row.targetId))
    .get();

  return toGeneratedAsset(joined?.asset);
}

function toGeneratedAsset(asset: (typeof assets.$inferSelect) | undefined): GeneratedAsset | undefined {
  if (!asset) {
    return undefined;
  }

  return {
    id: asset.id,
    url: `/api/assets/${asset.id}`,
    fileName: asset.fileName,
    mimeType: asset.mimeType,
    width: asset.width,
    height: asset.height,
    cloud:
      (asset.cloudProvider === "cos" || asset.cloudProvider === "s3") && (asset.cloudStatus === "uploaded" || asset.cloudStatus === "failed")
        ? {
            provider: asset.cloudProvider,
            status: asset.cloudStatus,
            lastError: asset.cloudError ?? undefined,
            uploadedAt: asset.cloudUploadedAt ?? undefined
          }
        : undefined
  };
}
