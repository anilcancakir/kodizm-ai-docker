// Unit tests for scripts/lib/stubs.mjs: the ingest, MCP and Anthropic API stubs the real-CLI smoke
// points the CLI and tmuxd at.
//
// Run: node --test tests/*.test.mjs (from the repo root; a directory argument fails on node 24)
//
// Why: the smoke judges the CLI by what these stubs logged, so a stub that mislogs or answers the
// wrong status would turn into a false pass or a false failure of the gate.

import assert from 'node:assert/strict'
import { afterEach, describe, it } from 'node:test'

import { startApi, startIngest, startMcp } from '../scripts/lib/stubs.mjs'

const open = []

afterEach(async () => {
  await Promise.all(open.splice(0).map((stub) => stub.close()))
})

async function track(starting) {
  const stub = await starting
  open.push(stub)

  return stub
}

function postJson(url, body, headers = {}) {
  return fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json', ...headers },
    body: JSON.stringify(body),
  })
}

function rpc(url, method, params, headers = {}, id = 1) {
  return postJson(url, { jsonrpc: '2.0', id, method, params }, { authorization: 'Bearer t', ...headers })
}

describe('startIngest', () => {
  it('binds 127.0.0.1 and acks the seq of the last event in the batch', async () => {
    const ingest = await track(startIngest())
    assert.match(ingest.url, /^http:\/\/127\.0\.0\.1:\d+$/)

    const events = [
      { type: 'session_started', seq: 1, gen: 1, ts: 10, payload: { a: 1 } },
      { type: 'turn_completed', seq: 2, gen: 1, ts: 11, payload: { lastAssistantMessage: 'hi' } },
    ]
    const response = await postJson(`${ingest.url}/live/events`, { events })

    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), { lastSeq: 2 })
    assert.deepEqual(ingest.events(), events.map((event) => ({ kind: 'event', ...event })))
  })

  it('keeps events in arrival order across batches', async () => {
    const ingest = await track(startIngest())

    await postJson(`${ingest.url}/live/events`, { events: [{ type: 'a', seq: 1, gen: 1, ts: 1, payload: {} }] })
    await postJson(`${ingest.url}/live/events`, { events: [{ type: 'b', seq: 2, gen: 1, ts: 2, payload: {} }] })

    assert.deepEqual(ingest.events().map((event) => event.type), ['a', 'b'])
  })

  it('records permission calls and answers 200 on POST, 404 on GET', async () => {
    const ingest = await track(startIngest())

    const created = await postJson(`${ingest.url}/live/permissions`, { tool: 'Bash' })
    assert.equal(created.status, 200)
    assert.deepEqual(await created.json(), { id: 'stub' })

    const polled = await fetch(`${ingest.url}/live/permissions/stub`)
    assert.equal(polled.status, 404)

    assert.deepEqual(ingest.permissions(), [
      { kind: 'permission', method: 'POST', path: '/live/permissions', body: { tool: 'Bash' } },
      { kind: 'permission', method: 'GET', path: '/live/permissions/stub', body: null },
    ])
    assert.deepEqual(ingest.events(), [])
  })

  it('answers 404 for any other route', async () => {
    const ingest = await track(startIngest())

    assert.equal((await fetch(`${ingest.url}/other`)).status, 404)
    assert.equal((await postJson(`${ingest.url}/events`, { events: [] })).status, 404)
  })
})

