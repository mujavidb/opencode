import type { SessionMessageAssistant, SessionMessageUser } from "@opencode/client/promise"
import { Icon } from "@opencode/ui/icon"
import { IconButton } from "@opencode/ui/icon-button"
import { Tooltip } from "@opencode/ui/tooltip"
import { For, Show, createMemo } from "solid-js"
import { createStore } from "solid-js/store"
import { useLanguage } from "@/runtime/i18n/language"
import { readPromptPresentation } from "@/composer/comment-note"

export type MessageRailEntry = {
  id: string
  prompt: string
  response: string
  agent?: string
  model?: string
  duration?: string
  time: string
}

function cleanSnippet(text: string): string {
  return text
    .replace(/```[\s\S]*?```/g, " ")
    .replace(/`([^`]+)`/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/^[#>*|-]+\s*/gm, "")
    .replace(/\*\*([^*]+)\*\*/g, "$1")
    .replace(/\s+/g, " ")
    .trim()
}

function formatDuration(ms: number | undefined): string | undefined {
  if (ms === undefined || !(ms >= 0)) return undefined
  const total = Math.round(ms / 1000)

  if (total < 60) return `${total}s`
  const minutes = Math.floor(total / 60)
  const seconds = total % 60

  return seconds > 0 ? `${minutes}m ${seconds}s` : `${minutes}m`
}

export function SessionMessageRail(props: {
  sessionID: string | undefined
  userMessages: SessionMessageUser[]
  assistantByUser: ReadonlyMap<string, SessionMessageAssistant[]>
  contextByUser: ReadonlyMap<string, { agent?: string; model?: SessionMessageAssistant["model"] }>
  activeMessageID?: string
  onSelect: (messageID: string) => void
  onFork?: (messageID: string) => void
}) {
  const language = useLanguage()

  const [state, setState] = createStore<{
    hoveredIndex: number | undefined
    cardTop: number
    cardHovered: boolean
  }>({
    hoveredIndex: undefined,
    cardTop: 0,
    cardHovered: false,
  })

  let railRef: HTMLDivElement | undefined
  let closeTimer: ReturnType<typeof setTimeout> | undefined

  const clearCloseTimer = () => {
    if (!closeTimer) return
    clearTimeout(closeTimer)
    closeTimer = undefined
  }

  const scheduleClose = () => {
    clearCloseTimer()
    closeTimer = setTimeout(() => {
      if (!state.cardHovered) setState("hoveredIndex", undefined)
    }, 110)
  }

  const timeFormatter = createMemo(() => new Intl.DateTimeFormat(language.intl(), { timeStyle: "short" }))

  const entries = createMemo<MessageRailEntry[]>(() =>
    props.userMessages.map((user) => {
      const presentation = readPromptPresentation(user.metadata)
      const rawPrompt = (presentation?.displayText ?? user.text).trim()
      const prompt = rawPrompt.replace(/\s+/g, " ").slice(0, 140) || language.t("common.attachment")
      const assistants = props.assistantByUser.get(user.id) ?? []

      const rawResponse = assistants
        .flatMap((msg) => msg.content.flatMap((part) => (part.type === "text" && part.text.trim() ? [part.text] : [])))
        .join(" ")

      const response = cleanSnippet(rawResponse).slice(0, 220)
      const ctx = props.contextByUser.get(user.id)
      const lastAssistant = assistants.at(-1)
      const agentRaw = lastAssistant?.agent ?? ctx?.agent
      const agent =
        agentRaw && agentRaw.toLowerCase() !== "build" ? agentRaw[0]?.toUpperCase() + agentRaw.slice(1) : undefined
      const modelId = lastAssistant?.model.id ?? ctx?.model?.id

      const completed = assistants.reduce<number | undefined>((latest, msg) => {
        if (msg.time.completed === undefined) return latest

        return latest === undefined ? msg.time.completed : Math.max(latest, msg.time.completed)
      }, undefined)

      const duration =
        completed !== undefined && completed >= user.time.created
          ? formatDuration(completed - user.time.created)
          : undefined

      return {
        id: user.id,
        prompt,
        response,
        agent,
        model: modelId,
        duration,
        time: timeFormatter().format(user.time.created),
      }
    }),
  )

  const hoveredEntry = createMemo(() => {
    const idx = state.hoveredIndex

    return idx !== undefined ? entries()[idx] : undefined
  })

  const updateHover = (index: number, element: HTMLElement) => {
    clearCloseTimer()
    const railRect = railRef?.getBoundingClientRect()
    const itemRect = element.getBoundingClientRect()
    const rawOffset = railRect ? itemRect.top - railRect.top + itemRect.height / 2 : 0
    const maxTop = railRect ? Math.max(48, railRect.height - 64) : 300
    const clampedTop = Math.max(44, Math.min(maxTop, rawOffset))

    setState({
      hoveredIndex: index,
      cardTop: clampedTop,
    })
  }

  const tickWidth = (index: number) => {
    const hovered = state.hoveredIndex

    if (hovered !== undefined) {
      const distance = Math.abs(index - hovered)

      if (distance === 0) return "20px"

      if (distance === 1) return "13px"

      if (distance === 2) return "9px"

      if (distance === 3) return "7px"

      return "5px"
    }

    const entry = entries()[index]

    if (entry && entry.id === props.activeMessageID) return "10px"

    return "5px"
  }

  const tickHeight = (index: number) => {
    if (state.hoveredIndex === index) return "2px"

    return "1.5px"
  }

  const tickColor = (index: number) => {
    const hovered = state.hoveredIndex

    if (hovered !== undefined) {
      const distance = Math.abs(index - hovered)

      if (distance === 0) return "var(--v2-text-text-base)"

      if (distance === 1) return "var(--v2-text-text-muted)"

      if (distance === 2) return "var(--v2-icon-icon-faint)"
    }

    const entry = entries()[index]

    if (entry && entry.id === props.activeMessageID) return "var(--v2-text-text-muted)"

    return "var(--v2-border-border-strong)"
  }

  return (
    <Show when={entries().length > 0}>
      <div
        ref={railRef}
        data-component="session-message-rail"
        class="pointer-events-none absolute start-1.5 top-14 bottom-4 z-40 hidden md:flex items-center"
      >
        <div
          class="pointer-events-auto flex max-h-full flex-col justify-center overflow-y-auto py-2 ps-1 pe-2 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden"
          onPointerLeave={scheduleClose}
        >
          <For each={entries()}>
            {(entry, index) => (
              <button
                type="button"
                data-slot="session-message-rail-tick"
                aria-label={entry.prompt}
                class="group flex h-2.5 w-6 items-center justify-start border-none bg-transparent p-0 cursor-pointer focus-visible:outline-none"
                onPointerEnter={(event) => updateHover(index(), event.currentTarget)}
                onFocus={(event) => updateHover(index(), event.currentTarget)}
                onClick={() => {
                  setState({ hoveredIndex: undefined, cardHovered: false })
                  props.onSelect(entry.id)
                }}
              >
                <span
                  class="block rounded-full transition-[width,height,background-color] duration-150 ease-out"
                  style={{
                    width: tickWidth(index()),
                    height: tickHeight(index()),
                    "background-color": tickColor(index()),
                  }}
                />
              </button>
            )}
          </For>
        </div>

        <Show when={hoveredEntry()}>
          {(item) => (
            <div
              data-slot="session-message-rail-card"
              class="pointer-events-auto absolute start-8 z-50 w-[300px] -translate-y-1/2 rounded-[12px] border border-v2-border-border-base bg-v2-background-bg-base p-3.5 shadow-[var(--v2-elevation-floating)] transition-[top] duration-100 ease-out cursor-pointer"
              style={{ top: `${state.cardTop}px` }}
              onPointerEnter={() => {
                clearCloseTimer()
                setState("cardHovered", true)
              }}
              onPointerLeave={() => {
                setState("cardHovered", false)
                scheduleClose()
              }}
              onClick={() => {
                const targetID = item().id
                setState({ hoveredIndex: undefined, cardHovered: false })
                props.onSelect(targetID)
              }}
            >
              <div class="flex items-center justify-between gap-2">
                <span class="min-w-0 flex-1 truncate text-[13px] font-[530] leading-text-compact text-v2-text-text-base">
                  {item().prompt}
                </span>
                <Show when={props.onFork}>
                  <Tooltip value={language.t("command.session.fork")} placement="top" gutter={4}>
                    <IconButton
                      icon={<Icon name="split" size="small" />}
                      size="small"
                      variant="ghost-muted"
                      class="shrink-0"
                      aria-label={language.t("command.session.fork")}
                      onClick={(event) => {
                        event.stopPropagation()
                        const targetID = item().id
                        setState({ hoveredIndex: undefined, cardHovered: false })
                        props.onFork?.(targetID)
                      }}
                    />
                  </Tooltip>
                </Show>
              </div>

              <Show when={item().response}>
                <p class="mt-1.5 line-clamp-2 text-[13px] leading-[18px] text-v2-text-text-muted">
                  {item().response}
                </p>
              </Show>

              <div class="mt-2 flex items-center justify-between gap-2 text-[12px] leading-text-compact text-v2-text-text-faint">
                <span class="min-w-0 truncate">
                  {[item().agent, item().model].filter(Boolean).join(" · ")}
                </span>
                <span class="shrink-0">
                  {[item().duration, item().time].filter(Boolean).join(" · ")}
                </span>
              </div>
            </div>
          )}
        </Show>
      </div>
    </Show>
  )
}
