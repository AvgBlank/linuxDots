---
name: adversarial-review
description: Use when independently challenging code for real bugs, security vulnerabilities, and reliability failures in diff, module, or repository scope.
---

# Adversarial review

Finding real bugs is the primary objective. Read `../architecture-review/references/review-contract.md` for targets, reconnaissance, read-only verification, and finding standards. Read `../delegate/references/orchestration.md` for adaptive assignments, model routing, and fallback. Reuse the target and map when composed by `review`.

Examples: `/adversarial-review scope=diff base=main`, `/adversarial-review scope=module path=packages/auth`, `/adversarial-review scope=repo`.

## Workflow

1. Establish scope and map critical components, trust boundaries, tests, and relevant configuration. Repository scope actively investigates existing bugs across major subsystems, not only regressions in recent changes.
2. Assign distinct failure paths by subsystem, risk, and interface. Ensure cross-component contracts have an owner. Use independent reviewers where useful; do not seed them with the implementer's verdict.
3. Trace reachable failure scenarios from inputs through state changes and outputs. Examine applicable categories below. Validate candidates through callers, tests, static proof, or safe focused reproductions. A pattern match is a lead, not proof of a defect.
4. Follow newly discovered high-risk paths with targeted assignments. Account for areas left incomplete. Stop redundant work when evidence settles the finding.
5. Recheck trigger, expected behavior, actual or predicted failure, and impact for each substantive candidate. Deduplicate by root cause. Report credible issues and specific verification gaps; keep architectural preferences and generic security advice out of the bug list.

## Workflow mode

Follow the shared Workflow mode. Shape: one finder per failure path → verification of each candidate.

## Failure categories

- **Logic and state:** incorrect control flow or assumptions, off-by-one errors, invalid state transitions, null/undefined handling, missing edge cases, and regression risks.
- **Async and resources:** incorrect async behavior, races, deadlocks, cancellation or retry failures, resource leaks, and unhandled failure states.
- **Data and persistence:** incorrect database operations, transactions, isolation, rollback, data corruption, and integrity failures.
- **Contracts and integration:** API mismatches, frontend/backend inconsistencies, serialization, ordering, error propagation, and cross-service failure behavior.
- **Trust and security:** authentication, authorization, input validation, trust-boundary violations, and reachable vulnerabilities.

Apply categories to the target's actual behavior. Inspect tests for boundary and failure assertions, mocks hiding failures, or focused/skipped tests that remove relevant coverage. Logging, skips, and mocks are not defects without consequences. Review pertinent infrastructure and configuration when they affect these paths.

## Result

Use the shared finding schema: priority, classification, file lines, defect, trigger, expected behavior, incorrect behavior, evidence, impact, fix direction, and confidence. Distinguish confirmed bugs from likely bugs and potential risks requiring verification. Include integration issues, security/reliability findings, behavioral test gaps, reviewed and partial/unreviewed areas, verification, and uncertainties.

If no substantial issues qualify, say so without asserting the software is bug-free. Report findings; do not fix source during review.
