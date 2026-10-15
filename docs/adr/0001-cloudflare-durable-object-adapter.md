# ADR 0001: Run Convex apps on a Cloudflare Durable Object

Status: accepted, version 1 of the adapter contract
Date: 2026-10-15

## Context

Parlor games keep their rules in Convex function modules (`convex/*.ts`), and
their clients talk to Convex through `convex/react` and `convex/browser`. The
Misty Step hosting contract moves every app-serving boundary, including hosted
databases and realtime backends, onto Cloudflare. Linejam is the first game to
move, and Poppycock is waiting on the same decision. Rewriting each game's
backend for D1 or a bespoke Worker API would fork the game logic. It would also
break the clients and drop the semantics the games rely on: serializable
transactions, reactive queries, the scheduler and crons.

## Decision

Add `@parlor/cloudflare` (`integrations/cloudflare`). It runs an unchanged
Convex app on one SQLite-backed Durable Object and serves the Convex client
protocol from that object.

- **Hosting.** One object (`idFromName("convex")`) holds the whole deployment:
  documents, indexes, the scheduler, crons, mutation receipts and live sync
  sessions. `forwardToBackend(request, namespace, basePath)` sends one URL
  prefix (Linejam uses `/backend`) to it. The app's Worker can therefore serve
  the backend from its own origin, with no new zone or DNS record.
- **Functions.** The adapter calls the app's registered functions through the
  same `globalThis.Convex` syscall interface the Convex runtime provides. Game
  code, `_generated/*` and `convex-helpers`-style wrappers run unmodified.
  `AsyncLocalStorage` scopes syscalls to their execution, so the Worker needs
  `nodejs_compat`.
- **Transactions.** Queries and mutations run one at a time behind a lock, and
  each mutation commits atomically with `transactionSync`. That is serializable
  by construction. Actions run outside the lock, and every `ctx.run*` call they
  make is its own transaction, as in Convex.
- **Storage.** Documents are stored as Convex JSON. Each index is a table of
  order-preserving keys: a prefix-free byte encoding, stored as hex, that sorts
  exactly like `compareValues`, NaN signs and payloads included. Index ranges,
  `order`, `filter`, `take`, `first`, `unique`, `paginate` and `count` follow
  Convex semantics, including the implicit `by_id` and `by_creation_time`
  indexes. Filter and limit stages run in the order the query applied them.
  Each page of `paginate()` runs the pipeline afresh from its cursor, so a
  `limit()` before it bounds each page and ends pagination once full.
- **IDs.** Document IDs use Convex's own v6 format, checked against IDs minted
  by a real backend: `base32(vint(table) ++ 16 random bytes ++ fletcher16)`.
  Table numbers start at 10001, and `_tables` numbers are kept on import. So
  `normalizeId`, `v.id()` and stored references agree with Convex, and a
  snapshot can move between Convex and this adapter in either direction.
- **Reactivity.** Each query records the half-open key intervals it read. A
  commit re-runs only the subscriptions whose intervals contain a changed key.
  Transitions carry a single commit timestamp. Paginated subscriptions keep
  their page end through the protocol journal.
- **Protocol (version 1).** Supported surface:
  - WebSocket `/api/<client version>/sync`, with these messages: `Connect`,
    `ModifyQuerySet`, `Mutation`, `Action`, `Authenticate`, `Event`,
    `Transition`, `MutationResponse`, `ActionResponse`, `AuthError`,
    `FatalError`, `Ping`.
  - HTTP `POST /api/query|mutation|action`, with Convex's request bodies,
    response bodies and its 560 status for function errors.
  - HTTP actions under `/http/*`.
  - Mutation responses carry their commit timestamp. Retries from a
    reconnecting client replay the stored result exactly once, using
    `(sessionId, requestId)` receipts kept for seven days.
  - Frames are handled in order, except that an admitted action runs alongside
    later frames with the identity in force when it was admitted. A connection
    may run 32 actions at once; more are refused, not queued.
  - Socket frames may carry 1 MiB and HTTP request bodies 8 MiB, counted in
    UTF-8 bytes as they arrive, whatever `Content-Length` claims.
