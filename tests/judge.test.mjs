// Unit tests for scripts/lib/judge.mjs, the pure verdict functions of the real-CLI smoke.
//
// Run: node --test tests/*.test.mjs   (from the repo root; a directory argument fails on node 24)
//
// Every function gets a good and a bad inline fixture shaped like the Claude Agent SDK
// messages (system/init, assistant tool_use, user tool_result, result.permission_denials),
// so a verdict that drifts from the real stream-json shape fails here before a paid run.

import assert from 'node:assert/strict'
import { describe, it } from 'node:test'

import {
  deniedBash,
  enforceSettings,
  formatReport,
  gateFailed,
  initOf,
  judgeClaudeJson,
  judgeCtlReply,
  judgeEscape,
  judgeInit,
  judgePaneDeny,
  judgeSafe,
  judgeSettings,
  judgeTurn,
  parseStreamJson,
  rereadVerdict,
  toolRuns,
  usageLimitVerdict,
  versionAtLeast,
} from '../scripts/lib/judge.mjs'

const init = (over = {}) => ({
  type: 'system',
  subtype: 'init',
  apiKeySource: 'ANTHROPIC_API_KEY',
  claude_code_version: '2.1.280',
  cwd: '/tmp/repo',
  tools: ['Bash', 'Read'],
  mcp_servers: [{ name: 'kodizm', status: 'connected' }],
  model: 'haiku',
  permissionMode: 'dontAsk',
  slash_commands: [],
  session_id: 's1',
  uuid: 'u1',
  ...over,
})

const toolUse = (id, name, input) => ({
  type: 'assistant',
  message: { role: 'assistant', content: [{ type: 'text', text: 'on it' }, { type: 'tool_use', id, name, input }] },
  session_id: 's1',
})

const toolResult = (id, content, isError = false) => ({
  type: 'user',
  message: { role: 'user', content: [{ type: 'tool_result', tool_use_id: id, content, is_error: isError }] },
  session_id: 's1',
})

const denial = (command, toolName = 'Bash') => ({
  tool_name: toolName,
  tool_use_id: 'tu-denied',
  tool_input: { command },
})

const result = (denials = [], over = {}) => ({
  type: 'result',
  subtype: 'success',
  is_error: false,
  result: 'done',
  permission_denials: denials,
  total_cost_usd: 0.01,
  num_turns: 2,
  ...over,
})

const bash = (id, command, output, isError = false) => [
  toolUse(id, 'Bash', { command }),
  toolResult(id, output, isError),
]

const mcpRecord = (over = {}) => ({
  path: '/mcp',
  httpMethod: 'POST',
  rpc: null,
  auth: null,
  session: null,
  status: 200,
  tool: null,
  args: null,
  ...over,
})

describe('parseStreamJson', () => {
  it('parses one message per line and skips blank lines', () => {
    const messages = parseStreamJson(`${JSON.stringify(init())}\n\n${JSON.stringify(result())}\n`)

    assert.equal(messages.length, 2)
    assert.equal(messages[0].subtype, 'init')
    assert.equal(messages[1].type, 'result')
  })

  it('returns an empty list for empty text', () => {
    assert.deepEqual(parseStreamJson(''), [])
  })

  it('throws with the line number on a line that is not JSON', () => {
    assert.throws(() => parseStreamJson(`${JSON.stringify(init())}\nnot json\n`), /line 2/)
  })

  it('counts blank lines when it reports the line number', () => {
    assert.throws(() => parseStreamJson(`\n\n{oops`), /line 3/)
  })
})

describe('initOf', () => {
  it('finds the init message among others', () => {
    const found = initOf([toolUse('t1', 'Bash', {}), init(), result()])

    assert.equal(found.subtype, 'init')
    assert.equal(found.permissionMode, 'dontAsk')
  })

  it('returns null when there is no init', () => {
    assert.equal(initOf([result()]), null)
    assert.equal(initOf([{ type: 'system', subtype: 'permission_denied' }]), null)
  })
})

