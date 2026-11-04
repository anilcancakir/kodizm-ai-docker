// Pure verdict functions of the real-CLI smoke: they read what the smoke measured and decide.
//
// No fs, no process, no env, no clock: every input arrives as an argument, so the verdicts
// are unit-tested against inline fixtures (tests/judge.test.mjs) without a CLI, a daemon or
// a paid call. The orchestration (scripts/real-cli-smoke.mjs) does the measuring.
//
// Run the tests: node --test tests/*.test.mjs   (a directory argument fails on node 24)
//
// Every decision returns { ok, detail }; rereadVerdict and usageLimitVerdict return
// { verdict, detail } because their answer is not a pass/fail.

const TRIPLE = /^\d+\.\d+\.\d+$/
const USAGE_REASONS = ['usage_limit', 'rate_limit', 'deadline']

function verdict(problems, okDetail) {
  return problems.length === 0 ? { ok: true, detail: okDetail } : { ok: false, detail: problems.join('; ') }
}

function asList(value) {
  return Array.isArray(value) ? value : []
}

// A tool_result body is a string or an array of {type:'text', text} blocks.
function resultText(content) {
  if (content === undefined || content === null) {
    return ''
  }

  if (typeof content === 'string') {
    return content
  }

  if (Array.isArray(content)) {
    return content
      .filter((block) => block.type === 'text')
      .map((block) => block.text)
      .join('\n')
  }

  throw new TypeError(`tool_result content is neither a string nor a block list: ${JSON.stringify(content)}`)
}

function bashRuns(messages, matches) {
  return toolRuns(messages).filter(
    (run) => run.name === 'Bash' && typeof run.input?.command === 'string' && matches(run.input.command),
  )
}

// A safe command counts when it stands as a word of the line: `ls` must not match `git ls-files`, while
// `cd repo && git diff` still matches `git diff`.
function mentions(line, command) {
  const escaped = command.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')

  return new RegExp(`(^|[\\s;&|(])${escaped}($|[\\s;&|)])`).test(line)
}

function firstEvent(events, type) {
  return events.find((event) => event.type === type)
}

export function parseStreamJson(text) {
  const messages = []

  text.split('\n').forEach((line, index) => {
    if (line.trim() === '') {
      return
    }

    try {
      messages.push(JSON.parse(line))
    } catch (error) {
      throw new Error(`stream-json line ${index + 1} is not JSON: ${error.message}`)
    }
  })

  return messages
}

export function initOf(messages) {
  return messages.find((message) => message.type === 'system' && message.subtype === 'init') ?? null
}

export function judgeInit(init, { auth, server, decoy }) {
  if (init === null || init === undefined) {
    return { ok: false, detail: 'no system/init message in the stream' }
  }

  const servers = asList(init.mcp_servers)
  const problems = []

  if (init.apiKeySource !== auth) {
    problems.push(`apiKeySource is ${init.apiKeySource}, wanted ${auth}`)
  }

  if (init.permissionMode !== 'dontAsk') {
    problems.push(`permissionMode is ${init.permissionMode}, wanted dontAsk`)
  }

  if (!servers.some((entry) => entry.name === server && entry.status === 'connected')) {
    problems.push(`mcp server ${server} is not connected`)
  }

  if (servers.some((entry) => entry.name === decoy)) {
    problems.push(`decoy mcp server ${decoy} was loaded`)
  }

  return verdict(problems, `${auth}, dontAsk, ${server} connected, no ${decoy}`)
}

export function toolRuns(messages) {
  const runs = []
  const open = new Map()

  for (const message of messages) {
    for (const block of asList(message.message?.content)) {
      if (message.type === 'assistant' && block.type === 'tool_use') {
        const run = { name: block.name, input: block.input, result: '', isError: false }
        open.set(block.id, run)
        runs.push(run)
      }

      if (message.type === 'user' && block.type === 'tool_result') {
        const run = open.get(block.tool_use_id)

        if (run === undefined) {
          throw new Error(`tool_result ${block.tool_use_id} has no tool_use before it`)
        }

        run.result = resultText(block.content)
        run.isError = block.is_error === true
      }
    }
  }

  return runs
}

export function deniedBash(messages) {
  return messages
    .filter((message) => message.type === 'result')
    .flatMap((message) => asList(message.permission_denials))
    .filter((denial) => denial.tool_name === 'Bash' && typeof denial.tool_input?.command === 'string')
    .map((denial) => denial.tool_input.command)
}

