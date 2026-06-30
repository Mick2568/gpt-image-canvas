import {
  AlertTriangle,
  Archive,
  CheckCircle2,
  ChevronDown,
  Clock3,
  Copy,
  Download,
  Check,
  FolderPlus,
  ImageIcon,
  Loader2,
  Maximize2,
  Palette,
  RotateCcw,
  Ruler,
  Search,
  Sparkles,
  Trash2,
  X,
  XCircle
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  PROJECT_RECORD_CURATION_STATUSES,
  PROJECT_RECORD_REJECT_REASONS,
  SIZE_PRESETS,
  STYLE_PRESETS,
  type CreateProjectRecordLinkRequest,
  type CreativeProject,
  type CreativeProjectDetailResponse,
  type CreativeProjectsResponse,
  type GalleryBatchDeleteRequest,
  type GalleryExportRequest,
  type GalleryImageItem,
  type GalleryResponse,
  type ProjectRecordCurationStatus,
  type ProjectRecordRejectReason
} from "@gpt-image-canvas/shared";
import { localizedApiErrorMessage, useI18n, type Locale, type Translate } from "../../shared/i18n";
import { assetDownloadUrl, assetPreviewUrl } from "../../shared/api/assets";

interface GalleryPageProps {
  onDeleted: (outputId: string) => void;
  onReuse: (item: GalleryImageItem) => void;
}

interface GalleryActionHandlers {
  onAddToRecord: (item: GalleryImageItem) => void;
  onCopy: (item: GalleryImageItem) => void;
  onDelete: (item: GalleryImageItem) => void;
  onDownload: (item: GalleryImageItem) => void;
  onReuse: (item: GalleryImageItem) => void;
}

interface GallerySelectionHandlers {
  exportMode: boolean;
  onToggleSelected: (item: GalleryImageItem) => void;
  selectedOutputIds: Set<string>;
}

