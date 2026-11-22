---
name: architecture-review
description: Use when reviewing architectural impact, subsystem design, or repository structure in diff, module, or repository scope.
---

# Architecture review

Read `references/review-contract.md` for scope, reconnaissance, read-only verification, severity, and findings. Read `../delegate/references/orchestration.md` for adaptive assignments, model routing, and fallback. Reuse an established target and reconnaissance summary when composed by `review`.

Examples: `/architecture-review scope=diff base=main`, `/architecture-review scope=module path=apps/api`, `/architecture-review scope=repo`.

## Workflow

1. Establish the target and applicable project decisions using the shared contract. In repository scope, map every major subsystem, shared infrastructure, tests, and CI before planning representative execution-path reviews.
2. Choose independent responsibilities and interaction paths.
3. Trace responsibilities, dependency direction, coupling, cohesion, layering, cycles, data flow, API contracts, error propagation, test seams, extensibility, and consistency. Check relevant configuration and infrastructure. Validate suspected weaknesses against callers, implementation, tests, and stated requirements.
4. For DIFF, assess the change's architectural impact and its surrounding dependencies. For MODULE, examine its public interfaces and relevant callers or consumers. For REPOSITORY, examine existing structure and critical paths across all major subsystems, including their interactions.
5. Prioritize by concrete consequences for change cost, correctness, reliability, or operations. Follow up on newly discovered high-risk boundaries; stop redundant analysis when evidence is sufficient.

Evaluate the project's architecture against its size, requirements, and documented decisions. A monolith, shared library, or local abstraction is not a defect merely because another architecture is possible. Show the dependency or execution path that makes a concern real.

## Workflow mode

Follow the shared Workflow mode. Shape: one analyst per responsibility or interaction path → verification of each candidate.

## Findings

Separate concrete architectural problems, reasonable improvements, and subjective preferences. Report actionable structural problems with evidence and priority. Label maintainability suggestions **Architectural improvement**; omit personal preferences unless requested. If analysis proves a correctness defect, classify it as a bug using the shared finding contract rather than disguising it as design advice.

Return prioritized findings, file lines or dependency evidence, impact, recommended improvements, confidence, and coverage limits. Say when no substantive architectural problems were found. Distinguish representative path inspection from exhaustive coverage. Keep source unchanged.
