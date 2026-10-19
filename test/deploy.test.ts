// `slidev deploy`: the plan, the dry run (which runs nothing), and the real run against a stub
// `wrangler` that records its calls. Nothing here reaches Cloudflare. The CLI tests need
// `@slidev/cli` built (`dist/cli.mjs`).
import type { WorkerDeployInfo } from '../packages/slidev/node/commands/og'
import { execFileSync } from 'node:child_process'
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import process from 'node:process'
import { afterAll, beforeEach, describe, expect, it } from 'vitest'
import { deployPlan, describePlan, findDatabaseId, hasSecret, resolveWrangler, runDeploy, setDatabaseId } from '../packages/slidev/node/commands/deploy'
import { DATABASE_ID_PLACEHOLDER, renderWranglerConfig } from '../packages/slidev/node/commands/og'

const CLI = resolve('packages/slidev/bin/slidev.mjs')

const authInfo: WorkerDeployInfo = {
  version: 1,
  name: 'talk',
  baseUrl: 'https://talk.example',
  base: '/',
  config: 'wrangler.jsonc',
  assets: '../dist',
  auth: { provider: 'open-athena', database: 'talk-auth', migrationsDir: '../node_modules/@open-athena/auth/migrations' },
}
const plainInfo: WorkerDeployInfo = { ...authInfo, auth: undefined }

// Records each call (and the length of anything piped in, never its content) to `$STUB_LOG`, and
// answers `d1 list` / `secret list` from `$STUB_STATE`.
const STUB = `import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
const args = process.argv.slice(2)
const state = JSON.parse(readFileSync(process.env.STUB_STATE, 'utf-8'))
const save = () => writeFileSync(process.env.STUB_STATE, JSON.stringify(state))
let stdin = ''
if (args[0] === 'secret' && args[1] === 'put')
  stdin = readFileSync(0, 'utf-8')
appendFileSync(process.env.STUB_LOG, JSON.stringify({ args, ...(stdin ? { stdinLength: stdin.length } : {}) }) + '\\n')
const cmd = args.slice(0, 2).join(' ')
if (cmd === 'd1 list')
  process.stdout.write(JSON.stringify(state.databases))
else if (cmd === 'd1 create') {
  state.databases.push({ name: args[2], uuid: 'uuid-' + state.databases.length })
  save()
}
else if (cmd === 'secret list')
  process.stdout.write(JSON.stringify(state.secrets.map(name => ({ name, type: 'secret_text' }))))
else if (cmd === 'secret put') {
  state.secrets.push(args[2])
  save()
}
`

const roots: string[] = []
afterAll(() => {
  for (const r of roots)
    rmSync(r, { recursive: true, force: true })
})

interface Fixture { root: string, log: string, state: string, wrangler: string }

/** A deck dir with a built `dist/` + `dist-worker/`, and a stub wrangler. */
function fixture(info: WorkerDeployInfo, { redirects = false, databases = [] as { name: string, uuid: string }[], secrets = [] as string[] } = {}): Fixture {
  const root = mkdtempSync(join(tmpdir(), 'slidev-deploy-'))
  roots.push(root)
  mkdirSync(join(root, 'dist'))
  mkdirSync(join(root, 'dist-worker'))
  mkdirSync(join(root, 'node_modules/@open-athena/auth/migrations'), { recursive: true })
  writeFileSync(join(root, 'dist/index.html'), '<!doctype html>')
  if (redirects)
    writeFileSync(join(root, 'dist/_redirects'), '/*    /index.html   200\n')
  writeFileSync(join(root, 'dist-worker/deploy.json'), JSON.stringify(info))
  writeFileSync(join(root, 'dist-worker/wrangler.jsonc'), renderWranglerConfig(info.name, 'none', '../dist', info.auth && {
    provider: 'open-athena',
    staffDomains: ['example.org'],
    admins: [],
    scope: 'deck',
    title: 'Talk',
    database: info.auth.database,
    migrationsDir: info.auth.migrationsDir,
  }))
  const log = join(root, 'stub.log')
  const state = join(root, 'stub-state.json')
  writeFileSync(log, '')
  writeFileSync(state, JSON.stringify({ databases, secrets }))
  writeFileSync(join(root, 'stub-wrangler.mjs'), STUB)
  return { root, log, state, wrangler: `${process.execPath} ${join(root, 'stub-wrangler.mjs')}` }
}