export function GalleryPage({ onDeleted, onReuse }: GalleryPageProps) {
  const { locale, t } = useI18n();
  const [items, setItems] = useState<GalleryImageItem[]>([]);
  const [query, setQuery] = useState("");
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState("");
  const [statusMessage, setStatusMessage] = useState("");
  const [expandedPrompts, setExpandedPrompts] = useState<Record<string, boolean>>({});
  const [selectedItem, setSelectedItem] = useState<GalleryImageItem | null>(null);
  const [recordDialogItem, setRecordDialogItem] = useState<GalleryImageItem | null>(null);
  const [recordDialogProjects, setRecordDialogProjects] = useState<CreativeProject[]>([]);
  const [recordDialogProjectDetail, setRecordDialogProjectDetail] = useState<CreativeProjectDetailResponse | null>(null);
  const [recordDialogProjectId, setRecordDialogProjectId] = useState("mavosport");
  const [recordDialogRecordId, setRecordDialogRecordId] = useState("");
  const [recordDialogCurationStatus, setRecordDialogCurationStatus] =
    useState<ProjectRecordCurationStatus>("needs_regeneration");
  const [recordDialogRejectReasons, setRecordDialogRejectReasons] = useState<ProjectRecordRejectReason[]>([]);
  const [recordDialogNotes, setRecordDialogNotes] = useState("");
  const [isRecordDialogLoading, setIsRecordDialogLoading] = useState(false);
  const [isRecordDialogSaving, setIsRecordDialogSaving] = useState(false);
  const [recordDialogError, setRecordDialogError] = useState("");
  const [pendingDeleteItem, setPendingDeleteItem] = useState<GalleryImageItem | null>(null);
  const [deletingOutputId, setDeletingOutputId] = useState<string | null>(null);
  const [pendingBulkDelete, setPendingBulkDelete] = useState(false);
  const [isDeletingSelected, setIsDeletingSelected] = useState(false);
  const [copiedOutputId, setCopiedOutputId] = useState<string | null>(null);
  const [exportMode, setExportMode] = useState(false);
  const [selectedExportOutputIds, setSelectedExportOutputIds] = useState<string[]>([]);
  const [isExporting, setIsExporting] = useState(false);
  const statusTimerRef = useRef<number | undefined>();
  const copiedTimerRef = useRef<number | undefined>();

  useEffect(() => {
    const controller = new AbortController();

    async function loadGallery(): Promise<void> {
      setIsLoading(true);
      setError("");

      try {
        const response = await fetch("/api/gallery", {
          signal: controller.signal
        });
        if (!response.ok) {
          throw new Error(await readGalleryError(response, locale, t));
        }

        const body = (await response.json()) as GalleryResponse;
        if (!Array.isArray(body.items)) {
          throw new Error(t("galleryServiceInvalidData"));
        }

        if (!controller.signal.aborted) {
          setItems(body.items);
        }
      } catch (loadError) {
        if (!controller.signal.aborted) {
          setError(loadError instanceof Error ? loadError.message : t("galleryLoadFailed"));
        }
      } finally {
        if (!controller.signal.aborted) {
          setIsLoading(false);
        }
      }
    }

    void loadGallery();

    return () => {
      controller.abort();
    };
  }, [locale, t]);

  useEffect(() => {
    if (!selectedItem && !recordDialogItem && !pendingDeleteItem && !pendingBulkDelete) {
      return;
    }

    const handleKeyDown = (event: KeyboardEvent): void => {
      if (event.key !== "Escape") {
        return;
      }

      event.preventDefault();
      if (recordDialogItem) {
        closeRecordDialog();
        return;
      }

      if (pendingDeleteItem) {
        setPendingDeleteItem(null);
        return;
      }

      if (pendingBulkDelete) {
        setPendingBulkDelete(false);
        return;
      }

      setSelectedItem(null);
    };

    window.addEventListener("keydown", handleKeyDown);
    return () => {
      window.removeEventListener("keydown", handleKeyDown);
    };
  }, [pendingBulkDelete, pendingDeleteItem, recordDialogItem, selectedItem]);

  useEffect(() => {
    return () => {
      window.clearTimeout(statusTimerRef.current);
      window.clearTimeout(copiedTimerRef.current);
    };
  }, []);

  const filteredItems = useMemo(() => {
    const normalizedQuery = normalizeSearchText(query);
    if (!normalizedQuery) {
      return items;
    }

    return items.filter((item) => normalizeSearchText(item.prompt).includes(normalizedQuery));
  }, [items, query]);
  const itemOutputIdSet = useMemo(() => new Set(items.map((item) => item.outputId)), [items]);
  const selectedExportOutputIdSet = useMemo(() => new Set(selectedExportOutputIds), [selectedExportOutputIds]);
  const filteredExportOutputIds = useMemo(() => filteredItems.map((item) => item.outputId), [filteredItems]);
  const selectedFilteredExportCount = useMemo(
    () => filteredExportOutputIds.filter((outputId) => selectedExportOutputIdSet.has(outputId)).length,
    [filteredExportOutputIds, selectedExportOutputIdSet]
  );
  const featuredItem = filteredItems[0] ?? null;
  const gridItems = featuredItem ? filteredItems.slice(1) : filteredItems;
  const actionHandlers: GalleryActionHandlers = {
    onAddToRecord: requestAddToRecord,
    onCopy: (item) => void copyPrompt(item),
    onDelete: requestDelete,
    onDownload: downloadItem,
    onReuse
  };
  const selectionHandlers: GallerySelectionHandlers = {
    exportMode,
    onToggleSelected: toggleExportSelection,
    selectedOutputIds: selectedExportOutputIdSet
  };

  useEffect(() => {
    setSelectedExportOutputIds((current) => {
      const next = current.filter((outputId) => itemOutputIdSet.has(outputId));
      return next.length === current.length ? current : next;
    });
  }, [itemOutputIdSet]);

  function showStatus(message: string): void {
    window.clearTimeout(statusTimerRef.current);
    setError("");
    setStatusMessage(message);
    statusTimerRef.current = window.setTimeout(() => {
      setStatusMessage("");
    }, 3200);
  }

  function togglePrompt(outputId: string): void {
    setExpandedPrompts((current) => ({
      ...current,
      [outputId]: !current[outputId]
    }));
  }

  function openExportMode(): void {
    setError("");
    setExportMode(true);
  }

  function closeExportMode(): void {
    setExportMode(false);
    setSelectedExportOutputIds([]);
    setPendingBulkDelete(false);
    setError("");
  }

  function toggleExportSelection(item: GalleryImageItem): void {
    setError("");
    setExportMode(true);
    setSelectedExportOutputIds((current) => {
      if (current.includes(item.outputId)) {
        return current.filter((outputId) => outputId !== item.outputId);
      }

      return [...current, item.outputId];
    });
  }

  function selectFilteredExportItems(): void {
    setError("");
    setExportMode(true);
    setSelectedExportOutputIds((current) => {
      const next = new Set(current);
      filteredExportOutputIds.forEach((outputId) => {
        next.add(outputId);
      });
      return Array.from(next);
    });
  }

  function clearExportSelection(): void {
    setError("");
    setSelectedExportOutputIds([]);
  }

  async function exportSelectedItems(): Promise<void> {
    if (selectedExportOutputIds.length === 0) {
      setError(t("galleryExportSelectAtLeastOne"));
      return;
    }

    const request: GalleryExportRequest = {
      outputIds: selectedExportOutputIds
    };

    setIsExporting(true);
    setError("");

    try {
      const response = await fetch("/api/gallery/export", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(request)
      });

      if (!response.ok) {
        throw new Error(await readGalleryError(response, locale, t));
      }

      const archive = await response.blob();
      if (archive.size === 0) {
        throw new Error(t("galleryExportFailed"));
      }

      const archiveUrl = window.URL.createObjectURL(archive);
      const link = document.createElement("a");
      link.href = archiveUrl;
      link.download = contentDispositionFileName(response.headers.get("Content-Disposition")) ?? "gpt-image-canvas-gallery.zip";
      document.body.append(link);
      link.click();
      link.remove();
      window.setTimeout(() => window.URL.revokeObjectURL(archiveUrl), 1000);
      showStatus(t("galleryExportStarted", { count: selectedExportOutputIds.length }));
    } catch (exportError) {
      setError(exportError instanceof Error ? exportError.message : t("galleryExportFailed"));
    } finally {
      setIsExporting(false);
    }
  }

  function requestDeleteSelectedItems(): void {
    if (selectedExportOutputIds.length === 0) {
      setError(t("galleryBulkDeleteSelectAtLeastOne"));
      return;
    }

    setError("");
    setPendingBulkDelete(true);
  }

  async function deleteSelectedItems(): Promise<void> {
    if (selectedExportOutputIds.length === 0) {
      setPendingBulkDelete(false);
      setError(t("galleryBulkDeleteSelectAtLeastOne"));
      return;
    }

    const request: GalleryBatchDeleteRequest = {
      outputIds: selectedExportOutputIds
    };

    setIsDeletingSelected(true);
    setError("");

    try {
      const response = await fetch("/api/gallery/batch", {
        method: "DELETE",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(request)
      });
      if (!response.ok) {
        throw new Error(await readGalleryError(response, locale, t));
      }

      const body = (await response.json().catch(() => undefined)) as { deletedOutputIds?: string[] } | undefined;
      const deletedOutputIds = Array.isArray(body?.deletedOutputIds)
        ? body.deletedOutputIds.filter((outputId): outputId is string => typeof outputId === "string")
        : selectedExportOutputIds;
      const deletedOutputIdSet = new Set(deletedOutputIds);
      setItems((current) => current.filter((galleryItem) => !deletedOutputIdSet.has(galleryItem.outputId)));
      setSelectedItem((current) => (current && deletedOutputIdSet.has(current.outputId) ? null : current));
      setCopiedOutputId((current) => (current && deletedOutputIdSet.has(current) ? null : current));
      setSelectedExportOutputIds((current) => current.filter((outputId) => !deletedOutputIdSet.has(outputId)));
      setPendingBulkDelete(false);
      deletedOutputIds.forEach(onDeleted);
      showStatus(t("galleryBulkDeleted", { count: deletedOutputIds.length }));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : t("galleryBulkDeleteFailed"));
    } finally {
      setIsDeletingSelected(false);
    }
  }

  async function copyPrompt(item: GalleryImageItem): Promise<void> {
    try {
      await writeClipboardText(item.prompt);
      window.clearTimeout(copiedTimerRef.current);
      setCopiedOutputId(item.outputId);
      copiedTimerRef.current = window.setTimeout(() => {
        setCopiedOutputId((current) => (current === item.outputId ? null : current));
        copiedTimerRef.current = undefined;
      }, 1800);
      showStatus(t("galleryCopiedPrompt"));
    } catch {
      setError(t("generationCopyFailed"));
    }
  }

  function downloadItem(item: GalleryImageItem): void {
    window.open(assetDownloadUrl(item.asset.id), "_blank", "noopener,noreferrer");
    showStatus(t("galleryOpenDownload"));
  }

  function requestAddToRecord(item: GalleryImageItem): void {
    setRecordDialogItem(item);
    setRecordDialogProjects([]);
    setRecordDialogProjectDetail(null);
    setRecordDialogProjectId("mavosport");
    setRecordDialogRecordId("");
    setRecordDialogCurationStatus("needs_regeneration");
    setRecordDialogRejectReasons([]);
    setRecordDialogNotes("");
    setRecordDialogError("");
    void loadRecordDialogProjects();
  }

  function closeRecordDialog(): void {
    setRecordDialogItem(null);
    setRecordDialogError("");
    setIsRecordDialogSaving(false);
  }

  async function loadRecordDialogProjects(): Promise<void> {
    setIsRecordDialogLoading(true);
    setRecordDialogError("");

    try {
      const response = await fetch("/api/creative-projects");
      if (!response.ok) {
        throw new Error(await readGalleryError(response, locale, t));
      }

      const body = (await response.json()) as CreativeProjectsResponse;
      const projects = Array.isArray(body.projects) ? body.projects : [];
      const preferredProjectId = projects.find((project) => project.slug === "mavosport")?.id ?? projects[0]?.id ?? "mavosport";
      setRecordDialogProjects(projects);
      await loadRecordDialogProject(preferredProjectId);
    } catch (loadError) {
      setRecordDialogError(loadError instanceof Error ? loadError.message : t("galleryRecordLoadFailed"));
    } finally {
      setIsRecordDialogLoading(false);
    }
  }

  async function loadRecordDialogProject(projectId: string): Promise<void> {
    setRecordDialogProjectId(projectId);
    setRecordDialogRecordId("");
    setRecordDialogProjectDetail(null);
    setRecordDialogError("");

    const response = await fetch(`/api/creative-projects/${encodeURIComponent(projectId)}`);
    if (!response.ok) {
      throw new Error(await readGalleryError(response, locale, t));
    }

    const body = (await response.json()) as CreativeProjectDetailResponse;
    setRecordDialogProjectDetail(body);
    setRecordDialogRecordId(body.records[0]?.id ?? "");
  }

  function changeRecordDialogProject(projectId: string): void {
    setIsRecordDialogLoading(true);
    void loadRecordDialogProject(projectId)
      .catch((loadError) => {
        setRecordDialogError(loadError instanceof Error ? loadError.message : t("galleryRecordLoadFailed"));
      })
      .finally(() => {
        setIsRecordDialogLoading(false);
      });
  }

  function updateRecordDialogCurationStatus(curationStatus: ProjectRecordCurationStatus): void {
    setRecordDialogCurationStatus(curationStatus);
    if (curationStatus !== "rejected") {
      setRecordDialogRejectReasons([]);
    }
  }

  function toggleRecordDialogRejectReason(reason: ProjectRecordRejectReason): void {
    setRecordDialogRejectReasons((current) =>
      current.includes(reason) ? current.filter((item) => item !== reason) : [...current, reason]
    );
  }

  async function submitRecordDialog(): Promise<void> {
    if (!recordDialogItem || !recordDialogRecordId) {
      return;
    }

    if (recordDialogCurationStatus === "rejected" && recordDialogRejectReasons.length === 0) {
      setRecordDialogError(t("galleryRecordRejectReasonRequired"));
      return;
    }

    const request: CreateProjectRecordLinkRequest = {
      linkType: "output",
      targetId: recordDialogItem.outputId,
      targetPath: recordDialogItem.asset.url,
      title: promptExcerpt(recordDialogItem.prompt),
      curationStatus: recordDialogCurationStatus,
      rejectReasons: recordDialogRejectReasons,
      notes: recordDialogNotes,
      metadataJson: JSON.stringify({
        source: "gallery",
        assetId: recordDialogItem.asset.id,
        fileName: recordDialogItem.asset.fileName,
        generationId: recordDialogItem.generationId,
        outputFormat: recordDialogItem.outputFormat,
        outputId: recordDialogItem.outputId,
        prompt: recordDialogItem.prompt,
        quality: recordDialogItem.quality,
        size: recordDialogItem.size,
        createdAt: recordDialogItem.createdAt
      })
    };

    setIsRecordDialogSaving(true);
    setRecordDialogError("");

    try {
      const response = await fetch(`/api/project-records/${encodeURIComponent(recordDialogRecordId)}/links`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(request)
      });
      if (!response.ok) {
        throw new Error(await readGalleryError(response, locale, t));
      }

      const body = (await response.json()) as { record?: { title?: string } };
      const recordTitle = body.record?.title ?? t("galleryRecordFallbackRecordTitle");
      closeRecordDialog();
      showStatus(t("galleryRecordSaved", { recordTitle }));
    } catch (saveError) {
      setRecordDialogError(saveError instanceof Error ? saveError.message : t("galleryRecordSaveFailed"));
    } finally {
      setIsRecordDialogSaving(false);
    }
  }

  function requestDelete(item: GalleryImageItem): void {
    setError("");
    setPendingDeleteItem(item);
  }

  async function deleteItem(item: GalleryImageItem): Promise<void> {
    setDeletingOutputId(item.outputId);
    setError("");

    try {
      const response = await fetch(`/api/gallery/${encodeURIComponent(item.outputId)}`, {
        method: "DELETE"
      });
      if (!response.ok) {
        throw new Error(await readGalleryError(response, locale, t));
      }

      setItems((current) => current.filter((galleryItem) => galleryItem.outputId !== item.outputId));
      setSelectedItem((current) => (current?.outputId === item.outputId ? null : current));
      setCopiedOutputId((current) => (current === item.outputId ? null : current));
      setSelectedExportOutputIds((current) => current.filter((outputId) => outputId !== item.outputId));
      setPendingDeleteItem(null);
      onDeleted(item.outputId);
      showStatus(t("galleryDeleted"));
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : t("galleryDeleteFailed"));
    } finally {
      setDeletingOutputId(null);
    }
  }

  return (
    <main className="gallery-page app-view" data-testid="gallery-page">
      <div className="gallery-page__inner">
        <header className="gallery-header">
          <div className="gallery-header__copy">
            <p className="gallery-kicker">
              <Sparkles className="size-3.5" aria-hidden="true" />
              {t("galleryKicker")}
            </p>
            <h1>{t("galleryTitle")}</h1>
          </div>
          <div className="gallery-header__meta" aria-label={t("galleryHeaderMeta", { count: items.length })}>
            <strong>{items.length}</strong>
            <span>{t("galleryWorkCount")}</span>
            <span>{t("galleryWorkSort")}</span>
          </div>
          <button
            aria-pressed={exportMode}
            className="gallery-export-entry"
            data-active={exportMode}
            type="button"
            onClick={exportMode ? closeExportMode : openExportMode}
          >
            <Archive className="size-4" aria-hidden="true" />
            {exportMode ? t("galleryExportExit") : t("galleryExportMode")}
          </button>
          <div className="gallery-search" role="search">
            <Search className="size-4" aria-hidden="true" />
            <input
              aria-label={t("gallerySearchAria")}
              className="gallery-search__input"
              data-testid="gallery-search"
              id="gallery-search-input"
              name="gallery-search"
              placeholder={t("gallerySearchPlaceholder")}
              value={query}
              onChange={(event) => setQuery(event.target.value)}
            />
          </div>
        </header>

        {error ? (
          <div className="gallery-alert gallery-alert--error" data-testid="gallery-error" role="alert">
            <XCircle className="size-4 shrink-0" aria-hidden="true" />
            <p>{error}</p>
          </div>
        ) : null}
        {statusMessage ? (
          <div className="gallery-alert gallery-alert--success" data-testid="gallery-message" role="status">
            <ImageIcon className="size-4 shrink-0" aria-hidden="true" />
            <p>{statusMessage}</p>
          </div>
        ) : null}

        {exportMode ? (
          <GalleryExportBar
            filteredCount={filteredItems.length}
            filteredSelectedCount={selectedFilteredExportCount}
            isExporting={isExporting}
            isDeleting={isDeletingSelected}
            selectedCount={selectedExportOutputIds.length}
            onClear={clearExportSelection}
            onDelete={requestDeleteSelectedItems}
            onExport={() => void exportSelectedItems()}
            onSelectFiltered={selectFilteredExportItems}
          />
        ) : null}

        {isLoading ? (
          <div className="gallery-empty-state" data-testid="gallery-loading" role="status">
            <Loader2 className="size-5 animate-spin" aria-hidden="true" />
            <p>{t("galleryLoading")}</p>
          </div>
        ) : filteredItems.length === 0 ? (
          <div className="gallery-empty-state" data-testid="gallery-empty">
            <ImageIcon className="size-7" aria-hidden="true" />
            <div>
              <p>{items.length === 0 ? t("galleryEmpty") : t("galleryNoMatches")}</p>
              <span>{items.length === 0 ? t("galleryEmptyHint") : t("galleryNoMatchesHint")}</span>
            </div>
          </div>
        ) : (
          <>
            {featuredItem ? (
              <FeaturedGalleryItem
                copied={copiedOutputId === featuredItem.outputId}
                deleting={deletingOutputId === featuredItem.outputId}
                expanded={Boolean(expandedPrompts[featuredItem.outputId])}
                item={featuredItem}
                onOpen={setSelectedItem}
                onTogglePrompt={togglePrompt}
                selection={selectionHandlers}
                {...actionHandlers}
              />
            ) : null}

            {gridItems.length > 0 ? (
              <div className="gallery-grid" data-testid="gallery-grid">
                {gridItems.map((item) => (
                  <GalleryCard
                    copied={copiedOutputId === item.outputId}
                    deleting={deletingOutputId === item.outputId}
                    expanded={Boolean(expandedPrompts[item.outputId])}
                    item={item}
                    key={item.outputId}
                    onOpen={setSelectedItem}
                    onTogglePrompt={togglePrompt}
                    selection={selectionHandlers}
                    {...actionHandlers}
                  />
                ))}
              </div>
            ) : null}
          </>
        )}
      </div>

      {selectedItem ? (
        <GalleryDetailDialog
          copied={copiedOutputId === selectedItem.outputId}
          deleting={deletingOutputId === selectedItem.outputId}
          item={selectedItem}
          onAddToRecord={() => requestAddToRecord(selectedItem)}
          onClose={() => setSelectedItem(null)}
          onCopy={() => void copyPrompt(selectedItem)}
          onDelete={() => requestDelete(selectedItem)}
          onDownload={() => downloadItem(selectedItem)}
          onReuse={() => onReuse(selectedItem)}
        />
      ) : null}

      {recordDialogItem ? (
        <AddToProjectRecordDialog
          curationStatus={recordDialogCurationStatus}
          error={recordDialogError}
          isLoading={isRecordDialogLoading}
          isSaving={isRecordDialogSaving}
          item={recordDialogItem}
          notes={recordDialogNotes}
          projectDetail={recordDialogProjectDetail}
          projects={recordDialogProjects}
          rejectReasons={recordDialogRejectReasons}
          selectedProjectId={recordDialogProjectId}
          selectedRecordId={recordDialogRecordId}
          onCancel={closeRecordDialog}
          onChangeCurationStatus={updateRecordDialogCurationStatus}
          onChangeNotes={setRecordDialogNotes}
          onChangeProject={changeRecordDialogProject}
          onChangeRecord={setRecordDialogRecordId}
          onConfirm={() => void submitRecordDialog()}
          onToggleRejectReason={toggleRecordDialogRejectReason}
        />
      ) : null}

      {pendingDeleteItem ? (
        <DeleteGalleryDialog
          deleting={deletingOutputId === pendingDeleteItem.outputId}
          item={pendingDeleteItem}
          onCancel={() => setPendingDeleteItem(null)}
          onConfirm={() => void deleteItem(pendingDeleteItem)}
        />
      ) : null}

      {pendingBulkDelete ? (
        <DeleteGallerySelectionDialog
          count={selectedExportOutputIds.length}
          deleting={isDeletingSelected}
          onCancel={() => setPendingBulkDelete(false)}
          onConfirm={() => void deleteSelectedItems()}
        />
      ) : null}
    </main>
  );
}

