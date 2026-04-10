# =============================================================================
# kodizm/agent-universal — Single universal agent image for all Kodizm tasks
# Inspired by OpenAI codex-universal. Supports 9 language runtimes + CLI tools.
#
# Build:  docker build -t kodizm/agent-universal:latest -f docker/Dockerfile docker/
# =============================================================================

FROM ubuntu:24.04 AS base

LABEL maintainer="kodizm" \
      description="Universal agent image — 9 languages, Claude Code CLI, OpenCode CLI"

SHELL ["/bin/bash", "-c"]

# ---------------------------------------------------------------------------
# ARGs — pin every version so builds are reproducible and overridable
# ---------------------------------------------------------------------------

# Python (pyenv)
ARG PYTHON_313=3.13.3
ARG PYTHON_312=3.12.10
ARG PYTHON_311=3.11.12
ARG PYTHON_310=3.10.17
ARG PYTHON_DEFAULT=3.13.3

# Node.js (nvm)
ARG NODE_22=22.16.0
ARG NODE_20=20.19.1
ARG NODE_18=18.20.8
ARG NODE_DEFAULT=22.16.0
ARG NVM_VERSION=0.40.3

# Bun
ARG BUN_VERSION=latest

# Rust (rustup)
ARG RUST_187=1.87.0
ARG RUST_186=1.86.0
ARG RUST_185=1.85.1
ARG RUST_DEFAULT=1.87.0

# Go (mise)
ARG GO_124=1.24.3
ARG GO_123=1.23.8
ARG GO_122=1.22.12
ARG GO_DEFAULT=1.24.3

# Ruby (mise)
ARG RUBY_34=3.4.4
ARG RUBY_33=3.3.8
ARG RUBY_DEFAULT=3.4.4

# PHP (ondrej/php PPA)
ARG PHP_DEFAULT=8.4

# Java (mise)
ARG JAVA_24=24
ARG JAVA_21=21
ARG JAVA_17=17
ARG JAVA_DEFAULT=24

# Flutter
ARG FLUTTER_CHANNEL=stable

# mise
ARG MISE_VERSION=latest

# ---------------------------------------------------------------------------
# ENV — foundational paths set once, extended per runtime below
# ---------------------------------------------------------------------------
ENV DEBIAN_FRONTEND=noninteractive \
    LANG=en_US.UTF-8 \
    LC_ALL=en_US.UTF-8 \
    TZ=UTC

