import { useGlobal, useServerCtx } from "@/runtime/server/runtime"
import { type HomeProjectSelection, useLayout } from "@/shell/state/layout"
import { ServerConnection, useServers } from "@/runtime/server/registry"
import { useTabs } from "@/shell/tabs/tabs"
import { toggleHomeProjectSelection } from "@/shell/layout/helpers"
import { createEffect, createMemo, startTransition } from "solid-js"
import { createStore } from "solid-js/store"
import type { SessionInfo } from "@opencode/client/promise"
import { displayName } from "@opencode/ui/project-avatar"
import { useLanguage } from "@/runtime/i18n/language"
import { showToast } from "@/shell/notifications/toast"
import { useSessionOrganization, type SessionFilterMode } from "@/session/organization"
import { pathKey } from "@/workspaces/path-key"
import { addProjects } from "./projects/add"

export function createHomeController() {
  const layout = useLayout()
  const global = useGlobal()
  const servers = useServers()
  const tabs = useTabs()
  const language = useLanguage()
  const org = useSessionOrganization()
  const selection = layout.home.selection

  const [organizeFilter, setOrganizeFilter] = createStore<{
    mode: SessionFilterMode
    folderID: string | undefined
    tag: string | undefined
    draggingSessionIDs: string[]
  }>({
    mode: "active",
    folderID: undefined,
    tag: undefined,
    draggingSessionIDs: [],
  })

  const focusedServer = createMemo<ServerConnection.Any | undefined>(
    () => servers.visible.find((conn) => ServerConnection.key(conn) === selection().server) ?? servers.visible[0],
  )

  const focusedServerCtx = useServerCtx(focusedServer)
  const focusedSync = () => focusedServerCtx()?.sync
  const projects = createMemo(() => focusedServerCtx()?.projects.list() ?? [])
  const recentlyClosed = createMemo(() => focusedServerCtx()?.projects.recentlyClosed() ?? [])
  const homedir = createMemo(() => focusedSync()?.data.path.home ?? "")
  const selectedProject = createMemo(() => projects().find((project) => project.worktree === selection().directory))

  const newSessionProject = createMemo(
    () =>
      selectedProject() ??
      projects().find((project) => project.worktree === focusedServerCtx()?.projects.last()) ??
      projects()[0],
  )

  createEffect(() => {
    const list = servers.visible

    if (list.some((conn) => ServerConnection.key(conn) === selection().server)) return
    const conn = list[0]

    if (conn) setSelection({ server: ServerConnection.key(conn) })
  })
  createEffect(() => {
    const ctx = focusedServerCtx()
    const id = selectedProject()?.id

    if (!ctx || !id || ctx.sdk.connection.status() !== "connected") return
    // Selecting a project is the demand for its worktree inventory: the session filter spans its worktrees.
    void ctx.sync.worktrees.list(id).then(() => ctx.sync.worktrees.refresh(id))
  })
  createEffect(() => {
    const ctx = focusedServerCtx()

    if (!ctx) return
    const opened = ctx.projects.list()
    const closed = ctx.projects.closed()

    if (opened.length > 0 || closed.length > 0) return
    const serverProjects = ctx.sync.data.project

    if (serverProjects.length === 0) return
    const homeDir = pathKey(ctx.sync.data.path.home ?? "")

    const candidates = serverProjects.flatMap((item) =>
      item.id !== "global" &&
      item.worktree &&
      item.worktree !== "/" &&
      !item.worktree.startsWith("/private/var/") &&
      !item.worktree.startsWith("/var/folders/") &&
      pathKey(item.worktree) !== homeDir
        ? [item.worktree]
        : [],
    )

    if (candidates.length > 0) addProjects(ctx, candidates)
  })
  createEffect(() => {
    // The project list is empty until the server store hydrates; clearing the restored
    // selection against it would persist the loss.
    if (!servers.hydrated()) return
    const current = selection()
    const directory = current.directory

    if (!directory) return
    const conn = servers.visible.find((conn) => ServerConnection.key(conn) === current.server)

    if (!conn) return

    if (
      global
        .ensureServerCtx(conn)
        .projects.list()
        .some((project) => pathKey(project.worktree) === pathKey(directory))
    )
      return
    setSelection({ server: current.server })
  })

  function setSelection(next: HomeProjectSelection) {
    layout.home.setSelection(next)
  }

  function openProjectNewSession(conn: ServerConnection.Any, directory: string) {
    const ctx = global.ensureServerCtx(conn)
    ctx.projects.open(directory)
    ctx.projects.touch(directory)
    void tabs.newDraft({ server: ServerConnection.key(conn), directory })
  }

  function openProjectSession(conn: ServerConnection.Any, directory: string, session: SessionInfo) {
    const ctx = global.ensureServerCtx(conn)
    void ctx.data.session.message.sync(session.id).catch(() => undefined)
    void startTransition(() => {
      const tab = tabs.addSessionTab({ server: ServerConnection.key(conn), sessionId: session.id })
      tabs.select(tab)
      ctx.data.session.remember(session)
      ctx.projects.open(directory)
      ctx.projects.touch(directory)
    })
  }

  function assignSessionsToProject(conn: ServerConnection.Any, sessionIDs: readonly string[], directory: string) {
    if (sessionIDs.length === 0) return
    const ctx = global.ensureServerCtx(conn)
    ctx.projects.open(directory)
    org.assignProjectMany(sessionIDs, directory)

    const targetProject =
      ctx.projects.list().find((item) => pathKey(item.worktree) === pathKey(directory)) ??
      ctx.projects.resolve({ worktree: directory, expanded: true })

    const projectName = displayName(targetProject)

    for (const sessionID of sessionIDs) {
      const existing = ctx.data.session.get(sessionID)

      if (existing) {
        ctx.data.session.remember({
          ...existing,
          location: { ...existing.location, directory },
        })
      }

      void ctx.sdk.api.session
        .move({ sessionID, directory })
        .then(() => ctx.data.session.sync(sessionID))
        .catch(() => {})
    }

    showToast({
      variant: "success",
      icon: "circle-check",
      title:
        sessionIDs.length === 1
          ? language.t("toast.session.assignedProject.title", { project: projectName })
          : language.plural("toast.session.bulkAssignedProject", sessionIDs.length, { project: projectName }),
    })
  }

  return {
    organize: {
      org,
      mode: () => organizeFilter.mode,
      setMode: (mode: SessionFilterMode) => setOrganizeFilter("mode", mode),
      folderID: () => organizeFilter.folderID,
      setFolderID: (folderID: string | undefined) => {
        setOrganizeFilter("folderID", (current) => (current === folderID ? undefined : folderID))

        if (folderID && organizeFilter.mode === "archived") setOrganizeFilter("mode", "active")
      },
      clearFolder: () => setOrganizeFilter("folderID", undefined),
      tag: () => organizeFilter.tag,
      setTag: (tag: string | undefined) => {
        setOrganizeFilter("tag", (current) => (current === tag ? undefined : tag))

        if (tag && organizeFilter.mode === "archived") setOrganizeFilter("mode", "active")
      },
      clearTag: () => setOrganizeFilter("tag", undefined),
      draggingSessionIDs: () => organizeFilter.draggingSessionIDs,
      setDraggingSessionIDs: (ids: string[]) => setOrganizeFilter("draggingSessionIDs", ids),
      assignSessionsToProject,
    },
    selection: {
      value: selection,
      set: setSelection,
      focusServer: (conn: ServerConnection.Any) => setSelection({ server: ServerConnection.key(conn) }),
    },
    server: {
      list: () => servers.visible,
      health: (conn: ServerConnection.Any) => global.servers.health[ServerConnection.key(conn)],
      context: (conn: ServerConnection.Any) => global.ensureServerCtx(conn),
      focused: focusedServer,
      focusedContext: focusedServerCtx,
      focusedSync,
    },
    project: {
      list: projects,
      recentlyClosed,
      homedir,
      selected: selectedProject,
      newSession: newSessionProject,
      forServer: (conn: ServerConnection.Any) => global.ensureServerCtx(conn).projects.list(),
      select: (conn: ServerConnection.Any, directory: string) => {
        const key = ServerConnection.key(conn)

        if (global.servers.health[key]?.healthy === false) return

        if (
          !global
            .ensureServerCtx(conn)
            .projects.list()
            .some((project) => project.worktree === directory)
        )
          return
        setSelection(toggleHomeProjectSelection(selection(), key, directory))
      },
      add: (conn: ServerConnection.Any, directories: string[]) => {
        const directory = addProjects(global.ensureServerCtx(conn), directories)

        if (!directory) return
        setSelection({ server: ServerConnection.key(conn), directory })
      },
      openNewSession: () => {
        const conn = focusedServer()
        const project = newSessionProject()

        if (!conn || !project) return
        openProjectNewSession(conn, project.worktree)
      },
      openProjectNewSession,
      openProjectSession,
    },
  }
}

export type HomeController = ReturnType<typeof createHomeController>