function GalleryExportBar({
  filteredCount,
  filteredSelectedCount,
  isDeleting,
  isExporting,
  selectedCount,
  onClear,
  onDelete,
  onExport,
  onSelectFiltered
}: {
  filteredCount: number;
  filteredSelectedCount: number;
  isDeleting: boolean;
  isExporting: boolean;
  selectedCount: number;
  onClear: () => void;
  onDelete: () => void;
  onExport: () => void;
  onSelectFiltered: () => void;
}) {
  const { t } = useI18n();
  const allFilteredSelected = filteredCount > 0 && filteredSelectedCount === filteredCount;

  return (
    <div className="gallery-export-bar" role="region" aria-label={t("galleryExportBarLabel")}>
      <div className="gallery-export-bar__summary" aria-live="polite">
        <span className="gallery-export-bar__mark" aria-hidden="true">
          <Archive className="size-4" />
        </span>
        <strong>{t("galleryExportSelectedCount", { count: selectedCount })}</strong>
        <span>{t("galleryExportVisibleCount", { selected: filteredSelectedCount, total: filteredCount })}</span>
      </div>
      <div className="gallery-export-bar__actions">
        <button
          className="secondary-action gallery-export-bar__button h-10"
          disabled={filteredCount === 0 || allFilteredSelected || isExporting}
          type="button"
          onClick={onSelectFiltered}
        >
          {t("galleryExportSelectVisible", { count: filteredCount })}
        </button>
        <button
          className="secondary-action gallery-export-bar__button h-10"
          disabled={selectedCount === 0 || isExporting}
          type="button"
          onClick={onClear}
        >
          {t("galleryExportClear")}
        </button>
        <button
          className="danger-action gallery-export-bar__button h-10"
          disabled={selectedCount === 0 || isExporting || isDeleting}
          type="button"
          onClick={onDelete}
        >
          {isDeleting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Trash2 className="size-4" aria-hidden="true" />}
          {t("galleryBulkDelete", { count: selectedCount })}
        </button>
        <button
          className="gallery-export-bar__primary h-10"
          disabled={selectedCount === 0 || isExporting || isDeleting}
          type="button"
          onClick={onExport}
        >
          {isExporting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Archive className="size-4" aria-hidden="true" />}
          {t("galleryExportZip", { count: selectedCount })}
        </button>
      </div>
    </div>
  );
}

