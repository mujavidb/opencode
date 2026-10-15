import type { SessionInfo } from "@opencode/client/promise"
import { Key } from "@solid-primitives/keyed"
import { createMemo, For, Index, onCleanup, Show } from "solid-js"
import { createStore, type SetStoreFunction } from "solid-js/store"
import { InlineInput } from "@opencode/ui/inline-input"
import { Spinner } from "@opencode/ui/spinner"
import { ScrollView } from "@opencode/ui/scroll-view"
import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Menu } from "@opencode/ui/menu"
import {
  displayName,
  getProjectAvatarSource,
  getProjectAvatarVariant,
  ProjectAvatar,
} from "@opencode/ui/project-avatar"
import { Tooltip } from "@opencode/ui/tooltip"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection } from "@/runtime/server/registry"
import { ORGANIZE_COLOR_STYLES } from "@/session/organization"
import { SessionTabAvatarView } from "@/shell/layout/session-tab-avatar"
import { sessionLabel } from "@/session/title"
import { pathKey } from "@/workspaces/path-key"
import { shouldOpenSessionInBackground } from "./open"
import { createAltHold } from "./alt-hold"
import "./view.css"
import {
  HomeSessionStatusController,
  homeSessionSearchKey,
  type HomeSessionGroup,
  type HomeSessionRecord,
  type HomeSessionsController,
  type OpenSessionOptions,
} from "./controller"

const HOME_SECTION_LABEL = "text-v2-text-text-muted [font-weight:440]"

const HOME_SESSION_SEARCH_RESULTS_ID = "home-session-search-results"

const HOME_SESSION_LONG_PRESS_MS = 500

// Middle-click or Cmd+click on macOS (Ctrl+click elsewhere) opens a session
// tab in the background without navigating, matching browser conventions.
function isBackgroundOpen(event: MouseEvent) {
  return shouldOpenSessionInBackground({
    button: event.button,
    mac: typeof navigator === "object" && /(Mac|iPod|iPhone|iPad)/.test(navigator.platform),
    meta: event.metaKey,
    ctrl: event.ctrlKey,
    shift: event.shiftKey,
    alt: event.altKey,
  })
}

export type HomeSessionsViewProps = {
  language: ReturnType<typeof useLanguage>
  groups: HomeSessionGroup[]
  counts: { active: number; pinned: number; archived: number }
  organize: HomeSessionsController["organize"]
  loading: boolean
  desktop: boolean
  location: (record: HomeSessionRecord) => { worktree: string; branch: string | undefined }
  onRevealLocations: (record?: HomeSessionRecord) => void
  showProjectName: boolean
  server: ServerConnection.Key
  canCreateSession: boolean
  searchValue: string
  searchPlaceholder: string
  searchOpen: boolean
  searchLoading: boolean
  searchResults: HomeSessionRecord[]
  searchActive: string
  searchNoResultsLabel: string
  titleOpacity: (id: HomeSessionGroup["id"]) => number
  isOpenTab: (record: HomeSessionRecord) => boolean
  onCreateSession: () => void
  onOpenSession: (session: SessionInfo, options?: OpenSessionOptions) => void
  onArchiveSession: (session: SessionInfo) => Promise<void>
  onRenameSession: (server: ServerConnection.Key, session: SessionInfo, title: string) => Promise<boolean>
  onExportSession: (server: ServerConnection.Key, session: SessionInfo) => Promise<void>
  onDeleteSession: (server: ServerConnection.Key, session: SessionInfo) => void
  onSetHoverTarget: (element: HTMLElement) => void
  onSetThumbTrack: (element: HTMLDivElement) => void
  onSetContent: (element: HTMLDivElement) => void
  onSetHeader: (id: HomeSessionGroup["id"], element: HTMLDivElement) => void
  onWheel: (event: WheelEvent) => void
  onSetSearchRoot: (element: HTMLDivElement) => void
  onSetSearchInput: (element: HTMLInputElement) => void
  onSetSearchList: (element: HTMLDivElement) => void
  onSearchFocus: () => void
  onSearchInput: (value: string) => void
  onSearchClose: () => void
  onSearchMove: (delta: number) => void
  onSearchSelectActive: () => void
  onSearchHighlight: (record: HomeSessionRecord) => void
  onSearchSelect: (record: HomeSessionRecord, options?: OpenSessionOptions) => void
}

// Session store updates recreate row components, so row-local state would
// close an open context menu or drop an in-progress rename. Keep both keyed
// by session ID at the view root, like the projects list does.
type HomeSessionRowUI = {
  menu: { id: string; x: number; y: number } | undefined
  editor: { id: string; draft: string; renaming: boolean } | undefined
}

export function HomeSessionsView(props: HomeSessionsViewProps) {
  const [rowUI, setRowUI] = createStore<HomeSessionRowUI>({ menu: undefined, editor: undefined })
  const [hover, setHover] = createStore<{ sessionID: string | undefined }>({ sessionID: undefined })
  const showLocations = createAltHold(props.desktop, props.onRevealLocations)

  return (
    <section
      ref={props.onSetHoverTarget}
      class="min-h-0 min-w-0 flex-1 flex flex-col"
      aria-label={props.language.t("sidebar.project.recentSessions")}
    >
      <div
        class="sticky top-0 z-30 shrink-0 bg-v2-background-bg-base pb-2 pt-6 md:pb-2.5 lg:pt-12"
        onWheel={props.onWheel}
      >
        <HomeSessionSearch
          {...props}
          showLocations={showLocations()}
          hoveredSession={hover.sessionID}
          onHoverSession={(sessionID) => setHover("sessionID", sessionID)}
        />
        <HomeSessionOrganizeToolbar {...props} />
        <Show when={props.organize.selection.active()}>
          <HomeSessionBulkBar {...props} />
        </Show>
      </div>
      <div class="pointer-events-none sticky top-[104px] z-40 h-0 -mr-3 md:top-[116px] lg:top-[140px]">
        <div
          ref={props.onSetThumbTrack}
          data-component="home-session-scroll-track"
          class="relative ml-auto h-[calc(100cqh-104px)] w-3 md:h-[calc(100cqh-116px)] lg:h-[calc(100cqh-140px)]"
        />
      </div>
      <div class="-mr-3 min-h-[calc(100cqh-100px)] md:min-h-[calc(100cqh-108px)] lg:min-h-[calc(100cqh-132px)]">
        <Show
          when={!props.loading}
          fallback={
            <div class="pt-1 md:pt-3">
              <HomeSessionSkeleton label={props.language.t("common.loading")} />
            </div>
          }
        >
          <Show
            when={props.groups.length > 0}
            fallback={
              <HomeSessionsEmpty
                onNewSession={props.canCreateSession ? props.onCreateSession : undefined}
                language={props.language}
                organize={props.organize}
              />
            }
          >
            <div ref={props.onSetContent} class="flex flex-col pt-1 pr-3 pb-16 md:pt-2">
              {/* Index keeps group subtrees mounted when the group arrays are
                  rebuilt, so store updates cannot recreate rows mid-gesture. */}
              <Index each={props.groups}>
                {(group, index) => (
                  <>
                    <HomeSessionGroupHeader
                      title={group().title}
                      titleOpacity={props.titleOpacity(group().id)}
                      onSetRef={(element) => props.onSetHeader(group().id, element)}
                      elevated={index === 0}
                    />
                    <div
                      class={`flex min-w-0 flex-col gap-px pt-1.5 md:pt-2.5 ${index === props.groups.length - 1 ? "" : "mb-5"}`}
                    >
                      {/* Rows key by session ID: session.sync replaces the
                          stored session object wholesale, so reference-keyed
                          rows would be disposed mid-interaction whenever a
                          sync response lands. */}
                      <Key each={group().sessions} by={(record) => record.session.id}>
                        {(record) => (
                          <HomeSessionRow
                            {...props}
                            record={record()}
                            rowUI={rowUI}
                            setRowUI={setRowUI}
                            showLocations={showLocations()}
                            hoveredSession={hover.sessionID}
                            onHoverSession={(sessionID) => setHover("sessionID", sessionID)}
                          />
                        )}
                      </Key>
                    </div>
                  </>
                )}
              </Index>
            </div>
          </Show>
        </Show>
      </div>
    </section>
  )
}

