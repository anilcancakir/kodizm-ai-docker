#!/usr/bin/env node
// Derives opencode's LSP config from the ac-lsp plugin's .lsp.json, so opencode and Claude Code
// launch the same servers through the same lsp-proxy. Runs at image build time; the output is
// what Laravel points OPENCODE_CONFIG at.
//
// Usage: node gen-opencode-lsp.mjs <lsp.json> <output> [pluginRoot]
//   pluginRoot  substituted for ${CLAUDE_PLUGIN_ROOT}, default /opt/kodizm/plugins/ac-lsp

import { readFileSync, writeFileSync } from 'node:fs'

const DEFAULT_PLUGIN_ROOT = '/opt/kodizm/plugins/ac-lsp'

// The image installs servers for these entries only: no sourcekit-lsp (swift), no superhtml (html).
const SERVERS = ['intelephense', 'dart', 'typescript', 'python', 'go']

// opencode 1.x built-in server ids (packages/opencode/src/lsp/server.ts) for the same languages.
// Left on, a file would get a second server, or opencode would try to download one.
const BUILT_IN_DUPLICATES = ['typescript', 'deno', 'pyright', 'ty', 'gopls', 'dart', 'php intelephense']

const [lspJsonPath, outputPath, pluginRoot = DEFAULT_PLUGIN_ROOT] = process.argv.slice(2)

if (lspJsonPath === undefined || outputPath === undefined) {
  console.error('usage: gen-opencode-lsp.mjs <lsp.json> <output> [pluginRoot]')
  process.exit(2)
}

// A disabled built-in id cannot also carry the replacement, so a colliding name moves aside.
function opencodeId(name) {
  return BUILT_IN_DUPLICATES.includes(name) ? `ac-${name}` : name
}

function toOpencodeServer(name, server) {
  if (server === undefined) {
    throw new Error(`${lspJsonPath} has no "${name}" server`)
  }

  const resolveRoot = (value) => String(value).replaceAll('${CLAUDE_PLUGIN_ROOT}', pluginRoot)
  const entry = {
    command: [server.command, ...server.args].map(resolveRoot),
    extensions: Object.keys(server.extensionToLanguage),
  }

  if (server.initializationOptions !== undefined) {
    entry.initialization = server.initializationOptions
  }

  return entry
}

const plugin = JSON.parse(readFileSync(lspJsonPath, 'utf8'))
const lsp = Object.fromEntries(BUILT_IN_DUPLICATES.map((id) => [id, { disabled: true }]))

for (const name of SERVERS) {
  lsp[opencodeId(name)] = toOpencodeServer(name, plugin[name])
}

writeFileSync(outputPath, `${JSON.stringify({ $schema: 'https://opencode.ai/config.json', lsp }, null, 2)}\n`)
