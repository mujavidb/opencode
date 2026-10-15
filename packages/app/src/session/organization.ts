import { batch, createComponent, createContext, useContext, type ParentProps } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { Predicate, Schema } from "effect"
import type { SessionInfo } from "@opencode/client/promise"
import { Persist, persisted } from "@/runtime/persistence/storage"
import { Persistence } from "@/runtime/persistence/schema"
import { uuid } from "@/runtime/persistence/uuid"
import { pathKey } from "@/workspaces/path-key"

export const ORGANIZE_COLORS = ["blue", "purple", "cyan", "green", "orange", "pink", "yellow", "red", "gray"] as const

export type OrganizeColor = (typeof ORGANIZE_COLORS)[number]

export const OrganizeColorSchema = Schema.Literals(ORGANIZE_COLORS)

export const SessionFolderSchema = Persistence.struct({
  id: Schema.String,
  name: Schema.String,
  color: Persistence.fallback(OrganizeColorSchema, () => "blue" as const),
  createdAt: Persistence.fallback(Schema.Finite, () => 0),
})

export type SessionFolder = typeof SessionFolderSchema.Type

export const SessionOrgEntrySchema = Persistence.struct({
  archivedAt: Persistence.optional(Schema.Finite),
  pinnedAt: Persistence.optional(Schema.Finite),
  folderID: Persistence.optional(Schema.String),
  projectDirectory: Persistence.optional(Schema.String),
  tags: Persistence.optional(Persistence.array(Schema.String)),
})

export type SessionOrgEntry = typeof SessionOrgEntrySchema.Type

export const SessionGroupBySchema = Schema.Literals(["date", "project", "folder"])

export type SessionGroupBy = typeof SessionGroupBySchema.Type

export const SessionFilterModeSchema = Schema.Literals(["active", "pinned", "archived"])

export type SessionFilterMode = typeof SessionFilterModeSchema.Type

export const SessionOrganizationSchema = Persistence.struct({
  folders: Persistence.array(SessionFolderSchema),
  sessions: Persistence.record(SessionOrgEntrySchema),
  tagColors: Persistence.record(OrganizeColorSchema),
  groupBy: Persistence.fallback(SessionGroupBySchema, () => "date" as const),
})

export type SessionOrganizationState = typeof SessionOrganizationSchema.Type

export function initialSessionOrganization(): SessionOrganizationState {
  return {
    folders: [],
    sessions: {},
    tagColors: {},
    groupBy: "date",
  }
}

export function isSessionArchived(
  state: Pick<SessionOrganizationState, "sessions">,
  session: Pick<SessionInfo, "id" | "time">,
) {
  const entry = state.sessions[session.id]

  if (entry?.archivedAt !== undefined) return entry.archivedAt > 0

  return Predicate.isNumber(session.time.archived)
}

export function isSessionPinned(state: Pick<SessionOrganizationState, "sessions">, sessionID: string) {
  return (state.sessions[sessionID]?.pinnedAt ?? 0) > 0
}

export function sessionEffectiveDirectory(
  state: Pick<SessionOrganizationState, "sessions">,
  session: Pick<SessionInfo, "id" | "location">,
) {
  return state.sessions[session.id]?.projectDirectory ?? session.location.directory
}

export function applySessionOrganization(state: Pick<SessionOrganizationState, "sessions">, session: SessionInfo) {
  const override = state.sessions[session.id]?.projectDirectory

  if (!override || pathKey(override) === pathKey(session.location.directory)) return session

  return {
    ...session,
    location: {
      ...session.location,
      directory: override,
    },
  }
}

export function deterministicColor(value: string): OrganizeColor {
  let hash = 0

  for (let i = 0; i < value.length; i++) {
    hash = (hash * 31 + value.charCodeAt(i)) | 0
  }

  return ORGANIZE_COLORS[Math.abs(hash) % ORGANIZE_COLORS.length]
}