const calls = (f: Fixture) => readFileSync(f.log, 'utf-8').split('\n').filter(Boolean).map(l => JSON.parse(l))

function slidev(f: Fixture, args: string[]): string {
  return execFileSync(process.execPath, [CLI, 'deploy', ...args], {
    cwd: f.root,
    encoding: 'utf-8',
    env: { ...process.env, STUB_LOG: f.log, STUB_STATE: f.state, SLIDEV_WRANGLER: f.wrangler, NO_COLOR: '1', FORCE_COLOR: '0' },
  })
}

describe('deployPlan', () => {
  const ctx = { info: authInfo, workerDir: 'dist-worker', outDir: 'dist', hasRedirects: false }

  it('provisions the auth database and secret around the deploy', () => {
    expect(deployPlan(ctx)).toEqual([
      { kind: 'd1-create', database: 'talk-auth' },
      { kind: 'd1-id', database: 'talk-auth', config: 'dist-worker/wrangler.jsonc' },
      { kind: 'migrate', database: 'talk-auth', config: 'dist-worker/wrangler.jsonc' },
      { kind: 'deploy', config: 'dist-worker/wrangler.jsonc' },
      { kind: 'secret', name: 'SESSION_SECRET', config: 'dist-worker/wrangler.jsonc' },
    ])
  })

  it('skips the lookup when the headmatter has the database id, and removes `_redirects`', () => {
    expect(deployPlan({ ...ctx, hasRedirects: true, info: { ...authInfo, auth: { ...authInfo.auth!, databaseId: 'abc' } } })).toEqual([
      { kind: 'rm-redirects', path: 'dist/_redirects' },
      { kind: 'migrate', database: 'talk-auth', config: 'dist-worker/wrangler.jsonc' },
      { kind: 'deploy', config: 'dist-worker/wrangler.jsonc' },
      { kind: 'secret', name: 'SESSION_SECRET', config: 'dist-worker/wrangler.jsonc' },
    ])
  })

  it('is just the deploy without auth', () => {
    expect(deployPlan({ ...ctx, info: plainInfo })).toEqual([{ kind: 'deploy', config: 'dist-worker/wrangler.jsonc' }])
  })
})

describe('describePlan', () => {
  it('prints every step and the manual Google step', () => {
    expect(describePlan({ info: authInfo, workerDir: 'dist-worker', outDir: 'dist', hasRedirects: true }, ['npx', 'wrangler']).split('\n')).toEqual([
      'Deploy plan for `talk` (https://talk.example), behind `@open-athena/auth`. Dry run: nothing was run.',
      '1. remove `dist/_redirects` (Workers assets reject its SPA catch-all; `not_found_handling` replaces it)',
      '2. if the D1 database `talk-auth` doesn\'t exist (`npx wrangler d1 list --json`): `npx wrangler d1 create talk-auth`',
      '3. write `talk-auth`\'s id (from `npx wrangler d1 list --json`) into `dist-worker/wrangler.jsonc`\'s `database_id`',
      '4. `npx wrangler d1 migrations apply talk-auth --remote -c dist-worker/wrangler.jsonc` (`@open-athena/auth`\'s migrations)',
      '5. `npx wrangler deploy -c dist-worker/wrangler.jsonc`',
      '6. if `SESSION_SECRET` isn\'t set (`npx wrangler secret list -c dist-worker/wrangler.jsonc --format json`): `npx wrangler secret put SESSION_SECRET -c dist-worker/wrangler.jsonc`, with 32 random bytes (base64url) on stdin',
      '',
      'Google sign-in, by hand (until then, the sign-in page says it isn\'t configured, and share links still work):',
      '  1. In the Google Cloud console, create an OAuth client (Web application) with JavaScript origin https://talk.example and redirect URI https://talk.example/auth/google/callback.',
      '  2. `npx wrangler secret put GOOGLE_CLIENT_ID -c dist-worker/wrangler.jsonc` and `npx wrangler secret put GOOGLE_CLIENT_SECRET -c dist-worker/wrangler.jsonc`.',
      '  (`@open-athena/auth`\'s `scripts/provision-oauth-client.mjs` stores these for Pages projects; it doesn\'t take a Worker yet.)',
      '',
    ])
  })
})