function FeaturedGalleryItem({
  copied,
  deleting,
  expanded,
  item,
  onAddToRecord,
  onCopy,
  onDelete,
  onDownload,
  onOpen,
  onReuse,
  onTogglePrompt,
  selection
}: {
  copied: boolean;
  deleting: boolean;
  expanded: boolean;
  item: GalleryImageItem;
  onOpen: (item: GalleryImageItem) => void;
  onTogglePrompt: (outputId: string) => void;
  selection: GallerySelectionHandlers;
} & GalleryActionHandlers) {
  const { formatDateTime, t } = useI18n();
  const selected = selection.selectedOutputIds.has(item.outputId);

  return (
    <article className="gallery-feature" data-export-mode={selection.exportMode} data-selected={selected} data-testid="gallery-feature">
      <div className="gallery-feature__media">
        {selection.exportMode ? <GallerySelectToggle item={item} selected={selected} onToggle={selection.onToggleSelected} /> : null}
        <button
          aria-label={t("galleryActionOpenLatest", { excerpt: promptExcerpt(item.prompt) })}
          className="gallery-feature__image-button"
          type="button"
          onClick={() => onOpen(item)}
        >
          <img
            alt={item.prompt}
            className="gallery-feature__image"
            height={item.asset.height}
            src={assetPreviewUrl(item.asset.id, 1024)}
            width={item.asset.width}
          />
          <span className="gallery-feature__badge">{t("galleryBadgeLatest")}</span>
          <span className="gallery-card__zoom">
            <Maximize2 className="size-4" aria-hidden="true" />
          </span>
        </button>
      </div>

      <div className="gallery-feature__body">
        <GalleryTags item={item} />
        <div className="gallery-feature__prompt-panel">
          <CollapsiblePrompt
            expanded={expanded}
            label={t("galleryPromptLabel")}
            lines={4}
            text={item.prompt}
            onToggle={() => onTogglePrompt(item.outputId)}
          />
        </div>
        <div className="gallery-feature__footer">
          <div className="gallery-feature__meta">
            <span>
              <Clock3 className="size-3.5" aria-hidden="true" />
              {formatCreatedTime(item.createdAt, formatDateTime)}
            </span>
            <span>{item.outputFormat.toUpperCase()}</span>
            <span>{t("qualityLabel", { quality: item.quality })}</span>
          </div>
          <GalleryIconActions
            copied={copied}
            deleting={deleting}
            item={item}
            onAddToRecord={onAddToRecord}
            onCopy={onCopy}
            onDelete={onDelete}
            onDownload={onDownload}
            onReuse={onReuse}
          />
        </div>
      </div>
    </article>
  );
}

