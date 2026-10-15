# ADR 0001: One canonical behavior specification

Status: accepted for implementation, 2026-10-15; independent review required before merge.

## Context

The foundations audit t_1133c3dc found four accurate but incomplete stories in
USER_STORIES.md and an obsolete proposed status/evidence reference for the shipped
website. Powder item `parlor-foundations-spec-20261014`, commissioned by Kaylee,
authorizes consolidation and verification, not behavior changes.

## Decision

The implementing engineer in t_a1c6aa6d classifies US-004 as live based on the
shipped website and executable browser checks, subject to independent designer
review. This resolves the old “pending operator review” label; MIS-167 is historical
context, not acceptance evidence. “Live” means implemented, not universal device
or deployment certification. A failing criterion remains a defect, not a reason to
weaken the contract; the gallery-link defect is owned by sibling t_4c69e952.

SPEC.md is the sole behavioral catalog, using the Linejam pilot's capability and
`### US-<digits> [live|next|later] <title>` headings. Preserve US-001 through US-004;
new IDs cover source-backed shipped behavior, with no speculative backlog. The
website has separate capability sections from the reusable toolkit and examples.
USER_STORIES.md is a compatibility pointer, never a synchronized copy. Tutorials,
API references, and the design guide remain explanations/maps, not independent
acceptance catalogs. Technical choices stay in ADRs.

QA selects story IDs and criteria from SPEC.md, uses docs/verification.md to find
the existing checks, and records actual observations and gaps. Do not create a
second acceptance list or claim a local simulation proves a deployed integration.
The canonical owner skill points workers to this procedure. Its routine deployment
wording follows the already-merged PR14 policy while preserving separate authority
for production access, credentials, spending, and destructive data operations.

## Consequences

Updating behavior requires updating SPEC.md and the relevant checks together.
Implementation examples can evolve without duplicating the spec. CI keeps its
existing check:all entry point; browser evidence must identify the tested revision,
target, identities, exact outputs, and capability limitations. Run receipts belong
in retained task evidence rather than being copied into a living requirements file.
