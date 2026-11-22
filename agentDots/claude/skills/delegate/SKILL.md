---
name: delegate
description: Use when a task needs a delegation decision or coordination of bounded research, investigation, implementation, or verification work.
---

# Delegate

Decide whether delegation earns its cost, then complete the original task. A single-agent result is valid.

Read [orchestration.md](references/orchestration.md) for dispatch, scaling, model routing, and fallback rules.

## Workflow

1. Establish the requested outcome, constraints, available tools, and smallest useful workstreams. Compare expected parallelism, context isolation, independent reasoning, and cost against coordination and integration overhead.
2. Choose direct execution when the task is narrow, tightly coupled, or already supported by sufficient evidence. Otherwise select a strategy below and a model for each assignment.
3. Dispatch only bounded work with distinct ownership. Continue useful coordinator work while children run; consolidate their evidence and resolve material conflicts.
4. Integrate authorized changes or conclusions and perform the verification needed for the original request. Delegation does not transfer responsibility for completion.

## Strategies

- **Parallel research:** For independent questions, read and follow [parallel-research](../parallel-research/SKILL.md).
- **Parallel investigation:** For competing explanations of unexpected behavior, read and follow [investigate](../investigate/SKILL.md).
- **Parallel implementation:** Establish file ownership, interface contracts, and integration order before dispatch. Use isolated worktrees when supported and useful. Serialize shared files, schemas, generated artifacts, and mutable resources. Give children permission to edit only their assigned area. Integrate and verify in the coordinator; do not overwrite others' changes.
- **Independent verification:** Give a reviewer raw artifacts and expected behavior, without the implementer's conclusions. Deliberate overlap earns its cost only when it supplies independent evidence.

For example, `/delegate locate the version constant` should normally run directly. An evaluation of unrelated storage, authentication, and deployment choices may justify distinct research assignments.

## Workflow mode

Follow the shared Workflow mode. For research or investigation, use that skill's shape. For parallel implementation, run each workstream in its own worktree, followed by a verify stage; the coordinator integrates after the workflow returns.

## Result

Return the requested deliverable, with a brief strategy rationale, verification, and material limitations. Avoid coordination transcripts and unsupported savings claims.