describe('judgeInit', () => {
  const want = { auth: 'ANTHROPIC_API_KEY', server: 'kodizm', decoy: 'decoy' }

  it('passes a dontAsk init with the pinned server connected and no decoy', () => {
    const verdict = judgeInit(init(), want)

    assert.equal(verdict.ok, true)
    assert.equal(typeof verdict.detail, 'string')
  })

  it('passes the oauth run when apiKeySource is none', () => {
    assert.equal(judgeInit(init({ apiKeySource: 'none' }), { ...want, auth: 'none' }).ok, true)
  })

  it('fails on the wrong auth source', () => {
    const verdict = judgeInit(init({ apiKeySource: 'none' }), want)

    assert.equal(verdict.ok, false)
    assert.match(verdict.detail, /apiKeySource/)
  })

  it('fails when the permission mode is not dontAsk', () => {
    const verdict = judgeInit(init({ permissionMode: 'default' }), want)

    assert.equal(verdict.ok, false)
    assert.match(verdict.detail, /permissionMode/)
  })

  it('fails when the pinned server is not connected', () => {
    const verdict = judgeInit(init({ mcp_servers: [{ name: 'kodizm', status: 'failed' }] }), want)

    assert.equal(verdict.ok, false)
    assert.match(verdict.detail, /kodizm/)
  })

  it('fails when the decoy server shows up, even connected', () => {
    const servers = [
      { name: 'kodizm', status: 'connected' },
      { name: 'decoy', status: 'connected' },
    ]
    const verdict = judgeInit(init({ mcp_servers: servers }), want)

    assert.equal(verdict.ok, false)
    assert.match(verdict.detail, /decoy/)
  })

  it('fails on a missing init instead of throwing', () => {
    assert.equal(judgeInit(null, want).ok, false)
  })
})

describe('toolRuns', () => {
  it('pairs each tool_use with its tool_result', () => {
    const runs = toolRuns([
      ...bash('t1', 'git diff', '@@ -1 +1 @@'),
      ...bash('t2', 'ls', 'a.txt'),
    ])

    assert.equal(runs.length, 2)
    assert.deepEqual(runs[0], { name: 'Bash', input: { command: 'git diff' }, result: '@@ -1 +1 @@', isError: false })
    assert.equal(runs[1].result, 'a.txt')
  })

  it('joins an array of text blocks into one string', () => {
    const content = [
      { type: 'text', text: 'first' },
      { type: 'text', text: 'second' },
    ]
    const runs = toolRuns([toolUse('t1', 'Bash', { command: 'ls' }), toolResult('t1', content)])

    assert.equal(runs[0].result, 'first\nsecond')
  })

  it('carries is_error through', () => {
    const runs = toolRuns(bash('t1', 'rm x', 'denied by rule', true))

    assert.equal(runs[0].isError, true)
  })

  it('keeps a tool_use that never got a result, with an empty result', () => {
    const runs = toolRuns([toolUse('t1', 'Bash', { command: 'sleep 9' })])

    assert.equal(runs.length, 1)
    assert.equal(runs[0].result, '')
    assert.equal(runs[0].isError, false)
  })

  it('ignores messages with no content blocks', () => {
    assert.deepEqual(toolRuns([init(), result()]), [])
  })

  it('throws on a tool_result whose tool_use was never seen', () => {
    assert.throws(() => toolRuns([toolResult('ghost', 'x')]), /ghost/)
  })
})

describe('deniedBash', () => {
  it('lists the Bash commands in result.permission_denials', () => {
    const messages = [result([denial('git diff --output=/tmp/x'), denial('echo hello')])]

    assert.deepEqual(deniedBash(messages), ['git diff --output=/tmp/x', 'echo hello'])
  })

  it('leaves out denials of other tools', () => {
    const messages = [result([denial('/proc/self/environ', 'Read'), denial('echo hi')])]

    assert.deepEqual(deniedBash(messages), ['echo hi'])
  })

  it('returns an empty list when nothing was denied', () => {
    assert.deepEqual(deniedBash([init(), result([])]), [])
  })

  it('reads denials from every result message', () => {
    assert.deepEqual(deniedBash([result([denial('a')]), result([denial('b')])]), ['a', 'b'])
  })
})

