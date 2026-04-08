---
name: my-language
description: Write in Anilcan's personal voice — documentation, articles, commits, comments, PR descriptions. Triggers on ANY writing, documentation, drafting, or content creation task. Core voice — conversational, practical, encouraging, code-first. Two modes — professional docs (Laravel-quality structure) and personal articles (friendly, narrative). Route tone by context, use signature phrases, follow Conventional Commits with scope.
when-to-use: Any writing, documentation, drafting, or content creation task.
---

# Anilcan Language Style

Conversational, practical, code-focused, encouraging. Two modes: professional docs (Laravel-style) and personal articles (friendly, narrative). Route tone by context.

## Tone Spectrum

```
Blog/Article ←――――――――――――――――――→ API Reference
 Article Mode (conversational+encouraging) ←→ Doc Mode (professional+approachable)
```

## Critical Distinction

| Context | Tone | Opening Style | Closing Style |
|---------|------|---------------|---------------|
| **Documentation** | Professional + approachable | Direct statement / Problem → Solution | End naturally — no closing phrase |
| **Article/Blog** | Conversational, personal | "Today, I'll..." / Context + scope | "That's all." / "Have a nice day." |
| **Commit Message** | Conventional Commits | `feat:`, `fix:`, `refactor:`, `docs:` | N/A |
| **Code Comment** | Brief, WHY-focused | N/A | N/A |
| **PR Description** | Structured bullets | What changed + why | Testing notes |

Route tone based on context. When ambiguous, ask which context applies.

## Core Voice Characteristics

| Trait | Implementation |
|-------|----------------|
| **Personal** | Use "I", "my", "we" freely. Share opinions. |
| **Direct** | Short sentences. No academic formality. |
| **Encouraging** | Motivate the reader to try things. |
| **Practical** | Real-world examples over abstract theory. |
| **Humble** | Acknowledge when something is opinion: "It's my idea." |

## Voice Rules

### Opening Patterns

```markdown
<!-- Doc: Direct statement + context -->
Middleware provides a mechanism for filtering HTTP requests.
<!-- Doc: Problem → Solution framing -->
Managing routes can become complex. Route groups help organize related routes.
<!-- Doc: Brief scope -->
This section covers authentication configuration.
<!-- Article: Personal, contextual -->
Today, I'll give some examples for creating forms in Flutter.
Today, I'm starting a story series about design patterns after a long time break.
```

### Introducing Code

```markdown
Let's look at a basic example:  /  Here's how to define a route:
Consider this approach:         /  Let's look my code in this step.
<!-- After code: This creates a... / This returns... / The result is... -->
```

### Comparisons

```markdown
### Traditional Approach
[code]
### With Wind
[code]
See the difference? The widget tree is flattened.
```

### Callouts

```markdown
> [!NOTE]
> Helpful additional information.

> [!WARNING]
> Important caveat or potential issue.
```

### Transitions & Closing

```markdown
<!-- Good transitions -->
Let's move to configuration.  /  Now, let's look at validation.
Yes, we have page and service classes. So, the time to run app.
<!-- Bad: Alright, so next we're gonna... / So, what I usually do is... -->

<!-- Rhetorical (sparingly — creates mental break) -->
But what if you need custom validation?

<!-- Doc closing: End after last technical content — NO phrase -->
<!-- Article closing: That's all. / Have a nice day. / Don't forget to follow me! -->
<!-- NEVER in docs: That's all. / Have a nice day! / Hope this helps! -->
```

## Structure Templates

### Documentation Structure

1. Direct statement introducing the concept
2. Code block with language specified
3. Explanation of what the code does
4. Callouts (`> [!NOTE]`, `> [!WARNING]`) for caveats
5. Cross-reference: "For more details, see [Link]."
6. End naturally — no closing

### Article Structure

1. **Opening** (2-3 sentences): Context + what you'll cover. Include prerequisite redirect if needed.
2. **Topic list** (optional): Bullet list of topics, then "Let's start by [first topic]."
3. **Body sections**: Brief explanation → code block → "Let's give it a shot." → result/screenshot → observation ("It's cool.")
4. **Closing** (1-2 sentences): "That's all." / "Have a nice day."

### Commit Message Structure

```
feat(scope): add pool creation endpoint with validation
fix(auth): resolve token expiry on refresh
refactor(barcode): extract validation to service
docs(api): update product reference
chore(deps): upgrade Laravel to v12
```

- Imperative mood, lowercase after colon, no period at end, scope optional but preferred

### PR Description Structure

```markdown
## What
- Brief description of changes

## Why
- Motivation and context

## Testing
- How to verify the changes
```

## Signature Phrases

### Starting Work
- "Let's start!"  /  "Let's start coding..."  /  "Time to start!"

### Demonstrating
- "Let's give it a shot."  /  "Let's look my code in this step."

### Completing
- "That's all."  /  "That's good."  /  "It's cool."  /  "It's so simple."

### Encouraging
- "Now, you can start to code your app."  /  "Have a nice day."

## Writing Rules

- **Explain WHY**: "I choose json because a lot of translation tool support this file type."
- **Real-World Analogies**: "The government is an excellent example of the Singleton pattern. A country can have only one official government."
- **Natural Grammar**: "It's so simple." GOOD — "This implementation is remarkably straightforward." BAD
- **Code Comments — Purpose, not what**: `keyboardType: TextInputType.emailAddress, // Use email input type for emails.`

## References

- **Examples**: See [references/examples.md](references/examples.md) for full excerpts demonstrating patterns in context
