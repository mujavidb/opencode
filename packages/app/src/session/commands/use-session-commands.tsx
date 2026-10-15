import { useCommand, type CommandOption } from "@/shell/commands/command"
import { useDialog } from "@opencode/ui/context/dialog"
import { previewSelectedLines } from "@opencode/session-ui/pierre/selection-bridge"
import { useFile, selectionFromLines, type FileSelection } from "@/workspaces/files/model"
import { useLanguage } from "@/runtime/i18n/language"
import { useLayout } from "@/shell/state/layout"
import { useComposerState } from "@/composer/persistence"
import { useServerSDK } from "@/runtime/server/client"
import { useData } from "@/runtime/server/current"
import { formatServerError } from "@/runtime/server/errors"
import { useSettings } from "@/settings/model"
import { showToast } from "@/shell/notifications/toast"
import { fetchSessionExport, saveSessionExport, sessionExportFilename } from "@/session/commands/export"
import { usePlatform } from "@/runtime/platform/platform"
import type { SessionModel } from "@/session/model"
import type { SessionRevert } from "@/session/revert"
import { Command } from "@opencode/gui-extensions/sdk"
import { useExtensionHost } from "@/runtime/extension/host"
import type { Region } from "@/runtime/extension/panels"
import { useSessionOrganization } from "@/session/organization"
import { notifySessionTabsRemoved } from "@/shell/titlebar/session-events"
import { useServer } from "@/runtime/server/current"
import { displayName } from "@opencode/ui/project-avatar"

type SessionCommandSource = {
  identity: SessionModel["identity"]
  data: Pick<SessionModel["data"], "info" | "revertMessageID">
  history: Pick<SessionModel["history"], "visibleUserMessages">
  layout: SessionModel["layout"]
  ownership: SessionModel["ownership"]
}

export type SessionCommandContext = {
  session: SessionCommandSource
  region: Region
  background: {
    blocking: () => boolean
    move: () => Promise<void>
  }
  navigateMessageByOffset: (offset: number) => void
  revert: Pick<SessionRevert, "undo" | "redo">
  focusInput: () => void
  // The composer's model, which a compaction runs with.
  model: () => { id: string; providerID: string; variant?: string } | undefined
}

const withCategory = (category: string) => {
  return (option: Omit<CommandOption, "category">): CommandOption => ({
    ...option,
    category,
  })
}