describe('wrangler output helpers', () => {
  it('finds a database id by name, or `null`', () => {
    const list = JSON.stringify([{ uuid: 'u1', name: 'other' }, { uuid: 'u2', name: 'talk-auth' }])
    expect([findDatabaseId(list, 'talk-auth'), findDatabaseId(list, 'missing')]).toEqual(['u2', null])
  })

  it('checks a secret list', () => {
    const list = JSON.stringify([{ name: 'SESSION_SECRET', type: 'secret_text' }])
    expect([hasSecret(list, 'SESSION_SECRET'), hasSecret('[]', 'SESSION_SECRET')]).toEqual([true, false])
  })

  it('sets the generated config\'s `database_id`', () => {
    const config = renderWranglerConfig('talk', 'none', '../dist', { provider: 'open-athena', staffDomains: [], admins: [], scope: 'deck', title: 'T', database: 'talk-auth', migrationsDir: 'm' })
    const updated = setDatabaseId(config, 'uuid-7')
    expect(updated).toBe(config.replace(`"database_id": "${DATABASE_ID_PLACEHOLDER}"`, '"database_id": "uuid-7"'))
    expect(() => setDatabaseId('{}', 'x')).toThrow('[Slidev] deploy: no `database_id` in the wrangler config; rebuild with `slidev build --worker`')
  })
})

describe('resolveWrangler', () => {
  let root: string
  beforeEach(() => {
    root = mkdtempSync(join(tmpdir(), 'slidev-deploy-wrangler-'))
    roots.push(root)
  })

  it('prefers `--wrangler`, then `$SLIDEV_WRANGLER`, then the deck\'s own, then `npx wrangler`', () => {
    const env = { PATH: '' }
    expect(resolveWrangler(undefined, root, env)).toEqual(['npx', 'wrangler'])
    mkdirSync(join(root, 'node_modules/.bin'), { recursive: true })
    writeFileSync(join(root, 'node_modules/.bin/wrangler'), '')
    expect([
      resolveWrangler(undefined, root, env),
      resolveWrangler(undefined, root, { ...env, SLIDEV_WRANGLER: 'scripts/cf.sh  wrangler' }),
      resolveWrangler('op run -- wrangler', root, { ...env, SLIDEV_WRANGLER: 'scripts/cf.sh wrangler' }),
    ]).toEqual([
      ['node_modules/.bin/wrangler'],
      ['scripts/cf.sh', 'wrangler'],
      ['op', 'run', '--', 'wrangler'],
    ])
  })
})