describe('judgeSafe', () => {
  const expectations = [
    { command: 'git diff', marker: '@@' },
    { command: 'git log --oneline -1', marker: 'initial commit' },
    { command: 'ls', marker: 'a.txt' },
  ]

  const good = () => [
    init(),
    ...bash('t1', 'git diff', 'diff --git a/a.txt b/a.txt\n@@ -1 +1 @@'),
    ...bash('t2', 'git log --oneline -1', 'abc1234 initial commit'),
    ...bash('t3', 'ls', 'a.txt\nb.txt'),
    result(),
  ]

  it('passes when every command ran clean with its marker', () => {
    const verdict = judgeSafe(good(), expectations)

    assert.equal(verdict.ok, true)
  })

  it('matches a command the model extended with flags', () => {
    const messages = [...bash('t1', 'git diff HEAD', '@@ -1 +1 @@'), result()]

    assert.equal(judgeSafe(messages, [{ command: 'git diff', marker: '@@' }]).ok, true)
  })

  it('fails and names the command that never ran', () => {
    const messages = [
      init(),
      ...bash('t1', 'git diff', '@@ -1 +1 @@'),
      ...bash('t3', 'ls', 'a.txt'),
      result(),
    ]
    const verdict = judgeSafe(messages, expectations)

    assert.equal(verdict.ok, false)
    assert.match(verdict.detail, /git log --oneline -1/)
  })

  it('fails when the tool_result is an error', () => {
    const messages = [...bash('t1', 'ls', 'refused', true), result()]
    const verdict = judgeSafe(messages, [{ command: 'ls', marker: 'a.txt' }])

    assert.equal(verdict.ok, false)
    assert.match(verdict.detail, /ls/)
  })

  it('fails when the marker is missing from the output', () => {
    const messages = [...bash('t1', 'ls', 'b.txt'), result()]
    const verdict = judgeSafe(messages, [{ command: 'ls', marker: 'a.txt' }])

    assert.equal(verdict.ok, false)
    assert.match(verdict.detail, /a\.txt/)
  })

  it('fails when the command shows up in permission_denials even if the output has the marker', () => {
    const messages = [...bash('t1', 'ls', 'a.txt'), result([denial('ls')])]
    const verdict = judgeSafe(messages, [{ command: 'ls', marker: 'a.txt' }])

    assert.equal(verdict.ok, false)
    assert.match(verdict.detail, /denied/)
  })

  it('reports the first failure when several commands fail', () => {
    const messages = [...bash('t1', 'git diff', 'nothing'), ...bash('t2', 'ls', 'nothing'), result()]
    const verdict = judgeSafe(messages, [
      { command: 'git diff', marker: '@@' },
      { command: 'ls', marker: 'a.txt' },
    ])

    assert.equal(verdict.ok, false)
    assert.match(verdict.detail, /^.*git diff/)
  })

  it('accepts a later clean run after an earlier failed attempt of the same command', () => {
    const messages = [...bash('t1', 'ls', 'oops', true), ...bash('t2', 'ls', 'a.txt'), result()]

    assert.equal(judgeSafe(messages, [{ command: 'ls', marker: 'a.txt' }]).ok, true)
  })

  it('ignores a non-Bash tool whose input happens to hold the command', () => {
    const messages = [toolUse('t1', 'Grep', { command: 'ls' }), toolResult('t1', 'a.txt'), result()]

    assert.equal(judgeSafe(messages, [{ command: 'ls', marker: 'a.txt' }]).ok, false)
  })

  it('does not take `git ls-files` for `ls`', () => {
    const messages = [...bash('t1', 'git ls-files', 'a.txt'), result()]
    const verdict = judgeSafe(messages, [{ command: 'ls', marker: 'a.txt' }])

    assert.equal(verdict.ok, false)
    assert.match(verdict.detail, /never run/)
  })

  it('finds the command inside a compound line', () => {
    const messages = [...bash('t1', 'cd /work/repo && ls', 'a.txt'), result()]

    assert.equal(judgeSafe(messages, [{ command: 'ls', marker: 'a.txt' }]).ok, true)
  })

  it('does not count a denied `git ls-files` as a denial of `ls`', () => {
    const messages = [...bash('t1', 'ls', 'a.txt'), result([denial('git ls-files')])]

    assert.equal(judgeSafe(messages, [{ command: 'ls', marker: 'a.txt' }]).ok, true)
  })
})

