import { createEffect, createMemo, createSignal, For, onCleanup, Show, type Ref } from "solid-js"
import { createStore } from "solid-js/store"
import { Predicate } from "effect"
import { makeEventListener } from "@solid-primitives/event-listener"
import { createResizeObserver } from "@solid-primitives/resize-observer"
import { createMutation } from "@tanstack/solid-query"
import { useDialog } from "@opencode/ui/context/dialog"
import { IconButton } from "@opencode/ui/icon-button"
import { Icon } from "@opencode/ui/icon"
import { Menu } from "@opencode/ui/menu"
import { Tooltip } from "@opencode/ui/tooltip"
import { displayName } from "@opencode/ui/project-avatar"
import { useServerCtx } from "@/runtime/server/runtime"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection, serverName, useServers } from "@/runtime/server/registry"
import { DialogCreateFolder } from "@/session/organize-dialogs"
import { ORGANIZE_COLOR_STYLES, useSessionOrganization } from "@/session/organization"
import { SessionTabAvatar } from "@/shell/layout/session-tab-avatar"
import { showToast } from "@/shell/notifications/toast"
import { SessionProgressIndicatorV2 } from "@opencode/session-ui/v2/session-progress-indicator-v2"
import type { SessionInfo } from "@opencode/client/promise"
import { sessionTabTitle } from "./tab-title"
import { TabPreviewPopover } from "./tab-popover"
import "./tab-nav.css"

// MouseEvent.button uses 1 for the middle/wheel button.
const MIDDLE_MOUSE_BUTTON = 1