function GalleryCard({
  copied,
  deleting,
  expanded,
  item,
  onAddToRecord,
  onCopy,
  onDelete,
  onDownload,
  onOpen,
  onReuse,
  onTogglePrompt,
  selection
}: {
  copied: boolean;
  deleting: boolean;
  expanded: boolean;
  item: GalleryImageItem;
  onOpen: (item: GalleryImageItem) => void;
  onTogglePrompt: (outputId: string) => void;
  selection: GallerySelectionHandlers;
} & GalleryActionHandlers) {
  const { formatDateTime, t } = useI18n();
  const selected = selection.selectedOutputIds.has(item.outputId);

  return (
    <article className="gallery-card" data-export-mode={selection.exportMode} data-selected={selected} data-testid="gallery-card">
      <div className="gallery-card__media">
        {selection.exportMode ? <GallerySelectToggle item={item} selected={selected} onToggle={selection.onToggleSelected} /> : null}
        <button
          aria-label={t("galleryActionOpenImage", { excerpt: promptExcerpt(item.prompt) })}
          className="gallery-card__image-button"
          type="button"
          onClick={() => onOpen(item)}
        >
          <img
            alt={item.prompt}
            className="gallery-card__image"
            height={item.asset.height}
            loading="lazy"
            src={assetPreviewUrl(item.asset.id, 512)}
            width={item.asset.width}
          />
          <span className="gallery-card__zoom">
            <Maximize2 className="size-4" aria-hidden="true" />
          </span>
        </button>
      </div>

      <div className="gallery-card__body">
        <GalleryTags item={item} compact />
        <CollapsiblePrompt
          expanded={expanded}
          label={t("galleryPromptLabel")}
          lines={2}
          text={item.prompt}
          onToggle={() => onTogglePrompt(item.outputId)}
        />
        <div className="gallery-card__footer">
          <span className="gallery-time-tag">
            <Clock3 className="size-3.5" aria-hidden="true" />
            {formatCreatedTime(item.createdAt, formatDateTime)}
          </span>
          <GalleryIconActions
            copied={copied}
            deleting={deleting}
            item={item}
            onAddToRecord={onAddToRecord}
            onCopy={onCopy}
            onDelete={onDelete}
            onDownload={onDownload}
            onReuse={onReuse}
          />
        </div>
      </div>
    </article>
  );
}

function GallerySelectToggle({
  item,
  selected,
  onToggle
}: {
  item: GalleryImageItem;
  selected: boolean;
  onToggle: (item: GalleryImageItem) => void;
}) {
  const { t } = useI18n();
  const excerpt = promptExcerpt(item.prompt);
  const label = selected ? t("galleryActionDeselectExport", { excerpt }) : t("galleryActionSelectExport", { excerpt });

  return (
    <button
      aria-label={label}
      aria-pressed={selected}
      className="gallery-select-toggle"
      data-selected={selected}
      title={label}
      type="button"
      onClick={() => onToggle(item)}
    >
      <span className="gallery-select-toggle__box" aria-hidden="true">
        {selected ? <Check className="size-3.5" /> : null}
      </span>
    </button>
  );
}