describe('judgeEscape', () => {
  const command = 'git diff --output=/tmp/escape-diff.txt'
  const absent = [{ kind: 'file-exists', path: '/tmp/escape-diff.txt', exists: false }]

  const denied = () => [
    init(),
    ...bash('t1', command, 'Permission to use Bash has been denied.', true),
    result([denial(command)]),
  ]

  it('passes when the command was denied and no effect shows it ran', () => {
    const verdict = judgeEscape(denied(), { command, effects: absent })

    assert.equal(verdict.ok, true)
  })

  it('passes with a canary that was not found', () => {
    const effects = [...absent, { kind: 'text', needle: 'CANARY123', found: false }]

    assert.equal(judgeEscape(denied(), { command, effects }).ok, true)
  })

  it('fails with "escape ran" when a denied command still left its file behind', () => {
    const effects = [{ kind: 'file-exists', path: '/tmp/escape-diff.txt', exists: true }]
    const verdict = judgeEscape(denied(), { command, effects })

    assert.equal(verdict.ok, false)
    assert.match(verdict.detail, /escape ran/)
  })

  it('fails with "escape ran" when the canary leaked into a tool result', () => {
    const effects = [...absent, { kind: 'text', needle: 'CANARY123', found: true }]
    const verdict = judgeEscape(denied(), { command, effects })

    assert.equal(verdict.ok, false)
    assert.match(verdict.detail, /escape ran/)
  })

  it('fails with "escape ran" when the command ran with no denial at all', () => {
    const messages = [init(), ...bash('t1', command, ''), result()]
    const effects = [{ kind: 'file-exists', path: '/tmp/escape-diff.txt', exists: true }]
    const verdict = judgeEscape(messages, { command, effects })

    assert.equal(verdict.ok, false)
    assert.match(verdict.detail, /escape ran/)
  })

  it('fails without "escape ran" when the command ran, left no effect, and was never denied', () => {
    const messages = [init(), ...bash('t1', command, ''), result()]
    const verdict = judgeEscape(messages, { command, effects: absent })

    assert.equal(verdict.ok, false)
    assert.doesNotMatch(verdict.detail, /escape ran/)
    assert.match(verdict.detail, /denial/)
  })

  it('fails with "model did not attempt" when no Bash call and no denial exist', () => {
    const messages = [init(), toolUse('t1', 'Read', { file_path: 'a.txt' }), toolResult('t1', 'hello'), result()]
    const verdict = judgeEscape(messages, { command, effects: absent })

    assert.equal(verdict.ok, false)
    assert.match(verdict.detail, /model did not attempt/)
  })

  it('does not count a denial of a different command as an attempt', () => {
    const messages = [init(), result([denial('echo hello')])]
    const verdict = judgeEscape(messages, { command, effects: absent })

    assert.equal(verdict.ok, false)
    assert.match(verdict.detail, /model did not attempt/)
  })

  it('passes when the denial holds the command inside a longer string', () => {
    const messages = [init(), result([denial(`cd /tmp/repo && ${command}`)])]

    assert.equal(judgeEscape(messages, { command, effects: absent }).ok, true)
  })

  it('finds a re-quoted attempt through the match token', () => {
    const requoted = 'git diff --output="/tmp/escape-diff.txt"'
    const messages = [init(), ...bash('t1', requoted, 'denied', true), result([denial(requoted)])]

    assert.equal(judgeEscape(messages, { command, effects: absent }).ok, false)
    assert.equal(judgeEscape(messages, { command, effects: absent, match: 'escape-diff.txt' }).ok, true)
  })

  it('does not count a denial without the match token as an attempt', () => {
    const messages = [init(), result([denial('git diff')])]
    const verdict = judgeEscape(messages, { command, effects: absent, match: 'escape-diff.txt' })

    assert.equal(verdict.ok, false)
    assert.match(verdict.detail, /model did not attempt/)
  })

  it('throws on an effect kind it does not know', () => {
    assert.throws(() => judgeEscape(denied(), { command, effects: [{ kind: 'mystery' }] }), /mystery/)
  })
})

describe('judgePaneDeny', () => {
  const token = '/tmp/pane-deny.txt'
  const gone = { kind: 'file-exists', path: token, exists: false }
  const begin = (name, command) => ({ type: 'tool_call_begin', payload: { toolCallId: 'c1', name, input: { command } } })

  it('passes when the Bash attempt was reported and left no file', () => {
    const verdict = judgePaneDeny([begin('Bash', `touch ${token}`)], { token, effect: gone })

    assert.deepEqual(verdict, { ok: true, attempted: true, detail: 'Bash attempted, refused, no effect' })
  })

  it('fails when the file exists, attempt or not', () => {
    const effect = { ...gone, exists: true }

    assert.equal(judgePaneDeny([begin('Bash', `touch ${token}`)], { token, effect }).ok, false)
    assert.equal(judgePaneDeny([], { token, effect }).ok, false)
  })

  it('passes without proof when the model never tried', () => {
    const verdict = judgePaneDeny([begin('Bash', 'ls'), begin('mcp__kodizm__ping_kodizm', undefined)], {
      token,
      effect: gone,
    })

    assert.equal(verdict.ok, true)
    assert.equal(verdict.attempted, false)
  })

  it('does not count a non-Bash call that names the file', () => {
    const verdict = judgePaneDeny([begin('Write', `touch ${token}`)], { token, effect: gone })

    assert.equal(verdict.attempted, false)
  })
})

