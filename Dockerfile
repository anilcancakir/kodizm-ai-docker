# syntax=docker/dockerfile:1.28.0@sha256:bb22d9815c728170f72750f4e5b0d672e06176142e1d602c7e66c050100b7e5b

# Kodizm agent image: one Debian 13 image for every project container.
#
# Laravel starts it with entrypoint ["tini", "--"] and cmd ["sleep", "infinity"] and drives it
# over `docker exec --user agent`, so nothing here starts a service. Named volumes mount
# /workspace, /home/agent/.claude, /home/agent/.config/opencode and /var/log/kodizm-debug, and
# Docker copies image content only into an EMPTY volume: anything baked under those paths would
# go stale in a warm volume, so they exist here as empty agent-owned directories only.
#
# Tools the agent may update or extend at runtime (node, bun, go, flutter, LSP servers, opencode,
# the bridge) are installed by the agent user itself, so they are agent-owned from the layer that
# creates them. A recursive chown over /opt once doubled the image (a 5.59 GB layer).
#
# Every version below is exact and bumped by Renovate through its `# renovate:` comment.

# renovate: datasource=docker depName=debian
FROM debian:13-slim@sha256:f6b08b09a05725f9431502d3b5714f5c4576e82c1a84fa1debe0c24a7e0c3ec4 AS toolchain

# Declared before SHELL: hadolint lints every RUN after a later ARG or ENV as POSIX sh.
ARG DEBIAN_FRONTEND=noninteractive
ENV LANG=C.UTF-8

SHELL ["/bin/bash", "-o", "pipefail", "-e", "-u", "-c"]

# ---------------------------------------------------------------------------
# Root: the agent user, then system packages
# ---------------------------------------------------------------------------

# The volume mountpoints are created here so the first copy-up gives the volume agent ownership.
RUN groupadd --gid 1001 agent \
 && useradd --uid 1001 --gid 1001 --create-home --shell /bin/bash agent \
 && install -d -o agent -g agent -m 0755 \
      /opt/node \
      /opt/bun \
      /opt/go \
      /opt/flutter \
      /opt/kodizm \
      /opt/kodizm/plugins \
      /workspace \
      /var/log/kodizm-debug \
      /home/agent/.claude \
      /home/agent/.config \
      /home/agent/.config/opencode

# Downloaded packages stay in the cache mount instead of the image; docker-clean would delete them.
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    rm -f /etc/apt/apt.conf.d/docker-clean \
 && echo 'Binary::apt::APT::Keep-Downloaded-Packages "true";' > /etc/apt/apt.conf.d/keep-cache \
 && apt-get update \
 && apt-get install -y --no-install-recommends \
      ca-certificates \
      curl \
      git \
      jq \
      openssh-client \
      procps \
      python3 \
      python3-venv \
      ripgrep \
      tini \
      unzip \
      xz-utils

# PHP 8.3 and 8.5 from sury; Laravel resolves /usr/bin/php8.3 and /usr/bin/php8.5, bare php is 8.5.
# ctype, fileinfo and tokenizer ship in phpX.Y-common, pcntl and openssl in phpX.Y-cli.
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    curl -fsSLo /tmp/debsuryorg-archive-keyring.deb https://packages.sury.org/debsuryorg-archive-keyring.deb \
 && dpkg -i /tmp/debsuryorg-archive-keyring.deb \
 && rm /tmp/debsuryorg-archive-keyring.deb \
 && echo 'deb [signed-by=/usr/share/keyrings/deb.sury.org-php.gpg] https://packages.sury.org/php/ trixie main' \
      > /etc/apt/sources.list.d/sury-php.list \
 && apt-get update \
 && packages=() \
 && for version in 8.3 8.5; do \
      for extension in cli bcmath curl gd imagick intl ldap mbstring mongodb mysql pgsql redis soap sqlite3 \
          swoole xml zip; do \
        packages+=("php${version}-${extension}"); \
      done; \
    done \
 && apt-get install -y --no-install-recommends "${packages[@]}" \
 && update-alternatives --set php /usr/bin/php8.5

# PostgreSQL 17 and pgvector from PGDG. The package's default cluster is suppressed: the agent
# runs its own through kodizm-pg, never at image boot.
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    keyring=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc \
 && install -d "${keyring%/*}" \
 && curl -fsSLo "${keyring}" https://www.postgresql.org/media/keys/ACCC4CF8.asc \
 && echo "deb [signed-by=${keyring}] https://apt.postgresql.org/pub/repos/apt trixie-pgdg main" \
      > /etc/apt/sources.list.d/pgdg.list \
 && apt-get update \
 && apt-get install -y --no-install-recommends postgresql-common \
 && sed -ri 's/#(create_main_cluster) .*$/\1 = false/' /etc/postgresql-common/createcluster.conf \
 && apt-get install -y --no-install-recommends postgresql-17 postgresql-17-pgvector