function GalleryIconActions({
  copied,
  deleting,
  item,
  onAddToRecord,
  onCopy,
  onDelete,
  onDownload,
  onReuse
}: {
  copied: boolean;
  deleting: boolean;
  item: GalleryImageItem;
} & GalleryActionHandlers) {
  const { t } = useI18n();
  const excerpt = promptExcerpt(item.prompt);

  return (
    <div className="gallery-card__actions">
      <button
        aria-label={copied ? t("galleryCopiedPrompt") : t("galleryActionCopyPrompt", { excerpt })}
        className="gallery-icon-action"
        data-copied={copied}
        title={copied ? t("galleryCopiedPrompt") : t("galleryPromptLabel")}
        type="button"
        onClick={() => onCopy(item)}
      >
        <span className="gallery-icon-action__icon-stack" aria-hidden="true">
          <Copy className="gallery-icon-action__icon gallery-icon-action__icon--copy size-4" />
          <CheckCircle2 className="gallery-icon-action__icon gallery-icon-action__icon--check size-4" />
        </span>
      </button>
      <button
        aria-label={t("galleryActionDownloadImage", { excerpt })}
        className="gallery-icon-action"
        title={t("galleryDownloadOriginal")}
        type="button"
        onClick={() => onDownload(item)}
      >
        <Download className="size-4" aria-hidden="true" />
      </button>
      <button
        aria-label={t("galleryActionReusePrompt", { excerpt })}
        className="gallery-icon-action"
        title={t("galleryReuseToCanvas")}
        type="button"
        onClick={() => onReuse(item)}
      >
        <RotateCcw className="size-4" aria-hidden="true" />
      </button>
      <button
        aria-label={t("galleryActionAddToRecord", { excerpt })}
        className="gallery-icon-action"
        title={t("galleryRecordAddAction")}
        type="button"
        onClick={() => onAddToRecord(item)}
      >
        <FolderPlus className="size-4" aria-hidden="true" />
      </button>
      <button
        aria-label={t("galleryActionDeleteImage", { excerpt })}
        className="gallery-icon-action gallery-icon-action--danger"
        disabled={deleting}
        title={t("galleryRemovedTitle")}
        type="button"
        onClick={() => onDelete(item)}
      >
        {deleting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Trash2 className="size-4" aria-hidden="true" />}
      </button>
    </div>
  );
}

function GalleryTags({ item, compact = false }: { item: GalleryImageItem; compact?: boolean }) {
  const { t } = useI18n();
  const styleLabel = styleTagLabel(item.presetId, t);
  const sizeLabel = sizeTagLabel(item, t);

  return (
    <div className="gallery-tags" data-compact={compact}>
      <span className="gallery-tag gallery-tag--mode">{t("galleryModeLabel", { mode: item.mode })}</span>
      {styleLabel ? (
        <span className="gallery-tag gallery-tag--style">
          <Palette className="size-3.5" aria-hidden="true" />
          {styleLabel}
        </span>
      ) : null}
      <span className="gallery-tag gallery-tag--size">
        <Ruler className="size-3.5" aria-hidden="true" />
        {sizeLabel}
      </span>
    </div>
  );
}

function CollapsiblePrompt({
  expanded,
  label,
  lines,
  text,
  onToggle
}: {
  expanded: boolean;
  label: string;
  lines: 2 | 4 | 8;
  text: string;
  onToggle: () => void;
}) {
  const { t } = useI18n();

  return (
    <section className="gallery-prompt-block">
      <div className="gallery-prompt-heading">
        <h3 className="gallery-prompt-label">{label}</h3>
        <button
          aria-expanded={expanded}
          className="gallery-prompt-toggle"
          data-expanded={expanded}
          type="button"
          onClick={onToggle}
        >
          {expanded ? t("galleryToggleCollapse") : t("galleryToggleExpand")}
          <ChevronDown className="size-3.5" aria-hidden="true" />
        </button>
      </div>
      <p className="gallery-prompt-text" data-expanded={expanded} data-lines={lines}>
        {text}
      </p>
    </section>
  );
}

function GalleryDetailDialog({
  copied,
  deleting,
  item,
  onAddToRecord,
  onClose,
  onCopy,
  onDelete,
  onDownload,
  onReuse
}: {
  copied: boolean;
  deleting: boolean;
  item: GalleryImageItem;
  onAddToRecord: () => void;
  onClose: () => void;
  onCopy: () => void;
  onDelete: () => void;
  onDownload: () => void;
  onReuse: () => void;
}) {
  const [promptExpanded, setPromptExpanded] = useState(false);
  const { formatDateTime, t } = useI18n();

  return (
    <div className="gallery-modal-backdrop app-modal-backdrop" data-testid="gallery-detail" role="presentation">
      <div aria-labelledby="gallery-detail-title" aria-modal="true" className="gallery-modal app-modal-surface" role="dialog">
        <header className="gallery-modal__header">
          <div className="gallery-modal__title">
            <p>{t("galleryDetailEyebrow")}</p>
            <h2 id="gallery-detail-title">{t("galleryDetailTitle")}</h2>
            <GalleryTags item={item} />
          </div>
          <button aria-label={t("commonClose")} className="gallery-icon-action gallery-modal__close" type="button" onClick={onClose}>
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>

        <div className="gallery-modal__body">
          <div className="gallery-modal__media">
            <img
              alt={item.prompt}
              className="gallery-modal__image"
              height={item.asset.height}
              src={item.asset.url}
              width={item.asset.width}
            />
          </div>

          <aside className="gallery-modal__copy">
            <div className="gallery-modal__meta">
              <span>
              <Clock3 className="size-3.5" aria-hidden="true" />
                {formatCreatedTime(item.createdAt, formatDateTime)}
              </span>
              <span>{item.outputFormat.toUpperCase()}</span>
              <span>{t("qualityLabel", { quality: item.quality })}</span>
            </div>
            <CollapsiblePrompt
              expanded={promptExpanded}
              label={t("galleryPromptLabel")}
              lines={8}
              text={item.prompt}
              onToggle={() => setPromptExpanded((current) => !current)}
            />
          </aside>
        </div>

        <footer className="gallery-modal__actions">
          <button
            aria-label={copied ? t("galleryCopiedPrompt") : t("commonCopy")}
            className="secondary-action gallery-copy-action h-10"
            data-copied={copied}
            title={copied ? t("galleryCopiedPrompt") : t("commonCopy")}
            type="button"
            onClick={onCopy}
          >
            <span className="gallery-icon-action__icon-stack" aria-hidden="true">
              <Copy className="gallery-icon-action__icon gallery-icon-action__icon--copy size-4" />
              <CheckCircle2 className="gallery-icon-action__icon gallery-icon-action__icon--check size-4" />
            </span>
            {t("commonCopy")}
          </button>
          <button className="secondary-action h-10" type="button" onClick={onDownload}>
            <Download className="size-4" aria-hidden="true" />
            {t("commonDownload")}
          </button>
          <button className="secondary-action h-10" type="button" onClick={onReuse}>
            <RotateCcw className="size-4" aria-hidden="true" />
            {t("commonReuse")}
          </button>
          <button className="secondary-action h-10" type="button" onClick={onAddToRecord}>
            <FolderPlus className="size-4" aria-hidden="true" />
            {t("galleryRecordAddAction")}
          </button>
          <button className="secondary-action h-10 text-red-700 hover:text-red-800" disabled={deleting} type="button" onClick={onDelete}>
            {deleting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Trash2 className="size-4" aria-hidden="true" />}
            {t("commonRemove")}
          </button>
        </footer>
      </div>
    </div>
  );
}