# ---------------------------------------------------------------------------
# Stage 1: System dependencies
# ---------------------------------------------------------------------------
RUN --mount=type=cache,target=/var/cache/apt,sharing=locked \
    --mount=type=cache,target=/var/lib/apt/lists,sharing=locked \
    set -euo pipefail && \
    apt-get update && \
    apt-get install -y --no-install-recommends \
        locales \
        git \
        curl \
        ca-certificates \
        build-essential \
        ripgrep \
        jq \
        unzip \
        xz-utils \
        wget \
        openssh-client \
        pkg-config \
        sqlite3 \
        libssl-dev \
        zlib1g-dev \
        libreadline-dev \
        libffi-dev \
        libbz2-dev \
        liblzma-dev \
        libncurses-dev \
        libsqlite3-dev \
        libxml2-dev \
        libcurl4-openssl-dev \
        libpq-dev \
        make \
        software-properties-common \
        gosu \
        tini \
        lsb-release \
        # Ruby deps
        libyaml-dev \
        # PHP deps
        autoconf \
        bison \
        re2c \
        libgd-dev \
        libedit-dev \
        libicu-dev \
        libjpeg-dev \
        libonig-dev \
        libpng-dev \
        libzip-dev \
        libtidy-dev \
        libxslt1-dev \
    && \
    locale-gen en_US.UTF-8 && \
    rm -rf /tmp/*

# ---------------------------------------------------------------------------
# Stage 1b: Repository setup — ondrej/php PPA + PostgreSQL PGDG + TimescaleDB
# ---------------------------------------------------------------------------
RUN set -euo pipefail && \
    add-apt-repository -y ppa:ondrej/php && \
    install -d /usr/share/postgresql-common/pgdg && \
    curl -fsSL https://www.postgresql.org/media/keys/ACCC4CF8.asc \
      -o /usr/share/postgresql-common/pgdg/apt.postgresql.org.asc && \
    echo "deb [signed-by=/usr/share/postgresql-common/pgdg/apt.postgresql.org.asc] \
      https://apt.postgresql.org/pub/repos/apt noble-pgdg main" \
      > /etc/apt/sources.list.d/pgdg.list && \
    curl -fsSL https://packagecloud.io/timescale/timescaledb/gpgkey \
      | gpg --dearmor -o /usr/share/keyrings/timescaledb.gpg && \
    echo "deb [signed-by=/usr/share/keyrings/timescaledb.gpg] \
      https://packagecloud.io/timescale/timescaledb/ubuntu/ noble main" \
      > /etc/apt/sources.list.d/timescaledb.list && \
    apt-get update

# ---------------------------------------------------------------------------
# Stage 2: Python via pyenv
# ---------------------------------------------------------------------------
ENV PYENV_ROOT=/opt/pyenv
ENV PATH="${PYENV_ROOT}/shims:${PYENV_ROOT}/bin:${PATH}"

RUN set -euo pipefail && \
    curl -fsSL https://pyenv.run | bash && \
    # Install Python versions
    pyenv install ${PYTHON_313} && \
    pyenv install ${PYTHON_312} && \
    pyenv install ${PYTHON_311} && \
    pyenv install ${PYTHON_310} && \
    pyenv global ${PYTHON_DEFAULT} && \
    pyenv rehash && \
    # Upgrade pip + install dev tools for each version
    for ver in ${PYTHON_313} ${PYTHON_312} ${PYTHON_311} ${PYTHON_310}; do \
        PYENV_VERSION=${ver} pip install --no-cache-dir --upgrade pip && \
        PYENV_VERSION=${ver} pip install --no-cache-dir ruff mypy pytest; \
    done && \
    pyenv global ${PYTHON_DEFAULT} && \
    # Install pipx, poetry, uv globally under default Python
    pip install --no-cache-dir pipx && \
    pipx ensurepath && \
    pipx install poetry && \
    pipx install uv && \
    rm -rf /tmp/*

# ---------------------------------------------------------------------------
# Stage 3: Node.js via nvm
# ---------------------------------------------------------------------------
ENV NVM_DIR=/opt/nvm
ENV PATH="${NVM_DIR}/versions/node/v${NODE_DEFAULT}/bin:${PATH}"

RUN set -euo pipefail && \
    mkdir -p ${NVM_DIR} && \
    curl -fsSL "https://raw.githubusercontent.com/nvm-sh/nvm/v${NVM_VERSION}/install.sh" | bash && \
    # Source nvm for this RUN layer
    source "${NVM_DIR}/nvm.sh" && \
    # Default packages installed with every node version
    echo "prettier" > "${NVM_DIR}/default-packages" && \
    echo "eslint" >> "${NVM_DIR}/default-packages" && \
    echo "typescript" >> "${NVM_DIR}/default-packages" && \
    # Install Node versions
    nvm install ${NODE_22} && \
    nvm install ${NODE_20} && \
    nvm install ${NODE_18} && \
    nvm alias default ${NODE_DEFAULT} && \
    nvm use default && \
    # Install pnpm for each version
    for ver in ${NODE_22} ${NODE_20} ${NODE_18}; do \
        nvm use ${ver} && \
        npm install -g pnpm yarn; \
    done && \
    nvm use default && \
    rm -rf /tmp/*

# ---------------------------------------------------------------------------
# Stage 4: Bun
# ---------------------------------------------------------------------------
ENV BUN_INSTALL=/opt/bun
ENV PATH="${BUN_INSTALL}/bin:${PATH}"

RUN set -euo pipefail && \
    curl -fsSL https://bun.sh/install | BUN_INSTALL=${BUN_INSTALL} bash && \
    bun --version && \
    rm -rf /tmp/*

# ---------------------------------------------------------------------------
# Stage 5: Rust via rustup
# ---------------------------------------------------------------------------
ENV RUSTUP_HOME=/opt/rustup
ENV CARGO_HOME=/opt/cargo
ENV PATH="${CARGO_HOME}/bin:${PATH}"

RUN set -euo pipefail && \
    curl -fsSL https://sh.rustup.rs | sh -s -- \
        -y \
        --default-toolchain ${RUST_DEFAULT} \
        --no-modify-path && \
    rustup toolchain install ${RUST_187} && \
    rustup toolchain install ${RUST_186} && \
    rustup toolchain install ${RUST_185} && \
    rustup default ${RUST_DEFAULT} && \
    rustup component add rustfmt clippy rust-analyzer && \
    rm -rf /tmp/*

# ---------------------------------------------------------------------------
# Stage 6: mise (used for Go, Ruby, Java)
# ---------------------------------------------------------------------------
ENV MISE_DATA_DIR=/opt/mise
ENV MISE_CACHE_DIR=/opt/mise/cache
ENV PATH="${MISE_DATA_DIR}/shims:${PATH}"

RUN set -euo pipefail && \
    MISE_VERSION=$(curl -fsSL "https://api.github.com/repos/jdx/mise/releases/latest" | \
      grep '"tag_name"' | sed 's/.*"tag_name": *"//;s/".*//' ) && \
    curl -fsSL "https://github.com/jdx/mise/releases/download/${MISE_VERSION}/mise-${MISE_VERSION}-linux-x64.tar.gz" \
      -o /tmp/mise.tar.gz && \
    tar -xzf /tmp/mise.tar.gz -C /tmp && \
    install -m 755 /tmp/mise/bin/mise /usr/local/bin/mise && \
    mise --version && \
    rm -rf /tmp/*

