# PHP / Laravel Conventions

## PHP 7.4

No promoted props, no enums, no match, no union types:

```php
// Manual constructor assignment
public function __construct(SkillDiscovery $discovery)
{
    $this->discovery = $discovery;
}

// Enums → class constants
public const ACTIVE = 'active';
public const ALL = [self::ACTIVE, self::INACTIVE];

// Union types → PHPDoc
/** @param string|int $identifier */
public function find($identifier) { ... }
```

## PHP 8.0

Promoted props, match, union types, named args. NO enums, NO readonly:

```php
public function __construct(
    protected SkillDiscovery $discovery,
    protected bool $cacheEnabled = true,
) {}

return match ($status) {
    'active' => 'Active',
    default => 'Unknown',
};

public function find(string|int $identifier): ?Product
```

## PHP 8.1+

Backed enums, readonly properties, intersection types, fibers.

## PHP 8.2+

readonly class, standalone null/true/false types, DNF types.

## PHP 8.4+

Property hooks (virtual/backed), asymmetric visibility, `new` without parens, array functions:

```php
// Property hooks — get/set on class properties
class Product extends Model
{
    public string $fullName {
        get => "{$this->firstName} {$this->lastName}";
    }
    public string $slug {
        set(string $value) => strtolower(trim($value));
    }
}

// Asymmetric visibility — public read, restricted write
class Settings
{
    public function __construct(
        public private(set) string $apiKey,
        public protected(set) int $timeout = 30,
    ) {}
}

// new without parentheses — chainable
$name = new ReflectionClass(Product::class)->getName();

// New array functions
$first = array_find($items, fn($v) => $v->isActive());
$hasAdmin = array_any($users, fn($u) => $u->isAdmin());
$allValid = array_all($entries, fn($e) => $e->isValid());

// #[\Deprecated] attribute — triggers deprecation notice
#[\Deprecated('Use findByUuid() instead', since: '2.1')]
public function findById(int $id): ?Product { ... }

// Implicit nullable removed — explicit ?Type required
public function setName(?string $name): void  // correct
// public function setName(string $name = null): void  // deprecated
```

## PHP 8.5+

Pipe operator, clone with overrides, `#[\NoDiscard]`, array_first/array_last, final property promotion:

```php
// Pipe operator — left-to-right function composition
$result = $input
    |> trim(...)
    |> strtolower(...)
    |> fn($s) => str_replace(' ', '-', $s);

// Clone with property overrides
$usd = new Money(1000, 'USD');
$eur = clone $usd with {currency: 'EUR'};

// #[\NoDiscard] — warns if return value is ignored
#[\NoDiscard('Check the result for errors')]
public function save(): Result { ... }

// array_first / array_last — no callback needed
$first = array_first($items);
$last = array_last($items);

// Final property promotion — prevents override in child classes
public function __construct(
    public final string $id,
) {}
```

---

## Naming Conventions

| Element | Convention | Example |
|---------|-----------|---------|
| Class | PascalCase | `ProductTranslationService` |
| Method | camelCase | `findOrCreate`, `bootSkillsIfNeeded` |
| Variable / Property | camelCase | `$targetLocale`, `protected array $loaded = []` |
| Constant / Enum Case | UPPER_SNAKE | `case ACTIVE = 'active'` |
| Config Key | snake_case | `services.stripe.secret_key` |
| DB Column | snake_case | `current_team_id`, `image_path` |
| Route Name | kebab-case dotted | `ai-product-creator.translate-product` |
| Route URL Prefix | camelCase | `productTypes`, `aiProductCreator` |
| Form Request | `StoreRequest`, `UpdateRequest` | Grouped by entity folder |
| Resource | `{Model}Resource` | `ProductResource` |
| Service | `{Domain}Service` | `ProductTranslationService` |
| Contract | `{Domain}ServiceContract` | `BarcodeScannerServiceContract` |
| Support | `{Domain}Support` | `ImageSupport`, `StringSupport` |
| Scope | `{Name}Scope` | `TeamScope` |

---

## Directory Structure (Application)

```
app/
├── Console/              # Artisan commands
├── Contracts/            # Interfaces
├── Enums/                # String-backed enums
├── Events/
├── Exceptions/
├── Http/
│   ├── Controllers/
│   │   └── API/          # API controllers (own namespace)
│   ├── Middleware/
│   ├── Requests/         # Grouped: Requests/Product/StoreRequest.php
│   └── Resources/        # JsonResource classes
├── Jobs/
├── Listeners/
├── Models/
│   ├── Concerns/         # Shared model logic
│   ├── Scopes/           # Global scopes (TeamScope)
│   └── Traits/           # Model-specific traits
├── Policies/
├── Providers/
├── Rules/                # Custom validation rules
├── Services/             # Business logic
│   └── BarcodeScanners/  # Sub-domain grouping
└── Supports/             # Static utility classes (plural)
```