function HomeSessionOrganizeToolbar(props: HomeSessionsViewProps) {
  const mode = () => props.organize.mode()
  const groupBy = () => props.organize.groupBy()
  const activeFolder = () => props.organize.activeFolder()
  const activeTag = () => props.organize.tag()

  const groupByLabel = () => {
    const current = groupBy()

    if (current === "project") return props.language.t("home.sessions.groupBy.project")

    if (current === "folder") return props.language.t("home.sessions.groupBy.folder")

    return props.language.t("home.sessions.groupBy.date")
  }

  return (
    <div
      data-component="home-session-organize-toolbar"
      class="mt-2 flex flex-wrap items-center justify-between gap-2"
    >
      <div class="flex min-w-0 flex-wrap items-center gap-1">
        <div
          role="tablist"
          aria-label={props.language.t("home.organize.section")}
          class="flex items-center gap-0.5 rounded-[6px] bg-v2-background-bg-layer-02/50 p-0.5"
        >
          <button
            type="button"
            role="tab"
            data-action="home-filter-active"
            aria-selected={mode() === "active"}
            class="flex h-6 items-center gap-1.5 rounded-[5px] px-2 text-[13px] leading-4 transition-colors"
            classList={{
              "bg-v2-background-bg-layer-03 text-v2-text-text-base [font-weight:530]": mode() === "active",
              "text-v2-text-text-muted hover:text-v2-text-text-base [font-weight:440]": mode() !== "active",
            }}
            onClick={() => props.organize.setMode("active")}
          >
            <span>{props.language.t("home.sessions.filter.active")}</span>
            <Show when={props.counts.active > 0}>
              <span class="text-[11px] leading-4 text-v2-text-text-faint">{props.counts.active}</span>
            </Show>
          </button>
          <button
            type="button"
            role="tab"
            data-action="home-filter-pinned"
            aria-selected={mode() === "pinned"}
            class="flex h-6 items-center gap-1 rounded-[5px] px-2 text-[13px] leading-4 transition-colors"
            classList={{
              "bg-v2-background-bg-layer-03 text-v2-text-text-base [font-weight:530]": mode() === "pinned",
              "text-v2-text-text-muted hover:text-v2-text-text-base [font-weight:440]": mode() !== "pinned",
            }}
            onClick={() => props.organize.setMode("pinned")}
          >
            <Icon name="pin" size="small" class="shrink-0" />
            <span>{props.language.t("home.sessions.filter.pinned")}</span>
            <Show when={props.counts.pinned > 0}>
              <span class="text-[11px] leading-4 text-v2-text-text-faint">{props.counts.pinned}</span>
            </Show>
          </button>
          <button
            type="button"
            role="tab"
            data-action="home-filter-archived"
            aria-selected={mode() === "archived"}
            class="flex h-6 items-center gap-1 rounded-[5px] px-2 text-[13px] leading-4 transition-colors"
            classList={{
              "bg-v2-background-bg-layer-03 text-v2-text-text-base [font-weight:530]": mode() === "archived",
              "text-v2-text-text-muted hover:text-v2-text-text-base [font-weight:440]": mode() !== "archived",
            }}
            onClick={() => props.organize.setMode("archived")}
          >
            <Icon name="archive" size="small" class="shrink-0" />
            <span>{props.language.t("home.sessions.filter.archived")}</span>
            <Show when={props.counts.archived > 0}>
              <span class="text-[11px] leading-4 text-v2-text-text-faint">{props.counts.archived}</span>
            </Show>
          </button>
        </div>

        <Show when={activeFolder()}>
          {(folder) => (
            <button
              type="button"
              data-action="home-clear-folder-filter"
              aria-label={props.language.t("home.sessions.filter.clearFolder")}
              class={`flex h-6 items-center gap-1 rounded-[5px] border px-2 text-[12px] leading-4 ${ORGANIZE_COLOR_STYLES[folder().color].pill}`}
              onClick={() => props.organize.clearFolder()}
            >
              <Icon name="folder" size="small" class="shrink-0" />
              <span class="max-w-32 truncate">{folder().name}</span>
              <Icon name="xmark-small" size="small" class="shrink-0" />
            </button>
          )}
        </Show>

        <Show when={activeTag()}>
          {(tag) => (
            <button
              type="button"
              data-action="home-clear-tag-filter"
              aria-label={props.language.t("home.sessions.filter.clearTag")}
              class={`flex h-6 items-center gap-1 rounded-[5px] border px-2 text-[12px] leading-4 ${ORGANIZE_COLOR_STYLES[props.organize.tagColor(tag())].pill}`}
              onClick={() => props.organize.clearTag()}
            >
              <span class="max-w-32 truncate">#{tag()}</span>
              <Icon name="xmark-small" size="small" class="shrink-0" />
            </button>
          )}
        </Show>
      </div>

      <div class="flex shrink-0 items-center gap-1">
        <Menu modal={false} placement="bottom-end" gutter={4}>
          <Menu.Trigger
            as="button"
            type="button"
            data-action="home-group-by"
            class="flex h-7 items-center gap-1 rounded-[6px] px-2 text-[13px] leading-4 text-v2-text-text-muted hover:bg-v2-background-bg-layer-02 hover:text-v2-text-text-base"
          >
            <Icon name="outline-sliders" size="small" class="shrink-0 text-v2-icon-icon-muted" />
            <span>{groupByLabel()}</span>
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Content>
              <Menu.GroupLabel>{props.language.t("home.sessions.groupBy.label")}</Menu.GroupLabel>
              <Menu.CheckboxItem
                checked={groupBy() === "date"}
                onChange={() => props.organize.setGroupBy("date")}
              >
                {props.language.t("home.sessions.groupBy.date")}
              </Menu.CheckboxItem>
              <Menu.CheckboxItem
                checked={groupBy() === "project"}
                onChange={() => props.organize.setGroupBy("project")}
              >
                {props.language.t("home.sessions.groupBy.project")}
              </Menu.CheckboxItem>
              <Menu.CheckboxItem
                checked={groupBy() === "folder"}
                onChange={() => props.organize.setGroupBy("folder")}
              >
                {props.language.t("home.sessions.groupBy.folder")}
              </Menu.CheckboxItem>
            </Menu.Content>
          </Menu.Portal>
        </Menu>

        <button
          type="button"
          data-action="home-select-toggle"
          aria-pressed={props.organize.selection.active()}
          class="flex h-7 items-center gap-1 rounded-[6px] px-2 text-[13px] leading-4 transition-colors"
          classList={{
            "bg-v2-background-bg-layer-03 text-v2-text-text-base [font-weight:530]":
              props.organize.selection.active(),
            "text-v2-text-text-muted hover:bg-v2-background-bg-layer-02 hover:text-v2-text-text-base":
              !props.organize.selection.active(),
          }}
          onClick={() => props.organize.selection.toggleMode()}
        >
          <Icon name="checklist" size="small" class="shrink-0" />
          <span>
            {props.language.t(
              props.organize.selection.active() ? "home.sessions.selectDone" : "home.sessions.select",
            )}
          </span>
        </button>

        <Show when={props.canCreateSession}>
          <Button
            data-action="home-new-session"
            variant="ghost-muted"
            size="normal"
            icon="edit"
            class="h-7 px-2 [font-weight:530]"
            onClick={props.onCreateSession}
          >
            {props.language.t("command.session.new")}
          </Button>
        </Show>
      </div>
    </div>
  )
}