export const ORGANIZE_COLOR_STYLES: Record<OrganizeColor, { dot: string; pill: string; text: string }> = {
  blue: {
    dot: "bg-[#3b82f6]",
    pill: "bg-[#3b82f6]/15 text-[#60a5fa] border-[#3b82f6]/30",
    text: "text-[#60a5fa]",
  },
  purple: {
    dot: "bg-[#a855f7]",
    pill: "bg-[#a855f7]/15 text-[#c084fc] border-[#a855f7]/30",
    text: "text-[#c084fc]",
  },
  cyan: {
    dot: "bg-[#06b6d4]",
    pill: "bg-[#06b6d4]/15 text-[#22d3ee] border-[#06b6d4]/30",
    text: "text-[#22d3ee]",
  },
  green: {
    dot: "bg-[#22c55e]",
    pill: "bg-[#22c55e]/15 text-[#4ade80] border-[#22c55e]/30",
    text: "text-[#4ade80]",
  },
  orange: {
    dot: "bg-[#f97316]",
    pill: "bg-[#f97316]/15 text-[#fb923c] border-[#f97316]/30",
    text: "text-[#fb923c]",
  },
  pink: {
    dot: "bg-[#ec4899]",
    pill: "bg-[#ec4899]/15 text-[#f472b6] border-[#ec4899]/30",
    text: "text-[#f472b6]",
  },
  yellow: {
    dot: "bg-[#eab308]",
    pill: "bg-[#eab308]/15 text-[#facc15] border-[#eab308]/30",
    text: "text-[#facc15]",
  },
  red: {
    dot: "bg-[#ef4444]",
    pill: "bg-[#ef4444]/15 text-[#f87171] border-[#ef4444]/30",
    text: "text-[#f87171]",
  },
  gray: {
    dot: "bg-[#71717a]",
    pill: "bg-[#71717a]/15 text-v2-text-text-muted border-v2-border-border-base",
    text: "text-v2-text-text-muted",
  },
}