# renovate: datasource=github-releases depName=composer/composer
ARG COMPOSER_VERSION=2.11.1
RUN base="https://getcomposer.org/download/${COMPOSER_VERSION}" \
 && curl -fsSLo /tmp/composer.phar "${base}/composer.phar" \
 && expected="$(curl -fsSL "${base}/composer.phar.sha256sum")" \
 && echo "${expected%% *}  /tmp/composer.phar" | sha256sum -c - \
 && install -m 0755 /tmp/composer.phar /usr/local/bin/composer \
 && rm /tmp/composer.phar

# renovate: datasource=github-releases depName=astral-sh/uv
ARG UV_VERSION=0.13.7
RUN tarball=uv-x86_64-unknown-linux-gnu.tar.gz \
 && base="https://github.com/astral-sh/uv/releases/download/${UV_VERSION}" \
 && curl -fsSLo "/tmp/${tarball}" "${base}/${tarball}" \
 && expected="$(curl -fsSL "${base}/${tarball}.sha256")" \
 && echo "${expected%% *}  /tmp/${tarball}" | sha256sum -c - \
 && tar -xzf "/tmp/${tarball}" --strip-components=1 -C /usr/local/bin \
      uv-x86_64-unknown-linux-gnu/uv \
      uv-x86_64-unknown-linux-gnu/uvx \
 && rm "/tmp/${tarball}"

# ---------------------------------------------------------------------------
# Agent: runtimes and tools, owned by the user that runs them
# ---------------------------------------------------------------------------

USER agent
WORKDIR /home/agent

# /usr/local/bin comes first so claude and kodizm-pg cannot be shadowed by a user-space install.
# PGHOST is kodizm-pg's socket directory, so a bare `psql` reaches the agent database.
# The CLIs are pinned, so their self-updaters stay off.
ENV HOME=/home/agent \
    PATH=/usr/local/sbin:/usr/local/bin:/opt/node/bin:/opt/bun/bin:/opt/go/bin:/home/agent/go/bin:/opt/flutter/bin:/home/agent/.local/bin:/usr/sbin:/usr/bin:/sbin:/bin \
    BUN_INSTALL=/opt/bun \
    PGHOST=/home/agent/.local/share/kodizm-pg/run \
    PGUSER=agent \
    PGDATABASE=agent \
    DISABLE_AUTOUPDATER=1 \
    OPENCODE_DISABLE_AUTOUPDATE=true

# renovate: datasource=github-releases depName=nodejs/node extractVersion=^v(?<version>.+)$
ARG NODE_VERSION=24.22.2
RUN tarball="node-v${NODE_VERSION}-linux-x64.tar.xz" \
 && base="https://nodejs.org/dist/v${NODE_VERSION}" \
 && curl -fsSLo "/tmp/${tarball}" "${base}/${tarball}" \
 && expected="$(curl -fsSL "${base}/SHASUMS256.txt" | grep " ${tarball}\$")" \
 && echo "${expected%% *}  /tmp/${tarball}" | sha256sum -c - \
 && tar -xJf "/tmp/${tarball}" --strip-components=1 -C /opt/node \
 && rm "/tmp/${tarball}"

# The bridge runs under bun (its bin is built with --target=bun).
# renovate: datasource=github-releases depName=oven-sh/bun extractVersion=^bun-v(?<version>.+)$
ARG BUN_VERSION=1.4.4
RUN base="https://github.com/oven-sh/bun/releases/download/bun-v${BUN_VERSION}" \
 && curl -fsSLo /tmp/bun-linux-x64.zip "${base}/bun-linux-x64.zip" \
 && expected="$(curl -fsSL "${base}/SHASUMS256.txt" | grep ' bun-linux-x64.zip$')" \
 && echo "${expected%% *}  /tmp/bun-linux-x64.zip" | sha256sum -c - \
 && unzip -q -j /tmp/bun-linux-x64.zip bun-linux-x64/bun -d /opt/bun/bin \
 && chmod 0755 /opt/bun/bin/bun \
 && ln -s bun /opt/bun/bin/bunx \
 && rm /tmp/bun-linux-x64.zip

# renovate: datasource=golang-version depName=go
ARG GO_VERSION=1.27.3
RUN tarball="go${GO_VERSION}.linux-amd64.tar.gz" \
 && curl -fsSLo "/tmp/${tarball}" "https://go.dev/dl/${tarball}" \
 && expected="$(curl -fsSL 'https://go.dev/dl/?mode=json&include=all' \
      | jq -er --arg file "${tarball}" '.[].files[] | select(.filename == $file) | .sha256')" \
 && echo "${expected}  /tmp/${tarball}" | sha256sum -c - \
 && tar -xzf "/tmp/${tarball}" --strip-components=1 -C /opt/go \
 && rm "/tmp/${tarball}"