function HomeSessionBulkBar(props: HomeSessionsViewProps) {
  const count = () => props.organize.selection.count()
  const isArchivedMode = () => props.organize.mode() === "archived"

  return (
    <div
      data-component="home-session-bulk-bar"
      class="mt-2 flex flex-wrap items-center justify-between gap-2 rounded-[8px] border border-v2-border-border-base bg-v2-background-bg-layer-02 px-2.5 py-1.5"
    >
      <div class="flex items-center gap-2">
        <button
          type="button"
          data-action="home-bulk-select-all"
          class="flex h-6 items-center gap-1.5 rounded-[5px] px-2 text-[13px] leading-4 text-v2-text-text-base hover:bg-v2-background-bg-layer-03 [font-weight:530]"
          onClick={() => props.organize.selection.selectAll()}
        >
          <Icon name="check-small" size="small" />
          <span>{props.language.t("home.sessions.selectAll")}</span>
        </button>
        <span class="text-[13px] leading-4 text-v2-text-text-muted">
          {props.language.plural("home.sessions.selected", count())}
        </span>
      </div>

      <div class="flex flex-wrap items-center gap-1">
        <Menu modal={false} placement="bottom-end" gutter={4}>
          <Menu.Trigger
            as="button"
            type="button"
            disabled={count() === 0}
            data-action="home-bulk-assign-project"
            class="flex h-6 items-center gap-1 rounded-[5px] px-2 text-[13px] leading-4 text-v2-text-text-base hover:bg-v2-background-bg-layer-03 disabled:opacity-40"
          >
            <Icon name="folder" size="small" class="text-v2-icon-icon-muted" />
            <span>{props.language.t("session.organize.assignProject")}</span>
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Content class="max-h-72 overflow-y-auto">
              <For each={props.organize.projects()}>
                {(project) => (
                  <Menu.Item onSelect={() => props.organize.selection.bulkAssignProject(project.worktree)}>
                    <span class="flex items-center gap-2">
                      <ProjectAvatar
                        fallback={displayName(project)}
                        src={getProjectAvatarSource(project.id, project.icon)}
                        variant={getProjectAvatarVariant(project.icon?.color)}
                      />
                      <span class="truncate">{displayName(project)}</span>
                    </span>
                  </Menu.Item>
                )}
              </For>
              <Show when={props.organize.projects().length > 0}>
                <Menu.Separator />
              </Show>
              <Menu.Item onSelect={() => props.organize.selection.bulkChooseDirectory()}>
                {props.language.t("session.organize.chooseDirectory")}
              </Menu.Item>
            </Menu.Content>
          </Menu.Portal>
        </Menu>

        <Menu modal={false} placement="bottom-end" gutter={4}>
          <Menu.Trigger
            as="button"
            type="button"
            disabled={count() === 0}
            data-action="home-bulk-move-folder"
            class="flex h-6 items-center gap-1 rounded-[5px] px-2 text-[13px] leading-4 text-v2-text-text-base hover:bg-v2-background-bg-layer-03 disabled:opacity-40"
          >
            <Icon name="folder-add-left" size="small" class="text-v2-icon-icon-muted" />
            <span>{props.language.t("session.organize.moveToFolder")}</span>
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Content class="max-h-72 overflow-y-auto">
              <For each={props.organize.folders()}>
                {(folder) => (
                  <Menu.Item onSelect={() => props.organize.selection.bulkAssignFolder(folder.id)}>
                    <span class="flex items-center gap-2">
                      <Icon name="folder" size="small" class={ORGANIZE_COLOR_STYLES[folder.color].text} />
                      <span class="truncate">{folder.name}</span>
                    </span>
                  </Menu.Item>
                )}
              </For>
              <Show when={props.organize.folders().length > 0}>
                <Menu.Item onSelect={() => props.organize.selection.bulkAssignFolder(undefined)}>
                  {props.language.t("session.organize.removeFromFolder")}
                </Menu.Item>
                <Menu.Separator />
              </Show>
              <Menu.Item onSelect={() => props.organize.selection.bulkCreateFolder()}>
                {props.language.t("session.organize.newFolder")}
              </Menu.Item>
            </Menu.Content>
          </Menu.Portal>
        </Menu>

        <Menu modal={false} placement="bottom-end" gutter={4}>
          <Menu.Trigger
            as="button"
            type="button"
            disabled={count() === 0}
            data-action="home-bulk-tags"
            class="flex h-6 items-center gap-1 rounded-[5px] px-2 text-[13px] leading-4 text-v2-text-text-base hover:bg-v2-background-bg-layer-03 disabled:opacity-40"
          >
            <Icon name="tag" size="small" class="text-v2-icon-icon-muted" />
            <span>{props.language.t("session.organize.tags")}</span>
          </Menu.Trigger>
          <Menu.Portal>
            <Menu.Content class="max-h-72 overflow-y-auto">
              <For each={props.organize.allTags()}>
                {(tag) => (
                  <Menu.Item onSelect={() => props.organize.selection.bulkToggleTag(tag)}>
                    <span class="flex items-center gap-2">
                      <span class={`size-2 rounded-full ${ORGANIZE_COLOR_STYLES[props.organize.tagColor(tag)].dot}`} />
                      <span class="truncate">#{tag}</span>
                    </span>
                  </Menu.Item>
                )}
              </For>
              <Show when={props.organize.allTags().length > 0}>
                <Menu.Separator />
              </Show>
              <Menu.Item onSelect={() => props.organize.selection.bulkCreateTag()}>
                {props.language.t("session.organize.newTag")}
              </Menu.Item>
            </Menu.Content>
          </Menu.Portal>
        </Menu>

        <button
          type="button"
          disabled={count() === 0}
          data-action="home-bulk-pin"
          class="flex h-6 items-center gap-1 rounded-[5px] px-2 text-[13px] leading-4 text-v2-text-text-base hover:bg-v2-background-bg-layer-03 disabled:opacity-40"
          onClick={() => props.organize.selection.bulkPin(true)}
        >
          <Icon name="pin" size="small" class="text-v2-icon-icon-muted" />
          <span>{props.language.t("session.organize.pin")}</span>
        </button>

        <button
          type="button"
          disabled={count() === 0}
          data-action="home-bulk-archive"
          class="flex h-6 items-center gap-1 rounded-[5px] px-2 text-[13px] leading-4 text-v2-text-text-base hover:bg-v2-background-bg-layer-03 disabled:opacity-40"
          onClick={() => props.organize.selection.bulkArchive()}
        >
          <Icon name={isArchivedMode() ? "archive-restore" : "archive"} size="small" class="text-v2-icon-icon-muted" />
          <span>
            {props.language.t(isArchivedMode() ? "session.organize.unarchive" : "session.organize.archive")}
          </span>
        </button>
      </div>
    </div>
  )
}

