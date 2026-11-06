// Tests for scripts/real-cli-smoke.mjs, run as a child process against fake binaries.
//
// Run: node --test tests/*.test.mjs   (from the repo root; a directory argument fails on node 24)
//
// Why child processes: the script is judged by its exit code, its report block and what it hands
// its children, so the tests watch exactly those. Every run gets an explicit env built here (never
// the host env), so no host credential reaches the script, and the fake CLI and fake ctl are node
// scripts that answer from canned output: nothing spends money, nothing starts tmuxd.

import assert from 'node:assert/strict'
import { spawn } from 'node:child_process'
import { chmodSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { afterEach, describe, it } from 'node:test'

const SCRIPT = join(dirname(fileURLToPath(import.meta.url)), '..', 'scripts', 'real-cli-smoke.mjs')
const PATH = `${dirname(process.execPath)}:/usr/bin:/bin`
const DUMMY_KEY = 'sk-ant-smoke-test-DISTINCTIVE-4f1e9c0b7a2d55e3'
const LEAK = 'host-leak-value-7d3a'
const ALLOWED_CLI_ENV = new Set([
  'PATH',
  'LANG',
  'TERM',
  'HOME',
  'ANTHROPIC_API_KEY',
  'CLAUDE_CODE_OAUTH_TOKEN',
  'ANTHROPIC_BASE_URL',
  'KODIZM_SMOKE_CANARY',
])

// Shared by both fakes: every invocation leaves a line in `invoked` next to the fake, so a test
// can prove a binary was never started.
const FAKE_PRELUDE = `#!/usr/bin/env node
import { appendFileSync, existsSync, writeFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const dir = dirname(fileURLToPath(import.meta.url))
const args = process.argv.slice(2)
appendFileSync(join(dir, 'invoked'), JSON.stringify({ bin: process.argv[1], args, env: process.env }) + '\\n')
const mode = (name) => existsSync(join(dir, name))
`

// ctl replies as acp 0.9.1 prints them: status on a missing socket is pane_not_running (exit 4),
// a start whose flags do not parse is usage_error (exit 2). A `no-version` file drops daemon_version.
const FAKE_ACP = `${FAKE_PRELUDE}
const [tmuxd, ctl, verb] = args
const data = mode('no-version') ? {} : { daemon_version: '0.9.1' }
const reply = (code, exit, extra = {}) => {
  process.stdout.write(JSON.stringify({ ok: false, code, data: { ...data, ...extra } }) + '\\n')
  process.exit(exit)
}

if (tmuxd !== 'tmuxd' || ctl !== 'ctl') {
  process.exit(2)
}

if (verb === 'status') {
  reply('pane_not_running', 4, { pane: args[4], running: false })
}

reply('usage_error', 2)
`

// A stream-json CLI. It reads the prompt after -p and answers like Claude Code would; a `bad`
// file makes every escape run (the side effect happens, no denial is recorded).
const FAKE_CLAUDE = `${FAKE_PRELUDE}
if (args[0] === '--version') {
  process.stdout.write('2.1.318 (Claude Code)\\n')
  process.exit(0)
}

const prompt = args[args.indexOf('-p') + 1]
const out = (message) => process.stdout.write(JSON.stringify(message) + '\\n')
let next = 0
const denials = []

out({
  type: 'system',
  subtype: 'init',
  apiKeySource: process.env.ANTHROPIC_API_KEY ? 'ANTHROPIC_API_KEY' : 'none',
  permissionMode: 'dontAsk',
  mcp_servers: [{ name: 'kodizm', status: 'connected' }],
})

const bash = (command, content, isError) => {
  const id = 'toolu_' + next++
  out({ type: 'assistant', message: { content: [{ type: 'tool_use', id, name: 'Bash', input: { command } }] } })
  out({ type: 'user', message: { content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] } })
  if (isError) {
    denials.push({ tool_name: 'Bash', tool_use_id: id, tool_input: { command } })
  }
}

if (prompt.includes('git log --oneline -1')) {
  bash('git diff', 'diff --git a/a.txt b/a.txt\\n@@ -1 +1,2 @@', false)
  bash('git log --oneline -1', 'abc1234 smoke fixture', false)
  bash('ls', 'a.txt', false)
} else if (prompt.includes('Run exactly this Bash command')) {
  const command = prompt.trim().split('\\n').at(-1)
  if (mode('bad')) {
    const target = /--output=(\\S+)|^touch (\\S+)/.exec(command)?.slice(1).find((hit) => hit !== undefined)
    if (target !== undefined) {
      writeFileSync(target, 'escaped')
    }
    bash(command, '', false)
  } else {
    bash(command, 'Permission to use Bash has been denied.', true)
  }
}

out({ type: 'result', subtype: 'success', is_error: false, permission_denials: denials })
`

const scratch = []

afterEach(() => {
  for (const dir of scratch.splice(0)) {
    rmSync(dir, { recursive: true, force: true })
  }
})

function makeDir() {
  const dir = mkdtempSync(join(tmpdir(), 'kcs-test-'))
  scratch.push(dir)

  return dir
}

function fake(dir, name, body, modes = []) {
  const path = join(dir, name)
  writeFileSync(path, body)
  chmodSync(path, 0o755)

  for (const mode of modes) {
    writeFileSync(join(dir, mode), '')
  }

  return path
}

function invocations(dir) {
  const path = join(dir, 'invoked')

  return existsSync(path)
    ? readFileSync(path, 'utf8')
        .trim()
        .split('\n')
        .map((line) => JSON.parse(line))
    : []
}

function versionsFile(dir) {
  const path = join(dir, 'versions.json')
  writeFileSync(path, JSON.stringify({ claude: '2.1.318', kodizm_acp: '0.9.1' }))

  return path
}

function runSmoke(env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [SCRIPT], { env, stdio: ['ignore', 'pipe', 'pipe'] })
    let stdout = ''
    let stderr = ''
    const timer = setTimeout(() => child.kill('SIGKILL'), 60_000)
    child.stdout.on('data', (chunk) => {
      stdout += chunk
    })
    child.stderr.on('data', (chunk) => {
      stderr += chunk
    })
    child.once('error', reject)
    child.once('close', (code) => {
      clearTimeout(timer)
      resolve({ code, stdout, stderr })
    })
  })
}