function AddToProjectRecordDialog({
  curationStatus,
  error,
  isLoading,
  isSaving,
  item,
  notes,
  projectDetail,
  projects,
  rejectReasons,
  selectedProjectId,
  selectedRecordId,
  onCancel,
  onChangeCurationStatus,
  onChangeNotes,
  onChangeProject,
  onChangeRecord,
  onConfirm,
  onToggleRejectReason
}: {
  curationStatus: ProjectRecordCurationStatus;
  error: string;
  isLoading: boolean;
  isSaving: boolean;
  item: GalleryImageItem;
  notes: string;
  projectDetail: CreativeProjectDetailResponse | null;
  projects: CreativeProject[];
  rejectReasons: ProjectRecordRejectReason[];
  selectedProjectId: string;
  selectedRecordId: string;
  onCancel: () => void;
  onChangeCurationStatus: (value: ProjectRecordCurationStatus) => void;
  onChangeNotes: (value: string) => void;
  onChangeProject: (value: string) => void;
  onChangeRecord: (value: string) => void;
  onConfirm: () => void;
  onToggleRejectReason: (reason: ProjectRecordRejectReason) => void;
}) {
  const { t } = useI18n();
  const records = projectDetail?.records ?? [];
  const canSubmit =
    !isLoading &&
    !isSaving &&
    Boolean(selectedRecordId) &&
    (curationStatus !== "rejected" || rejectReasons.length > 0);

  return (
    <div className="gallery-confirm-backdrop app-modal-backdrop" data-testid="gallery-add-record-dialog" role="presentation">
      <div
        aria-describedby="gallery-add-record-description"
        aria-labelledby="gallery-add-record-title"
        aria-modal="true"
        className="gallery-record-dialog app-modal-surface"
        role="dialog"
      >
        <header className="gallery-record-dialog__header">
          <div>
            <p className="gallery-record-dialog__eyebrow">{t("galleryRecordDialogEyebrow")}</p>
            <h2 id="gallery-add-record-title">{t("galleryRecordDialogTitle")}</h2>
            <p id="gallery-add-record-description">{t("galleryRecordDialogCopy", { excerpt: promptExcerpt(item.prompt) })}</p>
          </div>
          <button aria-label={t("commonClose")} className="gallery-icon-action gallery-modal__close" disabled={isSaving} type="button" onClick={onCancel}>
            <X className="size-4" aria-hidden="true" />
          </button>
        </header>

        <div className="gallery-record-dialog__body">
          <label className="project-records-field">
            <span>{t("galleryRecordProjectLabel")}</span>
            <select disabled={isLoading || isSaving} value={selectedProjectId} onChange={(event) => onChangeProject(event.target.value)}>
              {projects.length === 0 ? <option value="mavosport">MavoSport</option> : null}
              {projects.map((project) => (
                <option key={project.id} value={project.id}>
                  {project.name}
                </option>
              ))}
            </select>
          </label>

          <label className="project-records-field">
            <span>{t("galleryRecordRecordLabel")}</span>
            <select disabled={isLoading || isSaving || records.length === 0} value={selectedRecordId} onChange={(event) => onChangeRecord(event.target.value)}>
              <option value="">{records.length > 0 ? t("galleryRecordSelectRecord") : t("galleryRecordNoRecords")}</option>
              {records.map((record) => (
                <option key={record.id} value={record.id}>
                  {record.title}
                </option>
              ))}
            </select>
          </label>

          <label className="project-records-field">
            <span>{t("galleryRecordCurationLabel")}</span>
            <select
              disabled={isLoading || isSaving}
              value={curationStatus}
              onChange={(event) => onChangeCurationStatus(event.target.value as ProjectRecordCurationStatus)}
            >
              {PROJECT_RECORD_CURATION_STATUSES.map((status) => (
                <option key={status} value={status}>
                  {projectRecordCurationLabel(status, t)}
                </option>
              ))}
            </select>
          </label>

          {curationStatus === "rejected" ? (
            <fieldset className="gallery-record-dialog__reject-reasons">
              <legend>{t("galleryRecordRejectReasonsLabel")}</legend>
              <div className="project-records-reject-reasons">
                {PROJECT_RECORD_REJECT_REASONS.map((reason) => (
                  <label key={reason}>
                    <input
                      checked={rejectReasons.includes(reason)}
                      disabled={isSaving}
                      type="checkbox"
                      onChange={() => onToggleRejectReason(reason)}
                    />
                    <span>{projectRecordRejectReasonLabel(reason, t)}</span>
                  </label>
                ))}
              </div>
              {rejectReasons.length === 0 ? (
                <p className="project-records-inline-warning">
                  <AlertTriangle className="size-4" aria-hidden="true" />
                  {t("galleryRecordRejectReasonRequired")}
                </p>
              ) : null}
            </fieldset>
          ) : null}

          <label className="project-records-field">
            <span>{t("galleryRecordNotesLabel")}</span>
            <textarea
              disabled={isSaving}
              placeholder={t("galleryRecordNotesPlaceholder")}
              rows={4}
              value={notes}
              onChange={(event) => onChangeNotes(event.target.value)}
            />
          </label>

          {error ? (
            <div className="gallery-record-dialog__alert" role="alert">
              <XCircle className="size-4" aria-hidden="true" />
              <span>{error}</span>
            </div>
          ) : null}
        </div>

        <footer className="gallery-record-dialog__actions">
          <button className="secondary-action h-10" disabled={isSaving} type="button" onClick={onCancel}>
            {t("commonCancel")}
          </button>
          <button className="gallery-export-bar__primary h-10" disabled={!canSubmit} type="button" onClick={onConfirm}>
            {isSaving || isLoading ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <FolderPlus className="size-4" aria-hidden="true" />}
            {isLoading ? t("galleryRecordLoading") : t("galleryRecordSubmit")}
          </button>
        </footer>
      </div>
    </div>
  );
}

