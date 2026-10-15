import { batch, createComponent, createContext, useContext, type ParentProps } from "solid-js"
import { createStore, produce } from "solid-js/store"
import { Option, Predicate, Schema } from "effect"
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
  collapsed: Persistence.optional(Schema.Boolean),
  createdAt: Persistence.fallback(Schema.Finite, () => 0),
})

export type SessionFolder = typeof SessionFolderSchema.Type

export const SessionOrgEntrySchema = Persistence.struct({
  archivedAt: Persistence.optional(Schema.Finite),
  pinnedAt: Persistence.optional(Schema.Finite),
  folderID: Persistence.optional(Schema.String),
  projectDirectory: Persistence.optional(Schema.String),
  tags: Persistence.optional(Persistence.array(Schema.String)),
  title: Persistence.optional(Schema.String),
  server: Persistence.optional(Schema.String),
  directory: Persistence.optional(Schema.String),
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
  archivedExpanded: Persistence.fallback(Schema.Boolean, () => false),
})

export type SessionOrganizationState = typeof SessionOrganizationSchema.Type

export function initialSessionOrganization(): SessionOrganizationState {
  return {
    folders: [],
    sessions: {},
    tagColors: {},
    groupBy: "date",
    archivedExpanded: false,
  }
}

export const SessionOrgMetadataSchema = Persistence.struct({
  archivedAt: Persistence.optional(Schema.Finite),
  pinnedAt: Persistence.optional(Schema.Finite),
  folderID: Persistence.optional(Schema.String),
  folderName: Persistence.optional(Schema.String),
  folderColor: Persistence.optional(OrganizeColorSchema),
  projectDirectory: Persistence.optional(Schema.String),
  tags: Persistence.optional(Persistence.array(Schema.String)),
})

const decodeOrgMetadata = Schema.decodeUnknownOption(SessionOrgMetadataSchema)

export function readSessionOrgMetadata(session: Pick<SessionInfo, "metadata">): SessionOrgEntry | undefined {
  const raw = session.metadata?.org

  if (!raw || !Predicate.isObject(raw)) return undefined
  const decoded = decodeOrgMetadata(raw)

  return Option.isSome(decoded) ? decoded.value : undefined
}

export function isSessionArchived(
  state: Pick<SessionOrganizationState, "sessions">,
  session: Pick<SessionInfo, "id" | "time" | "metadata">,
) {
  const entry = state.sessions[session.id] ?? readSessionOrgMetadata(session)

  if (entry?.archivedAt !== undefined) return entry.archivedAt > 0

  return Predicate.isNumber(session.time.archived)
}

export function isSessionPinned(state: Pick<SessionOrganizationState, "sessions">, sessionID: string) {
  return (state.sessions[sessionID]?.pinnedAt ?? 0) > 0
}

export function sessionEffectiveDirectory(
  state: Pick<SessionOrganizationState, "sessions">,
  session: Pick<SessionInfo, "id" | "location" | "metadata">,
) {
  return (
    state.sessions[session.id]?.projectDirectory ??
    readSessionOrgMetadata(session)?.projectDirectory ??
    session.location.directory
  )
}

