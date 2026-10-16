import { Button } from "@opencode/ui/button"
import { Icon } from "@opencode/ui/icon"
import { Popover } from "@opencode/ui/popover"
import { TextInput } from "@opencode/ui/text-input"
import { Tooltip } from "@opencode/ui/tooltip"
import { For, Show, createEffect, onCleanup } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { usePlatform, type ProjectRunnerStatus } from "@/runtime/platform/platform"
import { showToast } from "@/shell/notifications/toast"

export function ProjectRunButton(props: { directory: string | undefined }) {
  const platform = usePlatform()
  const language = useLanguage()

  const [state, setState] = createStore<{
    open: boolean
    busy: boolean
    status: ProjectRunnerStatus | undefined
    commandDraft: string
    portDraft: string
  }>({
    open: false,
    busy: false,
    status: undefined,
    commandDraft: "",
    portDraft: "",
  })

  const refresh = async (dir: string, syncDrafts = false) => {
    const runner = platform.projectRunner

    if (!runner || !dir) return
    const next = await runner.status(dir).catch(() => undefined)

    if (!next || props.directory !== dir) return
    setState("status", next)

    if (syncDrafts) {
      setState({
        commandDraft: next.command,
        portDraft: next.port ? String(next.port) : "",
      })
    }
  }

  createEffect(() => {
    const dir = props.directory

    if (!dir || !platform.projectRunner) {
      setState("status", undefined)

      return
    }

    void refresh(dir, true)
    const timer = setInterval(() => void refresh(dir, false), 5000)
    onCleanup(() => clearInterval(timer))
  })

  const parsePort = (raw: string): number | undefined => {
    const n = Number(raw.trim())

    return Number.isFinite(n) && n > 0 && n <= 65535 ? Math.floor(n) : undefined
  }

  const handlePlayClick = async () => {
    const runner = platform.projectRunner
    const dir = props.directory

    if (!runner || !dir || state.busy) return
    setState("busy", true)

    try {
      const result = await runner.start({ directory: dir })
      setState("status", result)
      setState({
        commandDraft: result.command,
        portDraft: result.port ? String(result.port) : "",
      })

      if (result.action === "unconfigured") {
        setState("open", true)

        return
      }

      if (result.action === "already-running") {
        showToast({
          icon: "circle-check",
          title: language.t("projectRunner.toast.alreadyRunning"),
          description: result.url ?? result.command,
        })

        return
      }

      if (result.action === "started") {
        showToast({
          variant: "success",
          icon: "circle-check",
          title: language.t("projectRunner.toast.started"),
          description: result.url ?? result.command,
        })
      }
    } finally {
      setState("busy", false)
    }
  }

  const handleSaveAndRun = async () => {
    const runner = platform.projectRunner
    const dir = props.directory
    const cmd = state.commandDraft.trim()

    if (!runner || !dir || !cmd || state.busy) return
    setState("busy", true)

    try {
      const port = parsePort(state.portDraft)
      const result = await runner.start({
        directory: dir,
        command: cmd,
        port,
        url: port ? `http://localhost:${port}` : undefined,
      })

      setState("status", result)
      showToast({
        variant: "success",
        icon: "circle-check",
        title:
          result.action === "already-running"
            ? language.t("projectRunner.toast.alreadyRunning")
            : language.t("projectRunner.toast.started"),
        description: result.url ?? result.command,
      })
    } finally {
      setState("busy", false)
    }
  }

  const handleSaveOnly = async () => {
    const runner = platform.projectRunner
    const dir = props.directory
    const cmd = state.commandDraft.trim()

    if (!runner || !dir || !cmd || state.busy) return
    setState("busy", true)

    try {
      const port = parsePort(state.portDraft)
      const result = await runner.save({
        directory: dir,
        command: cmd,
        port,
        url: port ? `http://localhost:${port}` : undefined,
      })

      setState("status", result)
      showToast({
        icon: "circle-check",
        title: language.t("projectRunner.toast.saved"),
        description: result.configPath,
      })
    } finally {
      setState("busy", false)
    }
  }

  const handleStop = async () => {
    const runner = platform.projectRunner
    const dir = props.directory

    if (!runner || !dir || state.busy) return
    setState("busy", true)

    try {
      const result = await runner.stop(dir)
      setState("status", result)
      showToast({
        title: language.t("projectRunner.toast.stopped"),
      })
    } finally {
      setState("busy", false)
    }
  }

  const running = () => !!state.status?.running

  return (
    <Show when={platform.projectRunner && props.directory}>
      <div
        data-component="project-run-control"
        class="inline-flex h-7 shrink-0 flex-row items-center overflow-hidden rounded-[6px] shadow-[inset_0_0_0_1px_var(--v2-border-border-muted)]"
        onPointerDown={(event) => event.stopPropagation()}
      >
        <Tooltip
          placement="bottom"
          class="inline-flex h-7 items-center"
          value={
            running()
              ? `${language.t("projectRunner.status.running")}${state.status?.port ? ` (:${state.status.port})` : ""}`
              : state.status?.command
                ? `${language.t("projectRunner.run")}: ${state.status.command}`
                : language.t("projectRunner.run")
          }
        >
          <button
            type="button"
            data-action="project-run-play"
            disabled={state.busy}
            onPointerDown={(event) => event.stopPropagation()}
            onClick={(event) => {
              event.stopPropagation()
              void handlePlayClick()
            }}
            aria-label={language.t("projectRunner.run")}
            class="inline-flex h-7 w-7 shrink-0 items-center justify-center border-0 bg-transparent p-0 text-v2-icon-icon-base hover:bg-v2-overlay-simple-overlay-hover active:bg-v2-overlay-simple-overlay-pressed focus-visible:outline-none disabled:opacity-50"
          >
            <Icon
              name="play"
              size="normal"
              class={running() ? "text-[#22c55e]" : "text-v2-icon-icon-base"}
            />
          </button>
        </Tooltip>

        <Popover
          open={state.open}
          onOpenChange={(open) => {
            setState("open", open)

            if (open && props.directory) void refresh(props.directory, true)
          }}
          placement="bottom-end"
          gutter={6}
          class="w-80 rounded-[10px] border border-v2-border-border-base bg-v2-background-bg-base p-3 shadow-[var(--v2-elevation-floating)]"
          triggerAs="button"
          triggerProps={{
            type: "button",
            disabled: state.busy,
            "aria-label": language.t("projectRunner.configure"),
            onPointerDown: (event: PointerEvent) => event.stopPropagation(),
            class:
              "inline-flex h-7 w-5 shrink-0 items-center justify-center border-0 bg-transparent p-0 text-v2-icon-icon-base hover:bg-v2-overlay-simple-overlay-hover active:bg-v2-overlay-simple-overlay-pressed focus-visible:outline-none disabled:opacity-50",
          }}
          trigger={<Icon name="chevron-down" size="small" />}
        >
          <div class="flex flex-col gap-2.5">
            <div class="flex items-center justify-between gap-2">
              <div class="flex items-center gap-1.5">
                <span
                  class="size-2 rounded-full"
                  classList={{
                    "bg-[#22c55e]": running(),
                    "bg-v2-icon-icon-faint": !running(),
                  }}
                />
                <span class="text-[13px] font-[530] leading-4 text-v2-text-text-base">
                  {running()
                    ? language.t("projectRunner.status.running")
                    : language.t("projectRunner.status.stopped")}
                </span>
              </div>
              <Show when={state.status?.url && running()}>
                <button
                  type="button"
                  class="text-[12px] leading-4 text-v2-text-text-accent hover:underline"
                  onClick={() => state.status?.url && platform.openExternal(state.status.url)}
                >
                  {state.status?.url}
                </button>
              </Show>
            </div>

            <div class="flex flex-col gap-1">
              <label class="text-[11px] font-[530] leading-4 text-v2-text-text-muted">
                {language.t("projectRunner.field.command")}
              </label>
              <TextInput
                value={state.commandDraft}
                placeholder="bun run dev"
                onInput={(event) => setState("commandDraft", event.currentTarget.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter" && !event.isComposing) {
                    event.preventDefault()
                    void handleSaveAndRun()
                  }
                }}
              />
            </div>

            <div class="flex flex-col gap-1">
              <label class="text-[11px] font-[530] leading-4 text-v2-text-text-muted">
                {language.t("projectRunner.field.port")}
              </label>
              <TextInput
                value={state.portDraft}
                placeholder="3000"
                onInput={(event) => setState("portDraft", event.currentTarget.value)}
              />
            </div>

            <Show when={(state.status?.logs.length ?? 0) > 0}>
              <div class="max-h-24 overflow-y-auto rounded-[6px] bg-v2-background-bg-layer-02 p-2 font-mono text-[11px] leading-4 text-v2-text-text-muted">
                <For each={state.status?.logs.slice(-6)}>
                  {(line) => <div class="truncate">{line}</div>}
                </For>
              </div>
            </Show>

            <div class="text-[11px] leading-4 text-v2-text-text-faint truncate" title={state.status?.configPath}>
              ~/.config/opencode/run.json
            </div>

            <div class="flex items-center justify-end gap-1.5 pt-1">
              <Show when={running() && state.status?.pid}>
                <Button size="small" variant="danger" disabled={state.busy} onClick={() => void handleStop()}>
                  {language.t("projectRunner.stop")}
                </Button>
              </Show>
              <Button
                size="small"
                variant="ghost"
                disabled={state.busy || !state.commandDraft.trim()}
                onClick={() => void handleSaveOnly()}
              >
                {language.t("common.save")}
              </Button>
              <Button
                size="small"
                variant="contrast"
                disabled={state.busy || !state.commandDraft.trim()}
                onClick={() => void handleSaveAndRun()}
              >
                {language.t("projectRunner.run")}
              </Button>
            </div>
          </div>
        </Popover>
      </div>
    </Show>
  )
}
