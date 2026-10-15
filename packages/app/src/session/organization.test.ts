import { describe, expect, test } from "bun:test"
import { createRoot } from "solid-js"
import type { SessionInfo } from "@opencode/client/promise"
import {
  applySessionOrganization,
  initialSessionOrganization,
  isSessionArchived,
  isSessionPinned,
  useSessionOrganization,
} from "./organization"

const session = (id: string, input: Partial<SessionInfo> = {}) =>
  ({
    id,
    projectID: "project-a",
    title: id,
    time: { created: 1, updated: 1 },
    location: { directory: "/repo/a" },
    ...input,
  }) as SessionInfo

describe("session organization", () => {
  test("archives, unarchives (including server-archived sessions), pins, folders, tags, and assigns projects", () => {
    createRoot((dispose) => {
      try {
        const org = useSessionOrganization()
        const s1 = session("ses_1")
        const s2 = session("ses_server_archived", { time: { created: 1, updated: 2, archived: 3 } })

        expect(org.isArchived(s1)).toBe(false)
        expect(org.isArchived(s2)).toBe(true)

        org.archive(s1.id)
        expect(org.isArchived(s1)).toBe(true)

        org.unarchive(s2.id)
        expect(org.isArchived(s2)).toBe(false)

        expect(org.togglePin(s1.id)).toBe(true)
        expect(org.isPinned(s1.id)).toBe(true)
        expect(org.togglePin(s1.id)).toBe(false)
        expect(org.isPinned(s1.id)).toBe(false)

        const folder = org.createFolder("Urgent", "red")
        expect(folder?.name).toBe("Urgent")
        org.assignFolder(s1.id, folder?.id)
        expect(org.folderForSession(s1.id)?.name).toBe("Urgent")

        org.addTag(s1.id, "#frontend", "cyan")
        expect(org.tagsForSession(s1.id)).toEqual(["frontend"])
        expect(org.tagColor("frontend")).toBe("cyan")

        org.assignProject(s1.id, "/repo/b")
        expect(org.effectiveDirectory(s1)).toBe("/repo/b")
        expect(org.effectiveSession(s1).location.directory).toBe("/repo/b")

        if (folder) org.deleteFolder(folder.id)
        expect(org.folderForSession(s1.id)).toBeUndefined()
      } finally {
        dispose()
      }
    })
  })

  test("pure state helpers evaluate archive, pin, and project directory overrides", () => {
    const state = {
      ...initialSessionOrganization(),
      sessions: {
        ses_1: { archivedAt: 10, pinnedAt: 20, projectDirectory: "/repo/override" },
        ses_unarchived: { archivedAt: 0 },
      },
    }

    expect(isSessionArchived(state, session("ses_1"))).toBe(true)
    expect(isSessionArchived(state, session("ses_unarchived", { time: { created: 1, updated: 1, archived: 5 } }))).toBe(
      false,
    )
    expect(isSessionPinned(state, "ses_1")).toBe(true)
    expect(applySessionOrganization(state, session("ses_1")).location.directory).toBe("/repo/override")
  })
})