- **Auth.** OIDC providers (`domain` plus `applicationID`) and `customJwt`
  providers come from the app's `auth.config.ts`. Tokens are verified with
  RS256 or ES256 against cached JWKS. A token must carry a finite numeric
  `exp`, and `nbf` and `iat` must be numbers when present, so every identity
  expires. Identities map claims exactly as Convex does
  (`tokenIdentifier = iss|sub`, and so on).
- **Errors.** In production, unexpected errors are replaced by "Server Error".
  `ConvexError` messages and data reach the client unchanged.
- **Scheduler and crons.** `ctx.scheduler.runAfter/runAt/cancel` write
  `_scheduled_functions` rows, with their arguments as Convex values, in the
  caller's transaction. A Durable Object alarm runs due jobs. A scheduled
  mutation's state change commits atomically with its writes. A job or cron
  whose module fails to load is recorded as failed and never holds up the
  others. Actions cut off by a restart or a freeze are marked failed once
  writes resume. `cronJobs()` schedules (interval, hourly, daily, weekly,
  monthly, cron) run from the same alarm.
- **Operations.** Admin routes under `/admin/*` require a bearer key of at
  least 32 characters from a configured binding, compared in constant time.
  - `freeze` is the single-writer barrier. While frozen, the backend admits no
    mutation, action, HTTP action (503), scheduled function or cron, whoever
    calls, and commits no write except an import. The freeze takes the
    database lock, so its response carries the timestamp of the last accepted
    write. An action already running can no longer write. Queries and
    subscriptions keep working. A new deployment starts frozen.
  - `status` reports that timestamp, `writesFrozen`, `importPending` and the
    number of running actions.
  - `import/begin` (frozen only) validates the snapshot's table names and
    numbers before anything changes, then replaces all data in one
    transaction and refreshes every live subscription. `import/documents`
    loads a snapshot page, keeping IDs, creation times and table numbers.
    `import/commit` succeeds only when every table's count and checksum equal
    the snapshot's. Writes cannot be unfrozen while an import is pending.
  - `export` pages documents in the Convex ZIP's JSONL shape, each page with
    the timestamp it was read at. An export is consistent when every page
    reports the same timestamp while frozen.
  - `stats` returns per-table counts and canonical SHA-256 digests. The same
    digests can be computed from a Convex export ZIP, which makes migrations
    and rollbacks checkable without comparing database files.
- **Moving data out.** To hand writes to another backend without losing one:
  freeze; wait until `status` shows no running actions; export every table
  and require one timestamp across pages; restore elsewhere and require equal
  checksums; then make the other backend the only writer. Until that
  handover, a failure is undone by unfreezing, because nothing was accepted
  after the freeze.
- **Testing.** `@parlor/cloudflare/testing` exports a `convex-test`-compatible
  `convexTest(schema, modules)` backed by this runtime, using in-memory
  `node:sqlite`. An app can run its existing Convex test suite against the
  adapter by aliasing `convex-test`.

## Not supported in version 1

These fail loudly rather than misbehaving:

- File storage (`ctx.storage`).
- Search and vector indexes, which are rejected when the schema loads.
- Components.
- Admin-key function calls.
- `query_at_ts`.
- Streaming import and export.
- NaN payloads beyond what the JavaScript engine keeps. Keys order every IEEE
  bit pattern as `compareValues` does, but V8 may canonicalize a NaN stored in
  an array of doubles, which `compareValues` itself does internally.

Throughput is bounded by one object, so this suits a game backend, not a
high-write analytics store. Any of these needs a new ADR and a protocol
version bump.

## Consequences

- Games keep one copy of their rules and their current clients. The cutover
  for an app is a URL change plus a data move that can be checked.
- `@parlor/convex` and its consumers are untouched. Apps opt in per
  deployment.
- The adapter owns the correctness of a database engine. Its tests run the
  real `ConvexClient` over the sync protocol, pin ID and key ordering against
  Convex, and run each app's own Convex suite against the runtime. Any change
  to `convex` that touches the syscall or sync protocol must re-run them.
- Convex Cloud remains a working rollback target. A snapshot exported from the
  adapter imports into Convex with the same IDs, as long as `_tables` numbers
  are kept.
