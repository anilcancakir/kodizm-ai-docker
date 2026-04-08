# Dart / Flutter Conventions

## Naming Conventions

| Element | Convention | Example |
|---------|-----------|---------|
| Class | PascalCase | `WindParser`, `WindThemeData` |
| Widget | `W` prefix + PascalCase | `WDiv`, `WText`, `WButton` |
| Parser | `{Feature}Parser` | `BackgroundParser`, `BorderParser` |
| Enum | PascalCase | `WindDisplayType`, `WindOverflow` |
| Enum Value | camelCase | `WindDisplayType.flex` |
| Variable / Method | camelCase | `activeStates`, `_buildCompositionPipeline` |
| Private | `_` prefix | `_translateMainAxisToWrap` |
| File | snake_case | `wind_parser.dart`, `w_div.dart` |
| Test file | `{feature}_test.dart` | `background_parser_test.dart` |
| Extension | `{Domain}Extension` | `WindContextExtension` |
| Utility function | `w` prefix | `wColor()`, `wSpacing()` |
## Directory Structure (SDK/Package)

```
lib/
├── fluttersdk_wind.dart      # Barrel file — ONLY public API
└── src/                      # ALL implementation private
    ├── core/                 # Platform detection, base services
    ├── dynamic/              # Dynamic/runtime widget system
    ├── parser/               # className → WindStyle pipeline
    │   ├── wind_parser.dart      # Orchestrator + cache
    │   ├── wind_style.dart       # Immutable style object
    │   ├── wind_context.dart     # Runtime context
    │   └── parsers/              # Strategy: one parser per feature
    ├── state/                # ChangeNotifier + InheritedWidget
    ├── theme/                # Theme provider + config
    │   ├── wind_theme.dart
    │   ├── wind_theme_data.dart
    │   └── defaults/
    ├── utils/                # Color utils, extensions, logger
    └── widgets/              # W-prefixed widgets
```

- Single barrel file — users NEVER import from `src/`
- One file per class
- File snake_case matches class: `wind_style.dart` → `WindStyle`
## Type Declarations

```dart
final String? className;
final Widget? child;
final Set<String> activeStates;  // Set, never List for unique collections

WindStyle parse(WindStyle styles, List<String>? classes, WindContext context)

enum WindDisplayType { block, flex, grid, wrap }
```
## Immutability Pattern

```dart
@immutable
class WindStyle {
  final bool isHidden;
  final WindDisplayType? displayType;
  final double? width;

  const WindStyle({
    this.isHidden = false,
    this.displayType,
    this.width,
  });

  WindStyle copyWith({
    bool? isHidden,
    WindDisplayType? displayType,
  }) {
    return WindStyle(
      isHidden: isHidden ?? this.isHidden,
      displayType: displayType ?? this.displayType,
    );
  }
}
```

- `@immutable` on data classes. All fields `final`. `const` constructor. Mutate via `copyWith`.
## Constructor Patterns

```dart
// const + named params + super.key
const WText(
  this.data, {
  super.key,
  this.className,
  this.style,
  this.selectable = false,
});

// Assertion for mutual exclusivity
const WDiv({
  super.key,
  this.child,
  this.children,
}) : assert(
      child == null || children == null,
      'WDiv: Cannot provide both child and children.',
    );
```
## Widget Architecture

```dart
/// **The Utility-First Text Component**
///
/// Delegates parsing to [WindParser], rendering to private builders.
class WText extends StatelessWidget {
  final String data;
  final String? className;

  const WText(this.data, {super.key, this.className});

  @override
  Widget build(BuildContext context) {
    // 1. RESOLVE STYLES
    final WindStyle styles = WindParser.parse(className!, context);

    // 2. GUARD CLAUSE
    if (styles.isHidden) return const SizedBox.shrink();

    // 3. BUILD CORE CONTENT
    final Widget coreContent = _buildCoreContent(styles);

    // 4. COMPOSE DECORATORS
    return _buildCompositionPipeline(styles, coreContent);
  }
}
```

- ALL public widgets have `W` prefix
- `className` is primary styling API — always `String?`
- `child` for single-child, `children` for multi-child (never both)
- StatelessWidget for display-only, StatefulWidget for interactive
- `WindParser.parse()` in `build()`, never cached in state
- Numbered step comments in build methods
## Composition Pipeline

```dart
Widget _buildCompositionPipeline({
  required WindStyle styles,
  required Widget content,
  required WindLogger logger,
}) {
  Widget widget = content;

  // Step A: Container decoration and constraints
  if (styles.decoration != null || styles.constraints != null) {
    widget = Container(
      decoration: styles.decoration,
      constraints: styles.constraints,
      child: widget,
    );
    logger.wrapWith('Container', 'decoration + constraints');
  }

  // Step B: Padding
  if (styles.padding != null) {
    widget = Padding(padding: styles.padding!, child: widget);
  }

  // Step C: Margin
  if (styles.margin != null) {
    widget = Padding(padding: styles.margin!, child: widget);
  }

  return widget;
}
```

- Conditional wrap — skip if null
- Log every step. Order: decoration → padding → margin → alignment → flex
## State Management

```dart
// Flutter-native ONLY. NO external packages (no BLoC, no Riverpod, no Provider).
final anchorState = WindAnchorStateProvider.of(context);
final Set<String> activeStates = {
  if (anchorState?.isHovering ?? false) 'hover',
  if (anchorState?.isFocused ?? false) 'focus',
};
```

- InheritedWidget + ChangeNotifier
- Theme via custom widget, not stock ThemeData
- Platform detection via static service class
## Barrel File

```dart
/// # Wind - Utility-First Styling for Flutter
library;

export 'src/parser/wind_parser.dart';
export 'src/parser/wind_style.dart';
export 'src/widgets/w_div.dart';
export 'src/widgets/w_text.dart';
export 'src/theme/wind_theme.dart';
```
## Strategy Pattern (Parsers)

```dart
abstract class WindParserInterface {
  bool canParse(String className);
  WindStyle parse(WindStyle styles, List<String>? classes, WindContext context);
}

class BackgroundParser implements WindParserInterface {
  @override
  bool canParse(String className) => className.startsWith('bg-');

  @override
  WindStyle parse(WindStyle styles, List<String>? classes, WindContext context) {
    // return styles.copyWith(decoration: ...)
  }
}
```
## Caching Strategy

```dart
static final Map<String, WindStyle> _styleCache = {};
// Key = className + breakpoint + brightness + platform + states
// Invalidation: automatic per unique context combination
```
## Comment Style

```dart
/// **The Fundamental Building Block of Wind**
///
/// ### Supported Features:
/// - **Flexbox:** `flex`, `flex-row`, `items-center`
/// - **Grid:** `grid`, `grid-cols-3`, `gap-4`
///
/// ### Example Usage:
/// ```dart
/// WDiv(
///   className: "flex flex-col gap-4 p-4 bg-gray-100",
///   children: [Text("Item 1")],
/// )
/// ```
class WDiv extends StatelessWidget {
```

- DartDoc (`///`) on ALL public APIs
- Markdown headers in class docs
- Code examples in every class-level doc
- Bold for feature categories

## Testing

- Mirror `lib/src/` structure: `test/parser/`, `test/widgets/`, `test/state/`, `test/theme/`
- `tester.pumpWidget()` with `wrapWithTheme()` helper
- Use `pump(Duration(...))` NOT `pumpAndSettle()` for animations
- `createTestContext()` for parser tests