function HomeSessionLeadingController(props: {
  server: HomeSessionsViewProps["server"]
  isOpenTab: HomeSessionsViewProps["isOpenTab"]
  record: HomeSessionRecord
}) {
  return (
    <HomeSessionStatusController
      server={props.server}
      record={props.record}
      isOpenTab={props.isOpenTab}
      render={(state) => (
        <HomeSessionLeading
          record={props.record}
          open={state.open()}
          unread={state.unread()}
          loading={state.loading()}
        />
      )}
    />
  )
}

function HomeSessionLeading(props: { record: HomeSessionRecord; open: boolean; unread: boolean; loading: boolean }) {
  return (
    <div class="relative shrink-0">
      <Show when={props.open}>
        <span
          aria-hidden="true"
          class={`
            pointer-events-none absolute top-1/2 h-3 w-0.5 -translate-y-1/2
            rounded-[2px] bg-v2-background-bg-layer-04
          `}
          style={{ right: "calc(100% + 4px)" }}
        />
      </Show>
      <SessionTabAvatarView
        project={props.record.project}
        directory={props.record.session.location.directory}
        unread={props.unread}
        loading={props.loading}
      />
    </div>
  )
}

function HomeSessionSearch(
  props: HomeSessionsViewProps & {
    showLocations: boolean
    hoveredSession: string | undefined
    onHoverSession: (sessionID: string | undefined) => void
  },
) {
  return (
    <div class="w-full">
      <div ref={props.onSetSearchRoot} data-component="home-session-search" class="relative z-30 w-full">
        <Show when={props.searchOpen}>
          <div
            data-component="home-session-search-panel"
            class={`
              absolute flex flex-col overflow-hidden rounded-[12px]
              bg-v2-background-bg-base shadow-[var(--v2-elevation-floating)]
            `}
            style={{
              top: "-6px",
              "inset-inline-start": "-6px",
              width: "calc(100% + 12px)",
            }}
          >
            <div class="flex flex-col pt-9">
              <div id={HOME_SESSION_SEARCH_RESULTS_ID} role="listbox" class="flex flex-col gap-4 pt-4">
                <Show
                  when={!props.searchLoading}
                  fallback={
                    <div class="flex items-center justify-center px-4 py-3 text-v2-text-text-muted [font-weight:440]">
                      <Spinner class="size-4" />
                    </div>
                  }
                >
                  <Show
                    when={props.searchResults.length > 0}
                    fallback={
                      <p
                        class={`
                          my-1.5 px-4 pb-2 text-[13px] leading-4 tracking-[-0.04px]
                          text-v2-text-text-muted [font-weight:440]
                        `}
                      >
                        {props.searchNoResultsLabel}
                      </p>
                    }
                  >
                    <div class="flex flex-col">
                      <p
                        class={`
                          my-1.5 pl-[18px] pr-6 text-[13px] leading-4 tracking-[-0.04px]
                          text-v2-text-text-muted [font-weight:440]
                        `}
                      >
                        {props.language.t("home.sessions.search.sessions")}
                      </p>
                      <ScrollView class="max-h-[min(20rem,40dvh)]" viewportRef={props.onSetSearchList}>
                        <div class="flex flex-col gap-px pb-2">
                          <For each={props.searchResults}>
                            {(record) => (
                              <HomeSessionSearchResultRow
                                {...props}
                                record={record}
                                selected={props.searchActive === homeSessionSearchKey(record)}
                              />
                            )}
                          </For>
                        </div>
                      </ScrollView>
                    </div>
                  </Show>
                </Show>
              </div>
            </div>
          </div>
        </Show>
        <label
          class={`
            relative z-20 flex h-9 w-full items-center gap-2 rounded-[6px] py-1 ps-3 pe-2
            bg-v2-background-bg-layer-02/60 text-v2-icon-icon-muted transition-[background-color,box-shadow]
            duration-[120ms] ease-in-out hover:bg-v2-background-bg-layer-02 focus-within:bg-v2-background-bg-layer-02
          `}
        >
          <Icon name="magnifying-glass" />
          <input
            ref={props.onSetSearchInput}
            class={`
              relative z-20 min-w-0 flex-1 border-0 bg-transparent outline-0
              text-v2-text-text-base [font-weight:440] placeholder:text-v2-text-text-faint
            `}
            value={props.searchValue}
            placeholder={props.searchPlaceholder}
            aria-label={props.searchPlaceholder}
            aria-expanded={props.searchOpen}
            aria-controls={HOME_SESSION_SEARCH_RESULTS_ID}
            aria-autocomplete="list"
            aria-activedescendant={
              props.searchActive && props.searchOpen ? `home-session-search-option-${props.searchActive}` : undefined
            }
            onFocus={props.onSearchFocus}
            onInput={(event) => props.onSearchInput(event.currentTarget.value)}
            onKeyDown={(event) => {
              if (event.key === "Escape") {
                event.preventDefault()
                props.onSearchClose()
                event.currentTarget.blur()

                return
              }

              if (!props.searchOpen || props.searchResults.length === 0) return

              if (event.altKey || event.metaKey) return

              if (event.key === "ArrowDown") {
                event.preventDefault()
                props.onSearchMove(1)

                return
              }

              if (event.key === "ArrowUp") {
                event.preventDefault()
                props.onSearchMove(-1)

                return
              }

              if (event.key === "Enter" && !event.isComposing) {
                event.preventDefault()
                props.onSearchSelectActive()
              }
            }}
          />
          <Show when={props.searchValue}>
            <IconButton
              type="button"
              variant="ghost-muted"
              size="small"
              class="relative z-20 shrink-0"
              icon={<Icon name="close" size="large" class="text-v2-icon-icon-muted" />}
              aria-label={props.searchPlaceholder}
              onClick={() => {
                props.onSearchClose()
                props.onSearchFocus()
              }}
            />
          </Show>
        </label>
      </div>
    </div>
  )
}

