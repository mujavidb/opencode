import { createEffect, createMemo, createResource, For, onCleanup, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { DragDropProvider, PointerSensor } from "@dnd-kit/solid"
import { isSortable, useSortable } from "@dnd-kit/solid/sortable"
import { Accessibility, AutoScroller, Feedback, PointerActivationConstraints } from "@dnd-kit/dom"
import { RestrictToHorizontalAxis, RestrictToVerticalAxis } from "@dnd-kit/abstract/modifiers"
import { RestrictToElement } from "@dnd-kit/dom/modifiers"
import { arrayMove } from "@dnd-kit/helpers"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { InlineInput } from "@opencode/ui/inline-input"
import { Menu } from "@opencode/ui/menu"
import { Tooltip } from "@opencode/ui/tooltip"
import { tabHref, tabKey, type SessionTab, type Tab } from "@/shell/tabs/tabs"
import { ServerConnection } from "@/runtime/server/registry"
import { DraftTabItem, TabNavItem } from "@/shell/titlebar/tab-nav"
import { useGlobal, useServerCtx, type ServerCtx } from "@/runtime/server/runtime"
import { useLanguage } from "@/runtime/i18n/language"
import { useCommand } from "@/shell/commands/command"
import { useTabs } from "@/shell/tabs/tabs"
import { createTabComposerState } from "@/composer/persistence"
import {
  ORGANIZE_COLORS,
  useSessionOrganization,
  type OrganizeColor,
} from "@/session/organization"
import { base64Encode } from "@opencode/util/encode"
import { showToast } from "@/shell/notifications/toast"
import { adjacentTabKey, mergeVisibleTabOrder } from "./tab-order"
import type { SessionInfo } from "@opencode/client/promise"

function chatKeyOfTab(tab: Tab) {
  return tab.type === "session" ? tab.sessionId : `draft:${tab.draftID}`
}

function SessionTabSlot(props: {
  tab: SessionTab
  id: string
  group: string
  index: number
  active: boolean
  orientation: "horizontal" | "vertical"
  session: SessionInfo | undefined
  preparing: boolean
  fallbackTitle?: string
  onRename: (title: string) => Promise<void>
  onNavigate: (element: HTMLDivElement) => void
  onClose: () => void
  onArchive?: () => void
}) {
  const sortable = useSortable({
    get id() {
      return props.id
    },
    get group() {
      return props.group
    },
    get index() {
      return props.index
    },
  })

  let ref!: HTMLDivElement

  return (
    <div
      ref={sortable.ref}
      data-titlebar-tab-slot
      data-tab-key={props.id}
      data-active={props.active}
      data-orientation={props.orientation}
      class="relative flex"
      classList={{
        "w-56 min-w-7 max-w-56 flex-shrink": props.orientation === "horizontal",
        "w-full shrink-0": props.orientation === "vertical",
      }}
    >
      <TabNavItem
        ref={(el) => {
          ref = el
        }}
        href={tabHref(props.tab)}
        server={props.tab.server}
        sessionID={props.tab.sessionId}
        session={props.session}
        preparing={props.preparing}
        fallbackTitle={props.fallbackTitle}
        onRename={rename => props.onRename(rename)}
        onNavigate={() => props.onNavigate(ref)}
        onClose={props.onClose}
        onArchive={props.onArchive}
        active={props.active}
        dragging={sortable.isDragSource()}
        orientation={props.orientation}
      />
    </div>
  )
}

function SessionTabEntry(props: {
  tab: SessionTab
  id: string
  group: string
  index: number
  active: boolean
  orientation: "horizontal" | "vertical"
  serverCtx: ServerCtx | undefined
  onVisibleChange: (visible: boolean) => void
  onNavigate: (element: HTMLDivElement) => void
  onClose: () => void
  onArchive?: () => void
}) {
  const tabs = useTabs()
  const language = useLanguage()
  const org = useSessionOrganization()
  const sdk = createMemo(() => props.serverCtx?.sdk ?? null)
  const pending = createMemo(() => tabs.pendingSession(props.tab.server, props.tab.sessionId))
  const cachedSession = createMemo(() => props.serverCtx?.data.session.get(props.tab.sessionId))
  const persisted = createMemo(() => tabs.info[props.id])

  const [loadedSession] = createResource(
    () => {
      if (pending()) return null
      const ctx = props.serverCtx

      return ctx ? { id: props.tab.sessionId, ctx } : null
    },
    ({ id, ctx }) =>
      ctx.data.session
        .sync(id)
        .then(() => ctx.data.session.get(id))
        .catch(() => undefined),
  )

  const session = createMemo(() => (pending() ? undefined : (cachedSession() ?? loadedSession())))
  const missingSession = createMemo(() => !pending() && !!props.serverCtx && !loadedSession.loading && !session())
  const isArchived = createMemo(() => org.isArchivedID(props.tab.sessionId))

  const visible = createMemo(
    () => !isArchived() && (!!pending() || !!session() || missingSession() || !!persisted()?.title),
  )

  const rename = async (title: string) => {
    const value = session()
    const ctx = props.serverCtx

    if (!value || !ctx) return

    ctx.data.session.remember({ ...value, title })

    try {
      await ctx.sdk.api.session.update({ sessionID: value.id, title })
    } catch (err) {
      const current = session()
      const currentCtx = props.serverCtx

      if (current && currentCtx) currentCtx.data.session.remember({ ...current, title: value.title })
      showToast({
        title: language.t("common.requestFailed"),
        description: err instanceof Error ? err.message : undefined,
      })
    }
  }

  createEffect(() => props.onVisibleChange(visible()))

  createEffect(() => {
    const ctx = props.serverCtx
    const value = session()

    if (!ctx || !value || props.active || ctx.sdk.connection.status() !== "connected") return

    const timer = window.setTimeout(
      () =>
        void Promise.allSettled([
          ctx.data.session.sync(value.id, { children: true }),
          // The selected timeline loads the transcript; inactive tabs need attention, metadata, and the inbox,
          // whose waiting work keeps the tab busy.
          ctx.data.session.permission.sync(value.id),
          ctx.data.session.form.sync(value.id),
          ctx.data.session.pending.sync(value.id),
        ]),
      300 + props.index * 50,
    )

    onCleanup(() => window.clearTimeout(timer))
  })

  createEffect(() => {
    const value = session()

    if (!value) return
    tabs.rememberSessionInfo(
      props.tab,
      value,
      props.serverCtx?.data.session.message.list(value.id).some((message) => message.type === "user") ?? false,
    )
    const current = sdk()

    if (!current) return
    createTabComposerState(tabs, props.tab, current.scope, {
      dir: base64Encode(value.location.directory),
      id: value.id,
    })
  })

  return (
    <Show when={visible()}>
      <SessionTabSlot
        tab={props.tab}
        id={props.id}
        group={props.group}
        index={props.index}
        active={props.active}
        orientation={props.orientation}
        session={session()}
        preparing={!!pending()}
        fallbackTitle={
          pending()
            ? language.t("session.tab.session")
            : (persisted()?.title ?? (missingSession() ? language.t("session.tab.unknown") : undefined))
        }
        onRename={rename}
        onNavigate={props.onNavigate}
        onClose={props.onClose}
        onArchive={props.onArchive}
      />
    </Show>
  )
}

function DraftTabSlot(props: {
  tab: Extract<Tab, { type: "draft" }>
  id: string
  group: string
  index: number
  active: boolean
  orientation: "horizontal" | "vertical"
  title: string
  onNavigate: (element: HTMLDivElement) => void
  onClose: () => void
}) {
  const sortable = useSortable({
    get id() {
      return props.id
    },
    get group() {
      return props.group
    },
    get index() {
      return props.index
    },
  })

  let ref!: HTMLDivElement

  return (
    <div
      ref={sortable.ref}
      data-titlebar-tab-slot
      data-tab-key={props.id}
      data-active={props.active}
      data-orientation={props.orientation}
      class="relative flex"
      classList={{
        "w-56 min-w-7 max-w-56 flex-shrink": props.orientation === "horizontal",
        "w-full shrink-0": props.orientation === "vertical",
      }}
    >
      <DraftTabItem
        ref={(el) => {
          ref = el
        }}
        draftID={props.tab.draftID}
        href={tabHref(props.tab)}
        title={props.title}
        onNavigate={() => props.onNavigate(ref)}
        onClose={props.onClose}
        active={props.active}
        dragging={sortable.isDragSource()}
        orientation={props.orientation}
      />
    </div>
  )
}

export function TitlebarTabStrip(props: {
  orientation?: "horizontal" | "vertical"
  tabs: Tab[]
  currentTab: Tab | undefined
  onNavigate: (tab: Tab, el?: HTMLDivElement) => void
  onClose: (tab: Tab) => void
  onArchive?: (tab: Tab) => void
  onNewTabInProject?: (folderID?: string) => void
  onReorder: (keys: string[]) => void
}) {
  const global = useGlobal()
  const language = useLanguage()
  const command = useCommand()
  const org = useSessionOrganization()
  const vertical = () => props.orientation === "vertical"
  let listRef!: HTMLDivElement
  const [visibility, setVisibility] = createStore<Record<string, boolean>>({})
  const [dragDrop, setDragDrop] = createStore<{ targetFolderID: string | undefined }>({ targetFolderID: undefined })
  let cleanupDragPointer: (() => void) | undefined
  onCleanup(() => cleanupDragPointer?.())

  const visibleTabs = createMemo(() =>
    props.tabs.filter(
      (tab) => !org.isArchivedID(chatKeyOfTab(tab)) && (tab.type === "draft" || visibility[tabKey(tab)]),
    ),
  )

  const visibleTabIds = () => visibleTabs().map(tabKey)

  const unassignedTabs = createMemo(() =>
    vertical() ? props.tabs.filter((tab) => !org.folderID(chatKeyOfTab(tab))) : props.tabs,
  )

  const renderTabItem = (tab: Tab, group = "__unassigned__") => {
    const id = tabKey(tab)
    let ref!: HTMLDivElement
    const visibleIndex = () => visibleTabs().findIndex((item) => tabKey(item) === id)
    useTabShortcut(visibleIndex, () => props.onNavigate(tab, ref))

    const serverCtx = useServerCtx(() => {
      if (tab.type !== "session") return

      return global.servers.list().find((item) => ServerConnection.key(item) === tab.server)
    })

    if (tab.type === "session") {
      return (
        <SessionTabEntry
          tab={tab}
          id={id}
          group={group}
          index={visibleIndex()}
          active={props.currentTab === tab}
          orientation={vertical() ? "vertical" : "horizontal"}
          serverCtx={serverCtx()}
          onVisibleChange={(visible) => setVisibility(id, visible)}
          onNavigate={(element) => {
            ref = element
            props.onNavigate(tab, element)
          }}
          onClose={() => props.onClose(tab)}
          onArchive={() => (props.onArchive ? props.onArchive(tab) : props.onClose(tab))}
        />
      )
    }

    return (
      <DraftTabSlot
        tab={tab}
        id={id}
        group={group}
        index={visibleIndex()}
        active={props.currentTab === tab}
        orientation={vertical() ? "vertical" : "horizontal"}
        title={language.t("session.tab.session")}
        onNavigate={(element) => {
          ref = element
          props.onNavigate(tab, element)
        }}
        onClose={() => props.onClose(tab)}
      />
    )
  }

  command.register("titlebar-tab-cycle", () => [
    {
      id: `tab.prev`,
      category: "tab",
      title: "",
      keybind: `mod+option+ArrowLeft,ctrl+shift+tab`,
      hidden: true,
      onSelect: () => selectAdjacentTab(-1),
    },
    {
      id: `tab.next`,
      category: "tab",
      title: "",
      keybind: `mod+option+ArrowRight,ctrl+tab`,
      hidden: true,
      onSelect: () => selectAdjacentTab(1),
    },
  ])

  function selectAdjacentTab(offset: -1 | 1) {
    const current = props.currentTab
    const key = adjacentTabKey(visibleTabIds(), current ? tabKey(current) : undefined, offset)
    const next = props.tabs.find((tab) => tabKey(tab) === key)

    if (next) props.onNavigate(next)
  }

  return (
    <div
      data-slot={vertical() ? "vertical-tabs" : "titlebar-tabs"}
      data-orientation={vertical() ? "vertical" : "horizontal"}
      class="relative min-w-0"
      classList={{ "flex flex-1 min-h-0 flex-col overflow-hidden": vertical() }}
    >
      <div
        data-slot={vertical() ? "vertical-tabs-scroll" : "titlebar-tabs-scroll"}
        class="flex min-w-0 no-scrollbar [app-region:no-drag]"
        classList={{
          "flex-row items-center gap-1.5 overflow-x-auto": !vertical(),
          "flex-1 min-h-0 flex-col overflow-y-auto overflow-x-hidden": vertical(),
        }}
      >
        <DragDropProvider
          sensors={[
            PointerSensor.configure({
              activationConstraints: (event) =>
                event.pointerType === "touch"
                  ? [new PointerActivationConstraints.Distance({ value: 8 })]
                  : [new PointerActivationConstraints.Distance({ value: 4 })],
              preventActivation: (event) =>
                event.target instanceof Element &&
                !!event.target.closest('[data-slot="tab-close"], [contenteditable="true"], [data-sidebar-project-row]'),
            }),
          ]}
          modifiers={[
            vertical() ? RestrictToVerticalAxis : RestrictToHorizontalAxis,
            RestrictToElement.configure({ element: () => listRef }),
          ]}
          plugins={(defaults) => [
            ...defaults.filter((plugin) => plugin !== Accessibility),
            AutoScroller.configure({ acceleration: 8, threshold: vertical() ? { x: 0, y: 0.05 } : { x: 0.05, y: 0 } }),
            Feedback.configure({ dropAnimation: null }),
          ]}
          onDragStart={(event) => {
            cleanupDragPointer?.()
            cleanupDragPointer = undefined
            setDragDrop("targetFolderID", undefined)

            const source = event.operation.source

            if (!source) return
            const tab = props.tabs.find((item) => tabKey(item) === source.id.toString())

            if (!tab) return

            if (vertical()) {
              const sourceEl = source.element
              const currentFolder = org.folderID(chatKeyOfTab(tab))

              const handleMove = (pointerEvent: PointerEvent) => {
                const elements = document.elementsFromPoint(pointerEvent.clientX, pointerEvent.clientY)

                for (const el of elements) {
                  if (sourceEl && sourceEl.contains(el)) continue
                  const projEl = el.closest<HTMLElement>("[data-sidebar-project-drop]")

                  if (projEl) {
                    const folderID = projEl.getAttribute("data-sidebar-project-drop") ?? undefined
                    setDragDrop("targetFolderID", folderID !== currentFolder ? folderID : undefined)

                    return
                  }

                  if (currentFolder && el.closest("[data-sidebar-unassigned-drop]")) {
                    setDragDrop("targetFolderID", "__unassigned__")

                    return
                  }
                }

                setDragDrop("targetFolderID", undefined)
              }

              window.addEventListener("pointermove", handleMove, { passive: true })
              cleanupDragPointer = () => window.removeEventListener("pointermove", handleMove)

              return
            }

            const tabEl = source.element?.querySelector<HTMLDivElement>("[data-titlebar-tab]")
            props.onNavigate(tab, tabEl ?? undefined)
          }}
          onDragOver={(event) => {
            if (!vertical()) return
            const source = event.operation.source
            const target = event.operation.target

            if (isSortable(source) && isSortable(target) && source.sortable.group !== target.sortable.group) {
              event.preventDefault()
            }
          }}
          onDragEnd={(event) => {
            cleanupDragPointer?.()
            cleanupDragPointer = undefined
            const targetFolderID = dragDrop.targetFolderID
            setDragDrop("targetFolderID", undefined)

            const current = visibleTabIds()
            const source = event.operation.source

            if (event.canceled || !isSortable(source)) return

            if (vertical() && targetFolderID !== undefined) {
              const draggedTab = props.tabs.find((item) => tabKey(item) === source.id.toString())

              if (draggedTab) {
                const key = chatKeyOfTab(draggedTab)

                if (targetFolderID === "__unassigned__") {
                  org.assignFolder(key, undefined)
                  org.setGeneralCollapsed(false)
                }

                if (targetFolderID !== "__unassigned__") {
                  org.assignFolder(key, targetFolderID)
                  org.setFolderCollapsed(targetFolderID, false)
                }

                return
              }
            }

            const { initialIndex, index } = source

            if (initialIndex !== index) {
              props.onReorder(
                mergeVisibleTabOrder(
                  props.tabs.map(tabKey),
                  current,
                  arrayMove(current, source.initialIndex, source.index),
                ),
              )
            }
          }}
        >
          <div
            data-titlebar-tab-list
            data-orientation={vertical() ? "vertical" : "horizontal"}
            class="flex w-full min-w-0"
            classList={{ "flex-row items-center": !vertical(), "flex-col items-stretch": vertical() }}
            ref={listRef}
          >
            <Show when={vertical()}>
              <VerticalSidebarProjects
                tabs={props.tabs}
                dropTargetFolderID={dragDrop.targetFolderID}
                renderTab={renderTabItem}
                onNewTabInProject={(folderID) => props.onNewTabInProject?.(folderID)}
              />
            </Show>
            <div
              data-sidebar-unassigned-drop={vertical() ? "" : undefined}
              class="flex w-full min-w-0"
              classList={{
                "flex-row items-center": !vertical(),
                "flex-col items-stretch rounded-[6px] transition-colors": vertical(),
                "ring-1 ring-v2-border-border-base bg-v2-background-bg-layer-02/50":
                  vertical() && dragDrop.targetFolderID === "__unassigned__",
              }}
            >
              <Show when={vertical()}>
                <div
                  data-sidebar-project-row
                  class="group/sgen relative flex h-7 w-full min-w-0 items-center rounded-[6px] px-1 hover:bg-v2-background-bg-layer-02/70"
                >
                  <button
                    type="button"
                    data-action="sidebar-general-chats-toggle"
                    aria-expanded={!org.generalCollapsed()}
                    class="flex h-full min-w-0 flex-1 items-center gap-1.5 text-start text-[13px] leading-4 text-v2-text-text-faint hover:text-v2-text-text-base [font-weight:500]"
                    onClick={() => org.toggleGeneralCollapsed()}
                  >
                    <Icon
                      name="chevron-down"
                      size="small"
                      class="shrink-0 text-v2-icon-icon-muted transition-transform duration-150"
                      style={{ transform: `rotate(${org.generalCollapsed() ? -90 : 0}deg)` }}
                    />
                    <span class="min-w-0 flex-1 truncate">{language.t("sidebar.chats")}</span>
                    <Show when={unassignedTabs().length > 0}>
                      <span class="shrink-0 pe-1 text-[11px] leading-4 text-v2-text-text-faint group-hover/sgen:opacity-0">
                        {unassignedTabs().length}
                      </span>
                    </Show>
                  </button>
                  <Show when={props.onNewTabInProject}>
                    {(create) => (
                      <div class="hover-reveal absolute end-1 top-1/2 flex -translate-y-1/2 items-center group-hover/sgen:opacity-100">
                        <Tooltip placement="top" value={language.t("command.session.new")}>
                          <IconButton
                            size="small"
                            variant="ghost-muted"
                            icon={<Icon name="plus" size="small" />}
                            aria-label={language.t("command.session.new")}
                            onClick={(event) => {
                              event.preventDefault()
                              event.stopPropagation()
                              org.setGeneralCollapsed(false)
                              create()(undefined)
                            }}
                          />
                        </Tooltip>
                      </div>
                    )}
                  </Show>
                </div>
              </Show>
              <Show when={!vertical() || !org.generalCollapsed()}>
                <For each={unassignedTabs()}>{(tab) => renderTabItem(tab, "__unassigned__")}</For>
              </Show>
            </div>
          </div>
        </DragDropProvider>
      </div>
      <Show when={vertical()}>
        <VerticalSidebarArchived />
      </Show>
      <Show when={!vertical()}>
        <div
          data-slot="titlebar-tabs-fade-left"
          aria-hidden="true"
          class="pointer-events-none absolute inset-y-0 left-0 z-10 w-6 bg-[linear-gradient(to_right,var(--v2-background-bg-deep),transparent)]"
        />
        <div
          data-slot="titlebar-tabs-fade-right"
          aria-hidden="true"
          class="pointer-events-none absolute inset-y-0 right-0 z-10 w-6 bg-[linear-gradient(to_left,var(--v2-background-bg-deep),transparent)]"
        />
      </Show>
    </div>
  )
}

function VerticalSidebarProjects(props: {
  tabs: Tab[]
  dropTargetFolderID: string | undefined
  renderTab: (tab: Tab, group?: string) => ReturnType<typeof SessionTabEntry>
  onNewTabInProject: (folderID: string) => void
}) {
  const language = useLanguage()
  const org = useSessionOrganization()
  let creatorInputRef: HTMLInputElement | undefined

  const [state, setState] = createStore<{
    creating: boolean
    newName: string
    newColor: OrganizeColor
    editingID: string | undefined
    editDraft: string
    menuID: string | undefined
  }>({
    creating: false,
    newName: "",
    newColor: "blue",
    editingID: undefined,
    editDraft: "",
    menuID: undefined,
  })

  const openCreator = () => {
    setState({
      creating: true,
      newName: "",
      newColor: ORGANIZE_COLORS[org.folders().length % ORGANIZE_COLORS.length],
    })
    requestAnimationFrame(() => creatorInputRef?.focus())
  }

  const submitCreator = () => {
    const folder = org.createFolder(state.newName, state.newColor)
    setState({ creating: false, newName: "" })

    if (folder) org.setFolderCollapsed(folder.id, false)
  }

  return (
    <div data-slot="vertical-sidebar-projects" class="mb-1 flex flex-col gap-0.5">
      <button
        type="button"
        data-sidebar-project-row
        data-action="sidebar-new-project"
        class="flex h-7 w-full shrink-0 items-center gap-1.5 rounded-[6px] ps-1.5 pe-2 text-[13px] leading-4 text-v2-text-text-faint hover:bg-v2-background-bg-layer-02 hover:text-v2-text-text-base"
        onClick={openCreator}
      >
        <Icon name="folder-add-left" class="shrink-0" />
        <span class="min-w-0 truncate">{language.t("sidebar.projects.new")}</span>
      </button>

      <Show when={state.creating}>
        <div
          data-sidebar-project-row
          class="flex h-7 items-center gap-1.5 rounded-[6px] bg-v2-background-bg-layer-02 px-2"
        >
          <input
            ref={(el) => (creatorInputRef = el)}
            value={state.newName}
            placeholder={language.t("sidebar.projects.newPlaceholder")}
            aria-label={language.t("sidebar.projects.newPlaceholder")}
            class="min-w-0 flex-1 border-0 bg-transparent text-[13px] leading-4 text-v2-text-text-base outline-0 placeholder:text-v2-text-text-faint"
            onInput={(event) => setState("newName", event.currentTarget.value)}
            onKeyDown={(event) => {
              event.stopPropagation()

              if (event.key === "Enter" && !event.isComposing) {
                event.preventDefault()
                submitCreator()

                return
              }

              if (event.key === "Escape") {
                event.preventDefault()
                setState({ creating: false, newName: "" })
              }
            }}
            onBlur={() => {
              if (state.newName.trim()) {
                submitCreator()

                return
              }

              setState({ creating: false, newName: "" })
            }}
          />
        </div>
      </Show>

      <For each={org.folders()}>
        {(folder) => {
          const projectTabs = createMemo(() =>
            props.tabs.filter(
              (tab) =>
                !org.isArchivedID(chatKeyOfTab(tab)) && org.folderID(chatKeyOfTab(tab)) === folder.id,
            ),
          )

          const collapsed = () => org.isFolderCollapsed(folder.id)
          const editing = () => state.editingID === folder.id
          const menuOpen = () => state.menuID === folder.id
          const isDropTarget = () => props.dropTargetFolderID === folder.id

          const saveEdit = () => {
            if (state.editingID !== folder.id) return
            org.renameFolder(folder.id, state.editDraft)
            setState("editingID", undefined)
          }

          return (
            <div
              data-sidebar-project-drop={folder.id}
              class="flex flex-col rounded-[6px] transition-colors"
              classList={{
                "ring-1 ring-v2-border-border-base bg-v2-background-bg-layer-02/70": isDropTarget(),
              }}
            >
              <div
                data-sidebar-project-row
                data-sidebar-project-id={folder.id}
                class="group/sproj relative flex h-7 w-full min-w-0 items-center rounded-[6px] px-1 hover:bg-v2-background-bg-layer-02/70"
                onContextMenu={(event) => {
                  if (editing()) return
                  event.preventDefault()
                  setState("menuID", folder.id)
                }}
              >
                <Show
                  when={!editing()}
                  fallback={
                    <div class="flex h-7 w-full items-center gap-1.5 px-1">
                      <InlineInput
                        aria-label={language.t("sidebar.projects.rename")}
                        value={state.editDraft}
                        class="min-w-0 flex-1 text-[13px] leading-4 text-v2-text-text-base outline-none"
                        onInput={(event) => setState("editDraft", event.currentTarget.value)}
                        onKeyDown={(event) => {
                          event.stopPropagation()

                          if (event.key === "Enter") {
                            event.preventDefault()
                            saveEdit()

                            return
                          }

                          if (event.key === "Escape") {
                            event.preventDefault()
                            setState("editingID", undefined)
                          }
                        }}
                        onBlur={saveEdit}
                      />
                    </div>
                  }
                >
                  <button
                    type="button"
                    data-action="sidebar-project-toggle"
                    aria-expanded={!collapsed()}
                    class="flex h-full min-w-0 flex-1 items-center gap-1.5 text-start text-[13px] leading-4 text-v2-text-text-base [font-weight:500]"
                    onClick={() => org.toggleFolderCollapsed(folder.id)}
                    onDblClick={(event) => {
                      event.preventDefault()
                      event.stopPropagation()
                      setState({ editingID: folder.id, editDraft: folder.name })
                    }}
                  >
                    <Icon
                      name="chevron-down"
                      size="small"
                      class="shrink-0 text-v2-icon-icon-muted transition-transform duration-150"
                      style={{ transform: `rotate(${collapsed() ? -90 : 0}deg)` }}
                    />
                    <span class="min-w-0 flex-1 truncate">{folder.name}</span>
                    <Show when={projectTabs().length > 0}>
                      <span class="shrink-0 pe-1 text-[11px] leading-4 text-v2-text-text-faint group-hover/sproj:opacity-0">
                        {projectTabs().length}
                      </span>
                    </Show>
                  </button>
                </Show>

                <Show when={!editing()}>
                  <div
                    class="hover-reveal absolute end-1 top-1/2 flex -translate-y-1/2 items-center gap-0.5 group-hover/sproj:opacity-100 data-[menu=true]:opacity-100"
                    data-menu={menuOpen()}
                  >
                    <Tooltip placement="top" value={language.t("sidebar.projects.newChat")}>
                      <IconButton
                        data-action="sidebar-project-new-chat"
                        size="small"
                        variant="ghost-muted"
                        icon={<Icon name="plus" size="small" />}
                        aria-label={language.t("sidebar.projects.newChat")}
                        onClick={(event) => {
                          event.preventDefault()
                          event.stopPropagation()
                          org.setFolderCollapsed(folder.id, false)
                          props.onNewTabInProject(folder.id)
                        }}
                      />
                    </Tooltip>
                    <Menu
                      modal={false}
                      placement="bottom-end"
                      gutter={4}
                      open={menuOpen()}
                      onOpenChange={(open) => setState("menuID", open ? folder.id : undefined)}
                    >
                      <Menu.Trigger
                        as={IconButton}
                        size="small"
                        variant="ghost-muted"
                        icon={<Icon name="outline-dots" size="small" />}
                        aria-label={language.t("common.moreOptions")}
                      />
                      <Menu.Portal>
                        <Menu.Content>
                          <Menu.Item
                            onSelect={() => {
                              org.setFolderCollapsed(folder.id, false)
                              props.onNewTabInProject(folder.id)
                            }}
                          >
                            {language.t("sidebar.projects.newChat")}
                          </Menu.Item>
                          <Menu.Item
                            onSelect={() => setState({ editingID: folder.id, editDraft: folder.name })}
                          >
                            {language.t("common.rename")}
                          </Menu.Item>
                          <Menu.Separator />
                          <Menu.Item onSelect={() => org.deleteFolder(folder.id)}>
                            {language.t("common.delete")}
                          </Menu.Item>
                        </Menu.Content>
                      </Menu.Portal>
                    </Menu>
                  </div>
                </Show>
              </div>

              <Show when={!collapsed() && projectTabs().length > 0}>
                <div class="ms-2.5 flex flex-col border-s border-v2-border-border-base/60 ps-1.5">
                  <For each={projectTabs()}>{(tab) => props.renderTab(tab, folder.id)}</For>
                </div>
              </Show>
            </div>
          )
        }}
      </For>
    </div>
  )
}

function VerticalSidebarArchived() {
  const language = useLanguage()
  const org = useSessionOrganization()
  const tabs = useTabs()
  const global = useGlobal()

  const archivedList = createMemo(() => org.archivedChats())

  const restoreAndOpen = (item: { id: string; server?: string; directory?: string }, navigate: boolean) => {
    org.unarchive(item.id)
    const fallbackServer = global.servers.list()[0] ? ServerConnection.key(global.servers.list()[0]) : undefined
    const serverKey = (item.server ? ServerConnection.Key.make(item.server) : undefined) ?? fallbackServer

    if (!serverKey) return
    const tab = tabs.addSessionTab({ server: serverKey, sessionId: item.id })

    if (navigate) tabs.select(tab)
  }

  return (
    <div
      data-slot="vertical-sidebar-archived"
      class="mt-2 flex w-full shrink-0 flex-col border-t border-v2-border-border-muted/60 pt-1.5 [app-region:no-drag]"
    >
      <button
        type="button"
        data-action="vertical-sidebar-archived-toggle"
        aria-expanded={org.archivedExpanded()}
        class="flex h-7 w-full items-center gap-1.5 rounded-[6px] px-1.5 text-[13px] leading-4 text-v2-text-text-faint hover:bg-v2-background-bg-layer-02 hover:text-v2-text-text-base"
        onClick={() => org.toggleArchivedExpanded()}
      >
        <Icon
          name="chevron-down"
          size="small"
          class="shrink-0 transition-transform duration-150"
          style={{ transform: `rotate(${org.archivedExpanded() ? 0 : -90}deg)` }}
        />
        <Icon name="archive" size="small" class="shrink-0" />
        <span class="min-w-0 flex-1 truncate text-start">{language.t("sidebar.archived")}</span>
        <Show when={archivedList().length > 0}>
          <span class="shrink-0 text-[11px] leading-4 text-v2-text-text-faint">{archivedList().length}</span>
        </Show>
      </button>

      <Show when={org.archivedExpanded()}>
        <div class="mt-0.5 flex max-h-48 flex-col gap-0.5 overflow-y-auto ps-1">
          <Show
            when={archivedList().length > 0}
            fallback={
              <div class="px-2 py-1.5 text-[12px] leading-4 text-v2-text-text-faint">
                {language.t("sidebar.archived.empty")}
              </div>
            }
          >
            <For each={archivedList()}>
              {(item) => (
                <Menu.Context modal={false}>
                  <div
                    data-slot="vertical-sidebar-archived-item"
                    class="group/arch relative flex h-7 w-full min-w-0 items-center gap-1.5 rounded-[6px] px-1.5 hover:bg-v2-background-bg-layer-02"
                  >
                    <Menu.Context.Trigger
                      as="button"
                      type="button"
                      class="flex h-full min-w-0 flex-1 items-center gap-1.5 text-start text-[13px] leading-4 text-v2-text-text-muted hover:text-v2-text-text-base"
                      onClick={() => restoreAndOpen(item, true)}
                    >
                      <span class="min-w-0 flex-1 truncate">
                        {item.title ?? language.t("session.tab.session")}
                      </span>
                    </Menu.Context.Trigger>
                    <div class="hover-reveal flex shrink-0 items-center gap-0.5 group-hover/arch:opacity-100">
                      <Tooltip placement="top" value={language.t("session.organize.unarchive")}>
                        <IconButton
                          size="small"
                          variant="ghost-muted"
                          data-action="sidebar-unarchive-chat"
                          icon={<Icon name="archive-restore" size="small" />}
                          aria-label={language.t("session.organize.unarchive")}
                          onClick={(event) => {
                            event.preventDefault()
                            event.stopPropagation()
                            restoreAndOpen(item, false)
                          }}
                        />
                      </Tooltip>
                    </div>
                  </div>
                  <Menu.Context.Portal>
                    <Menu.Context.Content>
                      <Menu.Item onSelect={() => restoreAndOpen(item, true)}>
                        {language.t("session.organize.unarchive")}
                      </Menu.Item>
                      <Menu.Sub>
                        <Menu.SubTrigger>{language.t("sidebar.projects.assign")}</Menu.SubTrigger>
                        <Menu.Portal>
                          <Menu.SubContent class="max-h-72 overflow-y-auto">
                            <For each={org.folders()}>
                              {(folder) => (
                                <Menu.CheckboxItem
                                  checked={item.folder?.id === folder.id}
                                  onChange={() =>
                                    org.assignFolder(
                                      item.id,
                                      item.folder?.id === folder.id ? undefined : folder.id,
                                    )
                                  }
                                >
                                  <span class="max-w-44 truncate">{folder.name}</span>
                                </Menu.CheckboxItem>
                              )}
                            </For>
                            <Show when={item.folder}>
                              <Menu.Item onSelect={() => org.assignFolder(item.id, undefined)}>
                                {language.t("sidebar.projects.unassign")}
                              </Menu.Item>
                            </Show>
                          </Menu.SubContent>
                        </Menu.Portal>
                      </Menu.Sub>
                      <Menu.Separator />
                      <Menu.Item onSelect={() => org.removeArchived(item.id)}>
                        {language.t("common.delete")}
                      </Menu.Item>
                    </Menu.Context.Content>
                  </Menu.Context.Portal>
                </Menu.Context>
              )}
            </For>
          </Show>
        </div>
      </Show>
    </div>
  )
}

function useTabShortcut(index: () => number, onSelect: () => void) {
  const command = useCommand()

  command.register(() => {
    const number = index() + 1

    if (number < 1 || number > 9) return []

    return [
      {
        id: `tab.${number}`,
        category: "tab",
        title: "",
        keybind: `mod+${number}`,
        hidden: true,
        onSelect,
      },
    ]
  })
}
