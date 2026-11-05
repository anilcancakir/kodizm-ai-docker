// Loopback stub servers for the real-CLI smoke: the Kodizm live ingest, an MCP server and the Anthropic API.
//
// Each start*() binds 127.0.0.1 on a free port and resolves to { url, close(), ...logs }. close() destroys open
// connections, so a CLI holding a keep-alive socket cannot keep the smoke alive. Nothing is written to
// stdout or stderr: the smoke judges the CLI by the records these stubs keep, and the MCP records hold the
// full Authorization value on purpose (the judge compares bearers), so printing them would leak.
//
// Usage: import { startIngest, startMcp, startApi } from './stubs.mjs'
//
// Why a hand-rolled stub per surface: the CLI and tmuxd must talk real HTTP to something that answers as
// the real service does, with the exact status codes and headers the classifiers key on.

import { randomUUID } from 'node:crypto'
import { createServer } from 'node:http'

const PROTOCOL_FALLBACK = '2025-03-26'
const USAGE_LIMIT_RESET_SECONDS = 3600

const PING_TOOL = {
  name: 'ping_kodizm',
  description: 'Echo a message',
  inputSchema: {
    type: 'object',
    properties: { message: { type: 'string' } },
    required: ['message'],
  },
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = []
    req.on('data', (chunk) => chunks.push(chunk))
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
    req.on('error', reject)
  })
}

// An empty body is null; a body that is not JSON throws and becomes a 400 in listen().
async function readJson(req) {
  const text = await readBody(req)

  return text === '' ? null : JSON.parse(text)
}

function send(res, status, body = null, headers = {}) {
  if (body === null) {
    res.writeHead(status, headers)
    res.end()

    return
  }

  res.writeHead(status, { 'content-type': 'application/json', ...headers })
  res.end(JSON.stringify(body))
}

async function listen(handler) {
  const server = createServer(async (req, res) => {
    try {
      await handler(req, res)
    } catch (error) {
      send(res, 400, { error: error.message })
    }
  })

  await new Promise((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })

  return {
    server,
    url: `http://127.0.0.1:${server.address().port}`,
    close: () =>
      new Promise((resolve, reject) => {
        server.close((error) => (error ? reject(error) : resolve()))
        server.closeAllConnections()
      }),
  }
}

function pathOf(req) {
  return new URL(req.url, 'http://127.0.0.1').pathname
}

/**
 * The live ingest the tmuxd daemon posts to (ingestUrl = `<url>/live`).
 * events() lists accepted events in arrival order, permissions() the permission calls.
 */
export async function startIngest() {
  const events = []
  const permissions = []

  const { url, close } = await listen(async (req, res) => {
    const path = pathOf(req)

    if (req.method === 'POST' && path === '/live/events') {
      const body = await readJson(req)
      const batch = body?.events
      if (!Array.isArray(batch) || batch.length === 0) {
        send(res, 422, { error: { code: 'malformed' } })

        return
      }

      for (const event of batch) {
        events.push({
          kind: 'event',
          type: event.type,
          seq: event.seq,
          gen: event.gen,
          ts: event.ts,
          payload: event.payload,
        })
      }
      send(res, 200, { lastSeq: batch.at(-1).seq })

      return
    }

    if (path === '/live/permissions' && req.method === 'POST') {
      permissions.push({ kind: 'permission', method: 'POST', path, body: await readJson(req) })
      send(res, 200, { id: 'stub' })

      return
    }

    if (req.method === 'GET' && path.startsWith('/live/permissions/')) {
      permissions.push({ kind: 'permission', method: 'GET', path, body: null })
    }
    send(res, 404, { error: { code: 'not_found' } })
  })

  return {
    url,
    close,
    events: () => [...events],
    permissions: () => [...permissions],
  }
}

/**
 * A Streamable HTTP MCP server with plain JSON responses on /mcp and /decoy.
 * requests() lists one record per HTTP request; a request whose bearer is outside the accepted set is
 * answered 401 and still logged.
 */