describe('startMcp', () => {
  it('answers initialize with serverInfo and a fresh mcp-session-id', async () => {
    const mcp = await track(startMcp({ tokens: ['t'] }))
    assert.match(mcp.url, /^http:\/\/127\.0\.0\.1:\d+$/)

    const response = await rpc(`${mcp.url}/mcp`, 'initialize', { protocolVersion: '2025-06-18' })
    const body = await response.json()

    assert.equal(response.status, 200)
    assert.match(response.headers.get('content-type'), /^application\/json/)
    assert.match(response.headers.get('mcp-session-id'), /^[0-9a-f-]{36}$/)
    assert.equal(body.id, 1)
    assert.equal(body.result.protocolVersion, '2025-06-18')
    assert.deepEqual(body.result.capabilities, { tools: {} })
    assert.deepEqual(body.result.serverInfo, { name: 'kodizm-stub', version: '0.0.0' })
  })

  it('falls back to protocol 2025-03-26 when the client names none', async () => {
    const mcp = await track(startMcp({ tokens: ['t'] }))

    const body = await (await rpc(`${mcp.url}/mcp`, 'initialize', {})).json()

    assert.equal(body.result.protocolVersion, '2025-03-26')
  })

  it('acks notifications/initialized with an empty 202', async () => {
    const mcp = await track(startMcp({ tokens: ['t'] }))

    const response = await postJson(
      `${mcp.url}/mcp`,
      { jsonrpc: '2.0', method: 'notifications/initialized' },
      { authorization: 'Bearer t' },
    )

    assert.equal(response.status, 202)
    assert.equal(await response.text(), '')
  })

  it('lists ping_kodizm and echoes the message on tools/call', async () => {
    const mcp = await track(startMcp({ tokens: ['t'] }))

    const listed = await (await rpc(`${mcp.url}/mcp`, 'tools/list', {})).json()
    assert.deepEqual(listed.result.tools, [
      {
        name: 'ping_kodizm',
        description: 'Echo a message',
        inputSchema: { type: 'object', properties: { message: { type: 'string' } }, required: ['message'] },
      },
    ])

    const called = await (
      await rpc(`${mcp.url}/mcp`, 'tools/call', { name: 'ping_kodizm', arguments: { message: 'abc' } })
    ).json()
    assert.deepEqual(called.result.content, [{ type: 'text', text: 'pong:abc' }])
  })

  it('answers any other rpc method, server/discover included, with -32601', async () => {
    const mcp = await track(startMcp({ tokens: ['t'] }))

    const response = await rpc(`${mcp.url}/mcp`, 'server/discover', {}, {}, 7)
    const body = await response.json()

    assert.equal(response.status, 200)
    assert.equal(body.id, 7)
    assert.deepEqual(body.error, { code: -32601, message: 'Method not found' })
  })

  it('answers 405 on GET and 200 on DELETE', async () => {
    const mcp = await track(startMcp({ tokens: ['t'] }))

    assert.equal((await fetch(`${mcp.url}/mcp`, { headers: { authorization: 'Bearer t' } })).status, 405)
    assert.equal((await fetch(`${mcp.url}/mcp`, { method: 'DELETE', headers: { authorization: 'Bearer t' } })).status, 200)
  })

  it('answers 401 with an empty body on a wrong or missing bearer and still logs the request', async () => {
    const mcp = await track(startMcp({ tokens: ['good'] }))

    const wrong = await rpc(`${mcp.url}/mcp`, 'initialize', {}, { authorization: 'Bearer bad' })
    assert.equal(wrong.status, 401)
    assert.equal(await wrong.text(), '')

    const missing = await postJson(`${mcp.url}/mcp`, { jsonrpc: '2.0', id: 2, method: 'initialize', params: {} })
    assert.equal(missing.status, 401)

    const [first, second] = mcp.requests()
    assert.equal(first.status, 401)
    assert.equal(first.auth, 'Bearer bad')
    assert.equal(first.rpc, 'initialize')
    assert.equal(second.status, 401)
    assert.equal(second.auth, null)
  })

  it('replaces the accepted bearer set with setTokens', async () => {
    const mcp = await track(startMcp({ tokens: ['a'] }))
    mcp.setTokens(['b', 'c'])

    assert.equal((await rpc(`${mcp.url}/mcp`, 'tools/list', {}, { authorization: 'Bearer a' })).status, 401)
    assert.equal((await rpc(`${mcp.url}/mcp`, 'tools/list', {}, { authorization: 'Bearer b' })).status, 200)
    assert.equal((await rpc(`${mcp.url}/mcp`, 'tools/list', {}, { authorization: 'Bearer c' })).status, 200)
  })

  it('logs /decoy hits apart from /mcp with the full record shape', async () => {
    const mcp = await track(startMcp({ tokens: ['t'] }))

    await rpc(`${mcp.url}/mcp`, 'tools/call', { name: 'ping_kodizm', arguments: { message: 'm' } }, { 'mcp-session-id': 's1' })
    await rpc(`${mcp.url}/decoy`, 'initialize', {})

    const [real, decoy] = mcp.requests()
    assert.deepEqual(real, {
      path: '/mcp',
      httpMethod: 'POST',
      rpc: 'tools/call',
      auth: 'Bearer t',
      session: 's1',
      status: 200,
      tool: 'ping_kodizm',
      args: { message: 'm' },
    })
    assert.equal(decoy.path, '/decoy')
    assert.equal(decoy.rpc, 'initialize')
    assert.equal(decoy.session, null)
    assert.equal(decoy.tool, null)
    assert.equal(decoy.args, null)
    assert.equal(mcp.requests().filter((request) => request.path === '/decoy').length, 1)
  })

  it('serves /decoy like /mcp', async () => {
    const mcp = await track(startMcp({ tokens: ['t'] }))

    const body = await (await rpc(`${mcp.url}/decoy`, 'initialize', {})).json()

    assert.equal(body.result.serverInfo.name, 'kodizm-stub')
  })

  it('answers 404 for other paths', async () => {
    const mcp = await track(startMcp({ tokens: ['t'] }))

    assert.equal((await rpc(`${mcp.url}/other`, 'initialize', {})).status, 404)
  })

  it('returns 404 exactly once on the next request that carries a session id after expireNextSession', async () => {
    const mcp = await track(startMcp({ tokens: ['t'] }))
    mcp.expireNextSession()

    const fresh = await rpc(`${mcp.url}/mcp`, 'initialize', {})
    assert.equal(fresh.status, 200)

    const expired = await rpc(`${mcp.url}/mcp`, 'tools/list', {}, { 'mcp-session-id': 'old' }, 5)
    assert.equal(expired.status, 404)
    assert.deepEqual(await expired.json(), {
      jsonrpc: '2.0',
      id: 5,
      error: { code: -32001, message: 'Session not found' },
    })

    const again = await rpc(`${mcp.url}/mcp`, 'tools/list', {}, { 'mcp-session-id': 'old' })
    assert.equal(again.status, 200)

    assert.deepEqual(mcp.requests().map((request) => request.status), [200, 404, 200])
  })
})

