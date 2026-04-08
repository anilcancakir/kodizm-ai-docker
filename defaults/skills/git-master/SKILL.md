---
name: git-master
description: "Atomic commit architect with convention detection. Analyzes project commit style from instruction files (CLAUDE.md, GEMINI.md, AGENTS.md, copilot-instructions), git history, or falls back to Conventional Commits. Enforces split rules, test pairing, dependency ordering. Use when committing, staging, or preparing git commits."
when-to-use: "TRIGGER when: commit, stage, git add, ready to commit, save progress, checkpoint work. DO NOT TRIGGER when: push, rebase, squash, blame, bisect, cherry-pick, history search, GitHub API."
---

# Git Master

Atomic commit architect. Each logical unit of work gets its own commit — commit as you go, not in a batch at the end.

## Core Rule: Split by Default

**Single commit from many unrelated files = failure.** Default is MULTIPLE COMMITS.

```
3+  files → MUST be 2+ commits
5+  files → MUST be 3+ commits
10+ files → MUST be 5+ commits
```

**Split when ANY true:**

| Signal | Action |
|--------|--------|
| Different directories/modules | SPLIT |
| Different component types (model/service/view) | SPLIT |
| Can be reverted independently | SPLIT |
| Different concerns (UI/logic/config/test) | SPLIT |
| New file vs modification | SPLIT |

**Combine ONLY when ALL true:** exact same atomic unit (function + its test), splitting would break compilation, one-sentence justification exists.

## Phase 1: Context Gathering

Run in parallel:

- `git status`
- `git diff --staged --stat`
- `git diff --stat`
- `git log -20 --pretty=format:"%s"`
- `git branch --show-current`

## Phase 2: Convention Detection

**First match wins — stop searching after a match.**

### Step 1: AI agent instruction files

| File | Source |
|------|--------|
| `CLAUDE.md` | Claude Code |
| `GEMINI.md` | Gemini |
| `AGENTS.md` | Shared agent instructions |
| `.github/copilot-instructions.md` | GitHub Copilot |

If any specifies a commit format — adopt it exactly.

### Step 2: Project convention files

| File | What to look for |
|------|-----------------|
| `.github/git-commit-instructions.md` | Dedicated commit rules |
| `.commitlintrc` / `.commitlintrc.json` / `commitlint.config.js` | Commitlint type/scope rules |
| `.czrc` / `.cz.json` | Commitizen format |
| `CONTRIBUTING.md` / `.github/CONTRIBUTING.md` | "Commit" section |
| `PROJECT.md` | Project conventions |
| `README.md` | "Commit" or "Contributing" section |

If found — adopt exactly.

### Step 3: Git history analysis

Classify from the last 20 commits:

| Style | Pattern | Detection |
|-------|---------|-----------|
| `SEMANTIC` | `type(scope): msg` | `^(feat\|fix\|chore\|refactor\|docs\|test\|ci\|style\|perf\|build)(\(.+\))?:` |
| `PLAIN` | Descriptive, no prefix | No conventional prefix, >3 words |
| `SHORT` | Minimal | 1–3 words only |

```
semantic >= 50% → SEMANTIC
plain    >= 50% → PLAIN
short    >= 33% → SHORT
else            → PLAIN
```

### Step 4: Default fallback

Fewer than 5 commits → Conventional Commits: `feat:`, `fix:`, `refactor:`, `chore:`, `docs:`, `test:`.

### Output (mandatory before proceeding)

```
STYLE DETECTION
===============
Source: [instruction file | convention file | git history | default]
Style: [SEMANTIC | PLAIN | SHORT]

Reference examples from log:
  1. "..."
  2. "..."
  3. "..."
```

## Phase 3: Commit Planning

**Minimum commits:** `max(ceil(file_count / 3), hard_rule_minimum)`

Hard rule: 3+ → 2 min | 5+ → 3 min | 10+ → 5 min

**Split order:** directory/module first → then by concern.

### Test Pairing

Test files MUST be in the same commit as their implementation:

```
*_test.dart ↔ *.dart       test_*.py ↔ *.py
*.test.ts ↔ *.ts           *.spec.ts ↔ *.ts
__tests__/*.ts ↔ *.ts      tests/*.php ↔ src/*.php
```

### 3+ Files Justification

```
VALID:   "implementation + its direct test file"
VALID:   "migration + model change (breaks without both)"
INVALID: "all related to feature X"
INVALID: "part of the same task"
```

### Dependency Ordering

```
Level 0: Utilities, constants, type definitions
Level 1: Models, schemas, interfaces
Level 2: Services, business logic
Level 3: Controllers, views, endpoints
Level 4: Configuration, infrastructure
```

### Output (mandatory before executing)

```
COMMIT PLAN
===========
Files: N | Min commits: M | Planned: K | Status: K >= M ✓

COMMIT 1: [message in detected style]
  - path/to/file.dart
  - path/to/file_test.dart
  Justification: implementation + its test

COMMIT 2: [message]
  - path/to/other.dart

Order: Commit 1 → 2 (Level 0 → Level 2)
```

Validate before executing: each commit ≤4 files (or justified), messages match style, tests paired, total ≥ min_commits. Fail → REPLAN.

## Phase 4: Execute

For each commit in dependency order:

```bash
git add path/to/file1 path/to/file2
git diff --staged --stat
git commit -m "<message>"
```

After all commits: `git status` + `git log --oneline -10`. Report results.

**Message examples:**

| Style | Example |
|-------|---------|
| SEMANTIC | `feat: add login validation` |
| PLAIN | `Add login validation` |
| SHORT | `format` |

## Constraints

- Selective staging only — `git add path/to/file`, never `git add -A` or `git add .`
- No interactive staging — `git add -i` and `git add -p` are blocked
- No amending — `git commit --amend` is forbidden, each commit is final
- No history rewriting — no `git rebase`, `git reset`, `git cherry-pick`
- No pushing — the platform pushes automatically
- No branch switching — stay on the assigned worktree branch
