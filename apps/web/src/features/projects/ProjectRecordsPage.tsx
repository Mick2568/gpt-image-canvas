import {
  AlertTriangle,
  CheckCircle2,
  Clock3,
  FileText,
  ImageIcon,
  LinkIcon,
  Loader2,
  Plus,
  Save,
  XCircle
} from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import {
  CREATIVE_PROJECT_RECORD_STAGES,
  CREATIVE_PROJECT_RECORD_STATUSES,
  CREATIVE_PROJECT_RECORD_TYPES,
  PROJECT_RECORD_CURATION_STATUSES,
  PROJECT_RECORD_REJECT_REASONS,
  type CreativeProject,
  type CreativeProjectDetailResponse,
  type CreativeProjectRecordStage,
  type CreativeProjectRecordStatus,
  type CreativeProjectRecordType,
  type CreativeProjectsResponse,
  type GalleryImageItem,
  type ProjectRecord,
  type ProjectRecordCurationStatus,
  type ProjectRecordDetailResponse,
  type ProjectRecordLink,
  type ProjectRecordRejectReason,
  type ProjectRecordSummary
} from "@gpt-image-canvas/shared";
import { assetPreviewUrl } from "../../shared/api/assets";
import { localizedApiErrorMessage, useI18n, type Locale } from "../../shared/i18n";

interface ProjectRecordDraft {
  title: string;
  type: CreativeProjectRecordType;
  stage: CreativeProjectRecordStage;
  status: CreativeProjectRecordStatus;
  briefJson: string;
  prompt: string;
  notes: string;
}
interface ProjectRecordLinkDraft {
  curationStatus: ProjectRecordCurationStatus;
  rejectReasons: ProjectRecordRejectReason[];
  notes: string;
}

const defaultRecordDraft: ProjectRecordDraft = {
  title: "加拿大 vs 南非主視覺測試",
  type: "image_set",
  stage: "image",
  status: "active",
  briefJson: "{}",
  prompt: "",
  notes: ""
};

const groupedCurationStatuses: ProjectRecordCurationStatus[] = [
  "usable",
  "rejected",
  "needs_regeneration",
  "reference_only"
];