- Form Requests grouped by entity: `Requests/Product/StoreRequest.php`, NOT `StoreProductRequest.php`
- Utility classes in `Supports/` (plural), not `Helpers/`

## Directory Structure (Package)

```
src/
├── Console/
├── Enums/
├── Support/              # Core logic (singular for packages)
├── Tools/
├── Traits/               # Primary integration: trait-first API
└── SkillsServiceProvider.php
config/
stubs/
tests/
    ├── Unit/
    └── Feature/
```

- Package API is **trait-first**: `use Skillable;` not extend a base class
- Single ServiceProvider per package. No Facades unless necessary.

---

## Controller Pattern

```php
class ProductController extends Controller
{
    protected SubscriptionUsageService $subscriptionUsageService;

    public function __construct(SubscriptionUsageService $subscriptionUsageService)
    {
        $this->subscriptionUsageService = $subscriptionUsageService;
    }

    /** List products with search, filters, and pagination. */
    public function index(Request $request): AnonymousResourceCollection
    {
        $query = Product::search($request->get('search'));
        $products = $query->paginate(25);

        return ProductResource::collection($products);
    }

    /** Create a new product inside a DB transaction. */
    public function store(StoreRequest $request): ProductResource
    {
        $attributes = $request->validated();

        $product = DB::transaction(function () use ($attributes) {
            return Product::create([
                ...$attributes,
                'team_id' => auth()->user()->current_team_id,
            ]);
        });

        return new ProductResource($product);
    }

    /** Show with authorization and eager-loaded relations. */
    public function show(Product $product): ProductResource
    {
        Gate::authorize('view', $product);
        $product->load('productType.icon', 'barcodes', 'tags');
        return new ProductResource($product);
    }
}
```

- Return types ALWAYS explicit
- `store`/`update` use Form Requests, NOT inline validation
- `show`/`update` use `Gate::authorize()`
- Multi-model writes in `DB::transaction()`
- Spread operator: `[...$attributes, 'team_id' => ...]`

---

## Model Pattern

```php
/**
 * @property string $id
 * @property string $name
 * @property string $team_id
 * @property-read Collection<int, Barcode> $barcodes
 */
class Product extends Model
{
    use HasFactory, HasUuids, Searchable;

    protected $fillable = [
        'team_id',
        'name',
        'description',
    ];

    protected static function booted(): void
    {
        static::addGlobalScope(new TeamScope);
    }

    public function team(): BelongsTo
    {
        return $this->belongsTo(Team::class);
    }

    public function barcodes(): BelongsToMany
    {
        return $this->belongsToMany(Barcode::class);
    }
}
```

- UUID primary keys via `HasUuids`
- Multi-tenancy via `TeamScope` in `booted()`
- `$fillable` (NOT `$guarded`)
- Explicit relation return types
- `toAiString()` on models needing AI representation

---

## Service Pattern

```php
class ProductTranslationService
{
    // Promoted constructor (preferred for services/packages)
    public function __construct(
        protected SkillDiscovery $discovery,
        protected bool $cacheEnabled = true,
        protected int $cacheTtl = 3600,
    ) {}

    /** Orchestrate finding or creating a translated product. */
    public function findOrCreate(Team $team, User $user, array $data): GlobalProduct
    {
        // 1. Check if already exists.
        if ($existing = $this->findProductByLocale(...)) {
            return $existing;
        }

        // 2. Find base product as translation source.
        $base = $this->findBaseProduct(...);

        try {
            // 3. Translate via AI.
            $translated = $this->translateViaAI($base, $data['locale']);

            // 4. Create and return.
            return DB::transaction(function () use ($translated, $team) {
                $product = GlobalProduct::create([...$translated, 'team_id' => $team->id]);
                $this->syncBarcodes($product, collect($translated['barcodes']));

                return $product;
            });
        } catch (Throwable $exception) {
            report($exception);
            throw new RuntimeException('Failed to translate product.');
        }
    }

    private function findProductByLocale(string $locale, ?int $id, ?string $barcode): ?GlobalProduct { ... }
    private function findBaseProduct(?int $id, ?string $barcode): ?GlobalProduct { ... }
    private function syncBarcodes(GlobalProduct $product, Collection $barcodes): void { ... }
}

// readonly class for value objects
readonly class Skill
{
    public function __construct(
        public string $name,
        public string $description,
        public array $tools,
    ) {}
}
```

- One public orchestrator + private helpers
- Error: `catch (Throwable)` → `report()` → throw user-friendly
- Deps via constructor OR method params
- Promoted constructor preferred; `readonly class` for value objects