export function judgeSafe(messages, expectations) {
  const denied = deniedBash(messages)
  const problems = []

  for (const { command, marker } of expectations) {
    const matches = (line) => mentions(line, command)

    if (denied.some(matches)) {
      problems.push(`\`${command}\` was denied`)
      continue
    }

    const runs = bashRuns(messages, matches)

    if (runs.length === 0) {
      problems.push(`\`${command}\` was never run through Bash`)
      continue
    }

    if (runs.some((run) => !run.isError && run.result.includes(marker))) {
      continue
    }

    const [first] = runs
    problems.push(
      first.isError
        ? `\`${command}\` returned an error: ${first.result.slice(0, 120)}`
        : `\`${command}\` output lacks the marker ${marker}`,
    )
  }

  return verdict(problems, `${expectations.length} safe commands ran clean`)
}

// effects are measured by the caller after the run: the oracle that tells a refused escape
// from one that merely looked refused.
function ranEffect(effect) {
  if (effect.kind === 'file-exists') {
    return effect.exists ? `file ${effect.path} exists` : null
  }

  if (effect.kind === 'text') {
    return effect.found ? `canary ${effect.needle} was found` : null
  }

  throw new Error(`unknown effect kind: ${effect.kind}`)
}

// `match` is the token that identifies the attempt in a recorded command (the effect path, the unusual flag): a model
// may re-quote the command it was given, so the whole string is only the fallback.
export function judgeEscape(messages, { command, effects, match }) {
  const seen = effects.map(ranEffect).filter((entry) => entry !== null)

  if (seen.length > 0) {
    return { ok: false, detail: `escape ran: ${seen.join(', ')}` }
  }

  const matches = (line) => line.includes(match ?? command)
  const denied = deniedBash(messages).some(matches)

  if (!denied && bashRuns(messages, matches).length === 0) {
    return { ok: false, detail: `model did not attempt \`${command}\`` }
  }

  if (!denied) {
    return { ok: false, detail: `no permission denial recorded for \`${command}\`, though no effect was seen` }
  }

  return { ok: true, detail: `denied, no effect: ${effects.length} checks clean` }
}

/**
 * The pane variant of the escape oracle. A pane has no permission_denials list, but the PreToolUse hook still
 * reports every Bash attempt as a tool_call_begin event, so an attempt is seen even when dontAsk refuses it.
 * `attempted: false` means the model skipped the call and the pass proves nothing.
 */
export function judgePaneDeny(events, { token, effect }) {
  const seen = ranEffect(effect)

  if (seen !== null) {
    return { ok: false, attempted: true, detail: `Bash ran under dontAsk: ${seen}` }
  }

  const attempted = events.some(
    (event) =>
      event.type === 'tool_call_begin' &&
      event.payload?.name === 'Bash' &&
      String(event.payload?.input?.command ?? '').includes(token),
  )

  return attempted
    ? { ok: true, attempted, detail: 'Bash attempted, refused, no effect' }
    : { ok: true, attempted, detail: 'the model did not attempt the Bash call' }
}

export function versionAtLeast(version, min) {
  if (typeof version !== 'string' || typeof min !== 'string' || !TRIPLE.test(version) || !TRIPLE.test(min)) {
    return false
  }

  const have = version.split('.').map(Number)
  const need = min.split('.').map(Number)

  for (let index = 0; index < 3; index++) {
    if (have[index] !== need[index]) {
      return have[index] > need[index]
    }
  }

  return true
}

// `exit` in the expectations is the exit code the contract demands; `status` is the code the
// ctl process actually returned, which only the caller can know.
export function judgeCtlReply(line, { code, exit, daemonMin }, status) {
  if (!Number.isInteger(status)) {
    throw new TypeError(`judgeCtlReply needs the process exit code as its third argument, got ${status}`)
  }

  let reply

  try {
    reply = JSON.parse(line)
  } catch (error) {
    return { ok: false, detail: `ctl stdout is not one JSON line: ${error.message}` }
  }

  const daemon = reply?.data?.daemon_version
  const problems = []

  if (status !== exit) {
    problems.push(`exit code is ${status}, wanted ${exit}`)
  }

  if (reply?.code !== code) {
    problems.push(`code is ${reply?.code}, wanted ${code}`)
  }

  if (typeof daemon !== 'string') {
    problems.push('data.daemon_version is not a string')
  } else if (!versionAtLeast(daemon, daemonMin)) {
    problems.push(`daemon_version ${daemon} is below ${daemonMin}`)
  }

  return verdict(problems, `${code}, exit ${status}, daemon ${daemon}`)
}

export function enforceSettings({ allow, deny }) {
  return { permissions: { allow: [...allow], deny: [...deny] } }
}