export function ProjectRecordsPage() {
  const { formatDateTime, locale } = useI18n();
  const copy = labelsForLocale(locale);
  const [projects, setProjects] = useState<CreativeProject[]>([]);
  const [projectDetail, setProjectDetail] = useState<CreativeProjectDetailResponse | null>(null);
  const [recordDetail, setRecordDetail] = useState<ProjectRecordDetailResponse | null>(null);
  const [selectedProjectId, setSelectedProjectId] = useState("mavosport");
  const [selectedRecordId, setSelectedRecordId] = useState("");
  const [recordDraft, setRecordDraft] = useState<ProjectRecordDraft>(defaultRecordDraft);
  const [newRecordDraft, setNewRecordDraft] = useState<ProjectRecordDraft>(defaultRecordDraft);
  const [linkDrafts, setLinkDrafts] = useState<Record<string, ProjectRecordLinkDraft>>({});
  const [selectedGalleryOutputId, setSelectedGalleryOutputId] = useState("");
  const [manualTargetPath, setManualTargetPath] = useState("");
  const [manualTitle, setManualTitle] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");

  useEffect(() => {
    const controller = new AbortController();
    void loadProjects(controller.signal);
    return () => controller.abort();
  }, []);

  useEffect(() => {
    if (!selectedProjectId) {
      return;
    }

    const controller = new AbortController();
    void loadProjectDetail(selectedProjectId, controller.signal);
    return () => controller.abort();
  }, [selectedProjectId]);

  useEffect(() => {
    if (!selectedRecordId) {
      setRecordDetail(null);
      return;
    }

    const controller = new AbortController();
    void loadRecordDetail(selectedRecordId, controller.signal);
    return () => controller.abort();
  }, [selectedRecordId]);

  useEffect(() => {
    const record = recordDetail?.record;
    if (!record) {
      return;
    }

    setRecordDraft({
      title: record.title,
      type: record.type,
      stage: record.stage,
      status: record.status,
      briefJson: record.briefJson,
      prompt: record.prompt,
      notes: record.notes
    });
    setLinkDrafts(
      Object.fromEntries(
        record.links.map((link) => [
          link.id,
          {
            curationStatus: link.curationStatus,
            rejectReasons: link.rejectReasons,
            notes: link.notes
          }
        ])
      )
    );
  }, [recordDetail]);

  const gallery = recordDetail?.gallery ?? [];
  const galleryByOutputId = useMemo(() => new Map(gallery.map((item) => [item.outputId, item])), [gallery]);
  const selectedGalleryItem = selectedGalleryOutputId ? galleryByOutputId.get(selectedGalleryOutputId) : undefined;

  async function loadProjects(signal?: AbortSignal): Promise<void> {
    setIsLoading(true);
    setError("");

    try {
      const response = await fetch("/api/creative-projects", { signal });
      if (!response.ok) {
        throw new Error(await readApiError(response, locale, copy.projectsLoadFailed));
      }

      const body = (await response.json()) as CreativeProjectsResponse;
      setProjects(body.projects);
      setSelectedProjectId(body.projects.find((project) => project.slug === "mavosport")?.id ?? body.projects[0]?.id ?? "mavosport");
    } catch (loadError) {
      if (!signal?.aborted) {
        setError(loadError instanceof Error ? loadError.message : copy.projectsLoadFailed);
      }
    } finally {
      if (!signal?.aborted) {
        setIsLoading(false);
      }
    }
  }

  async function loadProjectDetail(projectId: string, signal?: AbortSignal): Promise<void> {
    setError("");

    try {
      const response = await fetch(`/api/creative-projects/${encodeURIComponent(projectId)}`, { signal });
      if (!response.ok) {
        throw new Error(await readApiError(response, locale, copy.projectsLoadFailed));
      }

      const body = (await response.json()) as CreativeProjectDetailResponse;
      setProjectDetail(body);
      setSelectedRecordId((current) => (current && body.records.some((record) => record.id === current) ? current : body.records[0]?.id ?? ""));
    } catch (loadError) {
      if (!signal?.aborted) {
        setError(loadError instanceof Error ? loadError.message : copy.projectsLoadFailed);
      }
    }
  }

  async function loadRecordDetail(recordId: string, signal?: AbortSignal): Promise<void> {
    setError("");

    try {
      const response = await fetch(`/api/project-records/${encodeURIComponent(recordId)}`, { signal });
      if (!response.ok) {
        throw new Error(await readApiError(response, locale, copy.recordLoadFailed));
      }

      setRecordDetail((await response.json()) as ProjectRecordDetailResponse);
      setSelectedGalleryOutputId("");
    } catch (loadError) {
      if (!signal?.aborted) {
        setError(loadError instanceof Error ? loadError.message : copy.recordLoadFailed);
      }
    }
  }

  async function createRecord(): Promise<void> {
    if (!projectDetail) {
      return;
    }

    setIsSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/creative-projects/${encodeURIComponent(projectDetail.project.id)}/records`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(newRecordDraft)
      });
      if (!response.ok) {
        throw new Error(await readApiError(response, locale, copy.recordCreateFailed));
      }

      const body = (await response.json()) as ProjectRecordDetailResponse;
      setRecordDetail(body);
      setSelectedRecordId(body.record.id);
      setNewRecordDraft(defaultRecordDraft);
      await loadProjectDetail(projectDetail.project.id);
      setStatusMessage(copy.recordCreated);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : copy.recordCreateFailed);
    } finally {
      setIsSaving(false);
    }
  }

  async function saveRecord(): Promise<void> {
    if (!recordDetail) {
      return;
    }

    setIsSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/project-records/${encodeURIComponent(recordDetail.record.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(recordDraft)
      });
      if (!response.ok) {
        throw new Error(await readApiError(response, locale, copy.recordSaveFailed));
      }

      const body = (await response.json()) as ProjectRecordDetailResponse;
      setRecordDetail(body);
      await loadProjectDetail(body.project.id);
      setStatusMessage(copy.recordSaved);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : copy.recordSaveFailed);
    } finally {
      setIsSaving(false);
    }
  }

  async function addGalleryLink(): Promise<void> {
    if (!recordDetail || !selectedGalleryItem) {
      return;
    }

    setIsSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/project-records/${encodeURIComponent(recordDetail.record.id)}/links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          linkType: "output",
          targetId: selectedGalleryItem.outputId,
          title: selectedGalleryItem.prompt.slice(0, 120),
          curationStatus: "usable",
          metadataJson: JSON.stringify({
            assetId: selectedGalleryItem.asset.id,
            generationId: selectedGalleryItem.generationId
          })
        })
      });
      if (!response.ok) {
        throw new Error(await readApiError(response, locale, copy.linkCreateFailed));
      }

      const body = (await response.json()) as ProjectRecordDetailResponse;
      setRecordDetail(body);
      setSelectedGalleryOutputId("");
      setStatusMessage(copy.linkCreated);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : copy.linkCreateFailed);
    } finally {
      setIsSaving(false);
    }
  }

  async function addManualLink(): Promise<void> {
    if (!recordDetail || !manualTargetPath.trim()) {
      return;
    }

    setIsSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/project-records/${encodeURIComponent(recordDetail.record.id)}/links`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          linkType: "reference",
          targetPath: manualTargetPath,
          title: manualTitle || manualTargetPath,
          curationStatus: "reference_only"
        })
      });
      if (!response.ok) {
        throw new Error(await readApiError(response, locale, copy.linkCreateFailed));
      }

      const body = (await response.json()) as ProjectRecordDetailResponse;
      setRecordDetail(body);
      setManualTargetPath("");
      setManualTitle("");
      setStatusMessage(copy.linkCreated);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : copy.linkCreateFailed);
    } finally {
      setIsSaving(false);
    }
  }

  async function saveLink(link: ProjectRecordLink): Promise<void> {
    const draft = linkDrafts[link.id];
    if (!draft) {
      return;
    }

    if (draft.curationStatus === "rejected" && draft.rejectReasons.length === 0) {
      setError(copy.rejectReasonRequired);
      return;
    }

    setIsSaving(true);
    setError("");
    try {
      const response = await fetch(`/api/project-record-links/${encodeURIComponent(link.id)}`, {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(draft)
      });
      if (!response.ok) {
        throw new Error(await readApiError(response, locale, copy.linkSaveFailed));
      }

      setRecordDetail((await response.json()) as ProjectRecordDetailResponse);
      setStatusMessage(copy.linkSaved);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : copy.linkSaveFailed);
    } finally {
      setIsSaving(false);
    }
  }

  function updateRecordDraft<Key extends keyof ProjectRecordDraft>(key: Key, value: ProjectRecordDraft[Key]): void {
    setRecordDraft((current) => ({ ...current, [key]: value }));
  }

  function updateNewRecordDraft<Key extends keyof ProjectRecordDraft>(key: Key, value: ProjectRecordDraft[Key]): void {
    setNewRecordDraft((current) => ({ ...current, [key]: value }));
  }

  function updateLinkDraft(linkId: string, patch: Partial<ProjectRecordLinkDraft>): void {
    setLinkDrafts((current) => ({
      ...current,
      [linkId]: {
        ...current[linkId],
        ...patch,
        rejectReasons: patch.curationStatus && patch.curationStatus !== "rejected" ? [] : patch.rejectReasons ?? current[linkId]?.rejectReasons ?? []
      }
    }));
  }

  function toggleRejectReason(linkId: string, reason: ProjectRecordRejectReason): void {
    const draft = linkDrafts[linkId];
    if (!draft) {
      return;
    }

    updateLinkDraft(linkId, {
      rejectReasons: draft.rejectReasons.includes(reason)
        ? draft.rejectReasons.filter((item) => item !== reason)
        : [...draft.rejectReasons, reason]
    });
  }

  return (
    <main className="project-records-page app-view" data-testid="project-records-page">
      <div className="project-records-page__inner">
        <header className="project-records-hero">
          <div>
            <p className="project-records-kicker">
              <FileText className="size-4" aria-hidden="true" />
              {copy.kicker}
            </p>
            <h1>{copy.title}</h1>
            <p>{copy.deck}</p>
          </div>
          <div className="project-records-hero__status" role="status">
            {isLoading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <CheckCircle2 className="size-4" aria-hidden="true" />}
            <span>{isLoading ? copy.loading : copy.localPersisted}</span>
          </div>
        </header>

        {error ? (
          <div className="project-records-alert project-records-alert--error" role="alert">
            <XCircle className="size-4" aria-hidden="true" />
            <span>{error}</span>
          </div>
        ) : null}

        {statusMessage ? (
          <div className="project-records-alert project-records-alert--success" role="status">
            <CheckCircle2 className="size-4" aria-hidden="true" />
            <span>{statusMessage}</span>
          </div>
        ) : null}

        <div className="project-records-layout">
          <aside className="project-records-sidebar" aria-label={copy.projectListLabel}>
            <SectionHeading title={copy.projectsTitle} meta={copy.projectsMeta} />
            <div className="project-records-project-list">
              {projects.map((project) => (
                <button
                  className="project-records-project-button"
                  data-active={project.id === selectedProjectId}
                  key={project.id}
                  type="button"
                  onClick={() => setSelectedProjectId(project.id)}
                >
                  <span>{project.name}</span>
                  <small>{project.recordCount} records</small>
                </button>
              ))}
            </div>
          </aside>

          <section className="project-records-panel" aria-label={copy.recordListLabel}>
            <div className="project-records-panel__head">
              <div>
                <p className="project-records-kicker">{copy.currentProject}</p>
                <h2>{projectDetail?.project.name ?? copy.projectsTitle}</h2>
                <p>{projectDetail?.project.description ?? copy.loading}</p>
              </div>
            </div>

            <section className="project-records-create">
              <SectionHeading title={copy.createRecordTitle} meta={copy.createRecordMeta} />
              <div className="project-records-form-grid">
                <LabeledInput label={copy.fieldTitle} value={newRecordDraft.title} onChange={(value) => updateNewRecordDraft("title", value)} />
                <LabeledSelect
                  label={copy.fieldType}
                  value={newRecordDraft.type}
                  options={CREATIVE_PROJECT_RECORD_TYPES}
                  optionLabel={(value) => copy.typeLabels[value]}
                  onChange={(value) => updateNewRecordDraft("type", value as CreativeProjectRecordType)}
                />
                <LabeledSelect
                  label={copy.fieldStage}
                  value={newRecordDraft.stage}
                  options={CREATIVE_PROJECT_RECORD_STAGES}
                  optionLabel={(value) => copy.stageLabels[value]}
                  onChange={(value) => updateNewRecordDraft("stage", value as CreativeProjectRecordStage)}
                />
                <LabeledSelect
                  label={copy.fieldStatus}
                  value={newRecordDraft.status}
                  options={CREATIVE_PROJECT_RECORD_STATUSES}
                  optionLabel={(value) => copy.statusLabels[value]}
                  onChange={(value) => updateNewRecordDraft("status", value as CreativeProjectRecordStatus)}
                />
              </div>
              <button className="project-records-primary-action" disabled={isSaving} type="button" onClick={() => void createRecord()}>
                {isSaving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Plus className="size-4" aria-hidden="true" />}
                {copy.createRecord}
              </button>
            </section>

            <div className="project-records-record-list">
              {(projectDetail?.records ?? []).map((record) => (
                <RecordButton
                  active={record.id === selectedRecordId}
                  copy={copy}
                  formatDateTime={formatDateTime}
                  key={record.id}
                  record={record}
                  onClick={() => setSelectedRecordId(record.id)}
                />
              ))}
              {projectDetail && projectDetail.records.length === 0 ? <p className="project-records-empty">{copy.emptyRecords}</p> : null}
            </div>
          </section>

          <section className="project-records-detail" aria-label={copy.recordDetailLabel}>
            {recordDetail ? (
              <>
                <div className="project-records-detail__head">
                  <div>
                    <p className="project-records-kicker">{copy.recordDetailLabel}</p>
                    <h2>{recordDetail.record.title}</h2>
                    <p>
                      {copy.stageLabels[recordDetail.record.stage]} / {copy.statusLabels[recordDetail.record.status]}
                    </p>
                  </div>
                  <button className="project-records-primary-action" disabled={isSaving} type="button" onClick={() => void saveRecord()}>
                    {isSaving ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Save className="size-4" aria-hidden="true" />}
                    {copy.saveRecord}
                  </button>
                </div>

                <div className="project-records-form-grid project-records-form-grid--detail">
                  <LabeledInput label={copy.fieldTitle} value={recordDraft.title} onChange={(value) => updateRecordDraft("title", value)} />
                  <LabeledSelect
                    label={copy.fieldType}
                    value={recordDraft.type}
                    options={CREATIVE_PROJECT_RECORD_TYPES}
                    optionLabel={(value) => copy.typeLabels[value]}
                    onChange={(value) => updateRecordDraft("type", value as CreativeProjectRecordType)}
                  />
                  <LabeledSelect
                    label={copy.fieldStage}
                    value={recordDraft.stage}
                    options={CREATIVE_PROJECT_RECORD_STAGES}
                    optionLabel={(value) => copy.stageLabels[value]}
                    onChange={(value) => updateRecordDraft("stage", value as CreativeProjectRecordStage)}
                  />
                  <LabeledSelect
                    label={copy.fieldStatus}
                    value={recordDraft.status}
                    options={CREATIVE_PROJECT_RECORD_STATUSES}
                    optionLabel={(value) => copy.statusLabels[value]}
                    onChange={(value) => updateRecordDraft("status", value as CreativeProjectRecordStatus)}
                  />
                </div>
                <LabeledTextarea label={copy.fieldBriefJson} rows={5} value={recordDraft.briefJson} onChange={(value) => updateRecordDraft("briefJson", value)} />
                <LabeledTextarea label={copy.fieldPrompt} rows={6} value={recordDraft.prompt} onChange={(value) => updateRecordDraft("prompt", value)} />
                <LabeledTextarea label={copy.fieldNotes} rows={5} value={recordDraft.notes} onChange={(value) => updateRecordDraft("notes", value)} />

                <section className="project-records-linking">
                  <SectionHeading title={copy.linkGalleryTitle} meta={copy.linkGalleryMeta} />
                  <div className="project-records-linking__row">
                    <select value={selectedGalleryOutputId} onChange={(event) => setSelectedGalleryOutputId(event.target.value)}>
                      <option value="">{gallery.length > 0 ? copy.selectGalleryOutput : copy.noGalleryOutput}</option>
                      {gallery.map((item) => (
                        <option key={item.outputId} value={item.outputId}>
                          {galleryOptionLabel(item)}
                        </option>
                      ))}
                    </select>
                    <button className="project-records-secondary-action" disabled={!selectedGalleryItem || isSaving} type="button" onClick={() => void addGalleryLink()}>
                      <LinkIcon className="size-4" aria-hidden="true" />
                      {copy.linkSelectedOutput}
                    </button>
                  </div>
                  <div className="project-records-manual-link">
                    <input placeholder={copy.manualTitlePlaceholder} value={manualTitle} onChange={(event) => setManualTitle(event.target.value)} />
                    <input placeholder={copy.manualPathPlaceholder} value={manualTargetPath} onChange={(event) => setManualTargetPath(event.target.value)} />
                    <button className="project-records-secondary-action" disabled={!manualTargetPath.trim() || isSaving} type="button" onClick={() => void addManualLink()}>
                      <Plus className="size-4" aria-hidden="true" />
                      {copy.addManualReference}
                    </button>
                  </div>
                </section>

                <section className="project-records-lanes">
                  {groupedCurationStatuses.map((status) => {
                    const links = recordDetail.record.links.filter((link) => link.curationStatus === status);
                    return (
                      <div className="project-records-lane" key={status}>
                        <div className="project-records-lane__head">
                          <h3>{copy.curationLabels[status]}</h3>
                          <span>{links.length}</span>
                        </div>
                        {links.length === 0 ? <p className="project-records-empty">{copy.emptyLane}</p> : null}
                        {links.map((link) => (
                          <ProjectRecordLinkCard
                            copy={copy}
                            draft={linkDrafts[link.id]}
                            key={link.id}
                            link={link}
                            onSave={() => void saveLink(link)}
                            onToggleReason={(reason) => toggleRejectReason(link.id, reason)}
                            onUpdate={(patch) => updateLinkDraft(link.id, patch)}
                          />
                        ))}
                      </div>
                    );
                  })}
                </section>
              </>
            ) : (
              <div className="project-records-detail-empty">
                <ImageIcon className="size-8" aria-hidden="true" />
                <h2>{copy.noRecordSelectedTitle}</h2>
                <p>{copy.noRecordSelectedCopy}</p>
              </div>
            )}
          </section>
        </div>
      </div>
    </main>
  );
}

