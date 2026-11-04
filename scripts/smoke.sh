#!/usr/bin/env bash
# Runtime smoke for the built image. Runs inside the container as the agent user:
#   docker run --rm -v "$PWD/scripts:/smoke:ro" IMAGE bash /smoke/smoke.sh
# Complements tests/structure-test.yaml (what exists) with what actually runs.
set -euo pipefail

VERSIONS_FILE="${VERSIONS_FILE:-/opt/kodizm/versions.json}"
VERSION_KEYS=(claude opencode kodizm_acp php node)

# The wide set Laravel and Symfony projects typically need, checked by name in `php -m`.
PHP_EXTENSIONS=(
  bcmath ctype curl dom fileinfo gd imagick intl mbstring openssl pcntl
  pdo_mysql pdo_pgsql pdo_sqlite pgsql redis sqlite3 tokenizer xml zip
)

fail() {
  echo "smoke: $*" >&2
  exit 1
}

# Same rule as supportsPasteBufferS in kodizm-acp's src/live/pane.ts: `paste-buffer -S`
# exists from tmux 3.7 on, and the Debian 13 tmux (3.5a) refuses it as an unknown flag.
tmux_has_paste_s() {
  local version
  version="$(tmux -V)"
  version="${version#tmux }"
  version="${version#next-}"
  [[ "${version}" =~ ^([0-9]+)\.([0-9]+)[a-z]?$ ]] || return 1
  local major="${BASH_REMATCH[1]}" minor="${BASH_REMATCH[2]}"
  ((major > 3 || (major == 3 && minor >= 7)))
}

pinned_version() {
  node -e '
    const value = require(process.argv[1])[process.argv[2]]
    if (typeof value !== "string" || value === "") process.exit(1)
    console.log(value)
  ' "${VERSIONS_FILE}" "$1" || fail "${VERSIONS_FILE} has no usable \"$1\" entry"
}

# Under set -e the status of a command substitution inside an argument is discarded,
# so versions are captured by plain assignment and checked for non-empty output.
expect_pinned() {
  local key="$1" actual="$2" pinned
  : "${actual:?${key} reported no version}"
  pinned="$(pinned_version "${key}")"
  [[ "${actual}" == "${pinned}" ]] || fail "${key} is ${actual}, versions.json pins ${pinned}"
  echo "smoke: ${key} ${actual}"
}

# 1. versions.json is the contract every later check reads, so it comes first.
for key in "${VERSION_KEYS[@]}"; do
  pinned_version "${key}" >/dev/null
done

# 2. A right-looking answer from the wrong binary passed the old build gate, so the
#    CLIs are held to the pinned versions rather than to "prints something".
claude_version="$(claude --version)"
expect_pinned claude "${claude_version%% *}"

opencode_version="$(opencode --version)"
expect_pinned opencode "${opencode_version}"

# 3. The control plane drives the image over this handshake; reading agentInfo back
#    proves the bridge boots with its bundled SDK and matches the pinned release.
initialize='{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":1}}'
handshake="$(printf '%s\n' "${initialize}" | KODIZM_BACKEND=claude timeout 60 kodizm-acp)" \
  || fail "kodizm-acp did not answer the initialize handshake within 60s"
acp_version="$(node -e '
  const reply = JSON.parse(process.argv[1].split("\n")[0])
  if (reply.result?.protocolVersion !== 1) process.exit(1)
  console.log(reply.result.agentInfo.version)
' "${handshake}")" || fail "kodizm-acp initialize handshake failed: ${handshake}"
expect_pinned kodizm_acp "${acp_version}"

# 4. Bounded wait, in case `start` returns before the server accepts connections.
kodizm-pg start
for _ in {1..30}; do
  psql -c 'select 1' >/dev/null 2>&1 && break
  sleep 1
done
psql -c 'select 1' >/dev/null || fail "psql could not reach the kodizm-pg server"
echo "smoke: kodizm-pg answers select 1"

# 5. Both PHP versions, since projects pin either one.
for php_bin in php8.3 php8.5; do
  loaded="$("${php_bin}" -m | tr '[:upper:]' '[:lower:]')"
  for extension in "${PHP_EXTENSIONS[@]}"; do
    grep -qx "${extension}" <<<"${loaded}" || fail "${php_bin} is missing the ${extension} extension"
  done
  echo "smoke: ${php_bin} has all ${#PHP_EXTENSIONS[@]} extensions"
done

# 6. Live sessions drive the CLI through a tmux server on its own socket, so a detached
#    session must start and die cleanly there without touching the default socket.
tmux -L kodizm-live new-session -d -s smoke 'sleep 60' || fail "tmux could not start a detached session"
tmux -L kodizm-live has-session -t smoke || fail "tmux session did not stay up on the kodizm-live socket"
echo "smoke: tmux runs a detached session on -L kodizm-live"

#    A prompt reaches the pane the way pane.ts sends it: load-buffer from stdin, then
#    paste-buffer with the flags this tmux accepts. A flag the image's tmux refuses
#    would fail every Live prompt, so a multi-line text has to arrive byte for byte.
paste_out=/tmp/kodizm-smoke-paste.out
paste_expected=/tmp/kodizm-smoke-paste.expected
paste_text=$'first line\nsecond line: çğıöşü 漢字\n  indented !not-bash /not-slash\n'
paste_flags=(-p -d -r)
tmux_has_paste_s && paste_flags+=(-S)
rm -f "${paste_out}"
printf '%s' "${paste_text}" >"${paste_expected}"
tmux -L kodizm-live new-session -d -s smoke-paste "cat > ${paste_out}" \
  || fail "tmux could not start the paste session"
printf '%s' "${paste_text}" | tmux -L kodizm-live load-buffer -b smoke - \
  || fail "tmux load-buffer refused the paste text"
tmux -L kodizm-live paste-buffer "${paste_flags[@]}" -b smoke -t '=smoke-paste:' \
  || fail "tmux paste-buffer ${paste_flags[*]} failed on $(tmux -V)"
for _ in {1..50}; do
  cmp -s "${paste_out}" "${paste_expected}" && break
  sleep 0.2
done
cmp -s "${paste_out}" "${paste_expected}" \
  || fail "the pasted text did not arrive byte for byte with paste-buffer ${paste_flags[*]} on $(tmux -V)"
rm -f "${paste_out}" "${paste_expected}"
echo "smoke: $(tmux -V) pastes a multi-line text byte for byte (paste-buffer ${paste_flags[*]})"

tmux -L kodizm-live kill-server || fail "tmux could not kill the kodizm-live server"

echo "smoke: ok"
