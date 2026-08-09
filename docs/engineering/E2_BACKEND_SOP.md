# FastAPI Backend — Standard Operating Procedure (SOP)

> **Version:** 3.0.0
> **Stack:** Python 3.12 · uv · FastAPI · PostgreSQL · Redis · Alembic
> **Audience:** AI coding agents and human developers
> **Enforcement:** pre-commit hooks + documented local checks

---

## 0. Standards This SOP Is Built On

Every rule below traces back to one of these external, versioned references
rather than to a personal preference. Where a rule departs from a source, it
says so and states why.

| Source | Version / date | Governs |
|---|---|---|
| [OWASP API Security Top 10](https://owasp.org/API-Security/editions/2023/en/0x11-t10/) | 2023 edition | Authorization, authentication, resource-consumption rules (§7–9) |
| [OWASP JSON Web Token Cheat Sheet](https://cheatsheetseries.owasp.org/cheatsheets/JSON_Web_Token_Cheat_Sheet.html) | current | Token issuance, validation, revocation (§7) |
| [FastAPI Best Practices — AGENTS.md](https://github.com/zhanymkanov/fastapi-best-practices) | community standard, 17k+ adopters | Dependency patterns, async rules, testing patterns, anti-patterns (§2–3, §11–13) |
| [Conventional Commits](https://www.conventionalcommits.org/en/v1.0.0/) | 1.0.0 | Commit and PR format (§14) |
| [Semantic Versioning](https://semver.org/) | 2.0.0 | This document's own version number, and release tagging |

**Deliberate departures from the community default, stated so they are not mistaken for oversights:**
- **Structure (§1):** the community standard organizes by domain (one package per bounded context). This SOP uses a layered structure instead (route / service / repository / model layers, each resource appearing once per layer). Both are valid; the layered form is chosen here because the boundary rules are mechanically checkable and it matches the structure most teams already have. The dependency, security, testing, and anti-pattern guidance is layout-independent and applies to either.
- **Enforcement (§4, §15):** the community standard assumes a CI runner (GitHub Actions). This SOP assumes none — enforcement runs through pre-commit hooks and a documented local check sequence. Every "Enforced by" reference reflects that.

---

## 1. Project Structure

A layered structure separated by responsibility: routes, business logic,
data access, and models each live in their own layer, and every resource
(`user`, `order`, `project`, …) appears once per layer rather than owning a
package of its own. This keeps the request path uniform — a route always
calls a service, a service always calls a repository — and makes the
boundary rules in 1.1–1.5 mechanical to check.

The layout below is generalized: `{resource}` is a placeholder for whatever
resources a given project defines. A project with `user` and `order`
resources has `routes/user.py` and `routes/order.py`, `services/user.py`
and `services/order.py`, and so on across each layer.

```
app/
├── api/
│   ├── v1/
│   │   ├── routes/
│   │   │   ├── __init__.py
│   │   │   └── {resource}.py     # one route module per resource
│   │   ├── router.py             # aggregates v1 routers under /api/v1
│   │   └── __init__.py
│   └── deps.py                   # shared Depends() — auth, db session, pagination
├── core/
│   ├── config.py                 # global pydantic-settings BaseSettings
│   ├── constants.py              # named constants, incl. rate limits
│   ├── exceptions.py             # application exception hierarchy
│   ├── logging.py                # structlog configuration
│   └── security.py               # JWT encode/decode, password hashing, denylist
├── db/
│   ├── base.py                   # declarative base + naming convention
│   └── session.py                # async engine + session factory
├── models/
│   ├── __init__.py
│   └── {resource}.py             # one ORM model module per resource
├── schemas/
│   ├── __init__.py
│   └── {resource}.py             # Create / Read / Update schemas per resource
├── services/
│   ├── __init__.py
│   └── {resource}.py             # business logic per resource
├── repositories/
│   ├── __init__.py
│   └── {resource}.py             # database queries per resource
├── middleware/
│   ├── __init__.py
│   └── logging.py                # request/response + request_id injection
└── main.py                       # app factory, lifespan, router mounting

tests/
├── unit/                         # services, security utils — no DB, no HTTP
├── integration/                  # full request -> service -> real Postgres
├── security/                     # authz boundaries, rate limits, tokens
└── conftest.py                   # shared fixtures — DB, Redis, client

alembic/
├── env.py                        # async migration environment
├── script.py.mako
└── versions/                     # migration files

alembic.ini
pyproject.toml
uv.lock
.env.example
.pre-commit-config.yaml
docker-compose.yml                # local dev — postgres + redis
```

**Rules**
1.1. The layer order is fixed: route → service → repository → database. A route MUST NOT import from `repositories/` or from SQLAlchemy directly, and a repository MUST NOT contain business logic. Cross-layer shortcuts are a boundary violation regardless of how small they seem.
1.2. Each resource appears at most once per layer — `services/user.py` owns all user business logic; there is no second place user logic lives. A file that begins handling more than one resource is split.
1.3. Shared, cross-cutting concerns live in `core/` and `api/deps.py`, never inside a single resource's module: JWT and password primitives in `core/security.py`, the current-user and DB-session dependencies in `api/deps.py`. Any resource's route may depend on these freely, because they belong to no single resource and so crossing into them is not a boundary violation.
1.4. Resource route modules (`api/v1/routes/{resource}.py`) are aggregated by `api/v1/router.py`, which `main.py` mounts once under the `/api/v1` prefix. Versioning lives in the path, so a future `/api/v2` can coexist without editing v1 modules.
1.5. `main.py` is the only place the app is instantiated. Startup/shutdown uses the `lifespan` context manager — not the deprecated `@app.on_event(...)` decorator, which does not reliably fire under a test transport (so anything initialized there, e.g. the rate limiter, silently never runs in tests).

---

## 2. Compatibility Matrix

Pin to at least these versions; examples in this document assume them.

| Dependency | Minimum | Why |
|---|---|---|
| Python | 3.12 | Modern typing (`X \| Y`, `StrEnum`) |
| FastAPI | 0.115 | `Annotated[T, Depends(...)]` is the idiomatic dependency form |
| Pydantic | 2.7 | v1 APIs (`json_encoders`, `.dict()`) are removed |
| pydantic-settings | 2.4 | Separate package since Pydantic v2 |
| SQLAlchemy | 2.0 | Async API (`AsyncSession`, `async_sessionmaker`) |
| Alembic | 1.13 | Async-aware migrations |
| httpx | 0.27 | `ASGITransport` for in-process tests |
| PyJWT | 2.9 | Actively maintained; `python-jose` is not |
| ruff | 0.6 | Replaces black, isort, autoflake |

---

## 3. Dependency Standards

Dependencies are tiered by whether the application actually needs them to
run correctly, not by whether they're nice to have. A package that only
does something once external infrastructure exists is not a MUST — treating
it as one contradicts the "no unwired dependency" rule below.

**Required — the app is not correct or safe without these:**
`fastapi[standard]`, `uvicorn[standard]`, `pydantic-settings`,
`sqlalchemy[asyncio]`, `asyncpg`, `alembic`, `redis[hiredis]`,
`pwdlib[argon2]`, `PyJWT`, `fastapi-limiter`, `structlog`.

**Required when the condition applies:**
- `httpx` — required as soon as the service makes any outbound HTTP call (to another service, a payment gateway, a third-party API). It's the async HTTP client; the point of requiring it is to keep the sync `requests` library out of `async def`, where it would block the event loop. A service that makes no outbound calls doesn't need it.

**Optional — add only when the backing service is actually running:**
- `sentry-sdk[fastapi]` — error tracking (exceptions + stack traces). Does nothing until a Sentry project exists to receive events. Add it when you have one; leave it out otherwise. **Configure with `send_default_pii=False`** — the SDK has had advisories around leaking session cookies and environment variables when PII forwarding is on, so keep it off and scrub sensitive fields.
- `prometheus-fastapi-instrumentator` — metrics (latency, error rates) at `/metrics`. Does nothing unless a Prometheus instance scrapes that endpoint. Add it when Prometheus exists; skip it otherwise. If added, keep `/metrics` off the public internet (§10) and wire it inside `lifespan`, not the package's deprecated `on_event` example.

The distinction: the Required tier keeps the app *running and debuggable*;
the Optional tier is for *watching it in production*, and both optional
packages depend on external infrastructure to mean anything — which is
exactly why they're optional, not mandatory.

**MUST NOT use — superseded, per current ecosystem consensus:**

| Package | Status | Use instead |
|---|---|---|
| `passlib[bcrypt]` | Unmaintained, broken on bcrypt 5.0 | `pwdlib[argon2]` |
| `python-jose` | Unmaintained | `PyJWT` |
| `slowapi` | Abandoned | `fastapi-limiter` |
| `requests` (in async code) | Sync, blocks the event loop | `httpx.AsyncClient`, or `run_in_threadpool` if a sync client is unavoidable |
| `async_asgi_testclient` | Unmaintained | `httpx.AsyncClient` + `ASGITransport` |
| `encode/databases` | In maintenance mode | SQLAlchemy 2.0 async API |

**Do not add a dependency with no wired consumer.** A package declared in
`pyproject.toml` but never imported (observability SDKs added "for later",
unused test-data factories) misrepresents what the system actually does —
add it when the code that uses it is written, not preemptively. The
Optional tier above is the concrete case: an unscraped Prometheus endpoint
or an unconfigured Sentry SDK is a dependency with no consumer.

**Rules**
3.1. All dependency management goes through `uv` — `uv add`, `uv sync` — never a bare `pip install`.
3.2. `[tool.ruff]` lint configuration lives under `[tool.ruff.lint]`. The older top-level `select` / `per-file-ignores` keys are legacy and are silently ignored on current Ruff releases — a security-relevant lint rule configured at the wrong nesting level is not actually running.
3.3. Coverage flags (`--cov`, `--cov-fail-under`) MUST be their own explicit invocation, not part of the global `[tool.pytest.ini_options] addopts`. Applying a repo-wide coverage floor to a partial test run (e.g. `pytest tests/unit/`) fails regardless of code quality, because it measures coverage of code that partial run never touched.

---

## 4. Environment & Local Enforcement

Bootstrap: `uv venv`, `uv sync --extra dev`, `uv run pre-commit install`.
Postgres and Redis run locally via `docker-compose.yml`; tests use
`pytest-postgresql` for a throwaway instance and `fakeredis` — no SQLite,
in dev or in tests, ever (behavioral differences in constraint enforcement
and type handling make it non-representative of production).

`.pre-commit-config.yaml` is this SOP's enforcement backbone. It MUST run,
in order: `ruff check --fix`, `ruff format`, `mypy`, `bandit -r app/ -ll`,
`pip-audit`. Without a CI runner behind this repository, a hook that is
skipped (`--no-verify`) or never installed is a rule that silently stopped
applying — treat `pre-commit install` as part of onboarding, not optional
setup.

`.env.example` holds placeholder values only, and MUST be updated whenever
a new environment variable is introduced anywhere in `app/`.

---

## 5. Configuration

A single `Settings(BaseSettings)` in `core/config.py`, loaded once and
imported everywhere as `settings`. In a layered structure the whole
application shares one settings object rather than splitting it per
resource — grouping related fields with comments keeps it readable without
fragmenting configuration across modules.

```python
# app/core/config.py
from pydantic import SecretStr, field_validator
from pydantic_settings import BaseSettings, SettingsConfigDict

class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", case_sensitive=False)

    # App
    ENV: str = "development"
    SECRET_KEY: SecretStr

    # Database / cache
    DATABASE_URL: str
    REDIS_URL: str = "redis://localhost:6379/0"

    # JWT
    JWT_ALGORITHM: str = "HS256"
    JWT_ACCESS_TOKEN_EXPIRE_SECONDS: int = 900   # 15 minutes
    JWT_REFRESH_TOKEN_EXPIRE_DAYS: int = 7

    @field_validator("JWT_ACCESS_TOKEN_EXPIRE_SECONDS")
    @classmethod
    def _cap_access_ttl(cls, v: int) -> int:
        if v > 900:
            raise ValueError("access token TTL must not exceed 900 seconds")
        return v

    @property
    def is_production(self) -> bool:
        return self.ENV == "production"

settings = Settings()
```

**Rules**
5.1. Secrets (`SECRET_KEY`, and any credential-bearing field) are typed `SecretStr`, never plain `str`, so they cannot be logged or repr'd by accident.
5.2. Configuration validates itself at import time and refuses to start on an invalid value — an access-token TTL over 15 minutes, or a `SECRET_KEY` under 32 characters, is a startup failure, not a runtime surprise.
5.3. `CORS_ORIGINS` is an explicit allow-list. `allow_credentials=True` combined with a wildcard origin MUST NOT occur — that combination defeats the purpose of enabling credentials in the first place.

---

## 6. Database & Migrations

6.1. SQLAlchemy 2.0 async API only (`AsyncSession`, `async_sessionmaker`) — no raw `text()` outside a documented, reviewed exception.
6.2. Table and constraint naming follows a fixed convention, applied via `MetaData(naming_convention=...)`, so index/constraint names are deterministic across the whole schema rather than auto-generated per dialect:

```python
POSTGRES_INDEXES_NAMING_CONVENTION = {
    "ix": "%(column_0_label)s_idx",
    "uq": "%(table_name)s_%(column_0_name)s_key",
    "ck": "%(table_name)s_%(constraint_name)s_check",
    "fk": "%(table_name)s_%(column_0_name)s_fkey",
    "pk": "%(table_name)s_pkey",
}
```

6.3. Tables are singular (`user`, `post`, not `users`, `posts`); the same foreign-key column name is used everywhere it appears (`profile_id`, not `user_id` in one table and `profile_id` in another).
6.4. Every migration has a working `downgrade()` and is reviewed line-by-line before being applied — autogenerate frequently misinterprets constraint changes.
6.5. A migration merged to a shared branch is never edited after the fact; a mistake gets a new migration.
6.6. No column is dropped without a deprecation period: stop writing to it, ship, confirm nothing reads it, drop it in a later migration.
6.7. No direct `ALTER TABLE` against a running database, in any environment.
6.8. `SELECT *` is not used in query code — columns or the ORM model are named explicitly.
6.9. SQL-first, Pydantic-second: joins, aggregation, and JSON shaping happen in SQL; Pydantic hydration is for response validation, not for transformation Postgres could do faster.

---

## 7. Authentication (OWASP API2:2023 — Broken Authentication)

Password hashing is Argon2id via `pwdlib` — the current OWASP-recommended
default, replacing bcrypt via the unmaintained `passlib`.

### 7.1 Token issuance and validation

Per the OWASP JWT Cheat Sheet: the signature is the only thing that
actually protects a token from tampering, so verification is mandatory,
the algorithm list is always explicit, and `alg: none` is never accepted.

```python
import jwt  # PyJWT
from jwt.exceptions import InvalidTokenError

def decode_token(token: str, expected_type: str) -> dict:
    try:
        payload = jwt.decode(token, settings.JWT_SECRET, algorithms=[settings.JWT_ALG])
    except jwt.ExpiredSignatureError as exc:
        raise TokenExpiredError() from exc
    except InvalidTokenError as exc:
        raise InvalidCredentials() from exc
    if payload.get("type") != expected_type:
        raise InvalidCredentials()
    return payload
```

**Rules**
7.1.1. The `algorithms=` argument to `jwt.decode` is always an explicit list, never inferred from the token header — this is the standard defense against algorithm-confusion attacks.
7.1.2. Every token carries a `type` claim (`"access"` or `"refresh"`), and `decode_token` takes an `expected_type` parameter and verifies it — a refresh token MUST be structurally incapable of being accepted where an access token is required.
7.1.3. An expired token and a tampered/malformed token are distinct exception types. Collapsing them hides tampering behind ordinary expiry noise in logs and audit trails.
7.1.4. Access token lifetime is short (≤ 15 minutes, per §5.2); refresh tokens live in an httpOnly, secure cookie — never in a location JavaScript can read.
7.1.5. The token subject (`sub`) is the user ID as a string (JWT requires string claims); parsing it back to a UUID on the server side is guarded, and a malformed subject produces a 401, not an unhandled 500.

### 7.2 Revocation

A `jti` (token ID) claim is only a control if something checks it. This SOP
requires an actual denylist, not a decorative claim:
- On logout, write `denylist:{jti}` to Redis with a TTL equal to the token's remaining lifetime.
- Every `decode_token` call checks `jti` against the denylist before trusting the payload.
- If Redis is unreachable at check time, fail closed — reject the token rather than trust it.

---

## 8. Authorization (OWASP API1, API3, API5:2023)

Three related OWASP risks apply directly to route design:

- **API1:2023 – Broken Object Level Authorization**: any endpoint that
  accepts an object ID (`GET /users/{id}`) must verify the caller is
  allowed to access *that specific object*, not just that they're
  authenticated.
- **API3:2023 – Broken Object Property Level Authorization**: a response
  schema must not expose fields the caller isn't entitled to see, and a
  request schema must not let the caller set fields they aren't entitled
  to set (mass assignment).
- **API5:2023 – Broken Function Level Authorization**: admin-only actions
  need their own guard, distinct from "is this user logged in."

**Rules**
8.1. Every route has an explicit `Depends()` guard establishing who may call it. A route with no guard MUST be an intentional, reviewed decision (public health check, public signup) — never a default.
8.2. Any route returning a resource by ID validates ownership (or superuser status) inside a dependency or the service layer, and does so for every call — not cached, not assumed from a prior check earlier in the request.
8.3. Response schemas exclude sensitive fields by construction (a `UserRead` schema simply has no `hashed_password` field) rather than by remembering to strip it before returning.
8.4. Request schemas for user-supplied input do not include fields the server assigns (`is_superuser`, `id`, `created_at`) — accepting them from the client body is a mass-assignment vulnerability even if a check elsewhere seems to catch it.
8.5. A security test asserting an authorization boundary must exercise a route that exists. A test against a non-existent endpoint that asserts "403 or 404" passes for the wrong reason — write the endpoint and its guard first, then write the test against the real behavior.

Dependency pattern, chained for reuse (the standard FastAPI idiom):

```python
async def valid_post(post_id: UUID4) -> Post:
    post = await service.get_by_id(post_id)
    if not post:
        raise PostNotFound()
    return post

async def valid_owned_post(
    post: Annotated[Post, Depends(valid_post)],
    token_data: Annotated[dict, Depends(parse_jwt_data)],
) -> Post:
    if post.owner_id != token_data["user_id"]:
        raise UserNotOwner()
    return post
```

Use `Annotated[T, Depends(...)]`, not the default-argument
`x: T = Depends(...)` form — the `Annotated` form is idiomatic since
FastAPI 0.95 and avoids default-value edge cases. Dependencies are cached
per request: the same `Depends(x)` referenced five times in one request
graph runs once.

---

## 9. Rate Limiting & Resource Consumption (OWASP API4, API6:2023)

Unrestricted resource consumption (API4) and unrestricted access to
sensitive business flows (API6) are addressed the same way: every
sensitive or expensive endpoint declares an explicit, named limit.

```python
@dataclass(frozen=True)
class RateLimit:
    times: int
    seconds: int

AUTH_RATE_LIMIT = RateLimit(times=5, seconds=60)     # login, signup, password reset
PUBLIC_RATE_LIMIT = RateLimit(times=60, seconds=60)   # general authenticated traffic
```

**Rules**
9.1. Rate limits are named constants, referenced by routes — a route MUST NOT inline `times=10, seconds=60` directly, since an inlined limit can't be audited or changed in one place.
9.2. Authentication endpoints (login, signup, token refresh, password reset) use the stricter limit — these are the endpoints credential-stuffing and brute-force attacks target.
9.3. File uploads are validated on MIME type, extension, and size before being accepted, not after.

---

## 10. Logging & Observability

Four layers: application (`structlog.get_logger(__name__)`), request/response
(middleware — method, path, status, duration, `request_id`), audit/security
(a separate stream for login attempts, 403s, 429s, admin actions), and infra
(uvicorn + SQLAlchemy routed through structlog rather than left as
independent stdlib loggers).

**MUST NEVER be logged:**
- Passwords, tokens, API keys, secrets
- Full request or response bodies
- Raw query parameters (may contain tokens)
- `Authorization` or `Cookie` headers
- Raw email addresses — hash first, and treat the hash as pseudonymous, not anonymous: an unsalted hash of a known address is still enumerable.
- Anything via bare `print()` — enforced by Ruff's `T201`, which only fires if `[tool.ruff.lint]` is configured correctly (§3.2).

JSON rendering in production (machine-parseable, ingestible by log
aggregation); human-readable console rendering in development. Never the
reverse.

`/metrics` (Prometheus) is not publicly reachable in production without at
least network-level restriction — an open metrics endpoint leaks internal
topology and request volume, which is itself a minor instance of
API8:2023 – Security Misconfiguration.

Of the four layers above, structured logging is required (a service must be
debuggable). Error tracking (Sentry) and metrics (Prometheus) are the
optional tier from §3 — valuable, but only once the backing service exists
to receive events or scrape the endpoint. A service with neither is still
compliant with this SOP; a service that declares them but wires up neither
is not (§3, "no unwired dependency").

---

## 11. API Layer

11.1. **Async/sync decision rule** (community standard):

| Route does | Use |
|---|---|
| Awaitable non-blocking I/O | `async def` |
| Blocking I/O with no async client available | `def` (sync — FastAPI runs it in a threadpool) |
| Mix of both | `async def` + `run_in_threadpool` for the blocking part |
| CPU-bound work (>50ms compute) | Offload to a worker process (Celery / Arq / RQ), not the request path |

A blocking call inside `async def` (`time.sleep`, `requests.get`, a sync DB
driver) blocks the entire event loop for every request on that worker, not
just the one that made the call — this is the single most common
AI-agent-introduced bug in FastAPI codebases per the community standard.

11.2. `docs_url`, `redoc_url`, `openapi_url` are disabled in production environments.

11.3. Routes are thin: parse via a Pydantic schema, call one service method, translate domain exceptions to HTTP status codes. Business logic does not live in a route function.

11.4. `BackgroundTasks` is for fire-and-forget work under one second where a dropped task on worker crash is acceptable (welcome emails, logging). Anything requiring retries, scheduling, or reliability guarantees uses a real task queue (Celery / Arq / RQ) — `BackgroundTasks` runs in-process after the response is sent and has no retry mechanism.

11.5. Exception handling around a route body catches the specific domain exception and raises the corresponding `HTTPException`. A bare `except Exception` around a route silently turns failures into whatever status the handler defaults to, and hides the actual error from the tracker.

---

## 12. Testing

Three tiers: unit (services, security utilities — no DB, no HTTP, no
Redis), integration (full HTTP → route → service → real throwaway
Postgres, `fakeredis`), security (authorization boundaries, rate-limit
enforcement, token validation, mapped to §7–9).

```python
import pytest
from httpx import AsyncClient, ASGITransport
from app.main import app

@pytest.fixture
async def client():
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://test") as ac:
        yield ac
```

**Rules**
12.1. `httpx.AsyncClient` with `ASGITransport` is the test client — not `async_asgi_testclient`, which is unmaintained.
12.2. Auth and other external dependencies are swapped in tests via FastAPI's `app.dependency_overrides`, not by monkeypatching internals.
12.3. The database is never mocked in integration tests — a mock/production divergence eventually surfaces in production. Use the real throwaway Postgres instance.
12.4. Row-level test isolation uses a SAVEPOINT pattern (nested transaction rolled back after each test), not teardown-time rollback — if a repository method calls `session.commit()`, a rollback issued only at teardown does nothing, because the commit already released what the rollback would have undone, and rows leak into subsequent tests.
12.5. Do not redefine a session-scoped `event_loop` fixture — it is deprecated in current `pytest-asyncio`. Set `asyncio_default_fixture_loop_scope` in `pyproject.toml` instead.
12.6. Coverage is run as its own explicit full-suite command (§3.3), never inferred from a partial test run.
12.7. Tests do not depend on execution order; each test creates its own data.
12.8. No `time.sleep()` in tests — use `asyncio.sleep()`, or mock time entirely; enforced by `pytest-timeout`.

---

## 13. Coding Practices — Anti-Patterns

The community AI-agent standard maintains this as a table specifically
because these are the failure modes agents introduce most often. Treated
here as binding, not illustrative.

| Anti-pattern | Why it's wrong | Fix |
|---|---|---|
| `requests.get(...)` inside `async def` | Blocks the event loop | `httpx.AsyncClient`, or `run_in_threadpool` |
| `time.sleep()` / sync DB driver inside `async def` | Same — blocks the loop | `asyncio.sleep()`, async driver |
| `from jose import jwt` | `python-jose` unmaintained | `import jwt` (PyJWT) |
| `model_config = ConfigDict(json_encoders={...})` | Deprecated in Pydantic v2 | `@field_serializer` |
| `Field(ge=18, default=None)` | Constraint contradicts the default | Pick required or optional, not both |
| `def get_user(id: int = Depends(...))` | Legacy default-arg form | `Annotated[User, Depends(...)]` |
| Bare `except Exception` around a route body | Hides bugs, turns 500s into silent 200s | Catch the specific domain exception |
| `BackgroundTasks` for anything you'd page on | No retry, dies with the worker | Celery / Arq / RQ |
| Returning a Pydantic model *and* setting `response_model=` to the same class | Model constructed twice | Return the ORM row/dict and let `response_model` validate, or drop `response_model` |
| Route importing a repository or SQLAlchemy directly | Skips the service layer, bleeds data access into the route | Route → service → repository (§1.1) |
| Business logic inside a repository or a route | Breaks the layer contract, becomes untestable | Business logic lives only in `services/` |
| Mocking the database in integration tests | Mock/prod divergence surfaces later | Real throwaway Postgres + `dependency_overrides` for external services |

Additional non-negotiables: one responsibility per file (a service file
owns one resource); named constants for any value with security or
business meaning (§9.1); small, single-purpose functions; typed schemas
at every function boundary instead of raw `dict`.

---

## 14. Git & Commit Standard (Conventional Commits 1.0.0)

Commit messages follow the specification exactly:

```
<type>[optional scope]: <description>

[optional body]

[optional footer(s)]
```

**Standard types:** `feat` (new capability — MINOR version bump), `fix`
(bug patch — PATCH version bump), `docs`, `style`, `refactor`, `perf`,
`test`, `build`, `ci`, `chore`. A breaking change is marked either with
`!` after the type/scope (`feat!:` or `feat(auth)!:`) or a
`BREAKING CHANGE:` footer, and correlates to a MAJOR version bump
regardless of type.

**Branch naming:** `feature/`, `fix/`, `security/`, `chore/`, `docs/`,
followed by a ticket reference and short description. `security/` branches
require a review with security context specifically.

**Before opening a PR, run locally** (§15) and report the output in the
PR description — `ruff check`, `ruff format --check`, `mypy`, `bandit`,
`pip-audit`, `alembic upgrade head` against a fresh database, the full
test suite, and coverage. There is no CI artifact to point to instead, so
the reviewer asks for this explicitly if it's missing.

**Merge rules:** minimum one approval; squash merge; no direct push to
`main`/`develop`; no merge without the local check output reported clean.

---

## 15. Quick Reference — Local Check Sequence

```bash
uv sync --extra dev
uv run ruff check --fix app && uv run ruff format app
uv run mypy app/
uv run bandit -r app/ -ll
uv run pip-audit
uv run alembic upgrade head
uv run pytest tests/unit/ -v
uv run pytest tests/integration/ tests/security/ -v
uv run pytest --cov=app --cov-report=term-missing --cov-fail-under=80
```

Any red output blocks the PR. In the absence of a hosted pipeline, this
sequence is the enforcement layer in full — there is nothing downstream
that catches what it misses.

---

## Appendix A — Organization-Specific Tooling (non-standard)

Everything above this line is grounded in an external, versioned standard
(§0). The following is environment-specific tooling, kept separate so it
is never mistaken for a general convention:

- **Ponytail** (internal scaffolding): generates route/schema/service/repo
  boilerplate only. It MUST NOT generate business logic, security guards,
  or migration files, and every output is treated as an unreviewed first
  draft subject to the full local check sequence (§15) before it's
  considered committable.
- **Context7 / Semgrep MCP / adversarial review tooling**: supplementary
  aids for pulling live framework docs and flagging anti-patterns inline;
  none of these substitute for the rules in §7–9 being satisfied by a
  human-reviewed diff.

---

*This SOP is a living document, versioned per Semantic Versioning 2.0.0.
A change to a rule, an enforcement mechanism, or a cited standard's
version is a MINOR bump; a restructuring that breaks compatibility with
prior guidance is a MAJOR bump. Every change goes through a PR, per §14.*
