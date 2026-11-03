#!/usr/bin/env bash
# One paid haiku call through the image's claude binary, proving the whole path works.
# Runs inside the container:
#   docker run --rm -e ANTHROPIC_API_KEY -v "$PWD/scripts:/smoke:ro" IMAGE bash /smoke/real-call-smoke.sh
#
# API-key auth on purpose: subscription auth (CLAUDE_CODE_REMOTE=1) hides the LSP tool in
# Claude Code, so a call made that way would not exercise the surface this image ships.
set -euo pipefail

: "${ANTHROPIC_API_KEY:?ANTHROPIC_API_KEY is required for the real call}"

# A leaked subscription token or remote flag would silently switch the auth path.
result="$(
  env -u CLAUDE_CODE_REMOTE -u CLAUDE_CODE_OAUTH_TOKEN \
    claude -p 'Reply with the single word: ok' --model haiku --output-format json
)"

# A zero cost means the response did not come from a billed API call.
node -e '
  const result = JSON.parse(process.argv[1])
  if (result.is_error === true) {
    console.error(`real-call-smoke: claude reported an error: ${result.result}`)
    process.exit(1)
  }
  if (!(result.total_cost_usd > 0)) {
    console.error(`real-call-smoke: total_cost_usd is ${result.total_cost_usd}, expected > 0`)
    process.exit(1)
  }
  console.log(`real-call-smoke: ok, total_cost_usd=${result.total_cost_usd}`)
' "${result}"
