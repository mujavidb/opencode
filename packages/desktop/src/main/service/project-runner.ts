import { spawn, type ChildProcess } from "node:child_process"
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs"
import net from "node:net"
import os from "node:os"
import path from "node:path"

export type ProjectRunConfig = {
  command: string
  port?: number
  url?: string
}

export type ProjectRunStatus = {
  directory: string
  configPath: string
  configured: boolean
  command: string
  port?: number
  url?: string
  running: boolean
  pid?: number
  logs: string[]
  action?: "started" | "already-running" | "stopped" | "saved" | "unconfigured"
}

type ManagedProcess = {
  proc: ChildProcess
  pid: number
  command: string
  port?: number
  url?: string
  logs: string[]
}

const managed = new Map<string, ManagedProcess>()

const MAX_LOG_LINES = 40

function opencodeConfigDir(): string {
  const xdg = process.env.XDG_CONFIG_HOME

  if (xdg && xdg.trim()) return path.join(xdg.trim(), "opencode")

  return path.join(os.homedir(), ".config", "opencode")
}

export function runConfigFilePath(): string {
  return path.join(opencodeConfigDir(), "run.json")
}

function opencodeJsonPath(): string {
  return path.join(opencodeConfigDir(), "opencode.json")
}

function normalizeDir(directory: string): string {
  return directory.replace(/[/\\]+$/, "") || directory
}

function readJsonRecord(filePath: string): Record<string, unknown> {
  if (!existsSync(filePath)) return {}

  try {
    const parsed: unknown = JSON.parse(readFileSync(filePath, "utf8"))

    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      return parsed as Record<string, unknown>
    }
  } catch {
    // Ignore malformed JSON and treat as empty
  }

  return {}
}

function parseEntry(raw: unknown): ProjectRunConfig | undefined {
  if (typeof raw === "string" && raw.trim()) {
    return { command: raw.trim() }
  }

  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined
  const obj = raw as Record<string, unknown>
  const command = typeof obj.command === "string" ? obj.command.trim() : ""

  if (!command) return undefined
  const port = typeof obj.port === "number" && Number.isFinite(obj.port) && obj.port > 0 ? obj.port : undefined
  const url = typeof obj.url === "string" && obj.url.trim() ? obj.url.trim() : undefined

  return { command, port, url }
}

function readConfiguredEntry(directory: string): ProjectRunConfig | undefined {
  const dir = normalizeDir(directory)
  const runMap = readJsonRecord(runConfigFilePath())
  const direct = parseEntry(runMap[dir])

  if (direct) return direct

  // Also check ~/.config/opencode/opencode.json under "run" in case OpenCode or the user configured it there
  const mainConfig = readJsonRecord(opencodeJsonPath())
  const mainRun = mainConfig.run

  if (mainRun && typeof mainRun === "object" && !Array.isArray(mainRun)) {
    const fromMain = parseEntry((mainRun as Record<string, unknown>)[dir])

    if (fromMain) return fromMain
  }

  return undefined
}

export function writeConfiguredEntry(directory: string, config: ProjectRunConfig): void {
  const dir = normalizeDir(directory)
  const configDir = opencodeConfigDir()
  mkdirSync(configDir, { recursive: true })
  const filePath = runConfigFilePath()
  const current = readJsonRecord(filePath)
  const entry: Record<string, unknown> = { command: config.command.trim() }

  if (config.port && Number.isFinite(config.port) && config.port > 0) entry.port = config.port

  if (config.url && config.url.trim()) entry.url = config.url.trim()

  current[dir] = entry
  writeFileSync(filePath, `${JSON.stringify(current, null, 2)}\n`, "utf8")
}

function detectPortFromText(text: string): number | undefined {
  const urlMatch = /https?:\/\/(?:localhost|127\.0\.0\.1|0\.0\.0\.0):(\d{2,5})/i.exec(text)

  if (urlMatch?.[1]) return Number(urlMatch[1])

  const flagMatch = /(?:--port|-p|PORT=)\s*(\d{2,5})\b/i.exec(text)

  if (flagMatch?.[1]) return Number(flagMatch[1])

  return undefined
}

function detectProjectDefault(directory: string): ProjectRunConfig | undefined {
  const dir = normalizeDir(directory)
  const pkgPath = path.join(dir, "package.json")

  if (!existsSync(pkgPath)) return undefined
  const pkg = readJsonRecord(pkgPath)
  const scripts = pkg.scripts

  if (!scripts || typeof scripts !== "object" || Array.isArray(scripts)) return undefined
  const scriptMap = scripts as Record<string, unknown>

  const runner =
    existsSync(path.join(dir, "bun.lock")) || existsSync(path.join(dir, "bun.lockb"))
      ? "bun"
      : existsSync(path.join(dir, "pnpm-lock.yaml"))
        ? "pnpm"
        : existsSync(path.join(dir, "yarn.lock"))
          ? "yarn"
          : "npm"

  for (const key of ["dev", "start", "serve"]) {
    const body = scriptMap[key]

    if (typeof body === "string" && body.trim()) {
      const command = `${runner} run ${key}`
      const port = detectPortFromText(body)

      return {
        command,
        port,
        url: port ? `http://localhost:${port}` : undefined,
      }
    }
  }

  return undefined
}

