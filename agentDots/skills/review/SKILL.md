---
name: review
description: Use when requesting a comprehensive bug and architecture review of a diff, module, or repository.
---

# Review

Combine architecture analysis and active bug detection in one read-only report. Neither perspective is optional. Bug detection receives explicit ownership and takes priority over design suggestions.

Read and follow `../architecture-review/SKILL.md` and `../adversarial-review/SKILL.md`, including their shared contracts.

Examples: `/review scope=diff`, `/review scope=diff base=main`, `/review scope=module path=apps/web`, `/review scope=repo`.

## Orchestration

1. Establish scope, target, and working-tree context once using the shared review contract. Map the codebase at the depth the scope requires; repository scope needs reconnaissance before distribution.
2. Build a coverage ledger by subsystem, risk, and interaction. Assign architecture and adversarial responsibilities explicitly. Reuse the map; children need not rediscover it. On large repositories distribute logical subsystem and risk workstreams rather than assigning one agent to each entire perspective.
3. Independent architecture and adversarial work may run concurrently. Coupled or small targets can run directly.
4. Collect both perspectives, including cross-component checks and behavioral test gaps. Add targeted investigations when evidence exposes high-risk omissions. Verify substantive candidate findings against source before finalizing the report, following the shared contract.
5. Merge duplicates by root cause, reconcile conflicting conclusions, and prioritize using the shared contract. Keep design preferences out of the bug list. Ensure every planned area is completed or explicitly reported as partial, unreviewed, or blocked before delivering.

## Workflow mode

Follow the shared Workflow mode. Run both lenses in one workflow: architecture and adversarial finders per subsystem → deduplicate by root cause → verification of each substantive finding, skipped when there are none.

## Combined report

Lead with a concise findings summary. Group actionable findings as **Critical / High Priority**, **Medium Priority**, **Low Priority**, and **Architectural Improvements**, using shared P0–P3 definitions. Label confirmed issues, likely issues, potential risks requiring verification, and improvements; include exact references and evidence for every actionable finding.

Keep critical correctness/security, reliability/integrity, and integration/concurrency failures ahead of structural suggestions. End with reviewed subsystems, partial/unreviewed areas, verification performed and not run, test gaps, and uncertainties. Say when no substantial issues qualify. Do not automatically fix findings.