export async function startMcp({ tokens }) {
  let accepted = [...tokens]
  let expireArmed = false
  const requests = []

  const { url, close } = await listen(async (req, res) => {
    const path = pathOf(req)
    if (path !== '/mcp' && path !== '/decoy') {
      send(res, 404, { error: 'not_found' })

      return
    }

    const message = req.method === 'POST' ? await readJson(req) : null
    const auth = req.headers.authorization ?? null
    const session = req.headers['mcp-session-id'] ?? null
    const record = {
      path,
      httpMethod: req.method,
      rpc: message?.method ?? null,
      auth,
      session,
      status: 0,
      tool: message?.method === 'tools/call' ? (message.params?.name ?? null) : null,
      args: message?.method === 'tools/call' ? (message.params?.arguments ?? null) : null,
    }
    requests.push(record)

    const reply = (status, body, headers) => {
      record.status = status
      send(res, status, body, headers)
    }

    if (!accepted.some((token) => auth === `Bearer ${token}`)) {
      reply(401)

      return
    }

    // Armed expiry models a server that forgot the session: only a request that names one can hit it.
    if (expireArmed && session !== null) {
      expireArmed = false
      reply(404, { jsonrpc: '2.0', id: message?.id ?? null, error: { code: -32001, message: 'Session not found' } })

      return
    }

    if (req.method === 'GET') {
      reply(405)

      return
    }

    if (req.method === 'DELETE') {
      reply(200)

      return
    }

    if (message === null || message.id === undefined) {
      reply(202)

      return
    }

    const respond = (result, headers) => reply(200, { jsonrpc: '2.0', id: message.id, result }, headers)
    const fail = (code, text) => reply(200, { jsonrpc: '2.0', id: message.id, error: { code, message: text } })

    switch (message.method) {
      case 'initialize':
        respond(
          {
            protocolVersion: message.params?.protocolVersion ?? PROTOCOL_FALLBACK,
            capabilities: { tools: {} },
            serverInfo: { name: 'kodizm-stub', version: '0.0.0' },
          },
          { 'mcp-session-id': randomUUID() },
        )
        break
      case 'tools/list':
        respond({ tools: [PING_TOOL] })
        break
      case 'tools/call':
        if (message.params?.name !== PING_TOOL.name) {
          fail(-32602, 'Unknown tool')
          break
        }
        respond({ content: [{ type: 'text', text: `pong:${message.params.arguments?.message}` }] })
        break
      default:
        fail(-32601, 'Method not found')
    }
  })

  return {
    url,
    close,
    requests: () => requests.map((record) => ({ ...record })),
    setTokens: (next) => {
      accepted = [...next]
    },
    expireNextSession: () => {
      expireArmed = true
    },
  }
}

/**
 * An Anthropic API that has hit its subscription usage limit: every POST /v1/messages is a 429 with the
 * unified rate-limit headers the CLI reads. The CLI appends a query string (?beta=true), so only the path
 * is matched.
 */
export async function startApi() {
  const requests = []

  const { url, close } = await listen(async (req, res) => {
    const path = pathOf(req)
    const limited = req.method === 'POST' && path === '/v1/messages'
    const status = limited ? 429 : 404
    requests.push({ path, status })

    if (!limited) {
      send(res, 404, { type: 'error', error: { type: 'not_found_error', message: 'not found' } })

      return
    }

    send(
      res,
      429,
      { type: 'error', error: { type: 'rate_limit_error', message: 'usage limit stub' } },
      {
        'anthropic-ratelimit-unified-status': 'rejected',
        'anthropic-ratelimit-unified-reset': String(Math.floor(Date.now() / 1000) + USAGE_LIMIT_RESET_SECONDS),
        'anthropic-ratelimit-unified-representative-claim': 'five_hour',
        'retry-after': String(USAGE_LIMIT_RESET_SECONDS),
      },
    )
  })

  return {
    url,
    close,
    requests: () => requests.map((record) => ({ ...record })),
  }
}
