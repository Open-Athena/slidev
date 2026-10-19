// `slidev deploy`: deploy the Worker `slidev build --worker` wrote (`<out>-worker/`) with
// wrangler. With `publish.worker.auth: open-athena` it also provisions what the gate needs: the D1
// database (created when missing, its id written into the generated `wrangler.jsonc`), the auth
// library's migrations, and `SESSION_SECRET` (generated, and piped to wrangler on stdin).
//
// `--dry-run` prints the plan without running anything: no wrangler, no Cloudflare API calls.

import type { WorkerDeployInfo } from './og'
import { spawn } from 'node:child_process'
import { randomBytes } from 'node:crypto'
import { existsSync } from 'node:fs'
import fs from 'node:fs/promises'
import { delimiter, dirname, relative, resolve } from 'node:path'
import process from 'node:process'
import { workerDirFor } from './og'

/** One step of the deploy, as the dry run prints it and the real run executes it. */
export type DeployStep
  = | { kind: 'rm-redirects', path: string }
    | { kind: 'd1-create', database: string }
    | { kind: 'd1-id', database: string, config: string }
    | { kind: 'migrate', database: string, config: string }
    | { kind: 'deploy', config: string }
    | { kind: 'secret', name: string, config: string }

export interface DeployContext {
  info: WorkerDeployInfo
  /** The Worker's directory, relative to the cwd. */
  workerDir: string
  /** The build output, relative to the cwd. */
  outDir: string
  /** Whether `<outDir>/_redirects` exists. */
  hasRedirects: boolean
}

export const SESSION_SECRET = 'SESSION_SECRET'

