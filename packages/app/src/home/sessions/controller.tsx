import type { SessionInfo } from "@opencode/client/promise"
import { useDialog } from "@opencode/ui/context/dialog"
import { Button } from "@opencode/ui/button"
import { DialogFooter, DialogHeader, DialogTitleGroup, Dialog } from "@opencode/ui/dialog"
import { skipToken, useQuery, useQueryClient } from "@tanstack/solid-query"
import { type Accessor, createEffect, createMemo, type JSX, startTransition, untrack } from "solid-js"
import { notifySessionTabsRemoved } from "@/shell/titlebar/session-events"
import { useCommand } from "@/shell/commands/command"
import {
  HOME_SESSION_LIMIT,
  loadHomeSessionIndex,
  mergeHomeSessionIndex,
  retainHomeSessions,
} from "@/home/sessions/index"
import type { LocalProject } from "@/shell/state/layout"
import { useLanguage } from "@/runtime/i18n/language"
import { ServerConnection } from "@/runtime/server/registry"
import { sessionHasOpenTab, useTabs } from "@/shell/tabs/tabs"
import { errorMessage } from "@/shell/layout/helpers"
import { useSessionTabAvatarState } from "@/shell/layout/project-avatar-state"
import { sessionTreeIDs } from "@/session/requests/session-request-tree"
import { pathKey } from "@/workspaces/path-key"
import { fetchSessionExport, saveSessionExport, sessionExportFilename } from "@/session/commands/export"
import { usePlatform } from "@/runtime/platform/platform"
import { sessionLabel, sessionTitle } from "@/session/title"
import { showToast } from "@/shell/notifications/toast"
import { useDirectoryPicker } from "@/workspaces/selection/picker"
import { homeProjectDirectories } from "@/shell/layout/helpers"
import {
  DialogAssignProject,
  DialogCreateFolder,
  DialogCreateTag,
  DialogMoveToFolder,
} from "@/session/organize-dialogs"
import type { OrganizeColor, SessionFilterMode, SessionFolder, SessionGroupBy } from "@/session/organization"
import { createStore } from "solid-js/store"
import { archiveHomeSession } from "./archive"
import type { HomeController } from "../model"
import { buildHomeSessionRecords, homeProjectForSession, homeSessionLocation, type HomeSessionRecord } from "./records"

export type { HomeSessionRecord } from "./records"

// Keep the immutable result opaque so Solid Query does not recursively unwrap every session on mount.
const selectSessions = (sessions: SessionInfo[]) => () => sessions

export type HomeSessionGroup = {
  id: string
  title: string
  sessions: HomeSessionRecord[]
}

export type OpenSessionOptions = { background?: boolean }