function HomeSessionSearchResultRow(
  props: HomeSessionsViewProps & {
    record: HomeSessionRecord
    selected: boolean
    showLocations: boolean
    hoveredSession: string | undefined
    onHoverSession: (sessionID: string | undefined) => void
  },
) {
  const title = createMemo(() => sessionLabel(props.record.session))
  const location = createMemo(() => props.location(props.record))
  const showProjectName = () => props.showProjectName && props.record.projectName
  const key = () => homeSessionSearchKey(props.record)

  return (
    <button
      type="button"
      id={`home-session-search-option-${key()}`}
      data-key={key()}
      data-component="home-session-search-row"
      data-project-name={!!showProjectName()}
      role="option"
      aria-selected={props.selected}
      class={`
        flex h-10 w-full shrink-0 cursor-default items-center border-0 py-3 pl-[18px] pr-6 text-left
        transition-[background-color] duration-[120ms] ease-in-out
        hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none
      `}
      classList={{
        "bg-v2-overlay-simple-overlay-hover": props.selected,
        "gap-1.5": props.desktop,
        "gap-2": !props.desktop,
      }}
      onMouseEnter={() => {
        props.onSearchHighlight(props.record)
        props.onHoverSession(props.record.session.id)
        props.onRevealLocations(props.record)
      }}
      onMouseLeave={() => props.onHoverSession(undefined)}
      onMouseDown={(event) => {
        if (event.button === 1) event.preventDefault()
      }}
      onClick={(event) => props.onSearchSelect(props.record, { background: isBackgroundOpen(event) })}
      onAuxClick={(event) => {
        if (!isBackgroundOpen(event)) return
        event.preventDefault()
        props.onSearchSelect(props.record, { background: true })
      }}
    >
      <HomeSessionLeadingController server={props.server} isOpenTab={props.isOpenTab} record={props.record} />
      <div data-slot="home-session-labels" class="flex min-w-0 flex-1 items-center gap-1.5">
        <HomeSessionTitle title={title()} showProjectName={!!showProjectName()} search />
        <Show when={showProjectName()}>
          <HomeSessionProjectName name={props.record.projectName} trailing={props.desktop} search />
        </Show>
        <HomeSessionLocation
          location={location()}
          show={props.showLocations || props.hoveredSession === props.record.session.id}
          instantHide={
            !props.showLocations &&
            props.hoveredSession !== undefined &&
            props.hoveredSession !== props.record.session.id
          }
          desktop={props.desktop}
        />
      </div>
    </button>
  )
}

function HomeSessionGroupHeader(props: {
  title: string
  titleOpacity: number
  onSetRef: (element: HTMLDivElement) => void
  elevated?: boolean
}) {
  return (
    <div
      ref={props.onSetRef}
      class={`
        pointer-events-none sticky top-[104px] flex h-7 min-w-0 items-center justify-between
        bg-v2-background-bg-base ps-1.5 md:ps-3 md:top-[116px] lg:top-[140px]
      `}
      classList={{ "home-session-group-header z-[5]": !!props.elevated, "z-10": !props.elevated }}
    >
      <div class={HOME_SECTION_LABEL} style={{ opacity: props.titleOpacity }}>
        {props.title}
      </div>
    </div>
  )
}