function checkPortOpen(port: number, host = "127.0.0.1", timeoutMs = 350): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = new net.Socket()
    let settled = false

    const done = (open: boolean) => {
      if (settled) return
      settled = true
      socket.destroy()
      resolve(open)
    }

    socket.setTimeout(timeoutMs)
    socket.once("connect", () => done(true))
    socket.once("timeout", () => done(false))
    socket.once("error", () => done(false))
    socket.connect(port, host)
  })
}

async function isPortListening(port: number): Promise<boolean> {
  if (await checkPortOpen(port, "127.0.0.1")) return true

  return checkPortOpen(port, "::1")
}

function isProcessAlive(pid: number): boolean {
  try {
    process.kill(pid, 0)

    return true
  } catch {
    return false
  }
}

function activeManaged(directory: string): ManagedProcess | undefined {
  const dir = normalizeDir(directory)
  const entry = managed.get(dir)

  if (!entry) return undefined

  if (entry.proc.exitCode !== null || entry.proc.killed || !isProcessAlive(entry.pid)) {
    managed.delete(dir)

    return undefined
  }

  return entry
}

function appendLog(entry: ManagedProcess, chunk: Buffer | string) {
  const lines = String(chunk)
    .replace(/\x1b\[[0-9;]*[a-zA-Z]/g, "")
    .split(/\r?\n/)
    .map((line) => line.trimEnd())
    .filter(Boolean)

  for (const line of lines) {
    entry.logs.push(line)
    const detectedPort = detectPortFromText(line)

    if (detectedPort && !entry.port) {
      entry.port = detectedPort
      entry.url = `http://localhost:${detectedPort}`
    }
  }

  if (entry.logs.length > MAX_LOG_LINES) {
    entry.logs.splice(0, entry.logs.length - MAX_LOG_LINES)
  }
}

export async function getProjectRunnerStatus(directory: string): Promise<ProjectRunStatus> {
  const dir = normalizeDir(directory)
  const saved = readConfiguredEntry(dir)
  const fallback = saved ?? detectProjectDefault(dir)
  const current = activeManaged(dir)
  const port = current?.port ?? saved?.port ?? fallback?.port ?? (fallback?.command ? detectPortFromText(fallback.command) : undefined)
  const portListening = port ? await isPortListening(port) : false
  const running = !!current || portListening
  const url = current?.url ?? saved?.url ?? (port ? `http://localhost:${port}` : fallback?.url)

  return {
    directory: dir,
    configPath: runConfigFilePath(),
    configured: !!saved,
    command: saved?.command ?? fallback?.command ?? "",
    port,
    url,
    running,
    pid: current?.pid,
    logs: current ? [...current.logs] : [],
  }
}

export async function saveProjectRunnerConfig(input: {
  directory: string
  command: string
  port?: number
  url?: string
}): Promise<ProjectRunStatus> {
  const dir = normalizeDir(input.directory)
  const port = input.port ?? detectPortFromText(input.command)
  const url = input.url?.trim() || (port ? `http://localhost:${port}` : undefined)
  writeConfiguredEntry(dir, {
    command: input.command.trim(),
    port,
    url,
  })
  const status = await getProjectRunnerStatus(dir)

  return { ...status, action: "saved" }
}

export async function startOrCheckProjectServer(input: {
  directory: string
  command?: string
  port?: number
  url?: string
}): Promise<ProjectRunStatus> {
  const dir = normalizeDir(input.directory)

  if (input.command?.trim()) {
    await saveProjectRunnerConfig({
      directory: dir,
      command: input.command.trim(),
      port: input.port,
      url: input.url,
    })
  }

  const current = await getProjectRunnerStatus(dir)

  if (current.running) {
    return { ...current, action: "already-running" }
  }

  if (!current.command.trim()) {
    return { ...current, action: "unconfigured" }
  }

  if (!current.configured) {
    writeConfiguredEntry(dir, {
      command: current.command,
      port: current.port,
      url: current.url,
    })
  }

  const shell = process.env.SHELL || "/bin/zsh"
  const child = spawn(shell, ["-lc", current.command], {
    cwd: dir,
    detached: true,
    stdio: ["ignore", "pipe", "pipe"],
    env: {
      ...process.env,
      FORCE_COLOR: "0",
    },
  })

  const pid = child.pid ?? 0
  const record: ManagedProcess = {
    proc: child,
    pid,
    command: current.command,
    port: current.port,
    url: current.url,
    logs: [`$ ${current.command}`],
  }

  if (pid > 0) {
    managed.set(dir, record)
  }

  child.stdout?.on("data", (chunk: Buffer) => appendLog(record, chunk))
  child.stderr?.on("data", (chunk: Buffer) => appendLog(record, chunk))
  child.once("exit", () => {
    if (managed.get(dir) === record) {
      managed.delete(dir)
    }
  })

  // Wait briefly so fast-starting servers or immediate port bindings are captured
  await new Promise((resolve) => setTimeout(resolve, 450))
  const updated = await getProjectRunnerStatus(dir)

  return {
    ...updated,
    running: updated.running || isProcessAlive(pid),
    action: "started",
  }
}

export async function stopProjectServer(directory: string): Promise<ProjectRunStatus> {
  const dir = normalizeDir(directory)
  const entry = activeManaged(dir)

  if (entry) {
    try {
      process.kill(-entry.pid, "SIGTERM")
    } catch {
      try {
        entry.proc.kill("SIGTERM")
      } catch {}
    }

    managed.delete(dir)
  }

  await new Promise((resolve) => setTimeout(resolve, 200))
  const status = await getProjectRunnerStatus(dir)

  return { ...status, action: "stopped" }
}