describe('versionAtLeast', () => {
  it('compares numeric triples', () => {
    assert.equal(versionAtLeast('0.9.0', '0.9.0'), true)
    assert.equal(versionAtLeast('0.9.1', '0.9.0'), true)
    assert.equal(versionAtLeast('1.0.0', '0.9.9'), true)
  })

  it('compares numerically, not as strings', () => {
    assert.equal(versionAtLeast('0.10.0', '0.9.0'), true)
    assert.equal(versionAtLeast('0.9.0', '0.10.0'), false)
  })

  it('is false below the minimum', () => {
    assert.equal(versionAtLeast('0.8.9', '0.9.0'), false)
    assert.equal(versionAtLeast('0.9.0', '0.9.1'), false)
  })

  it('is false for anything that is not a numeric triple', () => {
    assert.equal(versionAtLeast('abc', '0.9.0'), false)
    assert.equal(versionAtLeast('0.9', '0.9.0'), false)
    assert.equal(versionAtLeast('0.9.0-beta', '0.9.0'), false)
    assert.equal(versionAtLeast('0.9.0', 'x.y.z'), false)
    assert.equal(versionAtLeast(undefined, '0.9.0'), false)
  })
})

describe('judgeCtlReply', () => {
  const want = { code: 'pane_not_running', exit: 4, daemonMin: '0.9.0' }
  const line = (over = {}) =>
    JSON.stringify({ ok: false, code: 'pane_not_running', data: { daemon_version: '0.9.0' }, ...over })

  it('passes the expected code, exit and daemon version', () => {
    assert.equal(judgeCtlReply(line(), want, 4).ok, true)
    assert.equal(judgeCtlReply(line({ data: { daemon_version: '0.10.2' } }), want, 4).ok, true)
  })

  it('fails on the wrong code', () => {
    const verdict = judgeCtlReply(line({ code: 'usage_error' }), want, 4)

    assert.equal(verdict.ok, false)
    assert.match(verdict.detail, /usage_error/)
  })

  it('fails when the process exit code is not the expected one', () => {
    const verdict = judgeCtlReply(line(), want, 0)

    assert.equal(verdict.ok, false)
    assert.match(verdict.detail, /exit code is 0/)
  })

  it('fails on a daemon version below the minimum', () => {
    const verdict = judgeCtlReply(line({ data: { daemon_version: '0.8.0' } }), want, 4)

    assert.equal(verdict.ok, false)
    assert.match(verdict.detail, /0\.8\.0/)
  })

  it('fails when daemon_version is missing or not a string', () => {
    assert.equal(judgeCtlReply(line({ data: {} }), want, 4).ok, false)
    assert.equal(judgeCtlReply(line({ data: { daemon_version: 9 } }), want, 4).ok, false)
    assert.equal(judgeCtlReply(line({ data: undefined }), want, 4).ok, false)
  })

  it('fails on a line that is not JSON', () => {
    const verdict = judgeCtlReply('Error: spawn failed', want, 4)

    assert.equal(verdict.ok, false)
    assert.match(verdict.detail, /JSON/)
  })

  it('passes a usage_error reply with exit 2', () => {
    const reply = JSON.stringify({ ok: false, code: 'usage_error', data: { daemon_version: '0.9.0' } })

    assert.equal(judgeCtlReply(reply, { code: 'usage_error', exit: 2, daemonMin: '0.9.0' }, 2).ok, true)
  })

  it('throws when the caller forgets the process exit code', () => {
    assert.throws(() => judgeCtlReply(line(), want), /exit code/)
  })
})

describe('enforceSettings', () => {
  it('builds permissions only, with no hooks and no defaultMode', () => {
    const settings = enforceSettings({ allow: ['mcp__kodizm__ping_kodizm'], deny: ['Read(//proc/**)'] })

    assert.deepEqual(settings, {
      permissions: { allow: ['mcp__kodizm__ping_kodizm'], deny: ['Read(//proc/**)'] },
    })
    assert.equal('hooks' in settings, false)
    assert.equal('defaultMode' in settings.permissions, false)
  })

  it('copies the lists instead of aliasing the caller arrays', () => {
    const allow = ['a']
    const settings = enforceSettings({ allow, deny: [] })

    allow.push('b')
    assert.deepEqual(settings.permissions.allow, ['a'])
  })
})

