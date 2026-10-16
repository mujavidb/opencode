import { For, onMount, Show } from "solid-js"
import { createStore } from "solid-js/store"
import { Button } from "@opencode/ui/button"
import { useDialog } from "@opencode/ui/context/dialog"
import { Dialog, DialogBody, DialogFooter, DialogHeader, DialogTitleGroup } from "@opencode/ui/dialog"
import { Icon } from "@opencode/ui/icon"
import {
  displayName,
  getProjectAvatarSource,
  getProjectAvatarVariant,
  ProjectAvatar,
} from "@opencode/ui/project-avatar"
import { TextInput } from "@opencode/ui/text-input"
import { useLanguage } from "@/runtime/i18n/language"
import { showToast } from "@/shell/notifications/toast"
import type { LocalProject } from "@/shell/state/layout"
import { pathKey } from "@/workspaces/path-key"
import {
  ORGANIZE_COLORS,
  ORGANIZE_COLOR_STYLES,
  useSessionOrganization,
  type OrganizeColor,
  type SessionFolder,
} from "./organization"

export function DialogCreateFolder(props: {
  sessionIDs?: readonly string[]
  onCreated?: (folder: SessionFolder) => void
}) {
  const dialog = useDialog()
  const language = useLanguage()
  const org = useSessionOrganization()
  let inputRef: HTMLInputElement | undefined

  const [state, setState] = createStore<{ name: string; color: OrganizeColor }>({
    name: "",
    color: ORGANIZE_COLORS[org.folders().length % ORGANIZE_COLORS.length],
  })

  onMount(() => {
    requestAnimationFrame(() => inputRef?.focus())
  })

  const submit = () => {
    const folder = org.createFolder(state.name, state.color)

    if (!folder) return

    if (props.sessionIDs && props.sessionIDs.length > 0) {
      org.assignFolderMany(props.sessionIDs, folder.id)
      showToast({
        variant: "success",
        icon: "circle-check",
        title: language.t("toast.session.movedFolder.title", { folder: folder.name }),
      })
    }

    dialog.close()
    props.onCreated?.(folder)
  }

  return (
    <Dialog fit>
      <DialogHeader hideClose>
        <DialogTitleGroup
          title={language.t("dialog.folder.create.title")}
          description={language.t("dialog.folder.create.description")}
        />
      </DialogHeader>
      <DialogBody class="flex flex-col gap-3 px-4 py-1">
        <TextInput
          ref={(el) => (inputRef = el)}
          value={state.name}
          placeholder={language.t("dialog.folder.create.placeholder")}
          aria-label={language.t("home.folders.namePlaceholder")}
          onInput={(event) => setState("name", event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.isComposing) return
            event.preventDefault()
            submit()
          }}
        />
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </Button>
        <Button variant="contrast" disabled={!state.name.trim()} onClick={submit}>
          {language.t("dialog.folder.create.submit")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

export function DialogCreateTag(props: { sessionIDs: readonly string[]; onCreated?: (tag: string) => void }) {
  const dialog = useDialog()
  const language = useLanguage()
  const org = useSessionOrganization()
  let inputRef: HTMLInputElement | undefined

  const [state, setState] = createStore<{ name: string; color: OrganizeColor }>({
    name: "",
    color: ORGANIZE_COLORS[org.allTags().length % ORGANIZE_COLORS.length],
  })

  onMount(() => {
    requestAnimationFrame(() => inputRef?.focus())
  })

  const submit = () => {
    const cleaned = state.name.trim().replace(/^#+/, "")

    if (!cleaned) return
    org.addTagMany(props.sessionIDs, cleaned, state.color)
    dialog.close()
    props.onCreated?.(cleaned)
  }

  return (
    <Dialog fit>
      <DialogHeader hideClose>
        <DialogTitleGroup
          title={language.t("dialog.tag.create.title")}
          description={language.t("dialog.tag.create.description")}
        />
      </DialogHeader>
      <DialogBody class="flex flex-col gap-3 px-4 py-1">
        <TextInput
          ref={(el) => (inputRef = el)}
          value={state.name}
          placeholder={language.t("dialog.tag.create.placeholder")}
          aria-label={language.t("home.tags.namePlaceholder")}
          onInput={(event) => setState("name", event.currentTarget.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.isComposing) return
            event.preventDefault()
            submit()
          }}
        />
        <div class="flex items-center gap-1.5 py-1">
          <For each={ORGANIZE_COLORS}>
            {(color) => (
              <button
                type="button"
                aria-label={language.t("dialog.project.edit.color.select", { color: language.t(`common.color.${color}`) })}
                aria-pressed={state.color === color}
                class="flex size-6 items-center justify-center rounded-full border transition-transform"
                classList={{
                  "border-v2-text-text-base scale-110": state.color === color,
                  "border-transparent opacity-70 hover:opacity-100": state.color !== color,
                }}
                onClick={() => setState("color", color)}
              >
                <span class={`size-4 rounded-full ${ORGANIZE_COLOR_STYLES[color].dot}`} />
              </button>
            )}
          </For>
        </div>
      </DialogBody>
      <DialogFooter>
        <Button variant="ghost" onClick={() => dialog.close()}>
          {language.t("common.cancel")}
        </Button>
        <Button variant="contrast" disabled={!state.name.trim().replace(/^#+/, "")} onClick={submit}>
          {language.t("dialog.tag.create.submit")}
        </Button>
      </DialogFooter>
    </Dialog>
  )
}

export function DialogAssignProject(props: {
  projects: readonly LocalProject[]
  currentDirectory?: string
  onSelectProject: (directory: string) => void
  onChooseDirectory?: () => void
}) {
  const dialog = useDialog()
  const language = useLanguage()
  const [state, setState] = createStore({ query: "" })

  const filtered = () => {
    const q = state.query.trim().toLowerCase()

    if (!q) return props.projects

    return props.projects.filter((project) =>
      `${displayName(project)} ${project.worktree}`.toLowerCase().includes(q),
    )
  }

  return (
    <Dialog fit>
      <DialogHeader>
        <DialogTitleGroup title={language.t("dialog.assignProject.title")} />
      </DialogHeader>
      <DialogBody class="flex flex-col gap-2 px-4 pb-3">
        <TextInput
          value={state.query}
          placeholder={language.t("session.new.project.search")}
          aria-label={language.t("session.new.project.search")}
          onInput={(event) => setState("query", event.currentTarget.value)}
        />
        <div class="flex max-h-64 flex-col gap-0.5 overflow-y-auto py-1">
          <For each={filtered()}>
            {(project) => {
              const current = () =>
                !!props.currentDirectory && pathKey(project.worktree) === pathKey(props.currentDirectory)

              return (
                <button
                  type="button"
                  class="flex h-8 w-full items-center gap-2 rounded-[6px] px-2 text-start text-[13px] leading-4 text-v2-text-text-base hover:bg-v2-background-bg-layer-02"
                  onClick={() => {
                    dialog.close()
                    props.onSelectProject(project.worktree)
                  }}
                >
                  <ProjectAvatar
                    fallback={displayName(project)}
                    src={getProjectAvatarSource(project.id, project.icon)}
                    variant={getProjectAvatarVariant(project.icon?.color)}
                  />
                  <span class="min-w-0 flex-1 truncate">{displayName(project)}</span>
                  <Show when={current()}>
                    <Icon name="check" size="small" class="shrink-0 text-v2-icon-icon-muted" />
                  </Show>
                </button>
              )
            }}
          </For>
          <Show when={props.onChooseDirectory}>
            {(choose) => (
              <button
                type="button"
                class="mt-1 flex h-8 w-full items-center gap-2 rounded-[6px] border-t border-v2-border-border-base px-2 pt-1 text-start text-[13px] leading-4 text-v2-text-text-muted hover:bg-v2-background-bg-layer-02 hover:text-v2-text-text-base"
                onClick={() => {
                  dialog.close()
                  choose()()
                }}
              >
                <Icon name="folder-add-left" size="small" />
                <span class="min-w-0 flex-1 truncate">{language.t("session.organize.chooseDirectory")}</span>
              </button>
            )}
          </Show>
        </div>
      </DialogBody>
    </Dialog>
  )
}

export function DialogMoveToFolder(props: {
  sessionIDs: readonly string[]
  currentFolderID?: string
}) {
  const dialog = useDialog()
  const language = useLanguage()
  const org = useSessionOrganization()

  return (
    <Dialog fit>
      <DialogHeader>
        <DialogTitleGroup title={language.t("dialog.moveToFolder.title")} />
      </DialogHeader>
      <DialogBody class="flex flex-col gap-1 px-4 pb-3">
        <div class="flex max-h-64 flex-col gap-0.5 overflow-y-auto py-1">
          <For each={org.folders()}>
            {(folder) => (
              <button
                type="button"
                class="flex h-8 w-full items-center gap-2 rounded-[6px] px-2 text-start text-[13px] leading-4 text-v2-text-text-base hover:bg-v2-background-bg-layer-02"
                onClick={() => {
                  org.assignFolderMany(props.sessionIDs, folder.id)
                  showToast({
                    variant: "success",
                    icon: "circle-check",
                    title: language.t("toast.session.movedFolder.title", { folder: folder.name }),
                  })
                  dialog.close()
                }}
              >
                <Icon name="folder" size="small" class={ORGANIZE_COLOR_STYLES[folder.color].text} />
                <span class="min-w-0 flex-1 truncate">{folder.name}</span>
                <Show when={props.currentFolderID === folder.id}>
                  <Icon name="check" size="small" class="shrink-0 text-v2-icon-icon-muted" />
                </Show>
              </button>
            )}
          </For>
          <Show when={props.currentFolderID}>
            <button
              type="button"
              class="flex h-8 w-full items-center gap-2 rounded-[6px] px-2 text-start text-[13px] leading-4 text-v2-text-text-muted hover:bg-v2-background-bg-layer-02 hover:text-v2-text-text-base"
              onClick={() => {
                org.assignFolderMany(props.sessionIDs, undefined)
                showToast({
                  title: language.t("toast.session.removedFolder.title"),
                })
                dialog.close()
              }}
            >
              <Icon name="xmark-small" size="small" />
              <span class="min-w-0 flex-1 truncate">{language.t("session.organize.removeFromFolder")}</span>
            </button>
          </Show>
          <button
            type="button"
            class="mt-1 flex h-8 w-full items-center gap-2 rounded-[6px] border-t border-v2-border-border-base px-2 pt-1 text-start text-[13px] leading-4 text-v2-text-text-muted hover:bg-v2-background-bg-layer-02 hover:text-v2-text-text-base"
            onClick={() => {
              dialog.close()
              void dialog.show(() => <DialogCreateFolder sessionIDs={props.sessionIDs} />)
            }}
          >
            <Icon name="plus" size="small" />
            <span class="min-w-0 flex-1 truncate">{language.t("session.organize.newFolder")}</span>
          </button>
        </div>
      </DialogBody>
    </Dialog>
  )
}
