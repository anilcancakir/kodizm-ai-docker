#!/bin/bash
set -euo pipefail

echo "=================================="
echo "  Kodizm Agent Runtime"
echo "=================================="

# Phase 1: Root — start services and switch PHP, then re-exec as agent
if [ "$(id -u)" = "0" ]; then

    # Start PostgreSQL (opt-out: KODIZM_ENV_PG=false)
    if [[ "${KODIZM_ENV_PG:-true}" != "false" ]]; then
        pg_ver="${KODIZM_ENV_PG_VERSION:-17}"
        echo "Starting PostgreSQL ${pg_ver}..."
        pg_ctlcluster "${pg_ver}" main start 2>/dev/null || true
    fi

    # Start Redis (opt-out: KODIZM_ENV_REDIS=false)
    if [[ "${KODIZM_ENV_REDIS:-true}" != "false" ]]; then
        echo "Starting Redis..."
        redis-server --daemonize yes --bind 127.0.0.1 --loglevel warning || true
    fi

    # Switch PHP version (requires root for update-alternatives)
    if [[ -n "${KODIZM_ENV_PHP_VERSION:-}" ]]; then
        current=$(php --version 2>/dev/null | awk 'NR==1{print $2}' | cut -d. -f1,2)
        if [[ "$current" != "$KODIZM_ENV_PHP_VERSION" ]]; then
            echo "Switching PHP to ${KODIZM_ENV_PHP_VERSION}..."
            update-alternatives --set php "/usr/bin/php${KODIZM_ENV_PHP_VERSION}" 2>/dev/null || true
            update-alternatives --set phpize "/usr/bin/phpize${KODIZM_ENV_PHP_VERSION}" 2>/dev/null || true
            update-alternatives --set php-config "/usr/bin/php-config${KODIZM_ENV_PHP_VERSION}" 2>/dev/null || true
        fi
    fi

    # Fix workspace ownership for bind mounts (host files are often root-owned)
    if [ -d /workspace ]; then
        chown -R agent:agent /workspace 2>/dev/null || true
    fi

    # Ensure task-workspaces directory exists (pipeline workspace isolation)
    mkdir -p /task-workspaces
    chown agent:agent /task-workspaces

    # Re-exec as agent user
    exec gosu agent "$0" "$@"
fi

# Phase 2: Agent — language setup + exec command
source /etc/profile 2>/dev/null || true

# Sync image-baked defaults into the volume-mounted ~/.claude directory.
# The Docker volume at /home/agent/.claude shadows the image layer, so
# skills, settings, and plugin registry must be synced from /opt/kodizm/defaults/.
# CC's seed mechanism (CLAUDE_CODE_PLUGIN_SEED_DIR) only works in REPL mode,
# so we write known_marketplaces.json directly for one-shot/proxy compatibility.
if [ -d /opt/kodizm/defaults ]; then
    mkdir -p /home/agent/.claude/skills
    mkdir -p /home/agent/.claude/plugins
    cp -a /opt/kodizm/defaults/skills/* /home/agent/.claude/skills/ 2>/dev/null || true
    # Write plugin registry and installed state. CC requires both files:
    # - known_marketplaces.json: marketplace registry (installLocation → seed dir)
    # - installed_plugins.json: per-plugin installation record (installPath → plugin dir)
    # Without installed_plugins.json, CC considers plugins uninstalled.
    cp /opt/kodizm/defaults/plugins/known_marketplaces.json /home/agent/.claude/plugins/known_marketplaces.json 2>/dev/null || true
    cp /opt/kodizm/defaults/plugins/installed_plugins.json /home/agent/.claude/plugins/installed_plugins.json 2>/dev/null || true
    # Populate plugin cache — CC reads manifests from
    # ~/.claude/plugins/cache/{marketplace}/{plugin}/{version}/
    if [ -d /opt/kodizm/defaults/plugins/marketplaces/kodizm-lsp/plugins ]; then
        for plugdir in /opt/kodizm/defaults/plugins/marketplaces/kodizm-lsp/plugins/*/; do
            name=$(basename "$plugdir")
            dest="/home/agent/.claude/plugins/cache/kodizm-lsp/$name/0.1.0"
            mkdir -p "$dest"
            cp -a "$plugdir"* "$dest/" 2>/dev/null || true
            cp -a "$plugdir".claude-plugin "$dest/.claude-plugin" 2>/dev/null || true
        done
    fi
    # Ensure enabledPlugins from defaults are present in settings.json.
    # Bootstrap may have already written settings.json — merge, don't overwrite.
    if [ ! -f /home/agent/.claude/settings.json ]; then
        cp /opt/kodizm/defaults/settings.json /home/agent/.claude/settings.json
    else
        python3 -c "
import json
with open('/opt/kodizm/defaults/settings.json') as f:
    defaults = json.load(f)
with open('/home/agent/.claude/settings.json') as f:
    current = json.load(f)
# enabledPlugins is a Record<string, boolean|string[]> — merge as dict
dp = defaults.get('enabledPlugins', {})
cp = current.get('enabledPlugins', {})
# Handle legacy array format
if isinstance(cp, list):
    cp = {p: True for p in cp}
if isinstance(dp, list):
    dp = {p: True for p in dp}
merged = {**cp, **dp}
current['enabledPlugins'] = merged
env = current.setdefault('env', {})
env['FORCE_AUTOUPDATE_PLUGINS'] = 'false'
with open('/home/agent/.claude/settings.json', 'w') as f:
    json.dump(current, f, indent=2)
" 2>/dev/null || true
    fi
fi

# Ensure rust-analyzer is installed (may be missing if Docker layer was cached)
if command -v rustup &>/dev/null && ! rustup component list --installed 2>/dev/null | grep -q rust-analyzer; then
    rustup component add rust-analyzer 2>/dev/null || true
fi

# Mark workspace as safe for git (bind mounts have different ownership)
git config --global --add safe.directory /workspace 2>/dev/null || true

/opt/kodizm/setup.sh || echo "Warning: setup.sh exited with errors — continuing anyway"
echo "Environment ready."
exec "$@"