function report(stdout) {
  const match = /=== SMOKE REPORT ===\n([\s\S]*?)\n=== END SMOKE REPORT ===/.exec(stdout)
  assert.ok(match, `no report block in:\n${stdout}`)

  return match[1]
}

function contractEnv(dir, modes = []) {
  return {
    PATH,
    SMOKE_GROUPS: 'contract',
    CLAUDE_BIN: fake(dir, 'claude.mjs', FAKE_CLAUDE),
    KODIZM_ACP_BIN: fake(dir, 'kodizm-acp.mjs', FAKE_ACP, modes),
    VERSIONS_FILE: versionsFile(dir),
  }
}

function headlessEnv(dir, modes = []) {
  return {
    PATH,
    SMOKE_GROUPS: 'headless',
    CLAUDE_BIN: fake(dir, 'claude.mjs', FAKE_CLAUDE, modes),
    ANTHROPIC_API_KEY: DUMMY_KEY,
    // Stand-ins for host env the allow list must keep from the CLI.
    CLAUDE_CODE_REMOTE: LEAK,
    KODIZM_LEAK_TOKEN: LEAK,
  }
}

describe('real-cli-smoke', () => {
  it('exits 2 before spawning anything when headless is selected and no credential is set', async () => {
    const dir = makeDir()
    const temp = makeDir()
    const env = { ...contractEnv(dir), TMPDIR: temp }
    delete env.SMOKE_GROUPS

    const { code, stderr } = await runSmoke(env)

    assert.equal(code, 2)
    assert.match(stderr, /^real-cli-smoke: .*credential/m)
    assert.deepEqual(invocations(dir), [])
    assert.deepEqual(readdirSync(temp), [])
  })

  it('passes the contract group against a ctl that answers as acp 0.9.1 does', async () => {
    const dir = makeDir()

    const { code, stdout } = await runSmoke(contractEnv(dir))
    const block = report(stdout)

    assert.equal(code, 0, stdout)
    assert.match(block, /^GATE PASS contract\.cli-version /m)
    assert.match(block, /^GATE PASS contract\.status /m)
    assert.match(block, /^GATE PASS contract\.daemon-version /m)
    assert.match(block, /^GATE PASS contract\.usage-error-flag /m)
    assert.match(block, /^GATE PASS contract\.usage-error-mode /m)
    assert.doesNotMatch(block, / FAIL /)
    assert.match(block, /^claude: 2\.1\.318$/m)
    assert.match(block, /^daemon_version: 0\.9\.1$/m)

    const verbs = invocations(dir)
      .filter((call) => call.args[0] === 'tmuxd')
      .map((call) => call.args[2])
    assert.deepEqual(verbs, ['status', 'start', 'start'])
  })

  it('fails the contract gate when the status reply lacks daemon_version', async () => {
    const dir = makeDir()

    const { code, stdout } = await runSmoke(contractEnv(dir, ['no-version']))

    assert.equal(code, 1)
    assert.match(report(stdout), /^GATE FAIL contract\.daemon-version /m)
  })

  it('passes the headless group when every escape is denied, with an allow-listed env and the pane flags', async () => {
    const dir = makeDir()

    const { code, stdout, stderr } = await runSmoke(headlessEnv(dir))
    const block = report(stdout)

    assert.equal(code, 0, `${stdout}\n${stderr}`)
    assert.match(block, /^GATE PASS headless\.init-api-key /m)
    assert.match(block, /^SKIP INFO headless\.init-oauth /m)
    assert.match(block, /^GATE PASS headless\.safe /m)
    assert.match(block, /^GATE PASS headless\.escape-diff /m)
    assert.match(block, /^GATE PASS headless\.escape-grep /m)
    assert.match(block, /^GATE PASS headless\.escape-blame /m)
    assert.match(block, /^GATE PASS headless\.deny-default /m)

    const calls = invocations(dir).filter((call) => call.args[0] !== '--version')
    assert.ok(calls.length >= 6, `expected one call per check, got ${calls.length}`)

    for (const { args, env } of calls) {
      const at = (flag) => args.indexOf(flag)
      assert.equal(args[at('--permission-mode') + 1], 'dontAsk')
      assert.equal(args[at('--setting-sources') + 1], '')
      assert.ok(at('--settings') !== -1)
      assert.ok(at('--strict-mcp-config') === at('--mcp-config') + 2)
      assert.equal(env.ANTHROPIC_API_KEY, DUMMY_KEY)
      // macOS adds __CF_USER_TEXT_ENCODING to every exec'd process; it never came from the smoke.
      assert.deepEqual(
        Object.keys(env).filter((key) => !ALLOWED_CLI_ENV.has(key) && key !== '__CF_USER_TEXT_ENCODING'),
        [],
      )
      assert.ok(!JSON.stringify({ args, env }).includes(LEAK))
    }
  })

  it('fails the headless gate when an escape runs, and names it', async () => {
    const dir = makeDir()

    const { code, stdout } = await runSmoke(headlessEnv(dir, ['bad']))
    const block = report(stdout)

    assert.equal(code, 1)
    assert.match(block, /^GATE FAIL headless\.escape-diff escape ran/m)
    assert.match(block, /^GATE FAIL headless\.deny-default escape ran/m)
  })

  it('keeps the subscription token off the gateway: no base url, default model', async () => {
    const dir = makeDir()
    const env = {
      ...headlessEnv(dir),
      CLAUDE_CODE_OAUTH_TOKEN: 'oauth-smoke-test-DISTINCTIVE-91b7c2',
      ANTHROPIC_BASE_URL: 'http://gateway.invalid',
      SMOKE_MODEL: 'gateway-model',
    }

    const { code, stdout } = await runSmoke(env)
    const block = report(stdout)

    assert.equal(code, 0, stdout)
    assert.match(block, /^GATE PASS headless\.init-oauth /m)

    const calls = invocations(dir).filter((call) => call.args[0] !== '--version')
    const oauth = calls.filter((call) => call.env.CLAUDE_CODE_OAUTH_TOKEN !== undefined)
    const apiKey = calls.filter((call) => call.env.CLAUDE_CODE_OAUTH_TOKEN === undefined)
    assert.ok(oauth.length >= 1 && apiKey.length >= 1)

    for (const { args, env: seen } of oauth) {
      assert.equal(seen.ANTHROPIC_BASE_URL, undefined)
      assert.equal(args[args.indexOf('--model') + 1], 'haiku')
    }

    for (const { args, env: seen } of apiKey) {
      assert.equal(seen.ANTHROPIC_BASE_URL, 'http://gateway.invalid')
      assert.equal(args[args.indexOf('--model') + 1], 'gateway-model')
    }
  })

  it('never prints the API key or the suffix the CLI approves', async () => {
    const dir = makeDir()

    const { stdout, stderr } = await runSmoke(headlessEnv(dir, ['bad']))

    assert.ok(!`${stdout}${stderr}`.includes(DUMMY_KEY))
    assert.ok(!`${stdout}${stderr}`.includes(DUMMY_KEY.slice(-20)))
  })
})