---

## Form Request Pattern

```php
class StoreRequest extends FormRequest
{
    public function authorize(): bool
    {
        return Auth::check();
    }

    public function rules(): array
    {
        return [
            'name' => ['required', 'string', 'max:255'],
            'productType.id' => ['nullable', 'exists:product_types,id,team_id,' . auth()->user()->current_team_id],
            'barcodes' => ['nullable', 'array'],
            'barcodes.*.code' => ['nullable', new BarcodeRule],
        ];
    }
}
```

- Rules ALWAYS arrays, never pipe-delimited
- `exists` rules include team scoping
- Custom Rule objects for domain validation
- Nested: `'productType.id'`, `'barcodes.*.code'`

---

## API Resource Pattern

```php
/**
 * @mixin Product
 */
class ProductResource extends JsonResource
{
    public function toArray(Request $request): array
    {
        return [
            'id' => $this->id,
            'name' => $this->name,
            'available_quantity' => $this->whenLoaded('productLocations', function () {
                return $this->available_quantity;
            }),
            'productType' => new ProductTypeResource($this->whenLoaded('productType')),
            'tags' => TagResource::collection($this->whenLoaded('tags')),
            'image' => $this->image_path ? Storage::cloud()->url($this->image_path) : null,
        ];
    }
}
```

- `@mixin Model` for IDE autocomplete
- `whenLoaded()` prevents N+1
- Nested resources for related models
- URLs computed in resource, not stored in DB

---

## Route Organization

```php
Route::middleware('auth:sanctum')->group(function () {
    Route::prefix('products')->group(function () {
        Route::get('/', [ProductController::class, 'index'])->name('products.index');
        Route::post('/', [ProductController::class, 'store'])->name('products.store');
        Route::get('{product}', [ProductController::class, 'show'])->name('products.show');
        Route::put('{product}', [ProductController::class, 'update'])->name('products.update');
    });
});
```

- `Route::prefix()->group()`, NOT `Route::resource()` (explicit > implicit)
- URL prefixes: camelCase. Names: kebab-case with dots.
- Throttle middleware on expensive endpoints individually

---

## Enum Pattern

```php
enum SubscriptionStatus: string implements HasLabel
{
    case ACTIVE = 'active';
    case INACTIVE = 'inactive';
    case CANCELED = 'canceled';

    public function getLabel(): string
    {
        return match ($this) {
            self::ACTIVE => __('Active'),
            self::INACTIVE => __('Inactive'),
            self::CANCELED => __('Canceled'),
        };
    }

    /** Try from input with alias support. */
    public static function tryFromInput(mixed $value): ?self
    {
        return match (strtolower(trim($value))) {
            'lite', 'lazy' => self::Lite,
            'full', 'eager' => self::Full,
            default => null,
        };
    }
}
```

- ALWAYS string-backed, UPPER_SNAKE case names
- Implement `HasLabel` for UI
- `tryFromInput` with alias support

---

## Import Style

```php
use App\Models\Product;
use Illuminate\Support\Facades\DB;
use RuntimeException;
use Throwable;
```

- Group: PHP built-ins → Framework → App → same namespace
- Import exceptions: `use RuntimeException;` (never `\RuntimeException`)
- One use per line

---

## Comment Style

```php
/** @mixin Product */                              // Resource type hint
class ProductResource extends JsonResource

/** @property string $id */                        // Model property hints
/** @property-read Collection<int, Barcode> $barcodes */

/** Determine if the skill has any tools. */       // Single-line docblock
public function hasTools(): bool

/** @throws RuntimeException */                    // Multi-param: full block
public function findOrCreate(Team $team, array $data): GlobalProduct
```

---

## Service Provider (Package)

```php
class SkillsServiceProvider extends ServiceProvider
{
    public function register(): void
    {
        $this->mergeConfigFrom(__DIR__ . '/../config/skills.php', 'skills');

        $this->app->singleton(SkillDiscovery::class, fn ($app) => new SkillDiscovery(
            paths: config('skills.paths', [resource_path('skills')]),
            cacheEnabled: ! $app->environment('local', 'testing'),
        ));
    }

    public function boot(): void
    {
        if ($this->app->runningInConsole()) {
            $this->publishes([...], 'skills-config');
            $this->commands([...]);
        }
    }
}
```

- `mergeConfigFrom()` in `register()`
- `publishes()`/`commands()` inside `runningInConsole()`
- Defensive config with sensible fallbacks
- `singleton` for shared state, `scoped` for request-lifecycle

---

## Testing

```
tests/
├── Feature/    # Full HTTP cycle
└── Unit/       # Isolated logic (services, value objects)
```

- Naming: `test_{action}_{condition}_{expected_result}`
- Every test method has `: void` return type
