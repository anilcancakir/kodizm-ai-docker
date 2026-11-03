# kodizm-ai-docker

The agent image Kodizm runs for every project container: Debian 13 with Claude Code, opencode and the `kodizm-acp` bridge, PHP 8.3 and 8.5, Node 24, Python 3.13, Go, Flutter and Dart, PostgreSQL 17 with pgvector, and the LSP servers the `ac-lsp` plugin launches.

```bash
docker pull ghcr.io/anilcancakir/kodizm-ai-docker:latest
```

## Build and test

```bash
make docker-build        # docker build -t kodizm-agent:dev .
make docker-lint         # hadolint
make docker-test-static  # container-structure-test against tests/structure-test.yaml
make docker-test-smoke   # scripts/smoke.sh inside the image: pinned versions, bridge handshake, kodizm-pg, PHP extensions
make docker-test-lsp     # scripts/lsp-probe.mjs: every ac-lsp server answers documentSymbol on tests/fixtures
make docker-all          # all of the above
```

`IMAGE_TAG` overrides the tag. `scripts/real-call-smoke.sh` makes one paid call through the image's `claude` and needs `ANTHROPIC_API_KEY`. The test scripts are mounted at test time, never copied into the image.

## Versions

Every tool is pinned to an exact version in a `<TOOL>_VERSION` build arg, and the base image by digest. The `# renovate:` comment above each arg tells Renovate where to look; Renovate opens a pull request per bump. There is no scheduled rebuild that pulls whatever is newest.

The Claude Code CLI has no arg of its own. The image reads the bridge's exact SDK pin (`config.claudeAgentSdk` in the `@kodizm/acp` package), takes the `claude` binary from that SDK version's `linux-x64` platform package, and fails the build unless its checksum matches the official release manifest. Bumping `KODIZM_ACP_VERSION` therefore moves the CLI too.

## Contract with Laravel

- User `agent`, uid and gid 1001, `HOME=/home/agent`. Every tool the agent may update (Node, bun, Go, Flutter, LSP servers, opencode, the bridge) is owned by `agent` from the layer that installs it.
- Laravel overrides the entrypoint with `["tini", "--"]` and the command with `["sleep", "infinity"]`, and runs everything through `docker exec --user agent`. The image starts no service.
- Named volumes mount `/workspace`, `/home/agent/.claude`, `/home/agent/.config/opencode` and `/var/log/kodizm-debug`. They exist in the image as empty agent-owned directories; Claude Code and opencode config is written by Laravel at boot, never baked.
- `/usr/local/bin/claude` is the binary the bridge launches by default. `kodizm-acp`, `opencode` and `kodizm-pg` are on `PATH`.
- `kodizm-pg start|stop|status` runs PostgreSQL 17 as `agent` with its data in `~/.local/share/kodizm-pg`, role and database `agent`. Laravel runs `kodizm-pg start` on every boot of a persistent container; `PGHOST`, `PGUSER` and `PGDATABASE` let a bare `psql` connect.
- `/opt/kodizm/plugins/ac-lsp` is the LSP plugin passed to Claude Code; `/opt/kodizm/opencode.lsp.json` is the same servers in opencode's format, loaded through `OPENCODE_CONFIG`.
- `/opt/kodizm/versions.json` records the installed `claude`, `opencode`, `kodizm_acp`, `claude_agent_sdk`, `php` and `node` versions, read from the binaries at build time.