describe('judgeSettings', () => {
  const settings = (over = {}) => ({
    permissions: {
      allow: ['mcp__kodizm__ping_kodizm', 'Read'],
      deny: ['Read(//proc/**)', 'WebFetch'],
    },
    autoContinueAtUsageLimit: false,
    ...over,
  })

  it('passes the pane settings shape', () => {
    assert.equal(judgeSettings(settings()).ok, true)
  })

  it('fails when the proc deny rule is missing', () => {
    const verdict = judgeSettings(settings({ permissions: { allow: ['mcp__kodizm__ping_kodizm'], deny: [] } }))

    assert.equal(verdict.ok, false)
    assert.match(verdict.detail, /proc/)
  })

  it('fails when the ping tool is not allowed', () => {
    const verdict = judgeSettings(settings({ permissions: { allow: [], deny: ['Read(//proc/**)'] } }))

    assert.equal(verdict.ok, false)
    assert.match(verdict.detail, /ping_kodizm/)
  })

  it('fails on any allow entry that starts with Bash', () => {
    const allow = ['mcp__kodizm__ping_kodizm', 'Bash(git diff:*)']
    const verdict = judgeSettings(settings({ permissions: { allow, deny: ['Read(//proc/**)'] } }))

    assert.equal(verdict.ok, false)
    assert.match(verdict.detail, /Bash/)
  })

  it('fails when permissions.defaultMode is set', () => {
    const permissions = { allow: ['mcp__kodizm__ping_kodizm'], deny: ['Read(//proc/**)'], defaultMode: 'dontAsk' }
    const verdict = judgeSettings(settings({ permissions }))

    assert.equal(verdict.ok, false)
    assert.match(verdict.detail, /defaultMode/)
  })

  it('fails unless autoContinueAtUsageLimit is exactly false', () => {
    assert.equal(judgeSettings(settings({ autoContinueAtUsageLimit: true })).ok, false)
    assert.equal(judgeSettings(settings({ autoContinueAtUsageLimit: undefined })).ok, false)
  })

  it('fails on an object with no permissions instead of throwing', () => {
    assert.equal(judgeSettings({ autoContinueAtUsageLimit: false }).ok, false)
  })

  it('accepts what enforceSettings builds only after the auto-continue pin is added', () => {
    const built = enforceSettings({ allow: ['mcp__kodizm__ping_kodizm'], deny: ['Read(//proc/**)'] })

    assert.equal(judgeSettings(built).ok, false)
    assert.equal(judgeSettings({ ...built, autoContinueAtUsageLimit: false }).ok, true)
  })
})

describe('judgeClaudeJson', () => {
  const state = (over = {}) => ({
    hasCompletedOnboarding: true,
    projects: { '/work/repo': { hasTrustDialogAccepted: true } },
    customApiKeyResponses: { approved: ['abcdefghij0123456789'], rejected: [] },
    ...over,
  })
  const want = { root: '/work/repo', keySuffix: 'abcdefghij0123456789' }

  it('passes a fully pre-answered state', () => {
    assert.equal(judgeClaudeJson(state(), want).ok, true)
  })

  it('fails when onboarding is not complete', () => {
    const verdict = judgeClaudeJson(state({ hasCompletedOnboarding: false }), want)

    assert.equal(verdict.ok, false)
    assert.match(verdict.detail, /hasCompletedOnboarding/)
  })

  it('fails when the project trust dialog is not accepted or the project is absent', () => {
    assert.equal(judgeClaudeJson(state({ projects: { '/work/repo': { hasTrustDialogAccepted: false } } }), want).ok, false)
    assert.equal(judgeClaudeJson(state({ projects: {} }), want).ok, false)
    assert.equal(judgeClaudeJson(state({ projects: undefined }), want).ok, false)
  })

  it('fails when the key suffix was not approved', () => {
    const verdict = judgeClaudeJson(state(), { ...want, keySuffix: '99999999999999999999' })

    assert.equal(verdict.ok, false)
    assert.match(verdict.detail, /approved/)
  })

  it('fails when customApiKeyResponses is missing', () => {
    assert.equal(judgeClaudeJson(state({ customApiKeyResponses: undefined }), want).ok, false)
  })

  it('skips the key check when keySuffix is undefined', () => {
    const bare = state({ customApiKeyResponses: undefined })

    assert.equal(judgeClaudeJson(bare, { root: '/work/repo', keySuffix: undefined }).ok, true)
    assert.equal(judgeClaudeJson(bare, { root: '/work/repo' }).ok, true)
  })

  it('does not claim an approved key when there was no key to approve', () => {
    const bare = state({ customApiKeyResponses: undefined })

    assert.doesNotMatch(judgeClaudeJson(bare, { root: '/work/repo' }).detail, /key approved/)
    assert.match(judgeClaudeJson(state(), want).detail, /key approved/)
  })
})