export function TabNavItem(props: {
  ref?: Ref<HTMLDivElement>
  href: string
  server: ServerConnection.Key
  sessionID?: string
  session: SessionInfo | undefined
  preparing: boolean
  fallbackTitle?: string
  onRename: (title: string) => Promise<void>
  onClose: () => void
  onArchive?: () => void
  onNavigate: () => void
  active?: boolean
  suppressNavigation?: boolean
  dragging?: boolean
  pressed?: boolean
  hidden?: boolean
  orientation?: "horizontal" | "vertical"
}) {
  const language = useLanguage()
  const dialog = useDialog()
  const org = useSessionOrganization()
  const [menu, setMenu] = createStore({ open: false, rename: false })
  const [editing, setEditing] = createSignal(false)
  const [titleOverflowing, setTitleOverflowing] = createSignal(false)
  let tabRoot!: HTMLDivElement
  let titleEl!: HTMLSpanElement
  let measureFrame: number | undefined
  const rename = createMutation(() => ({ mutationFn: props.onRename }))

  const chatID = () => props.session?.id ?? props.sessionID

  const assignedFolder = createMemo(() => {
    const id = chatID()

    return id ? org.folderForSession(id) : undefined
  })

  const closeTab = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    props.onClose()
  }

  const archiveTab = (event?: MouseEvent) => {
    event?.preventDefault()
    event?.stopPropagation()
    const id = chatID()

    if (!id) return
    org.archive(id, {
      title: title(),
      server: props.server,
      directory: props.session?.location.directory,
    })

    if (props.onArchive) props.onArchive()

    if (!props.onArchive) props.onClose()
    showToast({
      icon: "archive",
      title: language.t("toast.session.archived.title"),
    })
  }

  const servers = useServers()
  const serverCtx = useServerCtx(() => servers.list.find((item) => ServerConnection.key(item) === props.server))

  const isUnread = createMemo(() => {
    const id = chatID()

    if (!id) return false

    return org.isUnread(id) || (serverCtx()?.notification.session.unseenCount(id) ?? 0) > 0
  })

  const project = createMemo(() => {
    const session = props.session

    if (!session) return

    return serverCtx()?.projects.forSession(session)
  })

  const title = createMemo(() => {
    const session = props.session

    return sessionTabTitle(session ? session.title : props.fallbackTitle, language.t("session.tab.session"))
  })

  const projectName = createMemo(() => {
    const session = props.session

    if (!session) return

    return displayName(project() ?? { worktree: session.location.directory })
  })

  const previewPath = createMemo(() => {
    const session = props.session

    if (!session) return
    const home = serverCtx()?.sync.data.path.home

    return home ? session.location.directory.replace(home, "~") : session.location.directory
  })

  // Only label the server when multiple servers are connected.
  const serverLabel = createMemo(() => {
    if (servers.list.length <= 1) return
    const conn = servers.list.find((item) => ServerConnection.key(item) === props.server)

    return conn ? serverName(conn) : undefined
  })

  // Like the TUI, a prompt sent to a background tab's session pulses the tab once.
  const [promptPulse, setPromptPulse] = createSignal(0)
  createEffect(() => {
    const data = serverCtx()?.data
    const sessionID = props.session?.id

    if (!data || !sessionID) return
    onCleanup(
      data.on("session.inbox.enqueued", (event) => {
        if (props.active || event.data.item.type !== "user" || data.session.root(event.data.sessionID) !== sessionID)
          return
        setPromptPulse((count) => count + 1)
      }),
    )
  })

  const [popoverOpen, setPopoverOpen] = createSignal(false)
  const previewBlocked = () => !!props.dragging || editing() || menu.open || !!props.pressed || !props.session

  const measureTitleOverflow = () => {
    if (!titleEl || editing()) {
      setTitleOverflowing(false)

      return
    }

    setTitleOverflowing(titleEl.scrollWidth > titleEl.clientWidth)
  }

  const scheduleTitleOverflow = () => {
    if (measureFrame !== undefined) return
    measureFrame = requestAnimationFrame(() => {
      measureFrame = undefined
      measureTitleOverflow()
    })
  }

  createEffect(() => {
    title()
    props.active
    props.orientation
    editing()
    scheduleTitleOverflow()
  })

  // The overflow fade changes title padding; observe the stable tab box, not that feedback.
  createResizeObserver(() => tabRoot, scheduleTitleOverflow)
  onCleanup(() => {
    if (measureFrame !== undefined) cancelAnimationFrame(measureFrame)
  })

  const selectTitle = () => {
    const range = document.createRange()
    range.selectNodeContents(titleEl)
    const selection = window.getSelection()
    selection?.removeAllRanges()
    selection?.addRange(range)
  }

  const closeRename = async (save: boolean) => {
    if (rename.isPending || !editing()) return

    const original = props.session?.title ?? ""
    const next = (titleEl.textContent ?? "").trim()

    titleEl.scrollLeft = 0
    setEditing(false)

    if (!save || !next || next === original) {
      return
    }

    await rename.mutateAsync(next)
  }

  createEffect(() => {
    const id = chatID()
    const currentTitle = title()

    if (!id || !currentTitle) return
    org.rememberChatInfo({
      id,
      title: currentTitle,
      server: props.server,
      directory: props.session?.location.directory,
    })
  })

  createEffect(() => {
    if (editing()) return

    if (!titleEl) return
    const value = title()

    if (value === undefined) return
    titleEl.textContent = value
  })

  const openRename = (event?: MouseEvent) => {
    event?.preventDefault()
    event?.stopPropagation()

    if (props.dragging || editing() || rename.isPending) return
    const session = props.session

    if (!session) return
    titleEl.textContent = session.title ?? ""
    setEditing(true)

    requestAnimationFrame(() => {
      titleEl.focus()
      selectTitle()
    })
  }

  createEffect(() => {
    if (!editing()) return

    const cleanup = makeEventListener(
      document,
      "pointerdown",
      (event) => {
        const target = event.target

        if (!(target instanceof Node)) return

        if (tabRoot.contains(target)) return
        void closeRename(true)
      },
      { capture: true },
    )

    onCleanup(cleanup)
  })

  const tab = () => (
    <div
      ref={(el) => {
        tabRoot = el

        if (Predicate.isFunction(props.ref)) props.ref(el)
      }}
      data-titlebar-tab
      data-slot="titlebar-tab-item"
      data-orientation={props.orientation ?? "horizontal"}
      data-title-overflow={titleOverflowing()}
      data-editing={editing()}
      class="group relative flex h-7 w-full min-w-0 select-none flex-row items-center gap-1.5 overflow-hidden whitespace-nowrap rounded-[6px] px-1.5 [container-type:inline-size]"
      classList={{ invisible: props.hidden }}
      data-active={props.active}
      data-unread={isUnread() ? "true" : undefined}
      data-dragging={props.dragging}
      data-state={props.active || props.pressed ? "pressed" : undefined}
      onMouseDown={(event) => {
        if (event.button !== MIDDLE_MOUSE_BUTTON) return
        event.preventDefault()
        event.stopPropagation()
      }}
      onAuxClick={(event) => {
        if (event.button !== MIDDLE_MOUSE_BUTTON) return
        closeTab(event)
      }}
    >
      <Show when={promptPulse()} keyed>
        <span data-slot="tab-prompt-pulse" aria-hidden="true" onAnimationEnd={() => setPromptPulse(0)} />
      </Show>
      <Menu.Context.Trigger
        as="a"
        disabled={editing() || props.dragging}
        aria-haspopup="menu"
        aria-expanded={menu.open}
        data-slot="tab-link"
        data-titlebar-tab-link
        href={props.href}
        draggable={false}
        onDragStart={(event) => {
          event.preventDefault()
          event.stopPropagation()
        }}
        onMouseDown={(event) => {
          // Navigate on mousedown to shave the press-release delay off tab switches.
          if (event.button !== 0) return

          if (editing()) return

          if (props.suppressNavigation) return
          const id = chatID()

          if (id) {
            org.markRead(id)
            serverCtx()?.notification.session.markViewed(id)
          }

          props.onNavigate()
        }}
        onClick={(event) => {
          event.preventDefault()

          // Mouse navigation already happened on mousedown; detail 0 means keyboard activation.
          if (event.detail > 0) return

          if (editing()) return

          if (props.suppressNavigation) return
          const id = chatID()

          if (id) {
            org.markRead(id)
            serverCtx()?.notification.session.markViewed(id)
          }

          props.onNavigate()
        }}
        class="flex h-full min-w-0 flex-1 flex-row items-center gap-1.5 text-[13px] font-medium text-v2-text-text-faint group-data-[unread='true']:text-v2-text-text-base group-data-[active='true']:text-v2-text-text-base group-data-[editing='true']:text-v2-text-text-base [-webkit-user-drag:none]"
      >
        <span data-slot="project-avatar-slot" class="flex size-4 shrink-0 items-center justify-center">
          <Show
            when={props.session}
            keyed
            fallback={
              <Show
                when={props.preparing}
                fallback={
                  <span class="block size-4 rounded-[3px] border border-v2-border-border-muted" aria-hidden="true" />
                }
              >
                <SessionProgressIndicatorV2 />
              </Show>
            }
          >
            {(session) => (
              <SessionTabAvatar
                project={project()}
                directory={session.location.directory}
                sessionId={session.id}
                server={props.server}
              />
            )}
          </Show>
        </span>
        <span
          ref={(el) => {
            titleEl = el
            titleEl.textContent = title() ?? ""
          }}
          data-slot="tab-title"
          data-titlebar-tab-title
          dir="auto"
          class="min-w-0 flex-1 outline-none leading-4"
          classList={{
            "overflow-hidden text-clip whitespace-nowrap": !editing(),
            "select-text": editing(),
          }}
          contenteditable={editing() ? true : undefined}
          onDblClick={openRename}
          onKeyDown={(event) => {
            event.stopPropagation()

            if (event.key === "Enter") {
              event.preventDefault()
              void closeRename(true)

              return
            }

            if (event.key !== "Escape") return
            event.preventDefault()
            titleEl.textContent = props.session?.title ?? ""
            void closeRename(false)
          }}
          onBlur={() => void closeRename(true)}
          onPointerDown={(event) => {
            if (!editing()) return
            event.stopPropagation()
          }}
          onClick={(event) => {
            if (!editing()) return
            event.preventDefault()
          }}
        />
      </Menu.Context.Trigger>

      <div data-slot="tab-close">
        <Show
          when={props.orientation === "vertical"}
          fallback={
            <IconButton
              size="small"
              variant="ghost-muted"
              class="hover-reveal relative z-10 group-hover:opacity-100 group-data-[active=true]:opacity-100 group-data-[editing=true]:opacity-100"
              onPointerDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
              }}
              onClick={closeTab}
              icon={<Icon name="xmark-small" />}
              aria-label={language.t("common.closeTab")}
            />
          }
        >
          <Show when={chatID()}>
            <Tooltip placement="top" value={language.t("common.archive")}>
              <IconButton
                size="small"
                variant="ghost-muted"
                data-action="tab-archive"
                class="hover-reveal relative z-10 group-hover:opacity-100"
                onPointerDown={(event) => {
                  event.preventDefault()
                  event.stopPropagation()
                }}
                onClick={archiveTab}
                icon={<Icon name="archive" size="small" />}
                aria-label={language.t("common.archive")}
              />
            </Tooltip>
          </Show>
        </Show>
      </div>
    </div>
  )

  return (
    <Menu.Context
      modal={false}
      onOpenChange={(open) => {
        setMenu("open", open)

        if (open) setPopoverOpen(false)
      }}
    >
      <TabPreviewPopover
        trigger={tab()}
        orientation={props.orientation}
        open={popoverOpen() && !previewBlocked()}
        onOpenChange={(value) => {
          if (value && previewBlocked()) return
          setPopoverOpen(value)
        }}
        data={{
          projectName: assignedFolder()?.name ?? projectName(),
          title: props.session?.title,
          path: previewPath(),
          serverName: serverLabel(),
        }}
      />
      <Menu.Context.Portal>
        <Menu.Context.Content
          onCloseAutoFocus={(event) => {
            if (!menu.rename) return
            event.preventDefault()
            setMenu("rename", false)
            openRename()
          }}
        >
          <Show when={chatID()}>
            {(id) => (
              <>
                <Menu.Sub>
                  <Menu.SubTrigger>{language.t("sidebar.projects.assign")}</Menu.SubTrigger>
                  <Menu.Portal>
                    <Menu.SubContent class="max-h-72 overflow-y-auto">
                      <For each={org.folders()}>
                        {(folder) => (
                          <Menu.CheckboxItem
                            checked={org.folderID(id()) === folder.id}
                            onChange={() =>
                              org.assignFolder(id(), org.folderID(id()) === folder.id ? undefined : folder.id)
                            }
                          >
                            <span class="flex items-center gap-2">
                              <span class={`size-2 rounded-full ${ORGANIZE_COLOR_STYLES[folder.color].dot}`} />
                              <span class="max-w-44 truncate">{folder.name}</span>
                            </span>
                          </Menu.CheckboxItem>
                        )}
                      </For>
                      <Show when={org.folderID(id())}>
                        <Menu.Item onSelect={() => org.assignFolder(id(), undefined)}>
                          {language.t("sidebar.projects.unassign")}
                        </Menu.Item>
                      </Show>
                      <Show when={org.folders().length > 0 || org.folderID(id())}>
                        <Menu.Separator />
                      </Show>
                      <Menu.Item onSelect={() => void dialog.show(() => <DialogCreateFolder sessionIDs={[id()]} />)}>
                        {language.t("sidebar.projects.new")}…
                      </Menu.Item>
                    </Menu.SubContent>
                  </Menu.Portal>
                </Menu.Sub>
                <Menu.Item
                  onSelect={() => {
                    if (isUnread()) {
                      org.markRead(id())
                      serverCtx()?.notification.session.markViewed(id())
                    } else {
                      org.markUnread(id())
                    }
                  }}
                >
                  {language.t(isUnread() ? "sidebar.session.markRead" : "sidebar.session.markUnread")}
                </Menu.Item>
                <Menu.Item onSelect={() => archiveTab()}>{language.t("common.archive")}</Menu.Item>
                <Menu.Separator />
              </>
            )}
          </Show>
          <Menu.Item disabled={!props.session || rename.isPending} onSelect={() => setMenu("rename", true)}>
            {language.t("common.rename")}
          </Menu.Item>
        </Menu.Context.Content>
      </Menu.Context.Portal>
    </Menu.Context>
  )
}

