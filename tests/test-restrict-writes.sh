#!/bin/bash
#
# Integration tests for docker/defaults/hooks/restrict-writes.sh
#
# Usage: bash docker/tests/test-restrict-writes.sh
# Exit: 0 if all tests pass, non-zero otherwise.

set -euo pipefail

HOOK="$(cd "$(dirname "$0")/.." && pwd)/defaults/hooks/restrict-writes.sh"

if [[ ! -f "$HOOK" ]]; then
    echo "ERROR: hook not found at $HOOK" >&2
    exit 1
fi

# -----------------------------------------------------------------------
# Test harness
# -----------------------------------------------------------------------

PASS=0
FAIL=0

run_test() {
    local name="$1"
    local expected_exit="$2"
    local json="$3"

    local actual_exit=0
    echo "$json" | bash "$HOOK" >/dev/null 2>&1 || actual_exit=$?

    if [[ "$actual_exit" -eq "$expected_exit" ]]; then
        echo "PASS: $name"
        PASS=$(( PASS + 1 ))
    else
        echo "FAIL: $name (expected exit $expected_exit, got $actual_exit)"
        FAIL=$(( FAIL + 1 ))
    fi
}

# -----------------------------------------------------------------------
# Test environment
# -----------------------------------------------------------------------

export CLAUDE_PROJECT_DIR="/task-workspaces/KAI-2/app"

# -----------------------------------------------------------------------
# Test cases
# -----------------------------------------------------------------------

# 1. Write to workspace path — allowed (exit 0)
run_test "Write to workspace path is allowed" 0 \
    '{"tool_name":"Write","tool_input":{"file_path":"/task-workspaces/KAI-2/app/src/main.dart","content":"void main() {}"}}'

# 2. Write to /tmp — allowed (exit 0)
run_test "Write to /tmp is allowed" 0 \
    '{"tool_name":"Write","tool_input":{"file_path":"/tmp/scratch.txt","content":"hello"}}'

# 3. Write to /home/agent/.claude/CLAUDE.md — blocked (exit 2)
run_test "Write to /home/agent/.claude/CLAUDE.md is blocked" 2 \
    '{"tool_name":"Write","tool_input":{"file_path":"/home/agent/.claude/CLAUDE.md","content":"malicious"}}'

# 4. Write to /home/agent/.claude/skills/test.md — blocked (exit 2)
run_test "Write to /home/agent/.claude/skills/test.md is blocked" 2 \
    '{"tool_name":"Write","tool_input":{"file_path":"/home/agent/.claude/skills/test.md","content":"malicious"}}'

# 5. Edit to /home/agent/.claude/settings.json — blocked (exit 2)
run_test "Edit to /home/agent/.claude/settings.json is blocked" 2 \
    '{"tool_name":"Edit","tool_input":{"file_path":"/home/agent/.claude/settings.json","old_string":"a","new_string":"b"}}'

# 6. Bash with redirect to /home/agent/.claude/ — blocked (exit 2)
run_test "Bash redirect to /home/agent/.claude/ is blocked" 2 \
    '{"tool_name":"Bash","tool_input":{"command":"echo malicious > /home/agent/.claude/CLAUDE.md"}}'

# 7. Write to /home/agent/.claude/projects/ — allowed (exit 0)
run_test "Write to /home/agent/.claude/projects/ is allowed" 0 \
    '{"tool_name":"Write","tool_input":{"file_path":"/home/agent/.claude/projects/my-project/session.jsonl","content":"{}"}}'

# 8. Bash with safe command — allowed (exit 0)
run_test "Bash with safe command is allowed" 0 \
    '{"tool_name":"Bash","tool_input":{"command":"echo hello && ls /tmp"}}'

# 9. Write to /home/agent/.ssh/id_rsa — blocked (exit 2)
run_test "Write to /home/agent/.ssh/id_rsa is blocked" 2 \
    '{"tool_name":"Write","tool_input":{"file_path":"/home/agent/.ssh/id_rsa","content":"-----BEGIN RSA PRIVATE KEY-----"}}'

# 10. Write to /workspace/base-repo/file.txt — blocked (exit 2)
run_test "Write to /workspace/base-repo/file.txt is blocked" 2 \
    '{"tool_name":"Write","tool_input":{"file_path":"/workspace/base-repo/file.txt","content":"data"}}'

# -----------------------------------------------------------------------
# Bonus edge cases
# -----------------------------------------------------------------------

# 11. Bash tee redirect to blocked path — blocked (exit 2)
run_test "Bash tee to /home/agent/.claude/skills/foo.md is blocked" 2 \
    '{"tool_name":"Bash","tool_input":{"command":"cat something | tee /home/agent/.claude/skills/foo.md"}}'

# 12. Bash append redirect to blocked path — blocked (exit 2)
run_test "Bash append redirect to /home/agent/.claude/settings.json is blocked" 2 \
    '{"tool_name":"Bash","tool_input":{"command":"echo x >> /home/agent/.claude/settings.json"}}'

# 13. Non-write tool — always allowed (exit 0)
run_test "Read tool is always allowed" 0 \
    '{"tool_name":"Read","tool_input":{"file_path":"/home/agent/.claude/CLAUDE.md"}}'

# 14. Fail-open on missing jq: tested implicitly — hook exits 0 when jq absent.
#     Here we test malformed JSON (fail-open behavior).
run_test "Malformed JSON input is fail-open (allowed)" 0 \
    'not-valid-json'

# 15. Write with relative path resolved into workspace — allowed (exit 0)
run_test "Write with relative path inside workspace is allowed" 0 \
    '{"tool_name":"Write","tool_input":{"file_path":"src/main.dart","content":"void main() {}"}}'

# -----------------------------------------------------------------------
# Summary
# -----------------------------------------------------------------------

echo ""
echo "Results: $PASS passed, $FAIL failed"

if [[ "$FAIL" -gt 0 ]]; then
    exit 1
fi

exit 0