function createSessionOrganizationController(persistedStore?: ReturnType<typeof persisted<typeof SessionOrganizationSchema>>) {
  const [store, setStore, , ready] = persistedStore ?? [
    ...createStore<SessionOrganizationState>(initialSessionOrganization()),
    null,
    Object.assign(() => true, { promise: undefined }),
  ]

  const allTags = () => {
    const tags = new Set<string>(Object.keys(store.tagColors))

    for (const entry of Object.values(store.sessions)) {
      for (const tag of entry?.tags ?? []) {
        if (tag.trim()) tags.add(tag.trim())
      }
    }

    return [...tags].toSorted((a, b) => a.localeCompare(b))
  }

  const ensureEntry = (draft: SessionOrganizationState, sessionID: string): SessionOrgEntry => {
    const existing = draft.sessions[sessionID]

    if (existing) return existing
    const created: SessionOrgEntry = {}
    draft.sessions[sessionID] = created

    return created
  }

  return {
    ready,
    store,
    folders: () => store.folders,
    folder: (folderID: string | undefined) =>
      folderID ? store.folders.find((folder) => folder.id === folderID) : undefined,
    groupBy: () => store.groupBy,
    setGroupBy(groupBy: SessionGroupBy) {
      setStore("groupBy", groupBy)
    },
    isArchived(session: Pick<SessionInfo, "id" | "time">) {
      return isSessionArchived(store, session)
    },
    isPinned(sessionID: string) {
      return isSessionPinned(store, sessionID)
    },
    pinnedAt(sessionID: string) {
      return store.sessions[sessionID]?.pinnedAt
    },
    folderForSession(sessionID: string) {
      const id = store.sessions[sessionID]?.folderID

      return id ? store.folders.find((folder) => folder.id === id) : undefined
    },
    folderID(sessionID: string) {
      return this.folderForSession(sessionID)?.id
    },
    tagsForSession(sessionID: string) {
      return store.sessions[sessionID]?.tags ?? []
    },
    allTags,
    tagColor(tag: string): OrganizeColor {
      return store.tagColors[tag] ?? deterministicColor(tag)
    },
    effectiveDirectory(session: Pick<SessionInfo, "id" | "location">) {
      return sessionEffectiveDirectory(store, session)
    },
    effectiveSession(session: SessionInfo) {
      return applySessionOrganization(store, session)
    },
    projectOverride(sessionID: string) {
      return store.sessions[sessionID]?.projectDirectory
    },
    archive(sessionID: string) {
      const now = Date.now()
      setStore(
        produce((draft) => {
          ensureEntry(draft, sessionID).archivedAt = now
        }),
      )
    },
    archiveMany(sessionIDs: readonly string[]) {
      if (sessionIDs.length === 0) return
      const now = Date.now()
      setStore(
        produce((draft) => {
          for (const id of sessionIDs) {
            ensureEntry(draft, id).archivedAt = now
          }
        }),
      )
    },
    unarchive(sessionID: string) {
      setStore(
        produce((draft) => {
          ensureEntry(draft, sessionID).archivedAt = 0
        }),
      )
    },
    unarchiveMany(sessionIDs: readonly string[]) {
      if (sessionIDs.length === 0) return
      setStore(
        produce((draft) => {
          for (const id of sessionIDs) {
            ensureEntry(draft, id).archivedAt = 0
          }
        }),
      )
    },
    toggleArchive(session: Pick<SessionInfo, "id" | "time">) {
      const archived = isSessionArchived(store, session)

      if (archived) {
        this.unarchive(session.id)

        return false
      }

      this.archive(session.id)

      return true
    },
    pin(sessionID: string) {
      const now = Date.now()
      setStore(
        produce((draft) => {
          ensureEntry(draft, sessionID).pinnedAt = now
        }),
      )
    },
    unpin(sessionID: string) {
      setStore(
        produce((draft) => {
          const entry = draft.sessions[sessionID]

          if (entry) delete entry.pinnedAt
        }),
      )
    },
    togglePin(sessionID: string) {
      const pinned = isSessionPinned(store, sessionID)

      if (pinned) {
        this.unpin(sessionID)

        return false
      }

      this.pin(sessionID)

      return true
    },
    pinMany(sessionIDs: readonly string[], pinned: boolean) {
      if (sessionIDs.length === 0) return
      const now = Date.now()
      setStore(
        produce((draft) => {
          for (const id of sessionIDs) {
            const entry = ensureEntry(draft, id)

            if (pinned) entry.pinnedAt = now

            if (!pinned) delete entry.pinnedAt
          }
        }),
      )
    },
    assignProject(sessionID: string, directory: string | undefined) {
      setStore(
        produce((draft) => {
          const entry = ensureEntry(draft, sessionID)

          if (directory) entry.projectDirectory = directory

          if (!directory) delete entry.projectDirectory
        }),
      )
    },
    assignProjectMany(sessionIDs: readonly string[], directory: string | undefined) {
      if (sessionIDs.length === 0) return
      setStore(
        produce((draft) => {
          for (const id of sessionIDs) {
            const entry = ensureEntry(draft, id)

            if (directory) entry.projectDirectory = directory

            if (!directory) delete entry.projectDirectory
          }
        }),
      )
    },
    assignFolder(sessionID: string, folderID: string | undefined) {
      setStore(
        produce((draft) => {
          const entry = ensureEntry(draft, sessionID)

          if (folderID) entry.folderID = folderID

          if (!folderID) delete entry.folderID
        }),
      )
    },
    assignFolderMany(sessionIDs: readonly string[], folderID: string | undefined) {
      if (sessionIDs.length === 0) return
      setStore(
        produce((draft) => {
          for (const id of sessionIDs) {
            const entry = ensureEntry(draft, id)

            if (folderID) entry.folderID = folderID

            if (!folderID) delete entry.folderID
          }
        }),
      )
    },
    createFolder(name: string, color?: OrganizeColor): SessionFolder | undefined {
      const trimmed = name.trim()

      if (!trimmed) return undefined

      const existing = store.folders.find((item) => item.name.toLowerCase() === trimmed.toLowerCase())

      if (existing) return existing

      const folder: SessionFolder = {
        id: `fld_${uuid()}`,
        name: trimmed,
        color: color ?? ORGANIZE_COLORS[store.folders.length % ORGANIZE_COLORS.length],
        createdAt: Date.now(),
      }

      setStore("folders", store.folders.length, folder)

      return folder
    },
    renameFolder(folderID: string, name: string) {
      const trimmed = name.trim()

      if (!trimmed) return false
      const index = store.folders.findIndex((item) => item.id === folderID)

      if (index === -1) return false
      setStore("folders", index, "name", trimmed)

      return true
    },
    setFolderColor(folderID: string, color: OrganizeColor) {
      const index = store.folders.findIndex((item) => item.id === folderID)

      if (index === -1) return
      setStore("folders", index, "color", color)
    },
    deleteFolder(folderID: string) {
      batch(() => {
        setStore(
          "folders",
          store.folders.filter((item) => item.id !== folderID),
        )
        setStore(
          "sessions",
          produce((sessions) => {
            for (const entry of Object.values(sessions)) {
              if (entry?.folderID === folderID) delete entry.folderID
            }
          }),
        )
      })
    },
    addTag(sessionID: string, rawTag: string, color?: OrganizeColor) {
      const tag = rawTag.trim().replace(/^#+/, "")

      if (!tag) return
      setStore(
        produce((draft) => {
          if (color) draft.tagColors[tag] = color
          const entry = ensureEntry(draft, sessionID)
          const current = entry.tags ?? []

          if (!current.includes(tag)) entry.tags = [...current, tag]
        }),
      )
    },
    removeTag(sessionID: string, tag: string) {
      setStore(
        produce((draft) => {
          const entry = draft.sessions[sessionID]

          if (!entry?.tags) return
          const next = entry.tags.filter((item) => item !== tag)

          if (next.length > 0) entry.tags = next

          if (next.length === 0) delete entry.tags
        }),
      )
    },
    toggleTag(sessionID: string, rawTag: string, color?: OrganizeColor) {
      const tag = rawTag.trim().replace(/^#+/, "")

      if (!tag) return false
      const has = (store.sessions[sessionID]?.tags ?? []).includes(tag)

      if (has) {
        this.removeTag(sessionID, tag)

        return false
      }

      this.addTag(sessionID, tag, color)

      return true
    },
    addTagMany(sessionIDs: readonly string[], rawTag: string, color?: OrganizeColor) {
      const tag = rawTag.trim().replace(/^#+/, "")

      if (!tag || sessionIDs.length === 0) return
      setStore(
        produce((draft) => {
          if (color) draft.tagColors[tag] = color

          for (const id of sessionIDs) {
            const entry = ensureEntry(draft, id)
            const current = entry.tags ?? []

            if (!current.includes(tag)) entry.tags = [...current, tag]
          }
        }),
      )
    },
    clearTags(sessionID: string) {
      setStore(
        produce((draft) => {
          const entry = draft.sessions[sessionID]

          if (entry) delete entry.tags
        }),
      )
    },
  }
}

export type SessionOrganization = ReturnType<typeof createSessionOrganizationController>

const SessionOrganizationContext = createContext<SessionOrganization>()

export function SessionOrganizationProvider(props: ParentProps) {
  const value = createSessionOrganizationController(
    persisted(
      { ...Persist.global("session.organization"), sync: true },
      SessionOrganizationSchema,
      initialSessionOrganization(),
    ),
  )

  return createComponent(SessionOrganizationContext.Provider, {
    value,
    get children() {
      return props.children
    },
  })
}

export function useSessionOrganization(): SessionOrganization {
  return useContext(SessionOrganizationContext) ?? createSessionOrganizationController()
}