export function applySessionOrganization(state: Pick<SessionOrganizationState, "sessions">, session: SessionInfo) {
  const override = sessionEffectiveDirectory(state, session)

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
    archivedExpanded: () => store.archivedExpanded,
    setArchivedExpanded(expanded: boolean) {
      setStore("archivedExpanded", expanded)
    },
    toggleArchivedExpanded() {
      setStore("archivedExpanded", !store.archivedExpanded)
    },
    isFolderCollapsed(folderID: string) {
      return !!store.folders.find((item) => item.id === folderID)?.collapsed
    },
    toggleFolderCollapsed(folderID: string) {
      const index = store.folders.findIndex((item) => item.id === folderID)

      if (index === -1) return
      setStore("folders", index, "collapsed", !store.folders[index]?.collapsed)
    },
    setFolderCollapsed(folderID: string, collapsed: boolean) {
      const index = store.folders.findIndex((item) => item.id === folderID)

      if (index === -1) return
      setStore("folders", index, "collapsed", collapsed)
    },
    groupBy: () => store.groupBy,
    setGroupBy(groupBy: SessionGroupBy) {
      setStore("groupBy", groupBy)
    },
    isArchived(session: Pick<SessionInfo, "id" | "time"> & { metadata?: SessionInfo["metadata"] }) {
      return isSessionArchived(store, session)
    },
    isArchivedID(sessionID: string) {
      return (store.sessions[sessionID]?.archivedAt ?? 0) > 0
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
    rememberChatInfo(input: { id: string; title?: string; server?: string; directory?: string }) {
      setStore(
        produce((draft) => {
          const entry = ensureEntry(draft, input.id)

          if (input.title) entry.title = input.title

          if (input.server) entry.server = input.server

          if (input.directory) entry.directory = input.directory
        }),
      )
    },
    archive(sessionID: string, details?: { title?: string; server?: string; directory?: string }) {
      const now = Date.now()
      setStore(
        produce((draft) => {
          const entry = ensureEntry(draft, sessionID)
          entry.archivedAt = now

          if (details?.title) entry.title = details.title

          if (details?.server) entry.server = details.server

          if (details?.directory) entry.directory = details.directory
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

      return store.sessions[sessionID]
    },
    removeArchived(sessionID: string) {
      setStore(
        produce((draft) => {
          delete draft.sessions[sessionID]
        }),
      )
    },
    archivedChats() {
      return Object.entries(store.sessions)
        .flatMap(([id, entry]) => {
          if (!entry?.archivedAt || entry.archivedAt <= 0) return []
          const folder = entry.folderID ? store.folders.find((item) => item.id === entry.folderID) : undefined

          return [
            {
              id,
              archivedAt: entry.archivedAt,
              title: entry.title,
              server: entry.server,
              directory: entry.directory,
              folder,
            },
          ]
        })
        .toSorted((a, b) => b.archivedAt - a.archivedAt)
    },
    transferDraft(draftID: string, sessionID: string) {
      const draftKey = `draft:${draftID}`
      const source = store.sessions[draftKey]

      if (!source) return
      setStore(
        produce((draft) => {
          const from = draft.sessions[draftKey]

          if (!from) return
          const target = ensureEntry(draft, sessionID)

          if (from.folderID && !target.folderID) target.folderID = from.folderID

          if (from.pinnedAt && !target.pinnedAt) target.pinnedAt = from.pinnedAt

          if (from.tags && (!target.tags || target.tags.length === 0)) target.tags = [...from.tags]
          delete draft.sessions[draftKey]
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
    hydrateFromSessions(sessions: readonly SessionInfo[]) {
      setStore(
        produce((draft) => {
          for (const session of sessions) {
            const raw = session.metadata?.org

            if (!raw || !Predicate.isObject(raw)) continue
            const decoded = decodeOrgMetadata(raw)

            if (Option.isNone(decoded)) continue
            const meta = decoded.value

            if (meta.folderID && meta.folderName && !draft.folders.some((f) => f.id === meta.folderID)) {
              draft.folders.push({
                id: meta.folderID,
                name: meta.folderName,
                color: meta.folderColor ?? "blue",
                createdAt: Date.now(),
              })
            }

            if (!draft.sessions[session.id]) {
              draft.sessions[session.id] = {
                archivedAt: meta.archivedAt,
                pinnedAt: meta.pinnedAt,
                folderID: meta.folderID,
                projectDirectory: meta.projectDirectory,
                tags: meta.tags ? [...meta.tags] : undefined,
              }
            }
          }
        }),
      )
    },
    serializeMetadata(session: SessionInfo) {
      const entry = store.sessions[session.id]
      const folder = entry?.folderID ? store.folders.find((f) => f.id === entry.folderID) : undefined

      return {
        ...(session.metadata ?? {}),
        org: entry
          ? {
              archivedAt: entry.archivedAt ?? null,
              pinnedAt: entry.pinnedAt ?? null,
              folderID: entry.folderID ?? null,
              folderName: folder?.name ?? null,
              folderColor: folder?.color ?? null,
              projectDirectory: entry.projectDirectory ?? null,
              tags: entry.tags ? [...entry.tags] : [],
            }
          : null,
      }
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
