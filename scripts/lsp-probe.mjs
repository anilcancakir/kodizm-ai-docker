#!/usr/bin/env node
// Proves every language server the baked .lsp.json declares can answer a real request.
//
// Runs inside the built image, spawning each server exactly as Claude Code does (the
// command and args from the JSON, ${CLAUDE_PLUGIN_ROOT} resolved), then speaks
// initialize / initialized / didOpen / documentSymbol over stdio on a fixture file and
// requires at least one symbol. A server that starts but returns nothing fails here,
// which is the failure a bare --version check cannot see.
//
// Usage: node lsp-probe.mjs [pluginRoot] [lspJson]
//   pluginRoot  default $LSP_PLUGIN_ROOT, then /opt/kodizm/plugins/ac-lsp
//   lspJson     default $LSP_JSON, then <pluginRoot>/.lsp.json
//   fixtures    $LSP_FIXTURES, then ../tests/fixtures next to this script
//
// Servers whose extensions have no fixture here are skipped: the image installs no
// sourcekit-lsp (swift) or superhtml (html).

import { spawn } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const pluginRoot = resolve(process.argv[2] ?? process.env.LSP_PLUGIN_ROOT ?? '/opt/kodizm/plugins/ac-lsp')
const lspJsonPath = resolve(process.argv[3] ?? process.env.LSP_JSON ?? join(pluginRoot, '.lsp.json'))
const fixturesRoot = resolve(
  process.env.LSP_FIXTURES ?? join(dirname(fileURLToPath(import.meta.url)), '..', 'tests', 'fixtures'),
)

const SYMBOL_WINDOW_MS = 45_000
const SYMBOL_RETRY_MS = 2_000
const SHUTDOWN_GRACE_MS = 3_000

// Extension to fixture; the first extension a server declares that appears here wins.
const FIXTURES = {
  '.php': 'php/Greeter.php',
  '.ts': 'ts/index.ts',
  '.dart': 'dart/main.dart',
  '.py': 'py/main.py',
  '.go': 'go/main.go',
}

const sleep = (ms) => new Promise((done) => setTimeout(done, ms))

function withTimeout(promise, ms, label) {
  let timer
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms)
  })

  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer))
}

function countSymbols(symbols) {
  if (!Array.isArray(symbols)) {
    return 0
  }

  return symbols.reduce((total, symbol) => total + 1 + countSymbols(symbol.children), 0)
}

class LspClient {
  #child
  #buffer = Buffer.alloc(0)
  #pending = new Map()
  #nextId = 1
  #stderr = ''
  #closed = null
  #exited

  constructor(command, args, cwd) {
    this.#child = spawn(command, args, { cwd, stdio: ['pipe', 'pipe', 'pipe'] })
    this.#exited = new Promise((done) => this.#child.once('close', done))
    this.#child.stdout.on('data', (chunk) => this.#onData(chunk))
    this.#child.stderr.on('data', (chunk) => {
      this.#stderr = (this.#stderr + chunk.toString()).slice(-2000)
    })
    this.#child.stdin.on('error', (error) => this.#fail(error))
    this.#child.on('error', (error) => this.#fail(error))
    this.#child.on('exit', (code, signal) => this.#fail(new Error(`server exited (code ${code}, signal ${signal})`)))
  }

  get stderrTail() {
    return this.#stderr.trim()
  }

  request(method, params) {
    if (this.#closed) {
      return Promise.reject(this.#closed)
    }

    const id = this.#nextId++

    return new Promise((resolveRequest, rejectRequest) => {
      this.#pending.set(id, { resolveRequest, rejectRequest })
      this.#send({ jsonrpc: '2.0', id, method, params })
    })
  }

  notify(method, params) {
    this.#send({ jsonrpc: '2.0', method, params })
  }

  async stop() {
    // A graceful exit lets lsp-proxy reap the server it wraps; a bare kill would orphan it.
    try {
      await withTimeout(this.request('shutdown', null), SHUTDOWN_GRACE_MS, 'shutdown')
      this.notify('exit', null)
      await withTimeout(this.#exited, SHUTDOWN_GRACE_MS, 'exit')
    } catch (error) {
      console.error(`lsp-probe: forcing the server down: ${error.message}`)
      this.#child.kill('SIGKILL')
    }
  }

  #send(message) {
    const body = Buffer.from(JSON.stringify(message))
    this.#child.stdin.write(`Content-Length: ${body.length}\r\n\r\n`)
    this.#child.stdin.write(body)
  }

  #fail(error) {
    this.#closed ??= error

    for (const { rejectRequest } of this.#pending.values()) {
      rejectRequest(error)
    }

    this.#pending.clear()
  }

  #onData(chunk) {
    this.#buffer = Buffer.concat([this.#buffer, chunk])

    for (;;) {
      const headerEnd = this.#buffer.indexOf('\r\n\r\n')

      if (headerEnd === -1) {
        return
      }

      const length = /Content-Length:\s*(\d+)/i.exec(this.#buffer.subarray(0, headerEnd).toString())?.[1]

      if (length === undefined) {
        this.#fail(new Error('malformed LSP frame: no Content-Length header'))

        return
      }

      const bodyStart = headerEnd + 4
      const bodyEnd = bodyStart + Number(length)

      if (this.#buffer.length < bodyEnd) {
        return
      }

      const message = JSON.parse(this.#buffer.subarray(bodyStart, bodyEnd).toString())
      this.#buffer = this.#buffer.subarray(bodyEnd)
      this.#dispatch(message)
    }
  }

  #dispatch(message) {
    if (message.method !== undefined && message.id !== undefined) {
      // Servers block on their own requests (configuration, progress, registration)
      // until the client answers, so every one gets an empty answer.
      const result = message.method === 'workspace/configuration' ? message.params.items.map(() => null) : null
      this.#send({ jsonrpc: '2.0', id: message.id, result })

      return
    }

    const pending = this.#pending.get(message.id)

    if (pending === undefined) {
      return
    }

    this.#pending.delete(message.id)

    if (message.error) {
      pending.rejectRequest(new Error(`${message.error.message} (code ${message.error.code})`))

      return
    }

    pending.resolveRequest(message.result)
  }
}