export function createHomeSessionsController(home: HomeController) {
  const tabs = useTabs()
  const command = useCommand()
  const dialog = useDialog()
  const language = useLanguage()
  const platform = usePlatform()
  const queryClient = useQueryClient()
  const pickDirectory = useDirectoryPicker()
  const org = home.organize.org

  const [selectionState, setSelectionState] = createStore<{
    active: boolean
    selected: string[]
  }>({
    active: false,
    selected: [],
  })

  const projectDirectories = createMemo(() => {
    const selected = home.selection.value().directory

    if (!selected) return
    const project = home.project.selected()

    return project ? directories(project) : [selected]
  })

  const sessionLoad = useQuery(() => {
    const ctx = home.server.focusedContext()
    const conn = home.server.focused()

    return {
      queryKey: ["home-sessions", conn] as const,
      enabled: !!ctx && ctx.sdk.connection.status() === "connected",
      queryFn: ctx
        ? ({ signal }) =>
            loadHomeSessionIndex((input, options) => ctx.sdk.api.session.list(input, options), signal, {
              includeArchived: true,
            })
        : skipToken,
      retry: false,
      staleTime: 30_000,
      refetchOnMount: true,
      refetchOnReconnect: true,
      select: selectSessions,
    }
  })

  const indexedSessions = createMemo(() => {
    const ctx = home.server.focusedContext()
    const conn = home.server.focused()

    if (!ctx || !conn) return []

    return retainHomeSessions(
      ctx.data.session.apply(
        mergeHomeSessionIndex(sessionLoad.isPending ? [] : (sessionLoad.data?.() ?? []), ctx.data.session.list(), {
          includeArchived: true,
        }),
      ),
      HOME_SESSION_LIMIT,
      Date.now(),
    )
  })

  const projectRecords = createMemo(() =>
    buildHomeSessionRecords({
      sessions: indexedSessions,
      projectDirectories,
      projects: home.project.list,
      resolveProject: (session) => home.server.focusedContext()?.projects.forSession(session),
      effectiveDirectory: (session) => org.effectiveDirectory(session),
    }),
  )

  const folderAndTagFiltered = createMemo(() => {
    const folderID = home.organize.folderID()
    const tag = home.organize.tag()

    return projectRecords().filter((record) => {
      if (folderID && org.folderID(record.session.id) !== folderID) return false

      if (tag && !org.tagsForSession(record.session.id).includes(tag)) return false

      return true
    })
  })

  const counts = createMemo(() => {
    let active = 0
    let pinned = 0
    let archived = 0

    for (const record of folderAndTagFiltered()) {
      const isArch = org.isArchived(record.session)

      if (isArch) {
        archived++
        continue
      }

      active++

      if (org.isPinned(record.session.id)) pinned++
    }

    return { active, pinned, archived }
  })

  const allRecords = createMemo(() => {
    const mode = home.organize.mode()

    return folderAndTagFiltered().filter((record) => {
      const archived = org.isArchived(record.session)

      if (mode === "archived") return archived

      if (archived) return false

      if (mode === "pinned") return org.isPinned(record.session.id)

      return true
    })
  })

  const records = createMemo(() => allRecords().slice(0, HOME_SESSION_LIMIT))

  const groups = createMemo(() =>
    groupSessions({
      records: records(),
      language,
      mode: home.organize.mode(),
      groupBy: org.groupBy(),
      isPinned: (id) => org.isPinned(id),
      folderForSession: (id) => org.folderForSession(id),
      folders: org.folders(),
    }),
  )

  const prefetched = new Set<string>()

  const location = (record: HomeSessionRecord) => {
    const branch = home.server.focusedContext()?.data.location.vcs.info(record.session.location)?.branch.current

    return homeSessionLocation(record.session.location.directory, branch)
  }

  const syncLocations = (record?: HomeSessionRecord) => {
    if (platform.platform !== "desktop") return
    const ctx = home.server.focusedContext()

    if (!ctx) return

    if (record) {
      void ctx.data.location.vcs.sync(record.session.location).catch(() => undefined)

      return
    }

    const locations = new Map(
      records().map((record) => [pathKey(record.session.location.directory), record.session.location] as const),
    )

    void Promise.allSettled(Array.from(locations.values(), (location) => ctx.data.location.vcs.sync(location)))
  }

  createEffect(() => {
    const ctx = home.server.focusedContext()
    const conn = home.server.focused()

    if (!ctx || !conn) return
    records()
      .slice(0, 2)
      .forEach((record) => {
        const key = `${ServerConnection.key(conn)}\0${record.session.id}`

        if (prefetched.has(key)) return
        prefetched.add(key)
        void untrack(() => ctx.data.session.sync(record.session.id)).catch(() => {})
      })
  })

  command.register("home.palette", () => [
    {
      id: "command.palette",
      title: language.t("command.palette"),
      hidden: true,
      onSelect: async () => {
        const conn = home.server.focused()

        if (!conn) return
        const ctx = home.server.focusedContext()

        if (!ctx) return
        const { HomeCommandPalette } = await import("./command-palette")
        void dialog.show(() => (
          <HomeCommandPalette
            server={conn}
            onSelectSession={(entry) => {
              if (!entry.sessionID || !entry.directory || !entry.server) return
              const sessionID = entry.sessionID
              const server = entry.server
              const directory = entry.project?.worktree ?? entry.directory
              ctx.projects.open(directory)
              ctx.projects.touch(directory)
              void startTransition(() => {
                const tab = tabs.addSessionTab({ server, sessionId: sessionID })
                tabs.select(tab)
              })
            }}
          />
        ))
      },
    },
  ])

  const rename = async (server: ServerConnection.Key, session: SessionInfo, title: string) => {
    const conn = home.server.list().find((item) => ServerConnection.key(item) === server)
    const ctx = conn ? home.server.context(conn) : undefined

    if (!conn || !ctx) return false
    const next = title.trim()

    if (!next || next === sessionLabel(session)) return true

    return ctx.sdk.api.session
      .update({ sessionID: session.id, title: next })
      .then(() => {
        ctx.data.session.remember({ ...(ctx.data.session.get(session.id) ?? session), title: next })
        // Rename advances time.updated server-side; re-sync the canonical
        // record so date grouping and ordering do not go stale.
        ctx.data.session.invalidate(session.id)
        void ctx.data.session.sync(session.id).catch(() => {})
        queryClient.setQueryData<SessionInfo[]>(["home-sessions", conn], (current) =>
          current?.map((item) => (item.id === session.id ? { ...item, title: next } : item)),
        )

        return true
      })
      .catch((cause) => {
        showToast({
          title: language.t("common.requestFailed"),
          description: errorMessage(cause, language.t("common.requestFailed")),
        })

        return false
      })
  }

  const exportSession = async (server: ServerConnection.Key, session: SessionInfo) => {
    const conn = home.server.list().find((item) => ServerConnection.key(item) === server)
    const ctx = conn ? home.server.context(conn) : undefined

    if (!ctx) return

    try {
      const data = await fetchSessionExport({ sessionID: session.id, api: ctx.sdk.api })
      const filename = sessionExportFilename(data.info)

      if (!(await saveSessionExport(filename, data, platform))) return
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("toast.session.export.success.title"),
        description: language.t("toast.session.export.success.description", { filename }),
      })
    } catch (cause) {
      showToast({
        variant: "error",
        title: language.t("toast.session.export.failed.title"),
        description: cause instanceof Error ? cause.message : language.t("toast.session.export.failed.description"),
      })
    }
  }

  const remove = async (server: ServerConnection.Key, session: SessionInfo) => {
    const conn = home.server.list().find((item) => ServerConnection.key(item) === server)
    const ctx = conn ? home.server.context(conn) : undefined

    if (!conn || !ctx) return false
    const ids = sessionTreeIDs(ctx.data.session.list(), session.id)

    return ctx.data.session
      .remove(session.id)
      .then(() => {
        notifySessionTabsRemoved({
          server: ServerConnection.key(conn),
          directory: session.location.directory,
          sessionIDs: ids,
        })

        return true
      })
      .catch((cause) => {
        showToast({
          title: language.t("session.delete.failed.title"),
          description: errorMessage(cause, language.t("session.delete.failed.title")),
        })

        return false
      })
      .finally(() => {
        void queryClient.invalidateQueries({ queryKey: ["home-sessions", conn], exact: true })
      })
  }

  function DeleteDialog(props: { server: ServerConnection.Key; session: SessionInfo }) {
    const name = () => sessionTitle(props.session.title) ?? language.t("command.session.new")

    const confirm = async () => {
      await remove(props.server, props.session)
      dialog.close()
    }

    return (
      <Dialog fit>
        <DialogHeader hideClose>
          <DialogTitleGroup
            title={language.t("session.delete.title")}
            description={language.t("session.delete.confirm", { name: name() })}
          />
        </DialogHeader>
        <DialogFooter>
          <Button variant="ghost" onClick={() => dialog.close()}>
            {language.t("common.cancel")}
          </Button>
          <Button variant="danger" onClick={confirm}>
            {language.t("session.delete.button")}
          </Button>
        </DialogFooter>
      </Dialog>
    )
  }

  const chooseDirectoryForSessions = (sessionIDs: readonly string[]) => {
    const conn = home.server.focused()

    if (!conn || sessionIDs.length === 0) return
    pickDirectory({
      server: conn,
      title: language.t("session.organize.assignProject"),
      multiple: false,
      onSelect: (result) => {
        const dirs = homeProjectDirectories(result)
        const dir = dirs[0]

        if (!dir) return
        home.project.add(conn, [dir])
        home.organize.assignSessionsToProject(conn, sessionIDs, dir)
      },
    })
  }

  return {
    copy: {
      language,
    },
    data: {
      records,
      groups,
      counts,
      loading: () => sessionLoad.isPending,
      searchRecords: allRecords,
    },
    organize: {
      mode: home.organize.mode,
      setMode: (mode: SessionFilterMode) => {
        home.organize.setMode(mode)
        setSelectionState("selected", [])
      },
      groupBy: org.groupBy,
      setGroupBy: (groupBy: SessionGroupBy) => org.setGroupBy(groupBy),
      folderID: home.organize.folderID,
      activeFolder: () => org.folder(home.organize.folderID()),
      setFolderID: home.organize.setFolderID,
      clearFolder: home.organize.clearFolder,
      tag: home.organize.tag,
      setTag: home.organize.setTag,
      clearTag: home.organize.clearTag,
      folders: org.folders,
      allTags: org.allTags,
      tagColor: (tag: string): OrganizeColor => org.tagColor(tag),
      isArchived: (session: SessionInfo) => org.isArchived(session),
      isPinned: (sessionID: string) => org.isPinned(sessionID),
      folderForSession: (sessionID: string): SessionFolder | undefined => org.folderForSession(sessionID),
      tagsForSession: (sessionID: string) => org.tagsForSession(sessionID),
      projects: home.project.list,
      togglePin: (session: SessionInfo) => {
        org.togglePin(session.id)
      },
      assignProject: (session: SessionInfo, directory: string) => {
        const conn = home.server.focused()

        if (!conn) return
        home.organize.assignSessionsToProject(conn, [session.id], directory)
      },
      chooseProjectDirectory: (session: SessionInfo) => {
        chooseDirectoryForSessions([session.id])
      },
      openAssignProjectDialog: (session: SessionInfo) => {
        void dialog.show(() => (
          <DialogAssignProject
            projects={home.project.list()}
            currentDirectory={org.effectiveDirectory(session)}
            onSelectProject={(directory) => {
              const conn = home.server.focused()

              if (conn) home.organize.assignSessionsToProject(conn, [session.id], directory)
            }}
            onChooseDirectory={() => chooseDirectoryForSessions([session.id])}
          />
        ))
      },
      assignFolder: (session: SessionInfo, folderID: string | undefined) => {
        org.assignFolder(session.id, folderID)
        const folder = org.folder(folderID)
        showToast({
          title: folder
            ? language.t("toast.session.movedFolder.title", { folder: folder.name })
            : language.t("toast.session.removedFolder.title"),
        })
      },
      openCreateFolderDialog: (sessionIDs?: readonly string[]) => {
        void dialog.show(() => <DialogCreateFolder sessionIDs={sessionIDs} />)
      },
      openMoveToFolderDialog: (session: SessionInfo) => {
        void dialog.show(() => (
          <DialogMoveToFolder sessionIDs={[session.id]} currentFolderID={org.folderID(session.id)} />
        ))
      },
      toggleTag: (session: SessionInfo, tag: string) => {
        org.toggleTag(session.id, tag)
      },
      clearTags: (session: SessionInfo) => {
        org.clearTags(session.id)
      },
      openCreateTagDialog: (sessionIDs: readonly string[]) => {
        void dialog.show(() => <DialogCreateTag sessionIDs={sessionIDs} />)
      },
      setDraggingSessions: (sessionID: string) => {
        const selected = selectionState.selected
        const ids = selectionState.active && selected.includes(sessionID) ? selected : [sessionID]
        home.organize.setDraggingSessionIDs(ids)

        return ids
      },
      clearDraggingSessions: () => home.organize.setDraggingSessionIDs([]),
      selection: {
        active: () => selectionState.active,
        toggleMode: () => {
          const next = !selectionState.active
          setSelectionState({ active: next, selected: [] })
        },
        selected: () => selectionState.selected,
        count: () => selectionState.selected.length,
        isSelected: (sessionID: string) => selectionState.selected.includes(sessionID),
        toggle: (sessionID: string) => {
          setSelectionState("selected", (current) =>
            current.includes(sessionID) ? current.filter((id) => id !== sessionID) : [...current, sessionID],
          )
        },
        selectAll: () => {
          const visibleIDs = records().map((record) => record.session.id)

          const allSelected =
            visibleIDs.length > 0 && visibleIDs.every((id) => selectionState.selected.includes(id))

          setSelectionState("selected", allSelected ? [] : visibleIDs)
        },
        clear: () => setSelectionState("selected", []),
        bulkPin: (pinned: boolean) => {
          const ids = selectionState.selected

          if (ids.length === 0) return
          org.pinMany(ids, pinned)
          setSelectionState("selected", [])
        },
        bulkAssignProject: (directory: string) => {
          const conn = home.server.focused()
          const ids = selectionState.selected

          if (!conn || ids.length === 0) return
          home.organize.assignSessionsToProject(conn, ids, directory)
          setSelectionState("selected", [])
        },
        bulkChooseDirectory: () => {
          const ids = [...selectionState.selected]

          if (ids.length === 0) return
          chooseDirectoryForSessions(ids)
          setSelectionState("selected", [])
        },
        bulkAssignFolder: (folderID: string | undefined) => {
          const ids = selectionState.selected

          if (ids.length === 0) return
          org.assignFolderMany(ids, folderID)
          const folder = org.folder(folderID)
          showToast({
            title: folder
              ? language.plural("toast.session.bulkMovedFolder", ids.length, { folder: folder.name })
              : language.t("toast.session.removedFolder.title"),
          })
          setSelectionState("selected", [])
        },
        bulkCreateFolder: () => {
          const ids = [...selectionState.selected]

          if (ids.length === 0) return
          void dialog.show(() => (
            <DialogCreateFolder
              sessionIDs={ids}
              onCreated={() => setSelectionState("selected", [])}
            />
          ))
        },
        bulkToggleTag: (tag: string) => {
          const ids = selectionState.selected

          if (ids.length === 0) return
          org.addTagMany(ids, tag)
        },
        bulkCreateTag: () => {
          const ids = [...selectionState.selected]

          if (ids.length === 0) return
          void dialog.show(() => <DialogCreateTag sessionIDs={ids} />)
        },
        bulkArchive: () => {
          const conn = home.server.focused()
          const ids = [...selectionState.selected]

          if (!conn || ids.length === 0) return
          const restoring = home.organize.mode() === "archived"

          if (restoring) {
            org.unarchiveMany(ids)
            showToast({
              variant: "success",
              icon: "circle-check",
              title: language.plural("toast.session.bulkUnarchived", ids.length),
            })
            setSelectionState("selected", [])

            return
          }

          org.archiveMany(ids)
          const serverKey = ServerConnection.key(conn)

          for (const record of records()) {
            if (!ids.includes(record.session.id)) continue
            notifySessionTabsRemoved({
              server: serverKey,
              directory: record.session.location.directory,
              sessionIDs: [record.session.id],
            })
          }

          showToast({
            icon: "archive",
            title: language.plural("toast.session.bulkArchived", ids.length),
          })
          setSelectionState("selected", [])
        },
      },
    },
    platform: {
      desktop: platform.platform === "desktop",
    },
    location: {
      value: location,
      sync: syncLocations,
    },
    session: {
      showProjectName: () => !home.project.selected() && org.groupBy() !== "project",
      server: () => home.selection.value().server,
      canCreate: () => !!home.project.newSession(),
      lookup: async (sessionID: string) => {
        const ctx = home.server.focusedContext()

        if (!ctx) return
        const result = await ctx.sdk.api.session.get({ sessionID })

        if (org.isArchived(result) && home.organize.mode() !== "archived") return

        return buildHomeSessionRecords({
          sessions: () => [result],
          projectDirectories,
          projects: home.project.list,
          resolveProject: ctx.projects.forSession,
          effectiveDirectory: (session) => org.effectiveDirectory(session),
        })[0]
      },
      create: home.project.openNewSession,
      open: (session: SessionInfo, options?: OpenSessionOptions) => {
        const effective = org.effectiveSession(session)
        const project = homeProjectForSession(effective, home.project.list())
        const conn = home.server.focused()

        if (!conn) return
        const connKey = ServerConnection.key(conn)
        const directory = project?.worktree ?? effective.location.directory
        const ctx = home.server.focusedContext()

        if (!ctx) return

        if (!options?.background) void ctx.data.session.message.sync(session.id).catch(() => undefined)
        // Commit cache/project changes with navigation instead of rebuilding
        // the outgoing Home list before leaving it.
        void startTransition(() => {
          const tab = tabs.addSessionTab({ server: connKey, sessionId: session.id })

          if (!options?.background) tabs.select(tab)
          ctx.data.session.remember(effective)
          ctx.projects.open(directory)

          if (!options?.background) ctx.projects.touch(directory)
        })
      },
      archive: async (session: SessionInfo) => {
        const conn = home.server.focused()
        const ctx = home.server.focusedContext()

        if (!conn || !ctx) return

        if (org.isArchived(session)) {
          org.unarchive(session.id)
          showToast({
            variant: "success",
            icon: "circle-check",
            title: language.t("toast.session.unarchived.title"),
          })

          return
        }

        await archiveHomeSession({
          server: ServerConnection.key(conn),
          session,
          archive: async (sessionID) => {
            org.archive(sessionID)
          },
          remove() {
            showToast({
              icon: "archive",
              title: language.t("toast.session.archived.title"),
            })
          },
          onError: (cause) =>
            showToast({
              title: language.t("common.requestFailed"),
              description: errorMessage(cause, language.t("common.requestFailed")),
            }),
        })
      },
      rename,
      export: exportSession,
      showDelete: (server: ServerConnection.Key, session: SessionInfo) =>
        dialog.show(() => <DeleteDialog server={server} session={session} />),
    },
    tab: {
      isOpen: (record: HomeSessionRecord) => {
        const server = home.selection.value().server

        return !!server && sessionHasOpenTab(tabs.store, server, record.session)
      },
    },
  }
}

