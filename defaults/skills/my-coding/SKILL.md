---
name: my-coding
description: Coding style for all languages — PHP, Dart, TypeScript, Go. No strict_types, 120-char lines, multi-line collections, full types + docblocks, TDD, English only, zero lint violations, Laravel-inspired OOP.
when-to-use: Any request to write, modify, review, or generate code in any language. Triggers on implementation, refactoring, code review, and TDD tasks.
---

# Kodizm Coding Style

Code is artisanship. Every class, method, and docblock is intentional. If it doesn't look clean enough to frame on a wall, it's not done.

## North Star: Laravel's Elegance

Laravel's API design — expressive method names, fluent interfaces, clean separation of concerns — is the gold standard for ALL code, not just PHP. Apply these principles universally:

- **Naming tells a story** — `findOrCreate`, `syncBarcodes`, `bootSkillsIfNeeded`
- **Structure mirrors intent** — Service orchestrates. Repository queries. Controller delegates.
- **OOP done right** — Interfaces for contracts. Abstract classes for shared behavior. Enums for magic values. Value objects for immutability.

## CRITICAL: Adapt to Project's Language Version

**BEFORE writing any code**, detect the project's language version from config files (`composer.json` → `require.php`, `pubspec.yaml` → `environment.sdk`, `tsconfig.json` → `target`, etc.). Use ONLY features available in that version.

**PHP version feature gates:**

| Feature | Minimum PHP |
|---------|-------------|
| Constructor property promotion, union types, named arguments, `match`, nullsafe `?->` | 8.0 |
| Backed enums, `readonly` properties, intersection types, fibers | 8.1 |
| `readonly class`, `true`/`false`/`null` standalone types, DNF types | 8.2 |
| `#[Override]` attribute, typed class constants, `json_validate()` | 8.3 |
| Property hooks, asymmetric visibility, `new` without parens, `array_find`/`array_any`/`array_all`, `#[Deprecated]`, implicit nullable deprecation | 8.4 |
| Pipe operator `\|>`, `clone` with overrides, `#[NoDiscard]`, `array_first`/`array_last`, final property promotion | 8.5 |

**Dart version feature gates:**

| Feature | Minimum Dart |
|---------|-------------|
| Records `(String, int)`, patterns / pattern matching, `sealed class`, class modifiers (`final`, `interface`, `base`, `mixin`) | 3.0 |

The style principles (clean imports, docblocks, multi-line formatting, TDD) apply regardless of version. Only syntax features adapt.

## Non-Negotiable Rules

### 1. No declare(strict_types=1)

NEVER add `declare(strict_types=1)` to PHP files. It violates project conventions, causes runtime `TypeError` in production with external data, and breaks Laravel's type coercion. Omit the declaration entirely. Type safety is enforced via PHPStan + explicit type declarations, not runtime strict mode.

### 2. English Only

ALL identifiers, comments, docblocks, commit messages, error messages, DB columns, task sections, knowledge base documents, plan content — English. No exceptions, regardless of project audience.

### 3. Type Everything

Every parameter, return type, and property has an explicit type declaration. No untyped code ships.

### 4. Document Everything

| Scope | Requirement |
|-------|-------------|
| Every class | Docblock explaining purpose |
| Every public method | Docblock with `@param`, `@return`, `@throws` |
| Every property | Type declaration + doc comment |
| Complex logic | Numbered step comments (WHY, not WHAT) |

If a method needs a paragraph of comments, extract it into a named method.

### 5. 120-Character Line Width

No line exceeds 120 characters. Break method signatures, chains, conditionals — everything.

### 6. Multi-Line Collections — ALWAYS

Arrays, objects, parameter lists, maps — ALWAYS multi-line. Even with 2 elements. Trailing commas mandatory.

```php
// CORRECT
$config = [
    'key' => 'value',
    'timeout' => 30,
];

// WRONG — never inline
$config = ['key' => 'value', 'timeout' => 30];
```

```dart
// CORRECT
final colors = [
  Colors.red,
  Colors.blue,
  Colors.green,
];

// WRONG
final colors = [Colors.red, Colors.blue, Colors.green];
```

### 7. Clean Imports

Import at the top of the file. NEVER reference classes by full namespace inline.

```php
// CORRECT
use RuntimeException;
throw new RuntimeException('Failed.');

// WRONG — inline namespace
throw new \RuntimeException('Failed.');
```

### 8. TDD — Red, Green, Refactor

Write the failing test FIRST. Then implement. Then refactor. Applies to features, bugfixes, and refactors.

- New feature → test describes the contract before implementation
- Bug fix → test reproduces the bug first
- Refactor → existing tests are the safety net

There is no "we'll add tests later." The test comes before the code.

### 9. Linter is Law

Code MUST pass the linter with zero warnings, zero errors. No suppressions (`@ts-ignore`, `@phpstan-ignore`, `// ignore:`). Fix the actual issue.

### 10. Numbered Step Comments

Methods with 3+ logical phases get numbered steps:

```php
public function findOrCreate(Team $team, User $user, array $data): GlobalProduct
{
    // 1. Check if already exists — avoid duplicate translations.
    if ($existing = $this->findProductByLocale(...)) {
        return $existing;
    }

    // 2. Find base product in any language as translation source.
    $base = $this->findBaseProduct(...);

    // 3. Translate via AI service.
    $translated = $this->translateViaAI($base, $data['locale']);

    // 4. Create product and sync related data in a transaction.
    return DB::transaction(function () use ($translated, $team) {
        $product = GlobalProduct::create([...$translated, 'team_id' => $team->id]);
        $this->syncBarcodes($product, collect($translated['barcodes']));
        return $product;
    });
}
```

### 11. Enum Everything

Status values, types, categories — ALWAYS backed enums. Never string constants or magic values.

### 12. Thin Controllers + Form Requests

Controllers validate via Form Request, delegate to Service, return Resource. No business logic. No inline validation.

```php
public function store(StoreRequest $request): JsonResponse
{
    $pool = $this->poolService->create($request->validated());

    return response()->json(PoolResource::make($pool), 201);
}
```

### 13. Constructor Dependency Injection

Inject dependencies via constructor. Never use facades or service location in class methods.

```php
public function __construct(
    protected PoolService $poolService,
) {}
```

### 14. Guard Clauses Over Nesting

Use early returns. Never nest conditionals beyond 2 levels.

```php
if ($pool->isActive()) {
    return;
}

if (! $pool->hasMinimumStake()) {
    throw new InsufficientStakeException($pool);
}

$pool->update(['status' => PoolStatus::Active]);
```

## Architecture Principles

| Principle | Rule |
|-----------|------|
| Thin Controllers, Fat Services | Controllers validate + return. Business logic in Services. |
| Immutable Value Objects | `readonly` (PHP) / `@immutable` (Dart). Mutate via `copyWith`. |
| Defensive Config | Always validate inputs. Always provide fallbacks. |
| Domain Directories | Complex domains get their own top-level directory. |
| Named Arguments | Use named params for clarity at call sites. |
| Event-Driven Side Effects | Cross-cutting concerns (notifications, cache, audit) in Listeners. |

## Language-Specific References

Load these when working in the respective language:

- **PHP / Laravel**: See [references/php-laravel.md](references/php-laravel.md) for controller, model, service, resource, route, and package patterns.
- **Dart / Flutter**: See [references/dart-flutter.md](references/dart-flutter.md) for widget, parser, state management, and SDK/package patterns.
- **Anti-Patterns**: See [references/anti-patterns.md](references/anti-patterns.md) for the comprehensive "never do" list across all languages.
