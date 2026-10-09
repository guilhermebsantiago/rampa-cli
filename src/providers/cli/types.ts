import type { ProcessResult } from './process.ts'

/** Runs the CLI with these arguments and this stdin, in Rampa's own working directory and environment (plus `env`, for one call). */
export type Exec = (args: readonly string[], input: string, options?: { timeoutMs?: number; env?: Record<string, string> }) => Promise<ProcessResult>

/** One judgment, as an agent CLI receives it. */
export interface CliCall {
  system: string
  user: string
  images: ReadonlyArray<{ data: Uint8Array; mediaType: string }>
  /** The answer's JSON Schema, draft-07, without `$schema`. */
  jsonSchema: Record<string, unknown>
  /** Model as written after the colon; undefined leaves the CLI's own default. */
  model: string | undefined
  /** From --reasoning, mapped to the effort levels the CLIs share. */
  effort: 'low' | 'medium' | 'high' | undefined
  /** A fresh directory for this call's files (images, schema, instructions), inside the working directory; removed afterwards. */
  dir: string
}

export interface CliAnswer {
  /** Still unchecked; the provider validates it against the criterion's schema. */
  output: unknown
  inputTokens: number
  outputTokens: number
  /** The model the CLI reports it used, when it reports one. */
  modelId?: string | undefined
}

export interface SignIn {
  /** undefined when the CLI has no cheap way to tell. */
  signedIn: boolean | undefined
  /** True for a subscription sign-in, false for an API key or a cloud account; undefined when unknown. */
  subscription: boolean | undefined
  /** How the CLI is signed in, in words, for doctor and errors, such as "ChatGPT". Never an email address. */
  detail?: string | undefined
}

/**
 * An official agent CLI that the user installed and signed in to. Rampa only
 * runs it in its documented non-interactive mode: it never reads, stores or
 * forwards the CLI's credentials, and it offers no login of its own.
 */
export interface CliAdapter {
  /** Executable name on PATH. */
  command: string
  /** Variable that points to the executable instead, for a CLI that is not on PATH. */
  binEnv: string
  /** Where the official installer puts it, tried after PATH: a shell alias is invisible to Rampa. */
  knownPaths?(): string[]
  /** The CLI's name in messages, such as "Codex CLI". */
  name: string
  /** Whose plan the usage counts against, such as "ChatGPT". */
  plan: string
  /** Where to get it. */
  install: string
  /** How to sign in, as an instruction. */
  signInHint: string
  /** Removed from the CLI's environment, so a key Rampa loaded from .env never moves the judgment to per-token API billing. */
  dropEnv: readonly string[]
  /** Added to the CLI's environment to keep the user's own context out of the judgment. */
  setEnv?: Readonly<Record<string, string>> | undefined
  /** Whether the CLI is signed in, without a model call. Absent when the CLI has no cheap way to tell. */
  signIn?(exec: Exec): Promise<SignIn>
  /** Once per run, before the first call: files the CLI reads from Rampa's working directory. */
  prepare?(workdir: string): Promise<void>
  /** One judgment: writes what the CLI needs into `call.dir`, runs it and reads the answer back. */
  judge(call: CliCall, exec: Exec): Promise<CliAnswer>
}