function directories(project: LocalProject) {
  return [project.worktree, ...(project.sandboxes ?? [])]
}

export function homeSessionSearchKey(record: HomeSessionRecord) {
  return `${pathKey(record.session.location.directory)}:${record.session.id}`
}

// Calendar day in the local time zone, comparable as a number.
function localDay(date: Date) {
  return date.getFullYear() * 10_000 + date.getMonth() * 100 + date.getDate()
}

function groupSessions(input: {
  records: HomeSessionRecord[]
  language: ReturnType<typeof useLanguage>
  mode: SessionFilterMode
  groupBy: SessionGroupBy
  isPinned: (sessionID: string) => boolean
  folderForSession: (sessionID: string) => SessionFolder | undefined
  folders: readonly SessionFolder[]
}): HomeSessionGroup[] {
  const { records, language, mode, groupBy, isPinned, folderForSession, folders } = input

  if (records.length === 0) return []

  if (groupBy === "project") {
    const byProject = new Map<string, { title: string; sessions: HomeSessionRecord[] }>()

    for (const record of records) {
      const key = pathKey(record.project.worktree)
      const existing = byProject.get(key)

      if (existing) {
        existing.sessions.push(record)
        continue
      }

      byProject.set(key, { title: record.projectName, sessions: [record] })
    }

    return [...byProject.entries()].map(([key, value]) => ({
      id: `project:${key}`,
      title: value.title,
      sessions: value.sessions,
    }))
  }

  if (groupBy === "folder") {
    const byFolder = new Map<string, HomeSessionRecord[]>()
    const unfiled: HomeSessionRecord[] = []

    for (const record of records) {
      const folder = folderForSession(record.session.id)

      if (!folder) {
        unfiled.push(record)
        continue
      }

      const list = byFolder.get(folder.id) ?? []
      list.push(record)
      byFolder.set(folder.id, list)
    }

    const result: HomeSessionGroup[] = folders.flatMap((folder) => {
      const sessions = byFolder.get(folder.id)

      return sessions && sessions.length > 0 ? [{ id: `folder:${folder.id}`, title: folder.name, sessions }] : []
    })

    if (unfiled.length > 0) {
      result.push({ id: "folder:unfiled", title: language.t("home.sessions.group.unfiled"), sessions: unfiled })
    }

    return result
  }

  if (mode === "pinned") {
    return [{ id: "pinned", title: language.t("home.sessions.group.pinned"), sessions: records }]
  }

  const pinnedSessions = mode === "active" ? records.filter((record) => isPinned(record.session.id)) : []
  const unpinnedRecords = mode === "active" ? records.filter((record) => !isPinned(record.session.id)) : records

  const now = new Date()
  const today = localDay(now)
  const yesterday = localDay(new Date(now.getFullYear(), now.getMonth(), now.getDate() - 1))
  const day = (record: HomeSessionRecord) => localDay(new Date(record.session.time.updated ?? record.session.time.created))
  const todaySessions = unpinnedRecords.filter((record) => day(record) === today)
  const yesterdaySessions = unpinnedRecords.filter((record) => day(record) === yesterday)
  const olderSessions = unpinnedRecords.filter((record) => day(record) !== today && day(record) !== yesterday)

  const olderTitle =
    todaySessions.length === 0 && yesterdaySessions.length === 0 && pinnedSessions.length === 0
      ? mode === "archived"
        ? language.t("home.sessions.group.archived")
        : language.t("sidebar.project.recentSessions")
      : language.t("home.sessions.group.older")

  return [
    { id: "pinned", title: language.t("home.sessions.group.pinned"), sessions: pinnedSessions },
    { id: "today", title: language.t("home.sessions.group.today"), sessions: todaySessions },
    { id: "yesterday", title: language.t("home.sessions.group.yesterday"), sessions: yesterdaySessions },
    { id: "older", title: olderTitle, sessions: olderSessions },
  ].filter((group) => group.sessions.length > 0)
}

export type HomeSessionsController = ReturnType<typeof createHomeSessionsController>

export function HomeSessionStatusController(props: {
  server: ServerConnection.Key
  record: HomeSessionRecord
  isOpenTab: (record: HomeSessionRecord) => boolean
  render: (state: { unread: Accessor<boolean>; loading: Accessor<boolean>; open: Accessor<boolean> }) => JSX.Element
}) {
  const avatar = useSessionTabAvatarState(
    () => props.server,
    () => props.record.session.id,
    () => true,
  )

  return props.render({
    unread: avatar.unread,
    loading: avatar.loading,
    open: () => props.isOpenTab(props.record),
  })
}