const join = (...parts: string[]) => parts.filter(Boolean).join('/').replace(/^\.\//, '')

/** The steps `slidev deploy` takes, in order. */
export function deployPlan({ info, workerDir, outDir, hasRedirects }: DeployContext): DeployStep[] {
  const config = join(workerDir, info.config)
  const steps: DeployStep[] = []
  // Workers assets reject Slidev's `/* /index.html 200` catch-all as a loop; the generated config's
  // `not_found_handling` does the SPA fallback instead.
  if (hasRedirects)
    steps.push({ kind: 'rm-redirects', path: join(outDir, '_redirects') })
  if (info.auth) {
    const { database } = info.auth
    if (!info.auth.databaseId) {
      steps.push({ kind: 'd1-create', database })
      steps.push({ kind: 'd1-id', database, config })
    }
    steps.push({ kind: 'migrate', database, config })
  }
  steps.push({ kind: 'deploy', config })
  // After the deploy, so the Worker exists (`secret put` on a missing one asks to create it).
  // Until it's set, the gate answers 503 rather than let anyone in.
  if (info.auth)
    steps.push({ kind: 'secret', name: SESSION_SECRET, config })
  return steps
}

/** The wrangler command line a step runs, if any (without the `wrangler` command itself). */
export function stepArgs(step: DeployStep): string[] | undefined {
  switch (step.kind) {
    case 'd1-create': return ['d1', 'create', step.database]
    case 'migrate': return ['d1', 'migrations', 'apply', step.database, '--remote', '-c', step.config]
    case 'deploy': return ['deploy', '-c', step.config]
    case 'secret': return ['secret', 'put', step.name, '-c', step.config]
    default: return undefined
  }
}

const D1_LIST = ['d1', 'list', '--json']
const secretList = (config: string) => ['secret', 'list', '-c', config, '--format', 'json']

function quote(arg: string): string {
  return /^[\w@%+=:,./-]+$/.test(arg) ? arg : `'${arg.replace(/'/g, `'\\''`)}'`
}

export function formatCommand(cmd: string[]): string {
  return cmd.map(quote).join(' ')
}

/** How the dry run describes a step. `wrangler` is the command prefix (e.g. `npx wrangler`). */
export function describeStep(step: DeployStep, wrangler: string[]): string {
  const w = (args: string[]) => `\`${formatCommand([...wrangler, ...args])}\``
  switch (step.kind) {
    case 'rm-redirects':
      return `remove \`${step.path}\` (Workers assets reject its SPA catch-all; \`not_found_handling\` replaces it)`
    case 'd1-create':
      return `if the D1 database \`${step.database}\` doesn't exist (${w(D1_LIST)}): ${w(stepArgs(step)!)}`
    case 'd1-id':
      return `write \`${step.database}\`'s id (from ${w(D1_LIST)}) into \`${step.config}\`'s \`database_id\``
    case 'migrate':
      return `${w(stepArgs(step)!)} (\`@open-athena/auth\`'s migrations)`
    case 'deploy':
      return w(stepArgs(step)!)
    case 'secret':
      return `if \`${step.name}\` isn't set (${w(secretList(step.config))}): ${w(stepArgs(step)!)}, with 32 random bytes (base64url) on stdin`
  }
}

/** The step that's always left to a person: Google's OAuth client (there's no API to create one). */
export function manualSteps(info: WorkerDeployInfo, wrangler: string[], config: string): string[] {
  if (!info.auth)
    return []
  const origin = new URL(info.baseUrl).origin
  const base = info.base.replace(/\/*$/, '/')
  const put = (name: string) => `\`${formatCommand([...wrangler, 'secret', 'put', name, '-c', config])}\``
  return [
    'Google sign-in, by hand (until then, the sign-in page says it isn\'t configured, and share links still work):',
    `  1. In the Google Cloud console, create an OAuth client (Web application) with JavaScript origin ${origin} and redirect URI ${origin}${base}auth/google/callback.`,
    `  2. ${put('GOOGLE_CLIENT_ID')} and ${put('GOOGLE_CLIENT_SECRET')}.`,
    '  (`@open-athena/auth`\'s `scripts/provision-oauth-client.mjs` stores these for Pages projects; it doesn\'t take a Worker yet.)',
  ]
}

/** The dry run's output. */
export function describePlan(ctx: DeployContext, wrangler: string[]): string {
  const steps = deployPlan(ctx)
  const config = join(ctx.workerDir, ctx.info.config)
  const lines = [
    `Deploy plan for \`${ctx.info.name}\` (${ctx.info.baseUrl})${ctx.info.auth ? ', behind `@open-athena/auth`' : ''}. Dry run: nothing was run.`,
    ...steps.map((s, i) => `${i + 1}. ${describeStep(s, wrangler)}`),
  ]
  const manual = manualSteps(ctx.info, wrangler, config)
  if (manual.length)
    lines.push('', ...manual)
  return `${lines.join('\n')}\n`
}

/** Set the `database_id` of the generated `wrangler.jsonc` (it has one D1 database). */
export function setDatabaseId(wranglerConfig: string, id: string): string {
  const re = /("database_id"\s*:\s*)"[^"]*"/
  if (!re.test(wranglerConfig))
    throw new Error('[Slidev] deploy: no `database_id` in the wrangler config; rebuild with `slidev build --worker`')
  return wranglerConfig.replace(re, (_, key: string) => `${key}${JSON.stringify(id)}`)
}

/** The id of the D1 database `name`, from `wrangler d1 list --json`'s output; `null` if missing. */
export function findDatabaseId(listJson: string, name: string): string | null {
  const rows = JSON.parse(listJson) as { name?: string, uuid?: string }[]
  return rows.find(r => r.name === name)?.uuid ?? null
}

/** Whether `wrangler secret list --format json`'s output includes `name`. */
export function hasSecret(listJson: string, name: string): boolean {
  return (JSON.parse(listJson) as { name?: string }[]).some(s => s.name === name)
}

export interface RunResult { code: number, stdout: string }
/** Runs `wrangler <args>`: `capture` collects stdout (else it's inherited), `input` goes to stdin. */
export type WranglerRunner = (args: string[], opts?: { capture?: boolean, input?: string }) => Promise<RunResult>

export function spawnRunner(wrangler: string[], cwd: string): WranglerRunner {
  return (args, opts = {}) => new Promise((resolvePromise, reject) => {
    const child = spawn(wrangler[0], [...wrangler.slice(1), ...args], {
      cwd,
      stdio: [opts.input !== undefined ? 'pipe' : 'inherit', opts.capture ? 'pipe' : 'inherit', 'inherit'],
    })
    let stdout = ''
    child.stdout?.on('data', (d) => {
      stdout += d
    })
    child.on('error', reject)
    child.on('close', code => resolvePromise({ code: code ?? 1, stdout }))
    if (opts.input !== undefined)
      child.stdin!.end(opts.input)
  })
}

/** `--wrangler`, else `$SLIDEV_WRANGLER`, else the deck's own `wrangler`, else `npx wrangler`. */
export function resolveWrangler(flag: string | undefined, cwd: string, env: NodeJS.ProcessEnv = process.env): string[] {
  const explicit = flag ?? env.SLIDEV_WRANGLER
  if (explicit)
    return explicit.trim().split(/\s+/)
  let dir = resolve(cwd)
  while (true) {
    const bin = resolve(dir, 'node_modules', '.bin', 'wrangler')
    if (existsSync(bin))
      return [relative(cwd, bin) || bin]
    const parent = dirname(dir)
    if (parent === dir)
      break
    dir = parent
  }
  // Also on `PATH`?
  for (const p of (env.PATH ?? '').split(delimiter)) {
    if (p && existsSync(resolve(p, 'wrangler')))
      return ['wrangler']
  }
  return ['npx', 'wrangler']
}

export async function loadDeployContext(out: string, cwd = process.cwd()): Promise<DeployContext> {
  const outDir = resolve(cwd, out)
  const workerDir = workerDirFor(outDir)
  const infoPath = resolve(workerDir, 'deploy.json')
  if (!existsSync(infoPath))
    throw new Error(`[Slidev] deploy: no ${relative(cwd, infoPath)}; build the Worker first (\`slidev build --worker\`, or \`publish.worker\` in the headmatter)`)
  const info = JSON.parse(await fs.readFile(infoPath, 'utf-8')) as WorkerDeployInfo
  return {
    info,
    workerDir: relative(cwd, workerDir) || '.',
    outDir: relative(cwd, outDir) || '.',
    hasRedirects: existsSync(resolve(outDir, '_redirects')),
  }
}

/** Run the plan. `log` gets a line per step. */
export async function runDeploy(
  ctx: DeployContext,
  opts: {
    run: WranglerRunner
    wrangler: string[]
    cwd: string
    log: (line: string) => void
    /** The generated secret; injectable for tests. */
    secret?: () => string
  },
): Promise<void> {
  const { run, log, cwd } = opts
  const must = async (args: string[], o?: { capture?: boolean, input?: string }) => {
    const res = await run(args, o)
    if (res.code !== 0)
      throw new Error(`[Slidev] deploy: \`${formatCommand([...opts.wrangler, ...args])}\` failed (exit ${res.code})`)
    return res.stdout
  }
  if (ctx.info.auth) {
    const migrations = resolve(cwd, ctx.workerDir, ctx.info.auth.migrationsDir)
    if (!existsSync(migrations))
      throw new Error(`[Slidev] deploy: \`@open-athena/auth\`'s migrations aren't at ${relative(cwd, migrations)}; install \`@open-athena/auth\` in the deck and rebuild`)
  }
  let databaseId: string | null = null
  for (const step of deployPlan(ctx)) {
    switch (step.kind) {
      case 'rm-redirects':
        log(`Removing ${step.path}`)
        await fs.rm(resolve(cwd, step.path))
        break
      case 'd1-create':
        databaseId = findDatabaseId(await must(D1_LIST, { capture: true }), step.database)
        if (databaseId) {
          log(`D1 database \`${step.database}\` exists (${databaseId})`)
          break
        }
        log(`Creating D1 database \`${step.database}\``)
        await must(stepArgs(step)!)
        databaseId = findDatabaseId(await must(D1_LIST, { capture: true }), step.database)
        if (!databaseId)
          throw new Error(`[Slidev] deploy: created D1 database \`${step.database}\`, but \`wrangler d1 list\` doesn't show it`)
        break
      case 'd1-id': {
        const path = resolve(cwd, step.config)
        await fs.writeFile(path, setDatabaseId(await fs.readFile(path, 'utf-8'), databaseId!), 'utf-8')
        log(`Set \`database_id\` in ${step.config}`)
        break
      }
      case 'migrate':
        log(`Applying \`@open-athena/auth\`'s migrations to \`${step.database}\``)
        await must(stepArgs(step)!)
        break
      case 'deploy':
        log(`Deploying \`${ctx.info.name}\``)
        await must(stepArgs(step)!)
        break
      case 'secret':
        if (hasSecret(await must(secretList(step.config), { capture: true }), step.name)) {
          log(`\`${step.name}\` is set`)
          break
        }
        log(`Setting \`${step.name}\` (generated)`)
        await must(stepArgs(step)!, { input: (opts.secret ?? (() => randomBytes(32).toString('base64url')))() })
        break
    }
  }
  const manual = manualSteps(ctx.info, opts.wrangler, join(ctx.workerDir, ctx.info.config))
  if (manual.length)
    log(['', ...manual].join('\n'))
}