# Flutter is the largest piece, so the clone and the artifact download are separate layers.
# renovate: datasource=github-tags depName=flutter/flutter versioning=regex:^(?<major>\d+)\.(?<minor>\d+)\.(?<patch>\d+)$
ARG FLUTTER_VERSION=3.47.9
RUN git clone --depth 1 --branch "${FLUTTER_VERSION}" https://github.com/flutter/flutter.git /opt/flutter

# Only what `flutter analyze` and `flutter test` need: the Dart SDK and the host test engine.
RUN flutter config --no-analytics --no-cli-animations \
 && dart --disable-analytics \
 && flutter precache --universal --no-android --no-ios --no-web --no-linux --no-windows --no-macos --no-fuchsia \
 && flutter --version

# Language servers the ac-lsp plugin launches (Dart's ships with Flutter).
# typescript-language-server resolves the global typescript as its sibling under /opt/node.
# renovate: datasource=npm depName=intelephense
ARG INTELEPHENSE_VERSION=1.18.5
# renovate: datasource=npm depName=typescript
ARG TYPESCRIPT_VERSION=6.0.3
# renovate: datasource=npm depName=typescript-language-server
ARG TYPESCRIPT_LANGUAGE_SERVER_VERSION=6.0.3
# renovate: datasource=pypi depName=pyrefly
ARG PYREFLY_VERSION=1.4.0
# renovate: datasource=go depName=golang.org/x/tools/gopls extractVersion=^v(?<version>.+)$
ARG GOPLS_VERSION=0.24.0
RUN npm_config_cache=/tmp/npm-cache npm install --global --no-fund --no-audit \
      "intelephense@${INTELEPHENSE_VERSION}" \
      "typescript@${TYPESCRIPT_VERSION}" \
      "typescript-language-server@${TYPESCRIPT_LANGUAGE_SERVER_VERSION}" \
 && rm -rf /tmp/npm-cache \
 && UV_CACHE_DIR=/tmp/uv-cache UV_PYTHON_DOWNLOADS=never \
      uv tool install --python /usr/bin/python3.13 "pyrefly==${PYREFLY_VERSION}" \
 && rm -rf /tmp/uv-cache \
 && export GOCACHE=/tmp/go-cache GOMODCACHE=/tmp/go-mod \
 && go install "golang.org/x/tools/gopls@v${GOPLS_VERSION}" \
 && go clean -cache -modcache

# corepack ships with Node 24; pnpm is pinned through npm so its version is never resolved at runtime.
# renovate: datasource=npm depName=pnpm
ARG PNPM_VERSION=12.16.1
# renovate: datasource=npm depName=opencode-ai
ARG OPENCODE_VERSION=1.19.5
RUN npm_config_cache=/tmp/npm-cache npm install --global --no-fund --no-audit \
      "pnpm@${PNPM_VERSION}" \
      "opencode-ai@${OPENCODE_VERSION}" \
 && rm -rf /tmp/npm-cache

# ac-lsp at an exact commit; only its plugin directory is extracted. The opencode config is derived
# from the same .lsp.json so both CLIs launch identical servers.
COPY --chown=agent:agent scripts/gen-opencode-lsp.mjs /opt/kodizm/lib/gen-opencode-lsp.mjs
# renovate: datasource=git-refs depName=https://github.com/anilcancakir/claude-code currentValue=main
ARG AC_LSP_VERSION=bb8ea3cdc17fae83f754d060499a7fe96dd1c3b3
RUN mkdir /opt/kodizm/plugins/ac-lsp \
 && curl -fsSL "https://codeload.github.com/anilcancakir/claude-code/tar.gz/${AC_LSP_VERSION}" \
      | tar -xz --strip-components=3 -C /opt/kodizm/plugins/ac-lsp "claude-code-${AC_LSP_VERSION}/plugins/ac-lsp" \
 && test -f /opt/kodizm/plugins/ac-lsp/.lsp.json \
 && test -f /opt/kodizm/plugins/ac-lsp/bin/lsp-proxy.js \
 && node /opt/kodizm/lib/gen-opencode-lsp.mjs \
      /opt/kodizm/plugins/ac-lsp/.lsp.json \
      /opt/kodizm/opencode.lsp.json \
      /opt/kodizm/plugins/ac-lsp

