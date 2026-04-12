---
name: task-analysis
description: Turns user requests into well-specified Kodizm tasks. Investigate the codebase first, apply the ambiguity gate, then create or refine the task with full spec and analysis section.
when-to-use: Any request to create, refine, or analyse a task: new features, bugs, spikes, meeting note batches, or existing task enrichment.
---

# Task Analysis Skill

Turn user requests into well-specified tasks that agents can plan and execute autonomously.

## Core Principle: Investigate First, Ask Later

Never ask what you can look up. Default flow:

1. **Investigate** — search existing tasks, read affected codebase area
2. **Draft** — create the task with what you know, marking gaps explicitly
3. **Clarify** — ask ONLY if a gap makes the task unplannable

Anti-patterns to avoid: asking "What framework?" when `pubspec.yaml` exists; asking "How does auth work?" when you can Grep for it.

## Ambiguity Gate (Internal)

Assess clarity before routing. Never surface scores to the user.

| Dimension | Weight | What to assess |
|-----------|--------|----------------|
| **Goal** | 0.35 | Is the desired outcome clear? |
| **Constraints** | 0.25 | Are boundaries and limitations known? |
| **Success** | 0.25 | Can acceptance criteria be written? |
| **Context** | 0.15 | Is the affected area and trigger understood? |

`clarity = Σ(score × weight)` (scores 0.0 to 1.0 per dimension).

- Clarity >= 80% → Fast Path
- Clarity < 80% → Clarification Path (1-2 targeted questions on the lowest-scoring dimension)

Codebase investigation raises scores — always investigate before routing.

## Workflow

### Fast Path (80% of requests)

Clear intent ("fix the login bug", "add dark mode toggle"):

1. `search` — check for related/duplicate tasks
2. Investigate codebase via `Explore` agent (broad) or `Grep`/`Read` (targeted)
3. `create-task` or `update-task` — full spec, no code snippets
4. INVEST validation (see gate below)
5. `create-task-section(type: analysis)` — problem, impact, codebase findings, open questions
6. `report-progress` — done

No questions asked. Ambiguous details go into "Open Questions" in the description.

### Clarification Path (20% of requests)

Genuinely ambiguous intent ("improve the dashboard", "make it better"):

- Use `ask-user` MCP tool — structured question with header + options
- Maximum 3 questions per request (hard cap), one question per turn
- Skip any question answerable by codebase investigation
- If user says "just do it" — create with best-effort spec + open questions

### Existing Task Refinement

When refining an existing task:

1. `get-task` — load current spec
2. Investigate codebase for gaps in the current spec
3. `update-task` — fill in missing description, acceptance criteria, complexity
4. `create-task-section(type: analysis)` — add findings if not present

### Bulk Path (meeting notes, multiple items)

1. Classify each item: bug / story / task / spike
2. Build triage table: Title, Type, Size, Priority, Clarity, Action
3. Clarity >= 80% → auto-draft; Clarity < 80% → 1-2 questions then draft
4. `create-task` x N — one per item, link related via `parent_task_id`
5. `report-progress` — summary of created tasks

## Codebase Investigation

Use these in order of specificity:

- `Explore` agent — broad questions ("where is the auth flow?", "how are routes structured?")
- `Grep` / `Read` — targeted lookups ("find the login controller", "read the task model")
- `librarian` agent — framework/library questions ("how does MagicStateMixin work?")
- `search` tool — existing tasks and documents

Include brief **file:line references** in task descriptions. Keep findings factual.

## Task Output Format

All task output (title, description, acceptance criteria, analysis section) MUST be in English. User communication via `ask-user` follows the user's language.

**Title**: Imperative, specific, under 80 characters.
Good: "Fix 500 error on registration page" / Bad: "Registration issue"

**Description** must include: problem statement (user perspective), context, code references (file:line), out of scope, open questions.

**Description must NOT include**: code snippets, implementation plans, dependency versions, file-level change lists.

**Acceptance Criteria** — `Given [precondition] / When [action] / Then [expected result]`:
- Cover happy path + primary error + obvious edge case
- Describe observable outcomes, not implementation steps

**Priority**: p0 (production down), p1 (major blocker), p2 (standard, default), p3 (nice-to-have)

## INVEST Validation

After drafting, validate:

| Criterion | Check |
|-----------|-------|
| **I**ndependent | Can ship without waiting on another in-progress task? |
| **N**egotiable | Acceptance criteria describe outcomes, not implementation? |
| **V**aluable | Clear outcome for a real user persona? |
| **E**stimable | Open questions <= 2, sufficient context for sizing? |
| **S**mall | Fits single planning cycle (XS-L)? If XL → Phase Decomposition |
| **T**estable | Every criterion has Given/When/Then? |

INVEST failures are warnings, not blockers. Note failures under "Open Questions".

## Phase Decomposition (L/XL only)

When complexity is L or XL spanning multiple concerns:

1. Decompose into phases (max 6): foundation, features, polish
2. Each phase = separate task linked via `parent_task_id`
3. Naming: "[Feature] Phase N: [phase goal]"
4. Each phase must be independently plannable
