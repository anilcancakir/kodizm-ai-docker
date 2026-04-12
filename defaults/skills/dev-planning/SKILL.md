---
name: dev-planning
description: Development planning — codebase investigation, complexity estimation, structured Wave/Step plan generation and review. Produces plans consumed by dev-execute.
when-to-use: Any task that needs an implementation plan before coding. Triggered when asked to plan a feature, analyze a task, or produce a development plan.
---

# Development Planning

Investigate the codebase, estimate complexity, and produce a structured Wave/Step plan. No code — only plans that the execution phase follows exactly.

## Phase 1: Load Context

1. `get-task` — read description, acceptance criteria, existing sections
2. Read the PM's `analysis` section if present
3. `report-progress(status: planning, percentage: 5)`

## Phase 2: Investigate

Estimate complexity first from the task description, then launch investigation accordingly.

**Simple (1-2 steps):** Direct Grep/Read on known files — no agents needed.

**Normal (3-6 steps):** Parallel investigation:
- 1 Explore agent: conventions, similar implementations, callers
- 1 librarian agent: official docs if external library involved

**Complex (7+ steps):** Parallel investigation:
- 2 Explore agents: conventions + organization, impact scope + test coverage
- 1 librarian agent: official docs, API references
- Self-assess: stress-test the approach, surface risks before planning

After investigation, assess codebase state: **Disciplined** (follow patterns) / **Transitional** (follow new direction) / **Legacy** (improve, don't copy) / **Chaotic** (establish from scratch).

`report-progress(percentage: 20)`

## Phase 3: Pre-Plan Analysis (complexity-gated)

**Simple:** Skip — proceed to Phase 4.

**Normal:** Skip-if-confident gate. Skip if ALL of:
1. scope is single module
2. no external dependencies introduced
3. no architectural impact
4. research found all relevant patterns and files
5. no cross-cutting concerns (auth, logging, error handling, migrations)

If ANY condition fails:
1. Self-analyze: context sufficiency, hidden requirements, gaps in the task description
2. Identify MUST DO / MUST NOT directives for your plan
3. If ambiguity remains: resolve via further investigation or `ask-user` MCP tool

**Complex:**
1. Deep analysis before planning:
   - Context sufficiency: hidden requirements, gaps, unstated assumptions
   - Effort estimation: prerequisites, codebase fit, dependency ordering
   - Stress-test: challenge the approach, surface risks and alternatives
2. Synthesize all findings into plan directives
3. If ambiguity remains: resolve before proceeding

`report-progress(percentage: 40)`

## Phase 4: Create Development Plan

Apply `my-coding` skill — plans must align with project coding standards. Apply `my-language` skill to all written output. All plan content (step titles, descriptions, conventions, risks) MUST be in English.

### Tier System

| Tier | Files | Model | When | Benchmark Context |
|------|-------|-------|------|-------------------|
| `quick` | ≤1 | haiku | Mechanical: config, rename, scaffold, boilerplate | SWE-bench 73%, 200K context, $5/MTok. Fast (93 tok/s). Fails at cross-file reasoning. |
| `mid` | 1-3 | sonnet | Standard implementation, business logic. **DEFAULT** | SWE-bench 80%, 200K context, $15/MTok. 98.5% of Opus coding at 1/5 cost. |
| `senior` | 3+ | opus | Cross-layer, architecture, migration, complex edge cases | SWE-bench 81%, 200K context, GPQA 91% (+17pp over Sonnet). $75/MTok. Justified for deep reasoning. |

**Codebase state escalation**: Chaotic or Legacy → all `quick` steps escalate to `mid`.

### Wave Construction Rules

- Steps within a wave MUST touch different files (file-exclusive parallelism)
- Steps across waves MAY touch the same files (sequential execution)
- Group independent steps into the same wave for parallel execution
- Dependent steps go into later waves

`report-progress(percentage: 60)`

## Phase 5: Plan Review (complexity-gated)

**Simple:** Skip — save plan directly.

**Normal:** Skip-if-confident gate. Skip if ALL of:
1. All file references verified (paths exist or are explicitly marked as new)
2. Every step has concrete QA (command + expected result, not vague)
3. Tiers match scope (no senior for single-file config, no quick for cross-module logic)
4. No scope beyond original request (no bonus features, no extra abstractions)

If ANY condition fails:
1. Spawn `plan-review` agent with the plan content
2. If REJECT: fix cited issues, re-submit (max 2 iterations)
3. If OKAY: proceed to Phase 6

**Complex:**
1. Spawn `plan-review` agent (opus override): comprehensive review including adversarial checks, reference verification, AI-slop detection
2. If REJECT: fix cited issues, re-submit (max 2 iterations)
3. If OKAY: proceed to Phase 6

`report-progress(percentage: 90)`

## Phase 6: Deliver

1. `create-task-section(type: plan)` — save the structured plan (format below)
2. `report-progress(status: planned, percentage: 100)`

---

## Plan Format

```markdown
## Development Plan

**Complexity**: simple | normal | complex
**Steps**: {total count}
**Waves**: {wave count}
**Codebase State**: disciplined | transitional | legacy | chaotic

### Wave 1

#### Step 1: {imperative title}
- **Tier**: quick | mid | senior
- **Files**: {comma-separated absolute paths}
- **Done when**:
  - {verifiable criterion 1}
  - {verifiable criterion 2}
- **QA**: {test scenario or command + expected result}

#### Step 2: {imperative title}
- **Tier**: mid
- **Files**: {paths — MUST NOT overlap with Step 1}
- **Done when**:
  - {criterion}
- **QA**: {scenario + expected result}

### Wave 2 (depends on Wave 1)

#### Step 3: {title}
...

### Conventions
- {Pattern from codebase to follow — file:line reference}

### Must NOT
- {Forbidden change or pattern}
- {File or module to leave untouched}

### Risks
- {Open questions, assumptions, unresolved gaps}
```

### Plan Quality Rules

- Every step has tier, files list, done-when, and QA
- Done-when criteria are verifiable (testable, greppable, readable) — never vague
- Files are absolute paths that exist in the codebase
- Conventions reference actual code patterns (file:line) — not generic advice
- Must NOT section prevents scope creep — always include for normal/complex

### Complexity Reference

| Steps | Complexity | Pre-Plan Analysis | Plan Review |
|-------|-----------|-------------------|-------------|
| 1-2 | simple | skip | skip |
| 3-6 | normal | self-analysis | plan-review (sonnet) |
| 7+ | complex | deep self-analysis | plan-review (opus) |