export function DraftTabItem(props: {
  ref?: Ref<HTMLDivElement>
  draftID?: string
  href: string
  title: string
  active?: boolean
  onNavigate: () => void
  onClose: () => void
  suppressNavigation?: boolean
  dragging?: boolean
  pressed?: boolean
  hidden?: boolean
  orientation?: "horizontal" | "vertical"
}) {
  const language = useLanguage()
  const dialog = useDialog()
  const org = useSessionOrganization()
  const chatKey = () => (props.draftID ? `draft:${props.draftID}` : undefined)

  const closeTab = (event: MouseEvent) => {
    event.preventDefault()
    event.stopPropagation()
    props.onClose()
  }

  return (
    <Menu.Context modal={false}>
      <div
        ref={(el) => {
          if (Predicate.isFunction(props.ref)) props.ref(el)
        }}
        data-titlebar-tab
        data-slot="titlebar-tab-item"
        data-orientation={props.orientation ?? "horizontal"}
        data-active={props.active}
        data-dragging={props.dragging}
        data-state={props.active || props.pressed ? "pressed" : undefined}
        class="group relative flex h-7 w-full min-w-0 flex-row items-center gap-1.5 overflow-hidden rounded-[6px] px-1.5 [container-type:inline-size] whitespace-nowrap"
        classList={{ invisible: props.hidden }}
        onMouseDown={(event) => {
          if (event.button !== MIDDLE_MOUSE_BUTTON) return
          event.preventDefault()
          event.stopPropagation()
        }}
        onAuxClick={(event) => {
          if (event.button !== MIDDLE_MOUSE_BUTTON) return
          closeTab(event)
        }}
      >
        <Menu.Context.Trigger
          as="a"
          data-slot="tab-link"
          data-titlebar-tab-link
          href={props.href}
          draggable={false}
          onDragStart={(event: DragEvent) => {
            event.preventDefault()
            event.stopPropagation()
          }}
          onMouseDown={(event: MouseEvent) => {
            // Navigate on mousedown to shave the press-release delay off tab switches.
            if (event.button !== 0) return

            if (props.suppressNavigation) return
            props.onNavigate()
          }}
          onClick={(event: MouseEvent) => {
            event.preventDefault()

            // Mouse navigation already happened on mousedown; detail 0 means keyboard activation.
            if (event.detail > 0) return

            if (props.suppressNavigation) return
            props.onNavigate()
          }}
          class="flex h-full min-w-0 flex-1 flex-row items-center gap-1.5 text-[13px] font-medium text-v2-text-text-faint group-data-[active='true']:text-v2-text-text-base [-webkit-user-drag:none]"
        >
          <span class="flex size-4 shrink-0 items-center justify-center">
            <svg
              class="text-v2-icon-icon-muted group-data-[active='true']:text-v2-icon-icon-base"
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              xmlns="http://www.w3.org/2000/svg"
              aria-hidden="true"
            >
              <path
                d="M9.00002 13.5H14M2.60419 10.9167V13.3958H5.08335L13.3959 5.08333L10.9167 2.60416L2.60419 10.9167Z"
                stroke="currentColor"
              />
            </svg>
          </span>
          <span
            data-titlebar-tab-title
            class="min-w-0 flex-1 overflow-hidden text-clip whitespace-nowrap outline-none leading-4"
          >
            {props.title}
          </span>
        </Menu.Context.Trigger>
        <Show when={props.orientation !== "vertical"}>
          <div data-slot="tab-close">
            <IconButton
              size="small"
              variant="ghost-muted"
              onPointerDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
              }}
              onMouseDown={(event) => {
                event.preventDefault()
                event.stopPropagation()
              }}
              class="hover-reveal relative z-10 group-hover:opacity-100 group-data-[active=true]:opacity-100 group-data-[editing=true]:opacity-100"
              onClick={closeTab}
              icon={<Icon name="xmark-small" />}
              aria-label={language.t("common.closeTab")}
            />
          </div>
        </Show>
      </div>
      <Menu.Context.Portal>
        <Menu.Context.Content>
          <Show when={chatKey()}>
            {(key) => (
              <>
                <Menu.Sub>
                  <Menu.SubTrigger>{language.t("sidebar.projects.assign")}</Menu.SubTrigger>
                  <Menu.Portal>
                    <Menu.SubContent class="max-h-72 overflow-y-auto">
                      <For each={org.folders()}>
                        {(folder) => (
                          <Menu.CheckboxItem
                            checked={org.folderID(key()) === folder.id}
                            onChange={() =>
                              org.assignFolder(key(), org.folderID(key()) === folder.id ? undefined : folder.id)
                            }
                          >
                            <span class="flex items-center gap-2">
                              <span class={`size-2 rounded-full ${ORGANIZE_COLOR_STYLES[folder.color].dot}`} />
                              <span class="max-w-44 truncate">{folder.name}</span>
                            </span>
                          </Menu.CheckboxItem>
                        )}
                      </For>
                      <Show when={org.folderID(key())}>
                        <Menu.Item onSelect={() => org.assignFolder(key(), undefined)}>
                          {language.t("sidebar.projects.unassign")}
                        </Menu.Item>
                      </Show>
                      <Show when={org.folders().length > 0 || org.folderID(key())}>
                        <Menu.Separator />
                      </Show>
                      <Menu.Item onSelect={() => void dialog.show(() => <DialogCreateFolder sessionIDs={[key()]} />)}>
                        {language.t("sidebar.projects.new")}…
                      </Menu.Item>
                    </Menu.SubContent>
                  </Menu.Portal>
                </Menu.Sub>
              </>
            )}
          </Show>
        </Menu.Context.Content>
      </Menu.Context.Portal>
    </Menu.Context>
  )
}
