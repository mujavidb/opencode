import { Schema } from "effect"
import { Rpc, RpcGroup } from "effect/rpc"

const ServerReadyData = Schema.Struct({
  url: Schema.String,
})

export const AppAwaitInitialization = Rpc.make("AppAwaitInitialization", { success: ServerReadyData })

export const AppReconnectService = Rpc.make("AppReconnectService", { success: ServerReadyData })

export const AppConsumeInitialDeepLinks = Rpc.make("AppConsumeInitialDeepLinks", {
  success: Schema.Array(Schema.String),
})

export const AppIsFirstLaunchOnboardingPending = Rpc.make("AppIsFirstLaunchOnboardingPending", {
  success: Schema.Boolean,
})

export const AppFinishFirstLaunchOnboarding = Rpc.make("AppFinishFirstLaunchOnboarding", {
  payload: { createDefaultProject: Schema.Boolean },
  success: Schema.NullOr(Schema.String),
})

export const AppCheckAppExists = Rpc.make("AppCheckAppExists", {
  payload: { appName: Schema.String },
  success: Schema.Boolean,
})

export const AppResolveAppPath = Rpc.make("AppResolveAppPath", {
  payload: { appName: Schema.String },
  success: Schema.NullOr(Schema.String),
})

export const AppSetBackgroundColor = Rpc.make("AppSetBackgroundColor", {
  payload: { color: Schema.String },
})

export const AppExportDebugLogs = Rpc.make("AppExportDebugLogs", { success: Schema.String })

export const AppSetForceFocus = Rpc.make("AppSetForceFocus", {
  payload: { enabled: Schema.Boolean },
})

export const AppRecordFatalRendererError = Rpc.make("AppRecordFatalRendererError", {
  payload: {
    error: Schema.Struct({
      error: Schema.String,
      url: Schema.String,
      version: Schema.optionalKey(Schema.String),
      platform: Schema.String,
      os: Schema.optionalKey(Schema.String),
    }),
  },
})

export const AppSetNativeTranslations = Rpc.make("AppSetNativeTranslations", {
  payload: { value: Schema.Unknown },
})

export const AppRelaunch = Rpc.make("AppRelaunch")

export const ProjectRunStatusSchema = Schema.Struct({
  directory: Schema.String,
  configPath: Schema.String,
  configured: Schema.Boolean,
  command: Schema.String,
  port: Schema.optionalKey(Schema.Number),
  url: Schema.optionalKey(Schema.String),
  running: Schema.Boolean,
  pid: Schema.optionalKey(Schema.Number),
  logs: Schema.Array(Schema.String),
  action: Schema.optionalKey(Schema.Literals(["started", "already-running", "stopped", "saved", "unconfigured"])),
})

export const AppProjectRunnerStatus = Rpc.make("AppProjectRunnerStatus", {
  payload: { directory: Schema.String },
  success: ProjectRunStatusSchema,
})

export const AppProjectRunnerSave = Rpc.make("AppProjectRunnerSave", {
  payload: {
    directory: Schema.String,
    command: Schema.String,
    port: Schema.optionalKey(Schema.Number),
    url: Schema.optionalKey(Schema.String),
  },
  success: ProjectRunStatusSchema,
})

export const AppProjectRunnerStart = Rpc.make("AppProjectRunnerStart", {
  payload: {
    directory: Schema.String,
    command: Schema.optionalKey(Schema.String),
    port: Schema.optionalKey(Schema.Number),
    url: Schema.optionalKey(Schema.String),
  },
  success: ProjectRunStatusSchema,
})

export const AppProjectRunnerStop = Rpc.make("AppProjectRunnerStop", {
  payload: { directory: Schema.String },
  success: ProjectRunStatusSchema,
})

export const AppRpcs = RpcGroup.make(
  AppAwaitInitialization,
  AppReconnectService,
  AppConsumeInitialDeepLinks,
  AppIsFirstLaunchOnboardingPending,
  AppFinishFirstLaunchOnboarding,
  AppCheckAppExists,
  AppResolveAppPath,
  AppSetBackgroundColor,
  AppExportDebugLogs,
  AppSetForceFocus,
  AppRecordFatalRendererError,
  AppSetNativeTranslations,
  AppRelaunch,
  AppProjectRunnerStatus,
  AppProjectRunnerSave,
  AppProjectRunnerStart,
  AppProjectRunnerStop,
)
