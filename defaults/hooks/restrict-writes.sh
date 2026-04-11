#!/bin/bash
#
# PreToolUse hook: restrict write operations to allowed directories only.
#
# Allowed:
#   - $CLAUDE_PROJECT_DIR/** (task workspace)
#   - /tmp/**
#   - /home/agent/.claude/projects/** (CC session JSONL data)
#
# Blocked (examples of what falls outside the allowed list):
#   - /home/agent/.claude/CLAUDE.md
#   - /home/agent/.claude/skills/**
#   - /home/agent/.claude/settings.json
#   - /home/agent/.ssh/**
#   - /workspace/** (base repos, not task workspaces)
#   - Anything else not in the allowed list
#
# Exit codes:
#   0  — allowed, proceed
#   2  — blocked, abort
#
# Fail-open: if jq is unavailable or input is malformed, allow the operation.

set -uo pipefail

# -----------------------------------------------------------------------
# Read stdin into a variable (input is a one-shot JSON object from CC)
# -----------------------------------------------------------------------
INPUT="$(cat)"

# Fail-open: if jq is not available, allow everything
if ! command -v jq &>/dev/null; then
    exit 0
fi

# Fail-open: if input is not valid JSON, allow everything
if ! echo "$INPUT" | jq empty 2>/dev/null; then
    exit 0
fi

# -----------------------------------------------------------------------
# Extract tool name
# -----------------------------------------------------------------------
TOOL_NAME="$(echo "$INPUT" | jq -r '.tool_name // ""')"

# -----------------------------------------------------------------------
# Helper: check whether a resolved absolute path is allowed
# Returns 0 (allowed) or 1 (blocked)
# -----------------------------------------------------------------------
is_allowed_path() {
    local path="$1"

    # Empty path — allow (nothing to check)
    if [[ -z "$path" ]]; then
        return 0
    fi

    # Allowed: workspace directory
    if [[ -n "${CLAUDE_PROJECT_DIR:-}" ]]; then
        # Normalize: strip trailing slash
        local workspace="${CLAUDE_PROJECT_DIR%/}"
        if [[ "$path" == "$workspace" || "$path" == "$workspace/"* ]]; then
            return 0
        fi
    fi

    # Allowed: /tmp
    if [[ "$path" == /tmp || "$path" == /tmp/* ]]; then
        return 0
    fi

    # Allowed: CC session JSONL directory
    if [[ "$path" == /home/agent/.claude/projects || "$path" == /home/agent/.claude/projects/* ]]; then
        return 0
    fi

    # Blocked: anything else
    return 1
}

# -----------------------------------------------------------------------
# Write / Edit tools — check file_path
# -----------------------------------------------------------------------
if [[ "$TOOL_NAME" == "Write" || "$TOOL_NAME" == "Edit" ]]; then
    FILE_PATH="$(echo "$INPUT" | jq -r '.tool_input.file_path // ""')"

    # Fail-open: missing or empty file_path
    if [[ -z "$FILE_PATH" ]]; then
        exit 0
    fi

    # Resolve relative paths against CLAUDE_PROJECT_DIR when set
    if [[ "$FILE_PATH" != /* ]]; then
        if [[ -n "${CLAUDE_PROJECT_DIR:-}" ]]; then
            FILE_PATH="${CLAUDE_PROJECT_DIR%/}/$FILE_PATH"
        else
            # Cannot resolve — allow (fail-open)
            exit 0
        fi
    fi

    if ! is_allowed_path "$FILE_PATH"; then
        echo "restrict-writes: blocked Write/Edit to restricted path: $FILE_PATH" >&2
        exit 2
    fi

    exit 0
fi

# -----------------------------------------------------------------------
# Bash tool — scan command for redirect operators targeting blocked paths
# -----------------------------------------------------------------------
if [[ "$TOOL_NAME" == "Bash" ]]; then
    COMMAND="$(echo "$INPUT" | jq -r '.tool_input.command // ""')"

    # Fail-open: empty command
    if [[ -z "$COMMAND" ]]; then
        exit 0
    fi

    # Check for redirect operators (>, >>, tee) pointing at /home/agent/.claude/
    # outside the allowed /home/agent/.claude/projects/ subtree.
    #
    # Strategy: extract tokens that follow > / >> / tee and test them.
    # We use a simple grep-based scan — not a full shell parser, but
    # sufficient to catch the common attack patterns.

    # Blocked patterns written into /home/agent/.claude/ (but NOT /projects/)
    # Examples: > /home/agent/.claude/CLAUDE.md
    #           >> /home/agent/.claude/skills/foo.md
    #           tee /home/agent/.claude/settings.json
    #           tee -a /home/agent/.claude/foo

    # Extract candidate paths following redirect operators
    # We look for whitespace-delimited tokens starting with /home/agent/.claude/
    # that appear after >, >>, or tee (optionally with flags)
    BLOCKED=0

    while IFS= read -r token; do
        # Skip empty tokens
        [[ -z "$token" ]] && continue

        # Resolve relative paths — if token is not absolute, skip
        [[ "$token" != /* ]] && continue

        if ! is_allowed_path "$token"; then
            BLOCKED=1
            echo "restrict-writes: blocked Bash redirect to restricted path: $token" >&2
            break
        fi
    done < <(
        # Extract tokens that follow >, >>, or tee (optionally -a / --append flags)
        # Using perl for reliable multi-pattern extraction
        echo "$COMMAND" | perl -ne '
            # Match > path or >> path
            while (/>>?\s+(\S+)/g) { print "$1\n" }
            # Match tee [flags] path (tee may have -a or --append before path)
            while (/\btee\b(?:\s+(?:-a|--append))?\s+(\S+)/g) { print "$1\n" }
        '
    )

    if [[ "$BLOCKED" -eq 1 ]]; then
        exit 2
    fi

    exit 0
fi

# -----------------------------------------------------------------------
# All other tools — allow
# -----------------------------------------------------------------------
exit 0