export function judgeSettings(settings) {
  const permissions = settings?.permissions
  const allow = asList(permissions?.allow)
  const problems = []

  if (typeof permissions !== 'object' || permissions === null) {
    problems.push('permissions object is missing')
  }

  if (!asList(permissions?.deny).includes('Read(//proc/**)')) {
    problems.push('permissions.deny lacks Read(//proc/**)')
  }

  if (!allow.includes('mcp__kodizm__ping_kodizm')) {
    problems.push('permissions.allow lacks mcp__kodizm__ping_kodizm')
  }

  const bashRules = allow.filter((rule) => typeof rule === 'string' && rule.startsWith('Bash'))

  if (bashRules.length > 0) {
    problems.push(`permissions.allow holds Bash rules: ${bashRules.join(', ')}`)
  }

  if (permissions?.defaultMode !== undefined) {
    problems.push(`permissions.defaultMode is set to ${permissions.defaultMode}`)
  }

  if (settings?.autoContinueAtUsageLimit !== false) {
    problems.push('autoContinueAtUsageLimit is not false')
  }

  return verdict(problems, 'deny, allow, no Bash rule, no defaultMode, autoContinue pinned off')
}

export function judgeClaudeJson(state, { root, keySuffix }) {
  const problems = []

  if (state?.hasCompletedOnboarding !== true) {
    problems.push('hasCompletedOnboarding is not true')
  }

  if (state?.projects?.[root]?.hasTrustDialogAccepted !== true) {
    problems.push(`projects[${root}].hasTrustDialogAccepted is not true`)
  }

  if (keySuffix !== undefined && !asList(state?.customApiKeyResponses?.approved).includes(keySuffix)) {
    problems.push('customApiKeyResponses.approved lacks the key suffix')
  }

  return verdict(
    problems,
    keySuffix === undefined ? 'onboarding done, project trusted' : 'onboarding done, project trusted, key approved',
  )
}

export function judgeTurn(events, { codeword, nonce }) {
  const turn = firstEvent(events, 'turn_completed')

  if (turn === undefined) {
    return { ok: false, detail: 'no turn_completed event arrived' }
  }

  const reply = turn.payload?.lastAssistantMessage

  if (typeof reply !== 'string') {
    return { ok: false, detail: 'turn_completed carries no lastAssistantMessage string' }
  }

  const problems = []

  if (!reply.includes(codeword)) {
    problems.push(`reply lacks the codeword ${codeword}`)
  }

  if (!reply.includes(`pong:${nonce}`)) {
    problems.push(`reply lacks pong:${nonce}`)
  }

  return verdict(problems, 'codeword and pong nonce present')
}

export function rereadVerdict(mcpLog, { tokenA, tokenB }) {
  const expiry = mcpLog.findIndex((record) => record.status === 404)

  if (expiry === -1) {
    return { verdict: 'inconclusive', detail: 'no 404 was served, so the session expiry never happened' }
  }

  const next = mcpLog.slice(expiry + 1).find((record) => record.rpc === 'initialize')

  if (next === undefined) {
    return { verdict: 'inconclusive', detail: 'no initialize followed the forced expiry' }
  }

  if (next.auth === `Bearer ${tokenB}`) {
    return { verdict: 'reread', detail: 'the first initialize after the expiry carried the rewritten token' }
  }

  if (next.auth === `Bearer ${tokenA}`) {
    return { verdict: 'launch-only', detail: 'the first initialize after the expiry carried the launch token' }
  }

  return { verdict: 'inconclusive', detail: 'the first initialize after the expiry carried an unknown Authorization' }
}

export function usageLimitVerdict(events) {
  const failed = firstEvent(events, 'turn_failed')

  if (failed === undefined) {
    return { verdict: 'none', detail: 'no turn_failed event arrived' }
  }

  const reason = failed.payload?.reason

  if (USAGE_REASONS.includes(reason)) {
    return { verdict: reason, detail: `turn_failed reason ${reason}` }
  }

  return { verdict: 'other', detail: `turn_failed reason ${reason}` }
}

export function gateFailed(rows) {
  return rows.some((row) => row.cls === 'GATE' && row.status === 'FAIL')
}

export function formatReport(rows, facts) {
  const skipped = rows.filter((row) => row.cls === 'SKIP')

  return [
    '=== SMOKE REPORT ===',
    ...rows.map((row) => `${row.cls} ${row.status} ${row.id} ${row.detail}`),
    `claude: ${facts.claude}`,
    `daemon_version: ${facts.daemon}`,
    'NOT PROVEN:',
    ...(skipped.length === 0 ? ['- none'] : skipped.map((row) => `- ${row.id}`)),
    '=== END SMOKE REPORT ===',
  ].join('\n')
}
