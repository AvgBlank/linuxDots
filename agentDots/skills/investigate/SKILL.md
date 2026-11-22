---
name: investigate
description: Use when a complex bug or unexpected behavior needs evidence-based diagnosis across diff, module, or repository scope.
---

# Investigate

Diagnose before changing production code. Read [orchestration.md](../delegate/references/orchestration.md) for hypothesis assignments, scaling, model routing, and fallback. Read the target/scope and verification sections of [review-contract.md](../architecture-review/references/review-contract.md); review priority formatting is optional for a diagnosis.

Examples: `/investigate scope=module path=services/payments intermittent duplicate charges`, `/investigate scope=diff base=main integration test failure`.

## Workflow

1. Establish observed and expected behavior, impact, symptoms, logs, timing, environment, recent changes, and reproduction details. Gather available evidence first. Ask for missing information only when it blocks a useful diagnosis; continue independent evidence collection while waiting.
2. Build plausible competing hypotheses and the observation that would distinguish each. Use targeted source traces, existing logs, and focused tests before expensive suite runs. Expand from symptoms to relevant scope; do not assume a recent diff caused the problem. When a hypothesis involves a dependency, error message, or platform behavior, search for upstream issues, changelogs, and documentation with the shared contract's web research tools, and confirm the result applies to the version in use.
3. Execute directly for a clear cause or tightly coupled question. Delegate distinct hypotheses when independent investigation adds value. Share facts and raw evidence, not a favored conclusion.
4. Give each assignment a hypothesis, relevant paths, falsification or validation criterion, resource constraints, and expected report.
5. Compare supporting and contrary evidence. Follow discoveries with targeted investigation; stop pursuing a hypothesis once it is disproved or a sufficiently supported cause makes it redundant. Preserve distinct causes when the evidence suggests several interacting failures.
6. Validate the leading explanation against the triggering path and expected behavior. Recommend the smallest resolution and a regression check. Changes require a separate authorized implementation step after initial diagnosis.

In repository scope, use the shared reconnaissance map to account for major subsystems while concentrating evidence collection on the incident's reachable paths. Mapping an unrelated subsystem does not mean it was diagnosed.

## Workflow mode

Follow the shared Workflow mode. Shape: one agent per hypothesis, each trying to validate or falsify it against its criterion → an adversarial check of each surviving explanation. A hypothesis that hinges on an external question, such as a known bug in a dependency version, gets a deep web research stage for that question only. The coordinator reconciles the evidence.

## Result

For each material hypothesis report evidence for and against it, file lines or logs, reproduction/validation actually performed, confidence, and recommended next action. Conclude with the best-supported root cause, causal path, affected scope, focused fix direction, verification, and remaining uncertainties.

Distinguish **confirmed root cause**, **likely cause**, and **unresolved hypothesis**. If no cause is confirmed, say so and name the next discriminating check. Do not present a guess as fact.