# ---------------------------------------------------------------------------
# Stage 7: Go via mise
# ---------------------------------------------------------------------------
RUN set -euo pipefail && \
    mise use --global go@${GO_124} && \
    mise use --global go@${GO_123} && \
    mise use --global go@${GO_122} && \
    mise use --global go@${GO_DEFAULT} && \
    mise reshim && \
    # Install golangci-lint
    go install github.com/golangci/golangci-lint/cmd/golangci-lint@latest && \
    rm -rf /tmp/*

# ---------------------------------------------------------------------------
# Stage 8: Ruby via mise
# ---------------------------------------------------------------------------
RUN set -euo pipefail && \
    mise use --global ruby@${RUBY_34} && \
    mise use --global ruby@${RUBY_33} && \
    mise use --global ruby@${RUBY_DEFAULT} && \
    mise reshim && \
    rm -rf /tmp/*

# ---------------------------------------------------------------------------
# Stage 9: PHP via ondrej/php PPA (6 versions: php7.4 through php8.4)
# ---------------------------------------------------------------------------
RUN set -euo pipefail && \
    EXTENSIONS="bcmath bz2 curl dev exif gd gmp igbinary imagick imap intl \
      ldap mbstring memcached msgpack mysql opcache pcov pgsql readline \
      redis soap sqlite3 tidy xml xsl yaml zip xdebug apcu" && \
    for ver in 7.4 8.0 8.1 8.2 8.3 8.4; do \
      echo "Installing PHP ${ver} + extensions..." && \
      pkg_list="php${ver}-cli" && \
      for ext in ${EXTENSIONS}; do \
        pkg_list="${pkg_list} php${ver}-${ext}"; \
      done && \
      apt-get install -y --no-install-recommends ${pkg_list} || true; \
    done && \
    for ver in 8.2 8.3 8.4; do \
      apt-get install -y --no-install-recommends php${ver}-swoole 2>/dev/null || true; \
    done && \
    update-alternatives --set php /usr/bin/php${PHP_DEFAULT} && \
    update-alternatives --set phpize /usr/bin/phpize${PHP_DEFAULT} 2>/dev/null || true && \
    update-alternatives --set php-config /usr/bin/php-config${PHP_DEFAULT} 2>/dev/null || true && \
    curl -fsSL https://getcomposer.org/installer | php -- \
      --install-dir=/usr/local/bin --filename=composer && \
    apt-get clean && rm -rf /var/lib/apt/lists/* /tmp/*

# ---------------------------------------------------------------------------
# Stage 9b: PostgreSQL 17 + extensions
# ---------------------------------------------------------------------------
RUN set -euo pipefail && \
    apt-get update && \
    apt-get install -y --no-install-recommends \
      postgresql-17 postgresql-17-pgvector postgresql-17-postgis-3 \
      postgresql-17-cron timescaledb-2-postgresql-17 && \
    for ver in 14 15 16; do \
      apt-get install -y --no-install-recommends \
        postgresql-client-${ver} postgresql-server-dev-${ver}; \
    done && \
    echo "local all all trust" > /etc/postgresql/17/main/pg_hba.conf && \
    echo "host all all 127.0.0.1/32 trust" >> /etc/postgresql/17/main/pg_hba.conf && \
    echo "host all all ::1/128 trust" >> /etc/postgresql/17/main/pg_hba.conf && \
    su postgres -c "pg_ctlcluster 17 main start" && \
    su postgres -c "createuser -s agent" && \
    su postgres -c "createdb agent" && \
    su postgres -c "pg_ctlcluster 17 main stop" && \
    apt-get clean && rm -rf /var/lib/apt/lists/* /tmp/*

# ---------------------------------------------------------------------------
# Stage 9c: MySQL client + SQLite + Redis
# ---------------------------------------------------------------------------
RUN set -euo pipefail && \
    apt-get update && \
    apt-get install -y --no-install-recommends \
      mysql-client libmysqlclient-dev sqlite3 libsqlite3-dev \
      redis-server redis-tools && \
    sed -i 's/^bind .*/bind 127.0.0.1/' /etc/redis/redis.conf && \
    sed -i 's/^daemonize .*/daemonize no/' /etc/redis/redis.conf && \
    apt-get clean && rm -rf /var/lib/apt/lists/* /tmp/*