function SectionHeading({ meta, title }: { meta: string; title: string }) {
  return (
    <div className="project-records-section-heading">
      <h3>{title}</h3>
      <p>{meta}</p>
    </div>
  );
}

function LabeledInput({ label, onChange, value }: { label: string; onChange: (value: string) => void; value: string }) {
  return (
    <label className="project-records-field">
      <span>{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function LabeledTextarea({
  label,
  onChange,
  rows,
  value
}: {
  label: string;
  onChange: (value: string) => void;
  rows: number;
  value: string;
}) {
  return (
    <label className="project-records-field">
      <span>{label}</span>
      <textarea rows={rows} value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function LabeledSelect<T extends string>({
  label,
  onChange,
  optionLabel,
  options,
  value
}: {
  label: string;
  onChange: (value: T) => void;
  optionLabel: (value: T) => string;
  options: readonly T[];
  value: T;
}) {
  return (
    <label className="project-records-field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value as T)}>
        {options.map((option) => (
          <option key={option} value={option}>
            {optionLabel(option)}
          </option>
        ))}
      </select>
    </label>
  );
}

function RecordButton({
  active,
  copy,
  formatDateTime,
  onClick,
  record
}: {
  active: boolean;
  copy: ProjectRecordLabels;
  formatDateTime: (value: string) => string;
  onClick: () => void;
  record: ProjectRecordSummary;
}) {
  return (
    <button className="project-records-record-button" data-active={active} type="button" onClick={onClick}>
      <span>
        <b>{record.title}</b>
        <small>
          {copy.typeLabels[record.type]} / {copy.stageLabels[record.stage]} / {copy.statusLabels[record.status]}
        </small>
      </span>
      <time dateTime={record.updatedAt}>
        <Clock3 className="size-3.5" aria-hidden="true" />
        {formatDateTime(record.updatedAt)}
      </time>
    </button>
  );
}

function ProjectRecordLinkCard({
  copy,
  draft,
  link,
  onSave,
  onToggleReason,
  onUpdate
}: {
  copy: ProjectRecordLabels;
  draft: ProjectRecordLinkDraft | undefined;
  link: ProjectRecordLink;
  onSave: () => void;
  onToggleReason: (reason: ProjectRecordRejectReason) => void;
  onUpdate: (patch: Partial<ProjectRecordLinkDraft>) => void;
}) {
  const activeDraft = draft ?? {
    curationStatus: link.curationStatus,
    rejectReasons: link.rejectReasons,
    notes: link.notes
  };
  const imageUrl = link.asset ? assetPreviewUrl(link.asset.id, 512) : "";

  return (
    <article className="project-records-link-card">
      {imageUrl ? (
        <img src={imageUrl} alt="" />
      ) : (
        <div className="project-records-link-card__placeholder">
          <FileText className="size-5" aria-hidden="true" />
        </div>
      )}
      <div className="project-records-link-card__body">
        <h4>{link.title || link.targetId || link.targetPath || copy.untitledLink}</h4>
        <p>
          {link.linkType} / {link.targetId || link.targetPath}
        </p>
        <LabeledSelect
          label={copy.fieldCuration}
          value={activeDraft.curationStatus}
          options={PROJECT_RECORD_CURATION_STATUSES}
          optionLabel={(value) => copy.curationLabels[value]}
          onChange={(value) => onUpdate({ curationStatus: value })}
        />
        {activeDraft.curationStatus === "rejected" ? (
          <div className="project-records-reject-reasons" aria-label={copy.rejectReasonsLabel}>
            {PROJECT_RECORD_REJECT_REASONS.map((reason) => (
              <label key={reason}>
                <input
                  checked={activeDraft.rejectReasons.includes(reason)}
                  type="checkbox"
                  onChange={() => onToggleReason(reason)}
                />
                <span>{copy.rejectReasonLabels[reason]}</span>
              </label>
            ))}
          </div>
        ) : null}
        <LabeledTextarea label={copy.fieldLinkNotes} rows={3} value={activeDraft.notes} onChange={(value) => onUpdate({ notes: value })} />
        {activeDraft.curationStatus === "rejected" && activeDraft.rejectReasons.length === 0 ? (
          <p className="project-records-inline-warning">
            <AlertTriangle className="size-4" aria-hidden="true" />
            {copy.rejectReasonRequired}
          </p>
        ) : null}
        <button className="project-records-secondary-action" type="button" onClick={onSave}>
          <Save className="size-4" aria-hidden="true" />
          {copy.saveLink}
        </button>
      </div>
    </article>
  );
}

async function readApiError(response: Response, locale: Locale, fallbackText: string): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string } };
    return localizedApiErrorMessage({
      code: body.error?.code,
      fallbackMessage: body.error?.message,
      fallbackText,
      locale,
      status: response.status
    });
  } catch {
    return fallbackText;
  }
}

function galleryOptionLabel(item: GalleryImageItem): string {
  const prompt = item.prompt.trim().replace(/\s+/gu, " ");
  return `${item.outputId} / ${prompt.slice(0, 80)}`;
}

interface ProjectRecordLabels {
  addManualReference: string;
  createRecord: string;
  createRecordMeta: string;
  createRecordTitle: string;
  currentProject: string;
  deck: string;
  emptyLane: string;
  emptyRecords: string;
  fieldBriefJson: string;
  fieldCuration: string;
  fieldLinkNotes: string;
  fieldNotes: string;
  fieldPrompt: string;
  fieldStage: string;
  fieldStatus: string;
  fieldTitle: string;
  fieldType: string;
  kicker: string;
  linkCreated: string;
  linkCreateFailed: string;
  linkGalleryMeta: string;
  linkGalleryTitle: string;
  linkSaveFailed: string;
  linkSaved: string;
  linkSelectedOutput: string;
  loading: string;
  localPersisted: string;
  manualPathPlaceholder: string;
  manualTitlePlaceholder: string;
  noGalleryOutput: string;
  noRecordSelectedCopy: string;
  noRecordSelectedTitle: string;
  projectListLabel: string;
  projectsLoadFailed: string;
  projectsMeta: string;
  projectsTitle: string;
  recordCreated: string;
  recordCreateFailed: string;
  recordDetailLabel: string;
  recordListLabel: string;
  recordLoadFailed: string;
  recordSaveFailed: string;
  recordSaved: string;
  rejectReasonRequired: string;
  rejectReasonsLabel: string;
  saveLink: string;
  saveRecord: string;
  selectGalleryOutput: string;
  title: string;
  untitledLink: string;
  typeLabels: Record<CreativeProjectRecordType, string>;
  stageLabels: Record<CreativeProjectRecordStage, string>;
  statusLabels: Record<CreativeProjectRecordStatus, string>;
  curationLabels: Record<ProjectRecordCurationStatus, string>;
  rejectReasonLabels: Record<ProjectRecordRejectReason, string>;
}

function labelsForLocale(locale: Locale): ProjectRecordLabels {
  if (locale === "en") {
    return {
      addManualReference: "Add reference",
      createRecord: "Create record",
      createRecordMeta: "Starts a local record under this creative project.",
      createRecordTitle: "New record",
      currentProject: "Current project",
      deck: "Keep prompts, notes, gallery outputs, curation status, and rejected reasons together before moving images into video references.",
      emptyLane: "No links in this lane.",
      emptyRecords: "No records yet.",
      fieldBriefJson: "briefJson",
      fieldCuration: "Curation",
      fieldLinkNotes: "Link notes",
      fieldNotes: "Notes",
      fieldPrompt: "Prompt",
      fieldStage: "Stage",
      fieldStatus: "Status",
      fieldTitle: "Title",
      fieldType: "Type",
      kicker: "Local project records",
      linkCreated: "Link saved.",
      linkCreateFailed: "Could not create link.",
      linkGalleryMeta: "Bind an existing Gallery output without changing the Gallery record.",
      linkGalleryTitle: "Links / Assets",
      linkSaveFailed: "Could not save link.",
      linkSaved: "Link updated.",
      linkSelectedOutput: "Link selected output",
      loading: "Loading",
      localPersisted: "SQLite persistence active",
      manualPathPlaceholder: "Local reference path or manifest path",
      manualTitlePlaceholder: "Manual reference title",
      noGalleryOutput: "No Gallery outputs available",
      noRecordSelectedCopy: "Create or select a record to edit prompt, notes, and asset lanes.",
      noRecordSelectedTitle: "No record selected",
      projectListLabel: "Creative projects",
      projectsLoadFailed: "Could not load project records.",
      projectsMeta: "Local-only creative buckets.",
      projectsTitle: "Projects",
      recordCreated: "Record created.",
      recordCreateFailed: "Could not create record.",
      recordDetailLabel: "Record detail",
      recordListLabel: "Project records",
      recordLoadFailed: "Could not load record.",
      recordSaveFailed: "Could not save record.",
      recordSaved: "Record saved.",
      rejectReasonRequired: "Rejected links need at least one reason.",
      rejectReasonsLabel: "Rejected reasons",
      saveLink: "Save link",
      saveRecord: "Save record",
      selectGalleryOutput: "Select a Gallery output",
      title: "Projects / Records",
      untitledLink: "Untitled link",
      typeLabels: {
        prompt: "Prompt",
        image_set: "Image set",
        video_plan: "Video plan",
        asset_package: "Asset package"
      },
      stageLabels: {
        prompt: "Prompt",
        reference: "Reference",
        image: "Image",
        curation: "Curation",
        video: "Video",
        export: "Export"
      },
      statusLabels: {
        draft: "Draft",
        active: "Active",
        ready: "Ready",
        archived: "Archived"
      },
      curationLabels: {
        usable: "Usable",
        rejected: "Rejected",
        needs_regeneration: "Needs regeneration",
        reference_only: "Reference only"
      },
      rejectReasonLabels: {
        no_logo: "No logo",
        wrong_logo: "Wrong logo",
        logo_position_wrong: "Logo position wrong",
        wrong_ratio: "Wrong ratio",
        bad_composition: "Bad composition",
        too_ugly: "Too ugly",
        fake_text: "Fake text",
        fake_score_or_data: "Fake score/data",
        brand_risk: "Brand risk",
        real_person_risk: "Real person risk",
        trademark_risk: "Trademark risk",
        too_aggressive: "Too aggressive",
        gambling_vibe: "Gambling vibe",
        not_video_friendly: "Not video friendly",
        other: "Other"
      }
    };
  }

  return {
    addManualReference: "新增參考",
    createRecord: "建立 record",
    createRecordMeta: "在此創作項目下建立一筆本機紀錄。",
    createRecordTitle: "新增紀錄",
    currentProject: "目前項目",
    deck: "把 prompt、notes、gallery output、挑圖狀態與淘汰原因留在同一筆紀錄，後續才能推進影片 reference。",
    emptyLane: "這區還沒有圖片。",
    emptyRecords: "尚未建立紀錄。",
    fieldBriefJson: "briefJson",
    fieldCuration: "挑圖狀態",
    fieldLinkNotes: "圖片備註",
    fieldNotes: "notes",
    fieldPrompt: "prompt",
    fieldStage: "stage",
    fieldStatus: "status",
    fieldTitle: "title",
    fieldType: "type",
    kicker: "本機項目紀錄",
    linkCreated: "圖片連結已保存。",
    linkCreateFailed: "建立圖片連結失敗。",
    linkGalleryMeta: "綁定既有 Gallery output，不改 Gallery 主資料。",
    linkGalleryTitle: "Links / Assets",
    linkSaveFailed: "圖片狀態儲存失敗。",
    linkSaved: "圖片狀態已更新。",
    linkSelectedOutput: "綁定選中 output",
    loading: "載入中",
    localPersisted: "SQLite 持久化已啟用",
    manualPathPlaceholder: "本機 reference 或 manifest 路徑",
    manualTitlePlaceholder: "手動參考標題",
    noGalleryOutput: "目前沒有 Gallery output",
    noRecordSelectedCopy: "建立或選擇一筆 record 後，就能編輯 prompt、notes 與圖片分區。",
    noRecordSelectedTitle: "尚未選擇 record",
    projectListLabel: "Creative projects",
    projectsLoadFailed: "無法讀取項目紀錄。",
    projectsMeta: "本機創作桶。",
    projectsTitle: "項目",
    recordCreated: "Record 已建立。",
    recordCreateFailed: "建立 record 失敗。",
    recordDetailLabel: "Record detail",
    recordListLabel: "Project records",
    recordLoadFailed: "讀取 record 失敗。",
    recordSaveFailed: "儲存 record 失敗。",
    recordSaved: "Record 已儲存。",
    rejectReasonRequired: "淘汰圖必須至少選一個原因。",
    rejectReasonsLabel: "淘汰原因",
    saveLink: "儲存圖片狀態",
    saveRecord: "儲存 record",
    selectGalleryOutput: "選擇 Gallery output",
    title: "Projects / 項目紀錄",
    untitledLink: "未命名連結",
    typeLabels: {
      prompt: "Prompt",
      image_set: "Image set",
      video_plan: "Video plan",
      asset_package: "Asset package"
    },
    stageLabels: {
      prompt: "Prompt",
      reference: "Reference",
      image: "Image",
      curation: "Curation",
      video: "Video",
      export: "Export"
    },
    statusLabels: {
      draft: "Draft",
      active: "Active",
      ready: "Ready",
      archived: "Archived"
    },
    curationLabels: {
      usable: "Usable 可用圖",
      rejected: "Rejected 淘汰圖",
      needs_regeneration: "Needs Regeneration 需要重生",
      reference_only: "Reference Only 只當參考"
    },
    rejectReasonLabels: {
      no_logo: "沒有 Logo",
      wrong_logo: "Logo 錯誤",
      logo_position_wrong: "Logo 位置錯誤",
      wrong_ratio: "比例錯誤",
      bad_composition: "構圖失敗",
      too_ugly: "畫面太醜",
      fake_text: "假文字 / 亂碼",
      fake_score_or_data: "偽比分 / 偽數據",
      brand_risk: "品牌風險",
      real_person_risk: "太像真實球星",
      trademark_risk: "疑似官方商標 / 球衣品牌 logo",
      too_aggressive: "太兇狠 / 打架感",
      gambling_vibe: "賭博感太重",
      not_video_friendly: "不適合影片 reference",
      other: "其他"
    }
  };
}