function DeleteGalleryDialog({
  deleting,
  item,
  onCancel,
  onConfirm
}: {
  deleting: boolean;
  item: GalleryImageItem;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();

  return (
    <div className="gallery-confirm-backdrop app-modal-backdrop" data-testid="gallery-delete-dialog" role="presentation">
      <div
        aria-describedby="gallery-delete-description"
        aria-labelledby="gallery-delete-title"
        aria-modal="true"
        className="gallery-confirm app-modal-surface"
        role="dialog"
      >
        <div className="gallery-confirm__icon">
          <AlertTriangle className="size-5" aria-hidden="true" />
        </div>
        <div className="gallery-confirm__copy">
          <h2 id="gallery-delete-title">{t("galleryConfirmDeleteTitle")}</h2>
          <p id="gallery-delete-description">
            {t("galleryConfirmDeleteBody", { excerpt: promptExcerpt(item.prompt) })}
          </p>
        </div>
        <div className="gallery-confirm__actions">
          <button className="secondary-action h-10" disabled={deleting} type="button" onClick={onCancel}>
            {t("commonCancel")}
          </button>
          <button className="danger-action h-10" disabled={deleting} type="button" onClick={onConfirm}>
            {deleting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Trash2 className="size-4" aria-hidden="true" />}
            {t("galleryConfirmRemove")}
          </button>
        </div>
      </div>
    </div>
  );
}

function DeleteGallerySelectionDialog({
  count,
  deleting,
  onCancel,
  onConfirm
}: {
  count: number;
  deleting: boolean;
  onCancel: () => void;
  onConfirm: () => void;
}) {
  const { t } = useI18n();

  return (
    <div className="gallery-confirm-backdrop app-modal-backdrop" data-testid="gallery-bulk-delete-dialog" role="presentation">
      <div
        aria-describedby="gallery-bulk-delete-description"
        aria-labelledby="gallery-bulk-delete-title"
        aria-modal="true"
        className="gallery-confirm app-modal-surface"
        role="dialog"
      >
        <div className="gallery-confirm__icon">
          <AlertTriangle className="size-5" aria-hidden="true" />
        </div>
        <div className="gallery-confirm__copy">
          <h2 id="gallery-bulk-delete-title">{t("galleryConfirmBulkDeleteTitle", { count })}</h2>
          <p id="gallery-bulk-delete-description">{t("galleryConfirmBulkDeleteBody", { count })}</p>
        </div>
        <div className="gallery-confirm__actions">
          <button className="secondary-action h-10" disabled={deleting} type="button" onClick={onCancel}>
            {t("commonCancel")}
          </button>
          <button className="danger-action h-10" disabled={deleting || count === 0} type="button" onClick={onConfirm}>
            {deleting ? <Loader2 className="size-4 animate-spin" aria-hidden="true" /> : <Trash2 className="size-4" aria-hidden="true" />}
            {t("galleryConfirmBulkRemove", { count })}
          </button>
        </div>
      </div>
    </div>
  );
}

function styleTagLabel(presetId: string, t: Translate): string {
  if (presetId === "none") {
    return "";
  }

  const preset = STYLE_PRESETS.find((item) => item.id === presetId);
  return preset ? t("stylePresetLabel", { presetId: preset.id, fallback: preset.label }) : "";
}

function sizeTagLabel(item: GalleryImageItem, t: Translate): string {
  const preset = SIZE_PRESETS.find((sizePreset) => sizePreset.width === item.size.width && sizePreset.height === item.size.height);
  const presetLabel = preset ? t("sizePresetLabel", { presetId: preset.id, fallback: preset.label }) : t("customSize");
  return `${presetLabel} · ${item.size.width} x ${item.size.height}`;
}

function projectRecordCurationLabel(status: ProjectRecordCurationStatus, t: Translate): string {
  switch (status) {
    case "usable":
      return t("galleryRecordCurationUsable");
    case "rejected":
      return t("galleryRecordCurationRejected");
    case "needs_regeneration":
      return t("galleryRecordCurationNeedsRegeneration");
    case "reference_only":
      return t("galleryRecordCurationReferenceOnly");
  }
}

function projectRecordRejectReasonLabel(reason: ProjectRecordRejectReason, t: Translate): string {
  switch (reason) {
    case "no_logo":
      return t("galleryRecordRejectReasonNoLogo");
    case "wrong_logo":
      return t("galleryRecordRejectReasonWrongLogo");
    case "logo_position_wrong":
      return t("galleryRecordRejectReasonLogoPositionWrong");
    case "wrong_ratio":
      return t("galleryRecordRejectReasonWrongRatio");
    case "bad_composition":
      return t("galleryRecordRejectReasonBadComposition");
    case "too_ugly":
      return t("galleryRecordRejectReasonTooUgly");
    case "fake_text":
      return t("galleryRecordRejectReasonFakeText");
    case "fake_score_or_data":
      return t("galleryRecordRejectReasonFakeScoreOrData");
    case "brand_risk":
      return t("galleryRecordRejectReasonBrandRisk");
    case "real_person_risk":
      return t("galleryRecordRejectReasonRealPersonRisk");
    case "trademark_risk":
      return t("galleryRecordRejectReasonTrademarkRisk");
    case "too_aggressive":
      return t("galleryRecordRejectReasonTooAggressive");
    case "gambling_vibe":
      return t("galleryRecordRejectReasonGamblingVibe");
    case "not_video_friendly":
      return t("galleryRecordRejectReasonNotVideoFriendly");
    case "other":
      return t("galleryRecordRejectReasonOther");
  }
}

function promptExcerpt(promptValue: string): string {
  const compact = promptValue.replace(/\s+/gu, " ").trim();
  return compact.length > 48 ? `${compact.slice(0, 48)}...` : compact;
}

function formatCreatedTime(value: string, formatDateTime: (value: string) => string): string {
  return formatDateTime(value);
}

function normalizeSearchText(value: string): string {
  return value.replace(/\s+/gu, " ").trim().toLocaleLowerCase();
}

async function readGalleryError(response: Response, locale: Locale, t: Translate): Promise<string> {
  try {
    const body = (await response.json()) as { error?: { code?: string; message?: string } };
    return localizedApiErrorMessage({
      code: body.error?.code,
      fallbackMessage: body.error?.message,
      fallbackText: t("galleryRequestFailed", { status: response.status }),
      locale,
      status: response.status
    });
  } catch {
    return t("galleryRequestFailed", { status: response.status });
  }
}

function contentDispositionFileName(value: string | null): string | undefined {
  if (!value) {
    return undefined;
  }

  const encoded = /filename\*=UTF-8''([^;]+)/iu.exec(value);
  if (encoded?.[1]) {
    try {
      return decodeURIComponent(encoded[1]);
    } catch {
      return undefined;
    }
  }

  const quoted = /filename="([^"]+)"/iu.exec(value);
  if (quoted?.[1]) {
    return quoted[1];
  }

  const unquoted = /filename=([^;]+)/iu.exec(value);
  return unquoted?.[1]?.trim();
}

async function writeClipboardText(text: string): Promise<void> {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return;
  }

  const textArea = document.createElement("textarea");
  textArea.value = text;
  textArea.readOnly = true;
  textArea.style.position = "fixed";
  textArea.style.left = "-9999px";
  textArea.style.top = "0";
  document.body.append(textArea);
  textArea.select();

  try {
    const copied = document.execCommand("copy");
    if (!copied) {
      throw new Error("Copy command was not accepted.");
    }
  } finally {
    textArea.remove();
  }
}