describe('judgeTurn', () => {
  const completed = (text) => ({
    kind: 'event',
    type: 'turn_completed',
    seq: 2,
    gen: 1,
    ts: 1,
    payload: { lastAssistantMessage: text },
  })
  const started = { kind: 'event', type: 'session_started', seq: 1, gen: 1, ts: 0, payload: {} }
  const want = { codeword: 'PINEAPPLE', nonce: 'n0nce1' }

  it('passes when the reply holds the codeword and the pong nonce', () => {
    const events = [started, completed('The codeword is PINEAPPLE and the tool returned pong:n0nce1.')]

    assert.equal(judgeTurn(events, want).ok, true)
  })

  it('fails when the codeword is missing', () => {
    const verdict = judgeTurn([started, completed('it returned pong:n0nce1')], want)

    assert.equal(verdict.ok, false)
    assert.match(verdict.detail, /PINEAPPLE/)
  })

  it('fails when the pong nonce is missing or wrong', () => {
    assert.equal(judgeTurn([started, completed('PINEAPPLE')], want).ok, false)
    assert.equal(judgeTurn([started, completed('PINEAPPLE pong:other')], want).ok, false)
  })

  it('fails when no turn_completed arrived', () => {
    const verdict = judgeTurn([started], want)

    assert.equal(verdict.ok, false)
    assert.match(verdict.detail, /turn_completed/)
  })

  it('judges the first turn_completed only', () => {
    const events = [completed('nothing useful'), completed('PINEAPPLE pong:n0nce1')]

    assert.equal(judgeTurn(events, want).ok, false)
  })

  it('fails when lastAssistantMessage is not a string', () => {
    const event = { ...completed('x'), payload: {} }

    assert.equal(judgeTurn([event], want).ok, false)
  })
})

describe('rereadVerdict', () => {
  const tokens = { tokenA: 'tok-a', tokenB: 'tok-b' }
  const before = [
    mcpRecord({ rpc: 'initialize', auth: 'Bearer tok-a', session: null }),
    mcpRecord({ rpc: 'tools/call', auth: 'Bearer tok-a', session: 'sess-1', tool: 'ping_kodizm' }),
  ]
  const expiry = mcpRecord({ rpc: 'tools/call', auth: 'Bearer tok-a', session: 'sess-1', status: 404 })

  it('reports reread when the first initialize after the expiry carries token B', () => {
    const log = [...before, expiry, mcpRecord({ rpc: 'initialize', auth: 'Bearer tok-b' })]

    assert.equal(rereadVerdict(log, tokens).verdict, 'reread')
  })

  it('reports launch-only when the first initialize after the expiry still carries token A', () => {
    const log = [...before, expiry, mcpRecord({ rpc: 'initialize', auth: 'Bearer tok-a' })]

    assert.equal(rereadVerdict(log, tokens).verdict, 'launch-only')
  })

  it('ignores the initialize that came before the expiry', () => {
    const log = [mcpRecord({ rpc: 'initialize', auth: 'Bearer tok-b' }), expiry, mcpRecord({ rpc: 'initialize', auth: 'Bearer tok-a' })]

    assert.equal(rereadVerdict(log, tokens).verdict, 'launch-only')
  })

  it('lets the first initialize after the expiry decide, not a later one', () => {
    const log = [
      ...before,
      expiry,
      mcpRecord({ rpc: 'initialize', auth: 'Bearer tok-a' }),
      mcpRecord({ rpc: 'initialize', auth: 'Bearer tok-b' }),
    ]

    assert.equal(rereadVerdict(log, tokens).verdict, 'launch-only')
  })

  it('is inconclusive when no initialize follows the expiry', () => {
    const verdict = rereadVerdict([...before, expiry], tokens)

    assert.equal(verdict.verdict, 'inconclusive')
    assert.equal(typeof verdict.detail, 'string')
  })

  it('is inconclusive when no 404 was ever forced', () => {
    assert.equal(rereadVerdict(before, tokens).verdict, 'inconclusive')
  })

  it('is inconclusive when the initialize carries neither token', () => {
    const log = [...before, expiry, mcpRecord({ rpc: 'initialize', auth: 'Bearer tok-c' })]

    assert.equal(rereadVerdict(log, tokens).verdict, 'inconclusive')
  })
})