function HomeSessionRow(
  props: HomeSessionsViewProps & {
    record: HomeSessionRecord
    rowUI: HomeSessionRowUI
    setRowUI: SetStoreFunction<HomeSessionRowUI>
    showLocations: boolean
    hoveredSession: string | undefined
    onHoverSession: (sessionID: string | undefined) => void
  },
) {
  const title = createMemo(() => sessionLabel(props.record.session))
  const location = createMemo(() => props.location(props.record))
  const showProjectName = () => props.showProjectName && props.record.projectName
  const sessionID = () => props.record.session.id
  const pinned = () => props.organize.isPinned(sessionID())
  const archived = () => props.organize.isArchived(props.record.session)
  const folder = () => props.organize.folderForSession(sessionID())
  const tags = () => props.organize.tagsForSession(sessionID())
  const selecting = () => props.organize.selection.active()
  const selected = () => props.organize.selection.isSelected(sessionID())
  const menu = () => (props.rowUI.menu?.id === sessionID() ? props.rowUI.menu : undefined)
  const editor = () => (props.rowUI.editor?.id === sessionID() ? props.rowUI.editor : undefined)
  let longPressTimer: ReturnType<typeof setTimeout> | undefined
  let longPressStart: { x: number; y: number } | undefined
  let suppressClick = false
  let menuInteractedOutside = false

  // Focus targets are looked up by session ID: session store updates recreate
  // row components, so instance refs can point at detached nodes by the time
  // deferred focus runs.
  const rowSelector = () => `[data-component="home-session-row-container"][data-session-id="${sessionID()}"]`

  const rowButton = () =>
    document.querySelector<HTMLButtonElement>(`${rowSelector()} [data-component="home-session-row"]`)

  const renameInput = () =>
    document.querySelector<HTMLInputElement>(`${rowSelector()} [data-component="home-session-rename"]`)

  const clearLongPress = () => {
    if (longPressTimer !== undefined) clearTimeout(longPressTimer)
    longPressTimer = undefined
    longPressStart = undefined
  }

  onCleanup(clearLongPress)

  const openMenu = (element: HTMLElement, clientX: number, clientY: number) => {
    const bounds = element.getBoundingClientRect()
    props.setRowUI("menu", { id: sessionID(), x: clientX - bounds.left, y: clientY - bounds.top })
  }

  const openEditor = () => {
    props.setRowUI("editor", { id: sessionID(), draft: title(), renaming: false })
    requestAnimationFrame(() => {
      const input = renameInput()
      input?.focus()
      input?.select()
    })
  }

  const closeEditor = () => {
    if (editor()?.renaming) return
    props.setRowUI("editor", (value) => (value?.id === sessionID() ? undefined : value))
  }

  const saveEditor = async () => {
    const current = editor()

    if (!current || current.renaming) return
    props.setRowUI("editor", { ...current, renaming: true })
    const saved = await props.onRenameSession(props.server, props.record.session, current.draft)
    // Disabling the input during the request drops focus to the body; restore
    // it unless the user focused another control while the rename was pending.
    const restore = document.activeElement === document.body || document.activeElement === renameInput()
    props.setRowUI("editor", (value) => {
      if (value?.id !== sessionID()) return value

      return saved ? undefined : { ...value, renaming: false }
    })

    if (!restore) return
    requestAnimationFrame(() => {
      if (saved) {
        rowButton()?.focus()

        return
      }

      renameInput()?.focus()
    })
  }

  return (
    <div
      data-component="home-session-row-container"
      data-project-name={!!showProjectName()}
      data-session-id={props.record.session.id}
      data-pinned={pinned() ? "" : undefined}
      data-selected={selected() ? "" : undefined}
      draggable={!editor()}
      class="group/session relative flex h-10 min-w-0 items-center rounded-[6px] outline-none focus:outline-none focus-visible:outline-none"
      classList={{
        "bg-v2-background-bg-layer-02/70": selected(),
      }}
      onDragStart={(event) => {
        if (editor()) {
          event.preventDefault()

          return
        }

        const ids = props.organize.setDraggingSessions(sessionID())
        event.dataTransfer?.setData("application/x-opencode-sessions", JSON.stringify(ids))
        event.dataTransfer?.setData("text/plain", ids.join(","))

        if (event.dataTransfer) event.dataTransfer.effectAllowed = "move"
      }}
      onDragEnd={() => props.organize.clearDraggingSessions()}
      onContextMenu={(event) => {
        // While renaming, keep the native menu so paste and spelling work.
        if (editor()) return
        event.preventDefault()
        openMenu(event.currentTarget, event.clientX, event.clientY)
      }}
    >
      <Show
        when={!editor()}
        fallback={
          <div
            data-slot="home-session-editor"
            class="flex h-10 min-w-0 w-full flex-1 items-center py-3 ps-1.5 pe-3 md:ps-3 md:pe-24"
            classList={{ "gap-1.5": props.desktop, "gap-2": !props.desktop }}
          >
            <HomeSessionLeadingController server={props.server} isOpenTab={props.isOpenTab} record={props.record} />
            <div data-slot="home-session-labels" class="contents">
              <InlineInput
                data-component="home-session-rename"
                aria-label={props.language.t("common.rename")}
                dir="auto"
                value={editor()?.draft ?? ""}
                disabled={editor()?.renaming ?? false}
                class={`
                block min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-v2-text-text-base
                [font-weight:530] field-sizing-content outline-none focus:outline-none focus-visible:outline-none
                 ${showProjectName() ? "max-w-[min(70%,480px)] flex-[0_1_auto]" : "flex-[1_1_auto]"}
              `}
                style={{ "--inline-input-shadow": "none", "text-align": "start" }}
                onInput={(event) => {
                  const draft = event.currentTarget.value
                  props.setRowUI("editor", (value) => (value?.id === sessionID() ? { ...value, draft } : value))
                }}
                onKeyDown={(event) => {
                  event.stopPropagation()

                  // Enter and Escape during IME composition commit or cancel
                  // the composition, not the rename. Safari can report the
                  // composition-confirming keydown with isComposing false but
                  // keyCode 229.
                  if (event.isComposing || event.keyCode === 229) return

                  if (event.key === "Enter") {
                    event.preventDefault()
                    void saveEditor()

                    return
                  }

                  if (event.key !== "Escape") return
                  event.preventDefault()
                  closeEditor()
                  requestAnimationFrame(() => rowButton()?.focus())
                }}
                onBlur={closeEditor}
              />
              <Show when={showProjectName()}>
                <HomeSessionProjectName name={props.record.projectName} />
              </Show>
            </div>
          </div>
        }
      >
        <button
          type="button"
          data-component="home-session-row"
          aria-haspopup="menu"
          aria-expanded={!!menu()}
          class={`
            flex h-10 min-w-0 w-full flex-1 shrink-0 cursor-default items-center rounded-[6px] border-0
            bg-transparent py-3 ps-1.5 pe-3 md:ps-3 md:pe-24 text-start text-v2-text-text-muted [font-weight:530]
            transition-[background-color,color,box-shadow] duration-[120ms] ease-in-out
            hover:bg-v2-overlay-simple-overlay-hover focus-visible:bg-v2-overlay-simple-overlay-hover focus-visible:outline-none
          `}
          classList={{ "gap-1.5": props.desktop, "gap-2": !props.desktop }}
          onMouseDown={(event) => {
            if (event.button === 1) event.preventDefault()
          }}
          onMouseEnter={() => {
            props.onHoverSession(props.record.session.id)
            props.onRevealLocations(props.record)
          }}
          onMouseLeave={() => props.onHoverSession(undefined)}
          onPointerDown={(event) => {
            suppressClick = false

            if (event.pointerType !== "touch") return
            clearLongPress()
            const element = event.currentTarget
            const x = event.clientX
            const y = event.clientY
            longPressStart = { x, y }
            longPressTimer = setTimeout(() => {
              suppressClick = true
              clearLongPress()
              openMenu(element, x, y)
            }, HOME_SESSION_LONG_PRESS_MS)
          }}
          onPointerMove={(event) => {
            if (!longPressStart) return

            if (Math.abs(event.clientX - longPressStart.x) <= 8 && Math.abs(event.clientY - longPressStart.y) <= 8)
              return
            clearLongPress()
          }}
          onPointerUp={clearLongPress}
          onPointerCancel={() => {
            clearLongPress()
            suppressClick = false
          }}
          onKeyDown={(event) => {
            if (event.key !== "ContextMenu" && (event.key !== "F10" || !event.shiftKey)) return
            event.preventDefault()
            const bounds = event.currentTarget.getBoundingClientRect()
            openMenu(event.currentTarget, bounds.left + 12, bounds.bottom)
          }}
          onClick={(event) => {
            // The flag stays set until the long-press compatibility click
            // arrives, however delayed; keyboard activation (detail 0) is
            // never that click and passes through.
            if (suppressClick) {
              suppressClick = false

              if (event.detail !== 0) {
                event.preventDefault()

                return
              }
            }

            if (selecting()) {
              event.preventDefault()
              props.organize.selection.toggle(sessionID())

              return
            }

            props.onOpenSession(props.record.session, { background: isBackgroundOpen(event) })
          }}
          onAuxClick={(event) => {
            if (!isBackgroundOpen(event)) return
            event.preventDefault()
            props.onOpenSession(props.record.session, { background: true })
          }}
        >
          <Show when={selecting()}>
            <span
              aria-hidden="true"
              class="flex size-4 shrink-0 items-center justify-center rounded-[4px] border transition-colors"
              classList={{
                "border-v2-text-text-base bg-v2-text-text-base text-v2-background-bg-base": selected(),
                "border-v2-border-border-muted bg-transparent": !selected(),
              }}
            >
              <Show when={selected()}>
                <Icon name="check" size="small" />
              </Show>
            </span>
          </Show>
          <HomeSessionLeadingController server={props.server} isOpenTab={props.isOpenTab} record={props.record} />
          <div
            data-slot="home-session-labels"
            class="min-w-0 flex-1 items-center gap-1.5"
            classList={{ flex: props.desktop, contents: !props.desktop }}
          >
            <Show when={pinned()}>
              <Icon
                name="pin-filled"
                size="small"
                class="shrink-0 text-v2-icon-icon-muted"
                aria-label={props.language.t("session.organize.unpin")}
              />
            </Show>
            <HomeSessionTitle title={title()} showProjectName={!!showProjectName()} />
            <Show when={folder() && props.organize.groupBy() !== "folder" ? folder() : undefined}>
              {(item) => (
                <span
                  data-slot="home-session-folder-badge"
                  class={`inline-flex h-5 shrink-0 items-center gap-1 rounded-[4px] border px-1.5 text-[11px] leading-4 ${ORGANIZE_COLOR_STYLES[item().color].pill}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    props.organize.setFolderID(item().id)
                  }}
                >
                  <Icon name="folder" size="small" class="size-3 shrink-0" />
                  <span class="max-w-24 truncate">{item().name}</span>
                </span>
              )}
            </Show>
            <For each={tags()}>
              {(tag) => (
                <span
                  data-slot="home-session-tag-badge"
                  class={`inline-flex h-5 shrink-0 items-center rounded-[4px] border px-1.5 text-[11px] leading-4 ${ORGANIZE_COLOR_STYLES[props.organize.tagColor(tag)].pill}`}
                  onClick={(event) => {
                    event.stopPropagation()
                    props.organize.setTag(tag)
                  }}
                >
                  <span class="max-w-20 truncate">#{tag}</span>
                </span>
              )}
            </For>
            <Show when={showProjectName()}>
              <HomeSessionProjectName name={props.record.projectName} trailing={props.desktop} />
            </Show>
            <HomeSessionLocation
              location={location()}
              show={props.showLocations || props.hoveredSession === props.record.session.id}
              instantHide={
                !props.showLocations &&
                props.hoveredSession !== undefined &&
                props.hoveredSession !== props.record.session.id
              }
              desktop={props.desktop}
            />
          </div>
        </button>
      </Show>
      <Menu
        modal={false}
        placement="bottom-start"
        gutter={2}
        open={!!menu()}
        onOpenChange={(open) => {
          if (open) return
          props.setRowUI("menu", (value) => (value?.id === sessionID() ? undefined : value))
        }}
      >
        <Menu.Trigger
          as="span"
          aria-hidden="true"
          tabIndex={-1}
          class="pointer-events-none absolute size-px"
          style={{ left: `${menu()?.x ?? 0}px`, top: `${menu()?.y ?? 0}px` }}
        />
        <Menu.Portal>
          <Menu.Content
            onInteractOutside={() => {
              menuInteractedOutside = true
            }}
            onCloseAutoFocus={(event) => {
              // The trigger is an invisible positioning span, so Kobalte's
              // default close focus restore has no useful target. Skip the
              // row focus when the rename editor owns focus or the user
              // dismissed the menu by interacting elsewhere.
              event.preventDefault()
              const outside = menuInteractedOutside
              menuInteractedOutside = false

              if (outside || editor()) return
              requestAnimationFrame(() => rowButton()?.focus())
            }}
          >
            <Menu.Item onSelect={() => props.organize.togglePin(props.record.session)}>
              {props.language.t(pinned() ? "session.organize.unpin" : "session.organize.pin")}
            </Menu.Item>

            <Menu.Sub>
              <Menu.SubTrigger>{props.language.t("session.organize.assignProject")}</Menu.SubTrigger>
              <Menu.Portal>
                <Menu.SubContent class="max-h-72 overflow-y-auto">
                  <For each={props.organize.projects()}>
                    {(project) => {
                      const isCurrent = () => pathKey(project.worktree) === pathKey(props.record.project.worktree)

                      return (
                        <Menu.CheckboxItem
                          checked={isCurrent()}
                          onChange={() => props.organize.assignProject(props.record.session, project.worktree)}
                        >
                          <span class="flex items-center gap-2">
                            <ProjectAvatar
                              fallback={displayName(project)}
                              src={getProjectAvatarSource(project.id, project.icon)}
                              variant={getProjectAvatarVariant(project.icon?.color)}
                            />
                            <span class="max-w-44 truncate">{displayName(project)}</span>
                          </span>
                        </Menu.CheckboxItem>
                      )
                    }}
                  </For>
                  <Show when={props.organize.projects().length > 0}>
                    <Menu.Separator />
                  </Show>
                  <Menu.Item onSelect={() => props.organize.chooseProjectDirectory(props.record.session)}>
                    {props.language.t("session.organize.chooseDirectory")}
                  </Menu.Item>
                </Menu.SubContent>
              </Menu.Portal>
            </Menu.Sub>

            <Menu.Sub>
              <Menu.SubTrigger>{props.language.t("session.organize.moveToFolder")}</Menu.SubTrigger>
              <Menu.Portal>
                <Menu.SubContent class="max-h-72 overflow-y-auto">
                  <For each={props.organize.folders()}>
                    {(item) => (
                      <Menu.CheckboxItem
                        checked={folder()?.id === item.id}
                        onChange={() =>
                          props.organize.assignFolder(
                            props.record.session,
                            folder()?.id === item.id ? undefined : item.id,
                          )
                        }
                      >
                        <span class="flex items-center gap-2">
                          <Icon name="folder" size="small" class={ORGANIZE_COLOR_STYLES[item.color].text} />
                          <span class="max-w-44 truncate">{item.name}</span>
                        </span>
                      </Menu.CheckboxItem>
                    )}
                  </For>
                  <Show when={folder()}>
                    <Menu.Item onSelect={() => props.organize.assignFolder(props.record.session, undefined)}>
                      {props.language.t("session.organize.removeFromFolder")}
                    </Menu.Item>
                  </Show>
                  <Show when={props.organize.folders().length > 0 || folder()}>
                    <Menu.Separator />
                  </Show>
                  <Menu.Item onSelect={() => props.organize.openCreateFolderDialog([sessionID()])}>
                    {props.language.t("session.organize.newFolder")}
                  </Menu.Item>
                </Menu.SubContent>
              </Menu.Portal>
            </Menu.Sub>

            <Menu.Sub>
              <Menu.SubTrigger>{props.language.t("session.organize.tags")}</Menu.SubTrigger>
              <Menu.Portal>
                <Menu.SubContent class="max-h-72 overflow-y-auto">
                  <For each={props.organize.allTags()}>
                    {(tag) => (
                      <Menu.CheckboxItem
                        checked={tags().includes(tag)}
                        closeOnSelect={false}
                        onChange={() => props.organize.toggleTag(props.record.session, tag)}
                      >
                        <span class="flex items-center gap-2">
                          <span class={`size-2 rounded-full ${ORGANIZE_COLOR_STYLES[props.organize.tagColor(tag)].dot}`} />
                          <span class="max-w-44 truncate">#{tag}</span>
                        </span>
                      </Menu.CheckboxItem>
                    )}
                  </For>
                  <Show when={tags().length > 0}>
                    <Menu.Item onSelect={() => props.organize.clearTags(props.record.session)}>
                      {props.language.t("session.organize.clearTags")}
                    </Menu.Item>
                  </Show>
                  <Show when={props.organize.allTags().length > 0 || tags().length > 0}>
                    <Menu.Separator />
                  </Show>
                  <Menu.Item onSelect={() => props.organize.openCreateTagDialog([sessionID()])}>
                    {props.language.t("session.organize.newTag")}
                  </Menu.Item>
                </Menu.SubContent>
              </Menu.Portal>
            </Menu.Sub>

            <Menu.Separator />
            <Menu.Item onSelect={openEditor}>{props.language.t("common.rename")}</Menu.Item>
            <Menu.Item onSelect={() => void props.onExportSession(props.server, props.record.session)}>
              {props.language.t("common.export")}…
            </Menu.Item>
            <Menu.Item onSelect={() => void props.onArchiveSession(props.record.session)}>
              {props.language.t(archived() ? "session.organize.unarchive" : "session.organize.archive")}
            </Menu.Item>
            <Menu.Separator />
            <Menu.Item onSelect={() => props.onDeleteSession(props.server, props.record.session)}>
              {props.language.t("common.delete")}…
            </Menu.Item>
          </Menu.Content>
        </Menu.Portal>
      </Menu>
      <Show when={!editor()}>
        <div
          class={`
            hover-reveal absolute right-1.5 top-1/2 flex -translate-y-1/2 items-center gap-0.5 rounded-[6px]
            bg-v2-background-bg-base/80 px-0.5 backdrop-blur-xs
            group-hover/session:opacity-100 focus-within:opacity-100
          `}
        >
          <Tooltip
            class="flex shrink-0 items-center"
            placement="bottom"
            value={props.language.t(pinned() ? "session.organize.unpin" : "session.organize.pin")}
          >
            <IconButton
              data-action="home-session-pin"
              variant="ghost-muted"
              size="small"
              icon={<Icon name={pinned() ? "pin-filled" : "pin"} />}
              aria-label={props.language.t(pinned() ? "session.organize.unpin" : "session.organize.pin")}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                props.organize.togglePin(props.record.session)
              }}
            />
          </Tooltip>
          <Tooltip
            class="flex shrink-0 items-center"
            placement="bottom"
            value={props.language.t(archived() ? "session.organize.unarchive" : "common.archive")}
          >
            <IconButton
              data-action="home-session-archive"
              variant="ghost-muted"
              size="small"
              icon={<Icon name={archived() ? "archive-restore" : "archive"} />}
              aria-label={props.language.t(archived() ? "session.organize.unarchive" : "common.archive")}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()
                void props.onArchiveSession(props.record.session)
              }}
            />
          </Tooltip>
          <Tooltip
            class="flex shrink-0 items-center"
            placement="bottom"
            value={props.language.t("common.moreOptions")}
          >
            <IconButton
              data-action="home-session-menu"
              variant="ghost-muted"
              size="small"
              icon={<Icon name="outline-dots" />}
              aria-label={props.language.t("common.moreOptions")}
              onClick={(event) => {
                event.preventDefault()
                event.stopPropagation()

                const container = event.currentTarget.closest<HTMLElement>(
                  '[data-component="home-session-row-container"]',
                )

                const rect = event.currentTarget.getBoundingClientRect()

                if (container) openMenu(container, rect.left, rect.bottom)
              }}
            />
          </Tooltip>
        </div>
      </Show>
    </div>
  )
}

function HomeSessionTitle(props: { title: string; showProjectName: boolean; search?: boolean }) {
  return (
    <span
      data-component="home-session-title"
      dir="auto"
      class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-v2-text-text-base [font-weight:530]"
      classList={{
        "text-[13px] leading-4 tracking-[-0.04px]": !!props.search,
        "max-w-[min(70%,480px)] flex-[0_1_auto]": props.showProjectName,
        "flex-[1_1_auto]": !props.showProjectName,
      }}
    >
      {props.title}
    </span>
  )
}

function HomeSessionLocation(props: {
  location: { worktree: string; branch: string | undefined }
  show: boolean
  instantHide: boolean
  desktop: boolean
}) {
  if (!props.desktop) return null

  return (
    <span
      dir="ltr"
      aria-hidden={!props.show || undefined}
      class="flex min-w-0 shrink-0 items-center gap-1.5 overflow-hidden whitespace-nowrap ease-out motion-reduce:transition-none"
      classList={{
        "-ms-1.5 max-w-0 opacity-0": !props.show,
        "max-w-[60%] opacity-100": props.show,
        "transition-[max-width,opacity] duration-[120ms]": !props.instantHide,
        "transition-none": props.instantHide,
      }}
    >
      <Icon name="outline-worktree" class="shrink-0 text-v2-icon-icon-muted" />
      <span class="min-w-0 overflow-hidden text-ellipsis [font-weight:440]">{props.location.worktree}</span>
      <Show when={props.location.branch}>
        {(branch) => (
          <>
            <Icon name="branch" class="shrink-0 text-v2-icon-icon-muted" />
            <span class="min-w-0 overflow-hidden text-ellipsis [font-weight:440]">{branch()}</span>
          </>
        )}
      </Show>
    </span>
  )
}

function HomeSessionProjectName(props: { name: string; search?: boolean; trailing?: boolean }) {
  return (
    <span
      data-component="home-session-project-name"
      dir="auto"
      class="min-w-0 overflow-hidden text-ellipsis whitespace-nowrap text-v2-text-text-muted [font-weight:440]"
      classList={{
        "flex-[0_1_auto]": !!props.trailing,
        "flex-[1_1_auto]": !props.trailing,
        "text-[13px] leading-4 tracking-[-0.04px]": !!props.search,
      }}
    >
      {props.name}
    </span>
  )
}

function HomeSessionsEmpty(props: {
  onNewSession?: () => void
  language: ReturnType<typeof useLanguage>
  organize: HomeSessionsController["organize"]
}) {
  const mode = () => props.organize.mode()
  const activeFolder = () => props.organize.activeFolder()
  const activeTag = () => props.organize.tag()

  const title = () => {
    const folder = activeFolder()

    if (folder) return props.language.t("home.sessions.empty.folder", { folder: folder.name })
    const tag = activeTag()

    if (tag) return props.language.t("home.sessions.empty.tag", { tag })

    if (mode() === "archived") return props.language.t("home.sessions.empty.archived")

    if (mode() === "pinned") return props.language.t("home.sessions.empty.pinned")

    return props.language.t("home.sessions.empty")
  }

  const description = () => {
    if (activeFolder()) return props.language.t("home.sessions.empty.folder.description")

    if (activeTag()) return props.language.t("home.sessions.empty.tag.description")

    if (mode() === "archived") return props.language.t("home.sessions.empty.archived.description")

    if (mode() === "pinned") return props.language.t("home.sessions.empty.pinned.description")

    return props.language.t("home.sessions.empty.description")
  }

  return (
    <div class="flex min-h-full flex-col items-center gap-4 px-6 pt-[52px] text-center">
      <div
        class={`
          shrink-0 text-[13px] leading-text-compact tracking-[-0.04px]
          text-v2-text-text-base [font-weight:530]
        `}
      >
        {title()}
      </div>
      <p
        class={`
          mb-1 text-center text-[13px] leading-5 tracking-[-0.04px]
          text-v2-text-text-muted [font-weight:440]
        `}
      >
        {description()}
      </p>
      <Show when={mode() === "active" && !activeFolder() && !activeTag() && props.onNewSession}>
        {(onNewSession) => (
          <Button data-action="home-new-session" variant="neutral" size="normal" icon="edit" onClick={onNewSession()}>
            {props.language.t("command.session.new")}
          </Button>
        )}
      </Show>
    </div>
  )
}

function HomeSessionSkeleton(props: { label: string }) {
  return (
    <div class="flex min-w-0 flex-col gap-4">
      <div class="flex h-7 min-w-0 items-center justify-between ps-1.5 pe-4 md:ps-4">
        <div class={HOME_SECTION_LABEL}>{props.label}</div>
      </div>
      <div class="flex min-w-0 flex-col gap-px" aria-hidden="true">
        <For each={[0, 1, 2, 3]}>{() => <div class="h-10 rounded-[6px] bg-v2-background-bg-deep opacity-70" />}</For>
      </div>
    </div>
  )
}