# ---------------------------------------------------------------------------
# Stage 10: Java via mise + build tools
# ---------------------------------------------------------------------------
RUN --mount=type=secret,id=github_token \
    set -euo pipefail && \
    if [ -f /run/secrets/github_token ]; then export GITHUB_TOKEN=$(cat /run/secrets/github_token); fi && \
    mise use --global java@${JAVA_24} && \
    mise use --global java@${JAVA_21} && \
    mise use --global java@${JAVA_17} && \
    mise use --global java@${JAVA_DEFAULT} && \
    mise use --global gradle@latest && \
    mise use --global maven@latest && \
    mise reshim && \
    rm -rf /tmp/*

# ---------------------------------------------------------------------------
# Stage 11: Flutter (git clone, no Android/iOS)
# ---------------------------------------------------------------------------
ENV FLUTTER_ROOT=/opt/flutter
ENV PATH="${FLUTTER_ROOT}/bin:${FLUTTER_ROOT}/bin/cache/dart-sdk/bin:${PATH}"

RUN set -euo pipefail && \
    git clone --depth 1 --branch ${FLUTTER_CHANNEL} https://github.com/flutter/flutter.git ${FLUTTER_ROOT} && \
    git config --global --add safe.directory ${FLUTTER_ROOT} && \
    flutter precache --no-android --no-ios --no-web && \
    flutter --version && \
    rm -rf /tmp/*

# ---------------------------------------------------------------------------
# Stage 12: CLI Tools — Claude Code + OpenCode (native binaries, no npm)
# ---------------------------------------------------------------------------

# Claude Code — native standalone binary (npm deprecated since Feb 2026)
# Install as root, then copy to /usr/local/bin so agent user can execute it
ENV DISABLE_AUTOUPDATER=1
RUN set -euo pipefail && \
    curl -fsSL https://claude.ai/install.sh | bash -s stable && \
    cp /root/.local/bin/claude /usr/local/bin/claude && \
    chmod 755 /usr/local/bin/claude

# OpenCode — native Bun-compiled binary from GitHub Releases
RUN set -euo pipefail && \
    ARCH="$(dpkg --print-architecture)" && \
    case "${ARCH}" in \
        amd64) OC_ARCH="x64" ;; \
        arm64) OC_ARCH="arm64" ;; \
        *) echo "Unsupported arch: ${ARCH}" && exit 1 ;; \
    esac && \
    curl -fsSL "https://github.com/anomalyco/opencode/releases/latest/download/opencode-linux-${OC_ARCH}.tar.gz" \
    | tar -xz -C /usr/local/bin && \
    chmod +x /usr/local/bin/opencode

# ---------------------------------------------------------------------------
# Stage 12b: Developer Tooling (LSP servers, linters, formatters, build tools)
# ---------------------------------------------------------------------------

# ── System tools (ripgrep, jq, make already in Stage 1) ──
RUN apt-get update && apt-get install -y --no-install-recommends \
    fd-find \
    tree \
    htop \
    less \
    cmake \
    shellcheck \
    && apt-get clean && rm -rf /var/lib/apt/lists/*

# ── GitHub CLI ──
RUN curl -fsSL https://cli.github.com/packages/githubcli-archive-keyring.gpg \
    | dd of=/usr/share/keyrings/githubcli-archive-keyring.gpg && \
    echo "deb [arch=$(dpkg --print-architecture) signed-by=/usr/share/keyrings/githubcli-archive-keyring.gpg] \
    https://cli.github.com/packages stable main" > /etc/apt/sources.list.d/github-cli.list && \
    apt-get update && apt-get install -y gh && \
    apt-get clean && rm -rf /var/lib/apt/lists/*

# ── Node-based LSP servers + tools (use default Node version) ──
RUN source ${NVM_DIR}/nvm.sh && nvm use default && \
    npm install -g \
      intelephense \
      basedpyright \
      @vtsls/language-server \
      @vue/language-server \
      @vue/typescript-plugin \
      vscode-langservers-extracted \
      yaml-language-server \
      bash-language-server \
      @tailwindcss/language-server \
      @astrojs/language-server \
      sass \
      postcss \
      postcss-cli \
      autoprefixer

# ── Marksman (Markdown LSP) — standalone binary, not on npm ──
RUN curl -fsSL https://github.com/artempyanykh/marksman/releases/latest/download/marksman-linux-x64 \
    -o /usr/local/bin/marksman && chmod +x /usr/local/bin/marksman

# ── Rust-based tools (rustup + cargo already in PATH via ENV) ──
RUN rustup component add rust-analyzer && \
    cargo install taplo-cli --locked

# ── Go-based tools (go available via mise shims) ──
RUN go install golang.org/x/tools/gopls@latest && \
    go install github.com/go-delve/delve/cmd/dlv@latest

# ── Ruby tools ──
RUN gem install ruby-lsp rubocop bundler --no-document

# ── PHP tools (via Composer global) ──
RUN composer global require \
    phpstan/phpstan \
    friendsofphp/php-cs-fixer \
    squizlabs/php_codesniffer \
    --no-interaction --no-progress && \
    echo 'export PATH="$HOME/.composer/vendor/bin:$PATH"' >> /etc/profile.d/composer-global.sh

# ── Python tools (system-wide via default pyenv Python) ──
RUN pip install --no-cache-dir \
    debugpy

# ---------------------------------------------------------------------------
# Stage 13: Profile setup — ensure login shells activate all runtimes
# ---------------------------------------------------------------------------
RUN cat >> /etc/profile <<'PROFILE'
# --- Kodizm universal agent runtime activation ---

# pyenv
export PYENV_ROOT="/opt/pyenv"
export PATH="${PYENV_ROOT}/shims:${PYENV_ROOT}/bin:${PATH}"
eval "$(pyenv init -)"

# nvm
export NVM_DIR="/opt/nvm"
[ -s "${NVM_DIR}/nvm.sh" ] && source "${NVM_DIR}/nvm.sh"

# Bun
export BUN_INSTALL="/opt/bun"
export PATH="${BUN_INSTALL}/bin:${PATH}"

# Rust
export RUSTUP_HOME="/opt/rustup"
export CARGO_HOME="/opt/cargo"
export PATH="${CARGO_HOME}/bin:${PATH}"

# mise (Go, Ruby, Java)
export MISE_DATA_DIR="/opt/mise"
export MISE_CACHE_DIR="/opt/mise/cache"
eval "$(mise activate bash)"

# Flutter
export FLUTTER_ROOT="/opt/flutter"
export PATH="${FLUTTER_ROOT}/bin:${FLUTTER_ROOT}/bin/cache/dart-sdk/bin:${PATH}"

# pipx
export PATH="${PATH}:/root/.local/bin:/home/agent/.local/bin"
PROFILE

# ---------------------------------------------------------------------------
# Stage 14: Non-root user — agent (UID 1001)
# ---------------------------------------------------------------------------
RUN set -euo pipefail && \
    groupadd --gid 1001 agent && \
    useradd --uid 1001 --gid 1001 --create-home --shell /bin/bash agent && \
    # Create tool/config directories for agent user
    mkdir -p /home/agent/.claude \
             /home/agent/.config/opencode \
             /home/agent/.pub-cache \
             /home/agent/.dart \
             /home/agent/.local/bin \
             /home/agent/.local/share/pipx \
             /home/agent/.cache \
             /home/agent/.npm \
             /home/agent/.composer && \
    # Chown all tool directories to agent
    chown -R agent:agent \
        /opt/pyenv \
        /opt/nvm \
        /opt/bun \
        /opt/rustup \
        /opt/cargo \
        /opt/mise \
        /opt/flutter \
        /home/agent && \
    # Copy profile to agent's bashrc for non-login shells too
    cp /etc/profile /home/agent/.profile_kodizm && \
    echo 'source /home/agent/.profile_kodizm' >> /home/agent/.bashrc && \
    chown agent:agent /home/agent/.bashrc /home/agent/.profile_kodizm && \
    # Flutter git safe.directory for agent user
    su -c "git config --global --add safe.directory /opt/flutter" agent

# ---------------------------------------------------------------------------
# Stage 14a: Claude Code default config bootstrap
# ---------------------------------------------------------------------------
# Run CC once as agent user to generate its native ~/.claude.json (feature
# flags, caches, migration markers) and ~/.claude/ directory structure.
# This ensures injectCredentials() can merge INTO existing config rather
# than blind-overwriting it. Uses a dummy API key to trigger full init.
# Default settings.json is copied from docker/defaults/ — edit there to
# change base CC settings for all containers.
# Persist defaults to /opt/kodizm/defaults/ — outside the volume mount at
# ~/.claude so entrypoint can sync them on every boot.
# Plugin seed dir: CC reads CLAUDE_CODE_PLUGIN_SEED_DIR at startup and
# merges seed marketplaces into ~/.claude/plugins/known_marketplaces.json.
COPY --chown=agent:agent defaults/plugins/ /opt/kodizm/defaults/plugins/
COPY --chown=agent:agent defaults/settings.json /opt/kodizm/defaults/settings.json
COPY --chown=agent:agent defaults/skills/ /opt/kodizm/defaults/skills/
ENV CLAUDE_CODE_PLUGIN_SEED_DIR=/opt/kodizm/defaults/plugins

COPY defaults/settings.json /home/agent/.claude/settings.json
COPY defaults/skills/ /home/agent/.claude/skills/
RUN su -l agent -c "CLAUDE_CODE_PLUGIN_SEED_DIR=/opt/kodizm/defaults/plugins ANTHROPIC_API_KEY=sk-ant-dummy DISABLE_AUTOUPDATER=1 claude -p 'init' 2>/dev/null || true" && \
    ls -la /home/agent/.claude.json && \
    cp /opt/kodizm/defaults/settings.json /home/agent/.claude/settings.json && \
    chown -R agent:agent /home/agent/.claude/ && \
    echo '[Dockerfile] CC default config + skills + LSP plugins bootstrapped'

# ---------------------------------------------------------------------------
# Stage 15: Workspace + entrypoint
# ---------------------------------------------------------------------------
COPY entrypoint.sh /opt/kodizm/entrypoint.sh
COPY setup.sh /opt/kodizm/setup.sh
COPY proxy/ /opt/kodizm/proxy/
RUN chmod +x /opt/kodizm/entrypoint.sh /opt/kodizm/setup.sh && \
    mkdir -p /workspace /task-workspaces && \
    chown agent:agent /workspace /task-workspaces /opt/kodizm

WORKDIR /workspace

EXPOSE 4096

ENTRYPOINT ["/usr/bin/tini", "--", "/opt/kodizm/entrypoint.sh"]
CMD ["bash", "--login"]