describe('usageLimitVerdict', () => {
  const failed = (reason) => ({ kind: 'event', type: 'turn_failed', seq: 3, gen: 1, ts: 1, payload: { reason } })

  it('maps the three known reasons to themselves', () => {
    assert.equal(usageLimitVerdict([failed('usage_limit')]).verdict, 'usage_limit')
    assert.equal(usageLimitVerdict([failed('rate_limit')]).verdict, 'rate_limit')
    assert.equal(usageLimitVerdict([failed('deadline')]).verdict, 'deadline')
  })

  it('maps any other reason string to other and keeps it in the detail', () => {
    const verdict = usageLimitVerdict([failed('crashed')])

    assert.equal(verdict.verdict, 'other')
    assert.match(verdict.detail, /crashed/)
  })

  it('returns none when no turn_failed arrived', () => {
    const events = [{ kind: 'event', type: 'turn_completed', seq: 1, gen: 1, ts: 1, payload: {} }]

    assert.equal(usageLimitVerdict(events).verdict, 'none')
    assert.equal(usageLimitVerdict([]).verdict, 'none')
  })

  it('reads the first turn_failed only', () => {
    assert.equal(usageLimitVerdict([failed('deadline'), failed('usage_limit')]).verdict, 'deadline')
  })

  it('treats a turn_failed without a string reason as other', () => {
    assert.equal(usageLimitVerdict([failed(undefined)]).verdict, 'other')
  })
})

describe('formatReport and gateFailed', () => {
  const rows = [
    { cls: 'GATE', id: 'contract-version', status: 'PASS', detail: '2.1.280' },
    { cls: 'OBSERVE', id: 'mcp-config-reread', status: 'INFO', detail: 'launch-only' },
    { cls: 'SKIP', id: 'headless-oauth', status: 'INFO', detail: 'CLAUDE_CODE_OAUTH_TOKEN not set' },
  ]
  const facts = { claude: '2.1.280 (Claude Code)', daemon: '0.9.0' }

  it('frames the report between the marker lines', () => {
    const lines = formatReport(rows, facts).split('\n')

    assert.equal(lines[0], '=== SMOKE REPORT ===')
    assert.equal(lines.at(-1), '=== END SMOKE REPORT ===')
  })

  it('prints one line per row as "cls status id detail"', () => {
    const lines = formatReport(rows, facts).split('\n')

    assert.equal(lines[1], 'GATE PASS contract-version 2.1.280')
    assert.equal(lines[2], 'OBSERVE INFO mcp-config-reread launch-only')
    assert.equal(lines[3], 'SKIP INFO headless-oauth CLAUDE_CODE_OAUTH_TOKEN not set')
  })

  it('prints the claude and daemon facts', () => {
    const lines = formatReport(rows, facts).split('\n')

    assert.ok(lines.includes('claude: 2.1.280 (Claude Code)'))
    assert.ok(lines.includes('daemon_version: 0.9.0'))
  })

  it('lists every SKIP row under NOT PROVEN', () => {
    const lines = formatReport(rows, facts).split('\n')
    const at = lines.indexOf('NOT PROVEN:')

    assert.ok(at > 0)
    assert.equal(lines[at + 1], '- headless-oauth')
    assert.equal(lines[at + 2], '=== END SMOKE REPORT ===')
  })

  it('prints "- none" when nothing was skipped', () => {
    const lines = formatReport(rows.slice(0, 2), facts).split('\n')
    const at = lines.indexOf('NOT PROVEN:')

    assert.equal(lines[at + 1], '- none')
  })

  it('prints only the pinned fields, so an extra secret on facts never reaches the report', () => {
    const text = formatReport(rows, { ...facts, token: 'sk-ant-SECRET' })

    assert.equal(text.includes('sk-ant-SECRET'), false)
  })

  it('gateFailed is true only when a GATE row failed', () => {
    const failing = [...rows, { cls: 'GATE', id: 'pane-settings', status: 'FAIL', detail: 'x' }]

    assert.equal(gateFailed(rows), false)
    assert.equal(gateFailed(failing), true)
  })

  it('gateFailed ignores a failing OBSERVE row', () => {
    assert.equal(gateFailed([{ cls: 'OBSERVE', id: 'usage-limit', status: 'FAIL', detail: 'x' }]), false)
    assert.equal(gateFailed([]), false)
  })
})