describe('runDeploy (stub wrangler)', () => {
  const run = async (f: Fixture, info: WorkerDeployInfo) => {
    const { spawnRunner, loadDeployContext } = await import('../packages/slidev/node/commands/deploy')
    const wrangler = f.wrangler.split(' ')
    const lines: string[] = []
    const prev = { log: process.env.STUB_LOG, state: process.env.STUB_STATE }
    process.env.STUB_LOG = f.log
    process.env.STUB_STATE = f.state
    try {
      const ctx = await loadDeployContext('dist', f.root)
      expect(ctx.info).toEqual(info)
      await runDeploy(ctx, { run: spawnRunner(wrangler, f.root), wrangler, cwd: f.root, log: l => lines.push(l), secret: () => 'x'.repeat(43) })
    }
    finally {
      process.env.STUB_LOG = prev.log
      process.env.STUB_STATE = prev.state
    }
    return lines
  }

  it('creates the database, writes its id, migrates, deploys, then sets the secret', async () => {
    const f = fixture(authInfo, { redirects: true, databases: [{ name: 'other', uuid: 'uuid-x' }] })
    const lines = await run(f, authInfo)
    expect(calls(f)).toEqual([
      { args: ['d1', 'list', '--json'] },
      { args: ['d1', 'create', 'talk-auth'] },
      { args: ['d1', 'list', '--json'] },
      { args: ['d1', 'migrations', 'apply', 'talk-auth', '--remote', '-c', 'dist-worker/wrangler.jsonc'] },
      { args: ['deploy', '-c', 'dist-worker/wrangler.jsonc'] },
      { args: ['secret', 'list', '-c', 'dist-worker/wrangler.jsonc', '--format', 'json'] },
      { args: ['secret', 'put', 'SESSION_SECRET', '-c', 'dist-worker/wrangler.jsonc'], stdinLength: 43 },
    ])
    expect(JSON.parse(readFileSync(join(f.root, 'dist-worker/wrangler.jsonc'), 'utf-8').replace(/^\s*\/\/.*$/gm, '')).d1_databases[0].database_id).toBe('uuid-1')
    expect(existsSync(join(f.root, 'dist/_redirects'))).toBe(false)
    expect(lines.slice(0, 7)).toEqual([
      'Removing dist/_redirects',
      'Creating D1 database `talk-auth`',
      'Set `database_id` in dist-worker/wrangler.jsonc',
      'Applying `@open-athena/auth`\'s migrations to `talk-auth`',
      'Deploying `talk`',
      'Setting `SESSION_SECRET` (generated)',
      '\nGoogle sign-in, by hand (until then, the sign-in page says it isn\'t configured, and share links still work):\n'
      + '  1. In the Google Cloud console, create an OAuth client (Web application) with JavaScript origin https://talk.example and redirect URI https://talk.example/auth/google/callback.\n'
      + `  2. \`${f.wrangler} secret put GOOGLE_CLIENT_ID -c dist-worker/wrangler.jsonc\` and \`${f.wrangler} secret put GOOGLE_CLIENT_SECRET -c dist-worker/wrangler.jsonc\`.\n`
      + '  (`@open-athena/auth`\'s `scripts/provision-oauth-client.mjs` stores these for Pages projects; it doesn\'t take a Worker yet.)',
    ])
  })

  it('reuses an existing database and secret', async () => {
    const f = fixture(authInfo, { databases: [{ name: 'talk-auth', uuid: 'uuid-9' }], secrets: ['SESSION_SECRET'] })
    await run(f, authInfo)
    expect(calls(f)).toEqual([
      { args: ['d1', 'list', '--json'] },
      { args: ['d1', 'migrations', 'apply', 'talk-auth', '--remote', '-c', 'dist-worker/wrangler.jsonc'] },
      { args: ['deploy', '-c', 'dist-worker/wrangler.jsonc'] },
      { args: ['secret', 'list', '-c', 'dist-worker/wrangler.jsonc', '--format', 'json'] },
    ])
    expect(JSON.parse(readFileSync(join(f.root, 'dist-worker/wrangler.jsonc'), 'utf-8').replace(/^\s*\/\/.*$/gm, '')).d1_databases[0].database_id).toBe('uuid-9')
  })

  it('stops before touching anything when the auth migrations are missing', async () => {
    const f = fixture(authInfo)
    rmSync(join(f.root, 'node_modules'), { recursive: true })
    await expect(run(f, authInfo)).rejects.toThrow('[Slidev] deploy: `@open-athena/auth`\'s migrations aren\'t at node_modules/@open-athena/auth/migrations; install `@open-athena/auth` in the deck and rebuild')
    expect(calls(f)).toEqual([])
  })
})

describe('`slidev deploy` CLI', () => {
  it('prints the plan on `--dry-run`, and runs nothing', () => {
    const f = fixture(authInfo)
    expect(slidev(f, ['--dry-run'])).toBe(describePlan({ info: authInfo, workerDir: 'dist-worker', outDir: 'dist', hasRedirects: false }, f.wrangler.split(' ')))
    expect(calls(f)).toEqual([])
  })

  it('deploys a Worker without auth', () => {
    const f = fixture(plainInfo)
    slidev(f, [])
    expect(calls(f)).toEqual([{ args: ['deploy', '-c', 'dist-worker/wrangler.jsonc'] }])
  })

  it('asks for a build when there\'s no Worker', () => {
    const root = mkdtempSync(join(tmpdir(), 'slidev-deploy-'))
    roots.push(root)
    let stderr = ''
    try {
      execFileSync(process.execPath, [CLI, 'deploy', '--dry-run'], { cwd: root, encoding: 'utf-8', stdio: 'pipe' })
    }
    catch (e: any) {
      stderr = e.stderr
    }
    expect(stderr.split('\n').find(l => l.includes('[Slidev] deploy:'))?.trim())
      .toBe('Error: [Slidev] deploy: no dist-worker/deploy.json; build the Worker first (`slidev build --worker`, or `publish.worker` in the headmatter)')
  })
})