describe('startApi', () => {
  it('answers every POST /v1/messages with 429 and the unified rate-limit headers', async () => {
    const api = await track(startApi())
    assert.match(api.url, /^http:\/\/127\.0\.0\.1:\d+$/)

    const before = Math.floor(Date.now() / 1000)
    const response = await postJson(`${api.url}/v1/messages`, { model: 'x' })
    const after = Math.floor(Date.now() / 1000)

    assert.equal(response.status, 429)
    assert.equal(response.headers.get('anthropic-ratelimit-unified-status'), 'rejected')
    assert.equal(response.headers.get('anthropic-ratelimit-unified-representative-claim'), 'five_hour')
    assert.equal(response.headers.get('retry-after'), '3600')
    assert.match(response.headers.get('content-type'), /^application\/json/)

    const reset = Number(response.headers.get('anthropic-ratelimit-unified-reset'))
    assert.ok(reset >= before + 3600 && reset <= after + 3600, `reset ${reset} not now + 3600`)

    assert.deepEqual(await response.json(), {
      type: 'error',
      error: { type: 'rate_limit_error', message: 'usage limit stub' },
    })
    assert.deepEqual(api.requests(), [{ path: '/v1/messages', status: 429 }])
  })

  it('answers 404 for every other path and logs it', async () => {
    const api = await track(startApi())

    assert.equal((await fetch(`${api.url}/v1/models`)).status, 404)
    assert.deepEqual(api.requests(), [{ path: '/v1/models', status: 404 }])
  })
})