export const useSessionCommands = (actions: SessionCommandContext) => {
  const command = useCommand()
  const dialog = useDialog()
  const file = useFile()
  const language = useLanguage()
  const prompt = useComposerState()
  const serverSDK = useServerSDK()
  const data = useData()
  const settings = useSettings()
  const platform = usePlatform()
  const layout = useLayout()
  const host = useExtensionHost()
  const org = useSessionOrganization()
  const server = useServer()

  const openDialog = async <T,>(load: () => Promise<T>, show: (value: T) => void) => {
    const owner = actions.session.ownership.capture()
    const value = await load()
    owner.run(() => show(value))
  }

  const shown = settings.visibility.fileTree

  // The file the selected side tab shows; other tabs have no line selection.
  const activeFile = () => actions.region.selected()?.tab.file

  // Pinned tabs stay open.
  const closableTab = () => {
    const entry = actions.region.selected()

    return entry && !entry.tab.pinned ? entry.key : undefined
  }

  // Focus inside an extension command's scope belongs to that extension, which binds its own shortcuts there.
  const extensionScoped = (target: EventTarget | null) =>
    target instanceof Element &&
    host.items(Command).some((item) => !!item.value.scope && !!target.closest(item.value.scope))

  const selectionPreview = (path: string, selection: FileSelection) => {
    const content = file.get(path)?.content?.content

    if (!content) return undefined

    return previewSelectedLines(content, { start: selection.startLine, end: selection.endLine })
  }

  const addSelectionToContext = (path: string, selection: FileSelection) => {
    const preview = selectionPreview(path, selection)
    prompt.context.add({ type: "file", path, selection, preview })
  }

  const canAddSelectionContext = () => {
    const path = activeFile()

    if (!path) return false

    return file.selectedLines(path) != null
  }

  const navigateMessageByOffset = actions.navigateMessageByOffset
  const focusInput = actions.focusInput

  const sessionCommand = withCategory(language.t("command.category.session"))
  const projectCommand = withCategory(language.t("command.category.project"))
  const fileCommand = withCategory(language.t("command.category.file"))
  const contextCommand = withCategory(language.t("command.category.context"))
  const viewCommand = withCategory(language.t("command.category.view"))
  const mcpCommand = withCategory(language.t("command.category.mcp"))
  const permissionsCommand = withCategory(language.t("command.category.permissions"))

  const exportSession = async () => {
    const sessionID = actions.session.identity.params.id

    if (!sessionID) return

    try {
      const data = await fetchSessionExport({
        sessionID,
        api: serverSDK.api,
      })

      const filename = sessionExportFilename(data.info)

      if (!(await saveSessionExport(filename, data, platform))) return
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("toast.session.export.success.title"),
        description: language.t("toast.session.export.success.description", { filename }),
      })
    } catch (err) {
      showToast({
        variant: "error",
        title: language.t("toast.session.export.failed.title"),
        description: err instanceof Error ? err.message : language.t("toast.session.export.failed.description"),
      })
    }
  }

  const copySessionID = async () => {
    const sessionID = actions.session.identity.params.id

    if (!sessionID) return

    try {
      await (platform.writeClipboardText?.(sessionID) ?? navigator.clipboard.writeText(sessionID))
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("common.copied"),
        description: sessionID,
      })
    } catch (err) {
      showToast({
        variant: "error",
        title: language.t("toast.session.copyID.failed.title"),
        description: err instanceof Error ? err.message : language.t("toast.session.copyID.failed.description"),
      })
    }
  }

  const copyProjectID = async () => {
    const projectID = actions.session.data.info()?.projectID

    if (!projectID) return

    try {
      await (platform.writeClipboardText?.(projectID) ?? navigator.clipboard.writeText(projectID))
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("common.copied"),
        description: projectID,
      })
    } catch (err) {
      showToast({
        variant: "error",
        title: language.t("toast.project.copyID.failed.title"),
        description: err instanceof Error ? err.message : language.t("toast.project.copyID.failed.description"),
      })
    }
  }

  const openFile = () => {
    void openDialog(
      () => import("@/shell/commands/dialog"),
      (x) => dialog.show(() => <x.DialogCommandPalette />),
    )
  }

  const closeTab = () => {
    const tab = closableTab()

    if (tab) actions.region.close(tab)
  }

  const addSelection = () => {
    const path = activeFile()

    if (!path) return

    const range = file.selectedLines(path)

    if (!range) {
      showToast({
        title: language.t("toast.context.noLineSelection.title"),
        description: language.t("toast.context.noLineSelection.description"),
      })

      return
    }

    addSelectionToContext(path, selectionFromLines(range))
  }

  const chooseMcp = () => {
    void openDialog(
      () => import("@/providers/connect/mcp-dialog"),
      (x) => dialog.show(() => <x.DialogSelectMcp />),
    )
  }

  const toggleAutoAccept = () => {
    const active = !settings.permissions.autoApprove()
    settings.permissions.setAutoApprove(active)
    showToast({
      title: active
        ? language.t("toast.permissions.autoaccept.on.title")
        : language.t("toast.permissions.autoaccept.off.title"),
      description: active
        ? language.t("toast.permissions.autoaccept.on.description")
        : language.t("toast.permissions.autoaccept.off.description"),
    })
  }

  const undo = actions.revert.undo
  const redo = actions.revert.redo

  const compact = async () => {
    const sessionID = actions.session.identity.params.id

    if (!sessionID) return

    await data.session.compact({ sessionID, model: actions.model() }).catch((cause: unknown) => {
      showToast({ title: formatServerError(cause, language.t, language.t("common.requestFailed")) })
    })
  }

  const fork = () => {
    const sessionID = actions.session.identity.params.id

    if (!sessionID) return
    void openDialog(
      () => import("@/session/commands/fork-dialog"),
      (x) => dialog.show(() => <x.DialogFork />),
    )
  }

  const sessionCmds = () => [
    sessionCommand({
      id: "session.new",
      title: language.t("command.session.new"),
      keybind: "mod+shift+s",
      slash: "new",
      onSelect: (source) => command.trigger("tab.new", source),
    }),
    sessionCommand({
      id: "session.undo",
      title: language.t("command.session.undo"),
      description: language.t("command.session.undo.description"),
      slash: "undo",
      disabled: !actions.session.identity.params.id || actions.session.history.visibleUserMessages().length === 0,
      onSelect: undo,
    }),
    sessionCommand({
      id: "session.redo",
      title: language.t("command.session.redo"),
      description: language.t("command.session.redo.description"),
      slash: "redo",
      disabled: !actions.session.identity.params.id || !actions.session.data.revertMessageID(),
      onSelect: redo,
    }),
    sessionCommand({
      id: "session.compact",
      title: language.t("command.session.compact"),
      description: language.t("command.session.compact.description"),
      slash: "compact",
      disabled: !actions.session.identity.params.id || actions.session.history.visibleUserMessages().length === 0,
      onSelect: compact,
    }),
    sessionCommand({
      id: "session.background",
      title: language.t("command.session.background"),
      keybind: "ctrl+b",
      disabled: !actions.background.blocking(),
      onSelect: actions.background.move,
    }),
    sessionCommand({
      id: "session.fork",
      title: language.t("command.session.fork"),
      description: language.t("command.session.fork.description"),
      slash: "fork",
      disabled: !actions.session.identity.params.id || actions.session.history.visibleUserMessages().length === 0,
      onSelect: fork,
    }),
    sessionCommand({
      id: "session.export",
      title: language.t("command.session.export"),
      description: language.t("command.session.export.description"),
      slash: "export",
      disabled: !actions.session.identity.params.id,
      onSelect: exportSession,
    }),
    sessionCommand({
      id: "session.copyID",
      title: language.t("command.session.copyID"),
      disabled: !actions.session.identity.params.id,
      onSelect: copySessionID,
    }),
    sessionCommand({
      id: "session.pin",
      title: language.t(
        actions.session.identity.params.id && org.isPinned(actions.session.identity.params.id)
          ? "command.session.unpin"
          : "command.session.pin",
      ),
      slash: "pin",
      disabled: !actions.session.identity.params.id,
      onSelect: () => {
        const sessionID = actions.session.identity.params.id

        if (sessionID) org.togglePin(sessionID)
      },
    }),
    sessionCommand({
      id: "session.archive",
      title: language.t(
        actions.session.data.info() && org.isArchived(actions.session.data.info()!)
          ? "command.session.unarchive"
          : "command.session.archive",
      ),
      slash: "archive",
      disabled: !actions.session.identity.params.id,
      onSelect: () => {
        const sessionID = actions.session.identity.params.id
        const info = actions.session.data.info()

        if (!sessionID) return

        if (info && org.isArchived(info)) {
          org.unarchive(sessionID)
          showToast({
            variant: "success",
            icon: "circle-check",
            title: language.t("toast.session.unarchived.title"),
          })

          return
        }

        org.archive(sessionID)
        notifySessionTabsRemoved({
          server: server.key,
          directory: info?.location.directory ?? "",
          sessionIDs: [sessionID],
        })
        showToast({
          icon: "archive",
          title: language.t("toast.session.archived.title"),
        })
      },
    }),
    sessionCommand({
      id: "session.assignProject",
      title: language.t("command.session.assignProject"),
      disabled: !actions.session.identity.params.id,
      onSelect: () => {
        const sessionID = actions.session.identity.params.id
        const info = actions.session.data.info()

        if (!sessionID) return
        void openDialog(
          () => import("@/session/organize-dialogs"),
          (x) =>
            dialog.show(() => (
              <x.DialogAssignProject
                projects={server.ctx.projects.list()}
                currentDirectory={info ? org.effectiveDirectory(info) : undefined}
                onSelectProject={(directory) => {
                  org.assignProject(sessionID, directory)
                  server.ctx.projects.open(directory)
                  void server.ctx.sdk.api.session
                    .move({ sessionID, directory })
                    .then(() => server.ctx.data.session.sync(sessionID))
                    .catch(() => {})

                  const target =
                    server.ctx.projects.list().find((item) => item.worktree === directory) ?? { worktree: directory }

                  showToast({
                    variant: "success",
                    icon: "circle-check",
                    title: language.t("toast.session.assignedProject.title", { project: displayName(target) }),
                  })
                }}
              />
            )),
        )
      },
    }),
    sessionCommand({
      id: "session.moveToFolder",
      title: language.t("command.session.moveToFolder"),
      disabled: !actions.session.identity.params.id,
      onSelect: () => {
        const sessionID = actions.session.identity.params.id

        if (!sessionID) return
        void openDialog(
          () => import("@/session/organize-dialogs"),
          (x) =>
            dialog.show(() => (
              <x.DialogMoveToFolder sessionIDs={[sessionID]} currentFolderID={org.folderID(sessionID)} />
            )),
        )
      },
    }),
  ]

  const fileCmds = () => {
    const tab = closableTab()

    return [
      fileCommand({
        id: "file.open",
        title: language.t("command.file.open"),
        description: language.t("palette.search.placeholder"),
        keybind: "mod+p",
        slash: "open",
        onSelect: openFile,
      }),
      tab &&
        fileCommand({
          id: "file.close",
          title: language.t("command.tab.close"),
          keybind: settings.keybinds.get("tab.close") ?? "mod+w",
          when: (event) => !extensionScoped(event.target),
          onSelect: closeTab,
        }),
    ].filter((v) => !!v)
  }

  const projectCmds = () => [
    projectCommand({
      id: "project.copyID",
      title: language.t("command.project.copyID"),
      disabled: !actions.session.data.info()?.projectID,
      onSelect: copyProjectID,
    }),
  ]

  const contextCmds = () => [
    contextCommand({
      id: "context.addSelection",
      title: language.t("command.context.addSelection"),
      description: language.t("command.context.addSelection.description"),
      keybind: "mod+shift+l",
      disabled: !canAddSelectionContext(),
      onSelect: addSelection,
    }),
  ]

  const viewCmds = () => [
    viewCommand({
      id: "review.toggle",
      title: language.t("command.review.toggle"),
      keybind: "mod+shift+r",
      onSelect: () => actions.session.layout.view().side.toggle(),
    }),
    ...(shown()
      ? [
          viewCommand({
            id: "fileTree.toggle",
            title: language.t("command.fileTree.toggle"),
            keybind: "mod+\\",
            onSelect: () => layout.fileTree.toggle(),
          }),
        ]
      : []),
    viewCommand({
      id: "input.focus",
      title: language.t("command.input.focus"),
      keybind: "ctrl+l",
      onSelect: focusInput,
    }),
  ]

  const messageCmds = () => [
    sessionCommand({
      id: "message.previous",
      title: language.t("command.message.previous"),
      description: language.t("command.message.previous.description"),
      keybind: "mod+alt+[",
      disabled: !actions.session.identity.params.id,
      onSelect: () => navigateMessageByOffset(-1),
    }),
    sessionCommand({
      id: "message.next",
      title: language.t("command.message.next"),
      description: language.t("command.message.next.description"),
      keybind: "mod+alt+]",
      disabled: !actions.session.identity.params.id,
      onSelect: () => navigateMessageByOffset(1),
    }),
  ]

  const mcpCmds = () => [
    mcpCommand({
      id: "mcp.toggle",
      title: language.t("command.mcp.toggle"),
      description: language.t("command.mcp.toggle.description"),
      keybind: "mod+;",
      slash: "mcp",
      onSelect: chooseMcp,
    }),
  ]

  const permissionsCmds = () => [
    permissionsCommand({
      id: "permissions.autoaccept",
      title: settings.permissions.autoApprove()
        ? language.t("command.permissions.autoaccept.disable")
        : language.t("command.permissions.autoaccept.enable"),
      keybind: "mod+shift+a",
      disabled: false,
      onSelect: toggleAutoAccept,
    }),
  ]

  command.register("session", () => [
    ...sessionCmds(),
    ...projectCmds(),
    ...fileCmds(),
    ...contextCmds(),
    ...viewCmds(),
    ...messageCmds(),
    ...mcpCmds(),
    ...permissionsCmds(),
  ])
}