# The bridge ships often, so it sits last; it carries its exact SDK pin in config.claudeAgentSdk.
# renovate: datasource=npm depName=@kodizm/acp
ARG KODIZM_ACP_VERSION=0.7.0
RUN npm_config_cache=/tmp/npm-cache npm install --global --no-fund --no-audit --omit=optional \
      "@kodizm/acp@${KODIZM_ACP_VERSION}" \
 && rm -rf /tmp/npm-cache

# ---------------------------------------------------------------------------
# Claude Code: the CLI from the SDK platform package the bridge is built against
# ---------------------------------------------------------------------------

# A separate stage, so the binary lands root-owned in /usr/local/bin through COPY while every
# install above stays with the agent. The build fails unless the binary matches the official
# release manifest for the CLI version that SDK bundles, and reports that version itself.
FROM toolchain AS claude-cli

# Inherited from toolchain already; restated because hadolint reads SHELL per stage.
SHELL ["/bin/bash", "-o", "pipefail", "-e", "-u", "-c"]

RUN sdk_version="$(jq -r '.config.claudeAgentSdk // empty' /opt/node/lib/node_modules/@kodizm/acp/package.json)" \
 && : "${sdk_version:?the installed @kodizm/acp has no config.claudeAgentSdk}" \
 && cli_version="$(npm view "@anthropic-ai/claude-agent-sdk@${sdk_version}" claudeCodeVersion)" \
 && : "${cli_version:?@anthropic-ai/claude-agent-sdk@${sdk_version} names no claudeCodeVersion}" \
 && workdir="$(mktemp -d)" \
 && tarball="$(npm_config_cache="${workdir}/npm-cache" npm pack --silent --pack-destination "${workdir}" \
      "@anthropic-ai/claude-agent-sdk-linux-x64@${sdk_version}")" \
 && tar -xzf "${workdir}/${tarball}" -C "${workdir}" package/claude \
 && expected="$(curl -fsSL "https://downloads.claude.ai/claude-code-releases/${cli_version}/manifest.json" \
      | jq -er '.platforms["linux-x64"].checksum')" \
 && echo "${expected}  ${workdir}/package/claude" | sha256sum -c - \
 && install -D -m 0755 "${workdir}/package/claude" /tmp/claude-cli/claude \
 && reported="$(HOME="${workdir}" /tmp/claude-cli/claude --version)" \
 && if [[ "${reported%% *}" != "${cli_version}" ]]; then \
      echo "claude reports ${reported}, SDK ${sdk_version} bundles ${cli_version}" >&2; \
      exit 1; \
    fi

# ---------------------------------------------------------------------------
# Final image
# ---------------------------------------------------------------------------

FROM toolchain

COPY --from=claude-cli --chown=root:root --chmod=0755 /tmp/claude-cli/claude /usr/local/bin/claude
COPY --chown=root:root --chmod=0755 scripts/kodizm-pg /usr/local/bin/kodizm-pg

# Recorded from the installed binaries, so the manifest cannot drift from what the image runs.
# The version probes get a throwaway HOME: ~/.claude is a volume mountpoint and must stay empty.
RUN probe_home="$(mktemp -d)" \
 && claude_version="$(HOME="${probe_home}" claude --version)" \
 && opencode_version="$(HOME="${probe_home}" opencode --version)" \
 && rm -rf "${probe_home}" \
 && acp_package=/opt/node/lib/node_modules/@kodizm/acp/package.json \
 && kodizm_acp_version="$(jq -er .version "${acp_package}")" \
 && claude_agent_sdk_version="$(jq -er .config.claudeAgentSdk "${acp_package}")" \
 && php_version="$(php -r 'echo PHP_MAJOR_VERSION, ".", PHP_MINOR_VERSION;')" \
 && node_version="$(node -p 'process.versions.node.split(".")[0]')" \
 && jq -n \
      --arg claude "${claude_version%% *}" \
      --arg opencode "${opencode_version}" \
      --arg kodizm_acp "${kodizm_acp_version}" \
      --arg claude_agent_sdk "${claude_agent_sdk_version}" \
      --arg php "${php_version}" \
      --arg node "${node_version}" \
      '$ARGS.named' \
      > /opt/kodizm/versions.json \
 && jq -e 'all(.[]; test("^[0-9]+(\\.[0-9]+)*$"))' /opt/kodizm/versions.json \
 && cat /opt/kodizm/versions.json

LABEL org.opencontainers.image.title="kodizm-ai-docker" \
      org.opencontainers.image.description="Kodizm agent image: Claude Code, opencode, kodizm-acp and toolchains" \
      org.opencontainers.image.source="https://github.com/anilcancakir/kodizm-ai-docker"

WORKDIR /workspace

ENTRYPOINT ["tini", "--"]
CMD ["sleep", "infinity"]