async function probe(server) {
  const extension = Object.keys(server.extensionToLanguage).find((candidate) => candidate in FIXTURES)

  if (extension === undefined) {
    return { status: 'skip', detail: 'no fixture for its extensions' }
  }

  const fixturePath = join(fixturesRoot, FIXTURES[extension])
  const fixtureDir = dirname(fixturePath)
  const resolveRoot = (value) => String(value).replaceAll('${CLAUDE_PLUGIN_ROOT}', pluginRoot)
  const client = new LspClient(resolveRoot(server.command), server.args.map(resolveRoot), fixtureDir)

  try {
    const rootUri = pathToFileURL(fixtureDir).href
    const documentUri = pathToFileURL(fixturePath).href

    await withTimeout(
      client.request('initialize', {
        processId: process.pid,
        rootUri,
        workspaceFolders: [{ uri: rootUri, name: 'probe' }],
        initializationOptions: server.initializationOptions ?? null,
        capabilities: {
          workspace: { configuration: true, workspaceFolders: true },
          textDocument: {
            synchronization: { didSave: false },
            documentSymbol: { hierarchicalDocumentSymbolSupport: true },
          },
        },
      }),
      server.startupTimeout ?? 30_000,
      'initialize',
    )
    client.notify('initialized', {})
    client.notify('textDocument/didOpen', {
      textDocument: {
        uri: documentUri,
        languageId: server.extensionToLanguage[extension],
        version: 1,
        text: readFileSync(fixturePath, 'utf8'),
      },
    })

    // Servers answer with an empty list until their first parse or index pass finishes.
    const deadline = Date.now() + SYMBOL_WINDOW_MS

    for (;;) {
      const symbols = countSymbols(
        await client.request('textDocument/documentSymbol', { textDocument: { uri: documentUri } }),
      )

      if (symbols > 0) {
        return { status: 'pass', detail: `${symbols} symbols from ${FIXTURES[extension]}` }
      }

      if (Date.now() >= deadline) {
        return { status: 'fail', detail: `no symbols for ${FIXTURES[extension]} within ${SYMBOL_WINDOW_MS}ms` }
      }

      await sleep(SYMBOL_RETRY_MS)
    }
  } catch (error) {
    const stderr = client.stderrTail

    return { status: 'fail', detail: stderr === '' ? error.message : `${error.message}; stderr: ${stderr}` }
  } finally {
    await client.stop()
  }
}

const servers = JSON.parse(readFileSync(lspJsonPath, 'utf8'))
let probed = 0
let failed = 0

for (const [name, server] of Object.entries(servers)) {
  const { status, detail } = await probe(server)
  console.log(`${status.toUpperCase()} ${name}: ${detail}`)

  if (status !== 'skip') {
    probed++
  }

  if (status === 'fail') {
    failed++
  }
}

if (probed === 0) {
  console.error(`lsp-probe: no server in ${lspJsonPath} matched a fixture`)
  process.exit(1)
}

process.exit(failed === 0 ? 0 : 1)
