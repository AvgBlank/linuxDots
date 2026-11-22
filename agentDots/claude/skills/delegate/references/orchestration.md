# Orchestration contract

Read this contract when coordinating work. Leaf workers follow their assignment without loading orchestration workflows or delegating again unless the coordinator explicitly assigns further delegation.

## Dispatch decision and scaling

Delegate when independent work, context isolation, independent reasoning, specialized investigation, or lower total execution cost provides a concrete benefit. Execute directly when coordination costs more than the work. Batched tool calls can handle simple parallel searches without additional agents.

Choose workstreams by responsibilities, execution paths, trust boundaries, or independent hypotheses, not arbitrary file slices. Size them using repository size, coupling, services, packages, languages, critical paths, security risk, task difficulty, and coordination overhead. Subdivide a complex subsystem only where responsibilities separate cleanly.

Maintain a compact ledger: assignment, perspective or hypothesis, owner, model, effort, state, evidence, and coverage. Include cross-component interactions with an explicit owner. Mark work pending, running, complete, blocked, or deferred with a reason. The ledger can stay in the coordinator's context; it does not require a file.

Inspect runtime concurrency and existing activity. Respect any limit that counts the coordinator or other agents. Launch useful assignments up to available capacity, then process the pending queue in waves. If capacity is unknown, start conservatively and adjust to observed limits. Never treat a capacity error as completed coverage or retry spawning in a busy loop.

Reassess when results arrive. Add targeted work for newly discovered high-risk paths or material contradictions. Stop redundant investigations once evidence settles their question; keep unrelated pending coverage accounted for. Resolve failed or missing reports by a focused retry, reassignment, or direct work, and disclose anything still incomplete. A fixed minimum or maximum agent count is not a coverage plan.

## Assignment contract

Give each child:

- Objective, scope, assigned subsystem or files, and exclusions.
- Relevant architecture, interfaces, symptoms, or primary sources; avoid full transcript inheritance when isolated context is supported.
- Applicable instruction paths, target revision and working-tree context, and permission or resource constraints.
- Expected output: concise conclusions, exact evidence references, verification, uncertainty, and coverage. Findings use the active review or investigation schema.
- Completion criterion and escalation rule for discoveries outside ownership.

Share a concise reconnaissance summary so each child does not map the whole system again. Keep implementation ownership disjoint. Serialize tests that share databases, ports, caches, fixtures, or external services, or isolate those resources first. Read-only workers do not edit source or fix findings.

Wait using the exposed event or completion mechanism while no local work remains. Collect all assigned results before claiming completion. Use follow-ups to clarify an existing assignment rather than launching a duplicate.

## Model routing

Choose a model for each assignment and pass it as the Agent tool's `model` alias:

| Model | Suitable work |
| --- | --- |
| `haiku` | File discovery, mapping, bounded extraction, and simple documentation lookups. |
| `sonnet` | Code-review analysis and finding discovery, small focused implementations and one-off bug fixes, documentation research, and straightforward comparisons. |
| `opus` | Targeted verification of review findings, large implementations, complex research and tradeoff analysis, conflicting evidence, and incident investigation and debugging. |

For code reviews, use `sonnet` for architecture analysis, bug discovery, and routine consolidation. Use `opus` for targeted verification of substantive candidate findings before reporting them as established issues. Give verification workers the relevant source, requirements, raw evidence, and a neutral question to resolve; require supporting and contrary evidence, trigger reachability, impact, and confidence. Reject unsupported candidates or preserve their uncertainty. Group related candidates into bounded verification assignments instead of spawning one worker per finding. When no substantive candidates exist, skip the `opus` pass. Verification is read-only and does not repeat the entire review. These phase rules override complexity-based model selection.

For implementation, use `sonnet` for a localized change or one-off bug fix with clear expected behavior, bounded context, and focused verification. Use `opus` for a large feature, substantial migration, or implementation requiring coordinated changes across subsystems and contracts. Judge scale by scope, coupling, and reasoning burden rather than file count alone. If a small implementation expands into substantial integration work, explain the new scope and move that work to `opus`.

Prefer the lightest model that can succeed without costly retries. For difficult work already on `opus`, raise `effort`, narrow the assignment, or add targeted verification. Use `fable` only when the user asks for it. A model the user names overrides this table. Pass the alias, never a full model ID. Direct execution uses the current session model; the skills do not switch that model. Report capability or evidence limits instead of claiming a model choice solved an unresolved task.

## Claude Code dispatch

- Read-only discovery and codebase search → `subagent_type: "Explore"`. Web research, implementation, and verification → `general-purpose`. Do not use `fork` for independent work: it inherits the full transcript and always runs on the parent model, so model routing does not apply.
- Set `effort` only to raise it for difficult `opus` work; otherwise omit it.
- Parallel implementation that edits files → `isolation: "worktree"`.
- Launch a wave as several Agent calls in one message. Children run in the background and notify on completion; do not poll. Send follow-ups with SendMessage.
- Web research → WebSearch and WebFetch. Search with `mode: "standard"` by default and `mode: "extended"` for niche, very recent, price or availability, or multi-step questions, or when a standard result is thin, off-target, or possibly outdated. Send planned searches in one turn, and fetch the primary page instead of citing a search snippet. Include these rules in web research assignments.

## Model-selection report

Before dispatch, briefly state the model, effort if set, and reason for each distinct selection. At completion, include a compact summary by assignment or group: requested model and effort, and selection reason. Label a fork's model as inherited. For direct or serial execution, report the current session model and state that no child model was selected. This reporting applies to every skill using this contract, including research, investigation, and all review perspectives.

## Workflow mode

Use the Workflow tool instead of separate Agent calls when the user asks for deep, exhaustive, or thorough work, or asks for a workflow. A skill that reads this contract counts as the opt-in the Workflow tool requires, but only under those conditions; otherwise use Agent calls.

- Load `workflow-authoring` before writing the script.
- Scout inline first: settle scope, target, and the work list (questions, hypotheses, subsystems, workstreams) before calling Workflow.
- The top-level coordinator runs one workflow. A composed skill contributes its stages to that workflow and does not start its own.
- Use `pipeline()` so each item moves to verification as soon as its own stage finishes. Use a barrier only to deduplicate across all results before verification, or to skip verification when nothing was found.
- Apply Model routing through `agent()`'s `model` option, and give find and verify stages a `schema`.
- Stay within the session's workflow size guideline, and `log()` any coverage the workflow drops.
- A deep web research stage runs the built-in `deep-research` workflow: `Workflow({ name: "deep-research", args })` when the run is web-only, otherwise `workflow("deep-research", question)` inside the script. Fold related web questions into one refined question, asking 2–3 clarifying questions first if it is underspecified.
- Synthesize the workflow's result in the coordinator and deliver the skill's normal result and model-selection report.

## Composition and fallback

Read referenced instructions before using their workflow. Expand only the active branch. Resolve relative links from the containing file after following symlinks; pass absolute instruction paths to children. If a required reference is missing, search the installed skill catalog for that skill, verify its identity, and disclose any remaining missing workflow rather than silently dropping it.

The top-level coordinator owns the queue. A composed skill runs as a workflow or leaf assignment, not a second coordinator spawning the same work. Do not recursively invoke `delegate` from its composed skills or create nested delegation loops.

When native subagents are unavailable, use the same assignments serially in the current agent. Keep review perspectives and hypotheses distinct, but disclose that execution was neither parallel nor independent. Preserve coverage and verification obligations. Do not edit global configuration, define custom agents, or require third-party MCP servers to enable these workflows.
