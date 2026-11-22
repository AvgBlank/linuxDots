# Orchestration contract

Read this contract when coordinating work. Leaf workers follow their assignment without loading orchestration workflows or delegating again unless the coordinator explicitly assigns further delegation.

## Dispatch decision and scaling

Delegate when independent work, context isolation, independent reasoning, specialized investigation, or lower total execution cost provides a concrete benefit. Execute directly when coordination costs more than the work. Batched tool calls can handle simple parallel searches without additional agents.

Choose workstreams by responsibilities, execution paths, trust boundaries, or independent hypotheses, not arbitrary file slices. Size them using repository size, coupling, services, packages, languages, critical paths, security risk, task difficulty, and coordination overhead. Subdivide a complex subsystem only where responsibilities separate cleanly.

Maintain a compact ledger: assignment, perspective or hypothesis, owner, model tier, state, evidence, and coverage. Include cross-component interactions with an explicit owner. Mark work pending, running, complete, blocked, or deferred with a reason. The ledger can stay in the coordinator's context; it does not require a file.

Inspect runtime concurrency and existing activity. Respect any limit that counts the coordinator or other agents. Launch useful assignments up to available capacity, then process the pending queue in waves. If capacity is unknown, start conservatively and adjust to observed limits. Never treat a capacity error as completed coverage or retry spawning in a busy loop.

Reassess when results arrive. Add targeted work for newly discovered high-risk paths or material contradictions. Stop redundant investigations once evidence settles their question; keep unrelated pending coverage accounted for. Resolve failed or missing reports by a focused retry, reassignment, or direct work, and disclose anything still incomplete. A fixed minimum or maximum agent count is not a coverage plan.

## Assignment contract

Give each child:

- Objective, scope, assigned subsystem or files, and exclusions.
- Relevant architecture, interfaces, symptoms, or primary sources; keep child prompts bounded instead of dumping the full parent transcript.
- Applicable instruction paths, target revision and working-tree context, and permission or resource constraints.
- Expected output: concise conclusions, exact evidence references, verification, uncertainty, and coverage. Findings use the active review or investigation schema.
- Completion criterion and escalation rule for discoveries outside ownership.

Share a concise reconnaissance summary so each child does not map the whole system again. Keep implementation ownership disjoint. Serialize tests that share databases, ports, caches, fixtures, or external services, or isolate those resources first. Read-only workers do not edit source or fix findings.

Wait reactively for subagent messages once no local work remains; never poll in a loop. Collect all assigned results before claiming completion. Send follow-ups to an existing subagent via `send_message` rather than launching a duplicate.

## Model routing

Choose a model tier for each assignment and pass it as `Model` in `invoke_subagent` (or `model` in `agent()` inside `run_workflow`):

| Model tier | Suitable work |
| --- | --- |
| `flash_lite` | File discovery, mapping, bounded extraction, and simple documentation lookups. |
| `flash` | Code-review analysis and finding discovery, small focused implementations and one-off bug fixes, documentation research, and straightforward comparisons. |
| `pro` | Targeted verification of review findings, large implementations, complex research and tradeoff analysis, conflicting evidence, and incident investigation and debugging. |
| `inherit` | Matches the coordinator's current session model (default when omitted). |

For code reviews, use `flash` for architecture analysis, bug discovery, and routine consolidation. Use `pro` for targeted verification of substantive candidate findings before reporting them as established issues. Give verification workers the relevant source, requirements, raw evidence, and a neutral question to resolve; require supporting and contrary evidence, trigger reachability, impact, and confidence. Reject unsupported candidates or preserve their uncertainty. Group related candidates into bounded verification assignments instead of spawning one worker per finding. When no substantive candidates exist, skip the `pro` pass. Verification is read-only and does not repeat the entire review. These phase rules override complexity-based model selection.

For implementation, use `flash` for a localized change or one-off bug fix with clear expected behavior, bounded context, and focused verification. Use `pro` for a large feature, substantial migration, or implementation requiring coordinated changes across subsystems and contracts. Judge scale by scope, coupling, and reasoning burden rather than file count alone. If a small implementation expands into substantial integration work, explain the new scope and move that work to `pro`.

Prefer the lightest tier that can succeed without costly retries. A model the user explicitly names overrides this table. Pass the tier string (`flash_lite`, `flash`, `pro`, `inherit`), never a raw internal model ID. Direct execution uses the current session model; the skills do not switch that model. Report capability or evidence limits instead of claiming a model choice solved an unresolved task.

## Antigravity dispatch

- Read-only codebase search, file inspection, and web search → `invoke_subagent` with `TypeName: "research"` (read-only sandbox with `read_file` and `search_web`; no shell network access). Implementation, shell-based verification, and MCP tool calls → `TypeName: "self"` (or `define_subagent` when a custom read-only/write tool mix is needed).
- Give every subagent a distinct, descriptive `Role` (2–5 words).
- Parallel implementation that edits files → `Workspace: "share"` (shared repository working copy, worktree-style) or `Workspace: "branch"` (isolated clone). Readers and verifiers keep default `Workspace: "inherit"`.
- Launch a wave as several `invoke_subagent` calls in one turn. Subagents run in the background and wake the coordinator when done; do not poll. Send follow-ups with `send_message` using the returned `conversationId`.
- Web and documentation research → use the `context7` MCP (`resolve-library-id`, then `query-docs`, via `TypeName: "self"`) for library and framework documentation; use `search_web` for general web research. Batch planned searches in one turn and verify against primary sources rather than citing a single thin snippet. Include these rules in web research assignments.

## Model-selection report

Before dispatch, briefly state the model tier and reason for each distinct selection. At completion, include a compact summary by assignment or group: requested model tier and selection reason. For direct or serial execution, report the current session model (human-readable name) and state that no child model was selected. This reporting applies to every skill using this contract, including research, investigation, and all review perspectives.

## Workflow mode

Use `run_workflow` instead of manual `invoke_subagent` waves when the user asks for deep, exhaustive, or thorough work, asks for a workflow, or when orchestration requires programmatic fan-out, staged pipelines, or aggregation.

- Load the built-in `run-workflow` skill before writing the script.
- Scout inline first: settle scope, target, and the work list (questions, hypotheses, subsystems, workstreams) before calling `run_workflow`.
- The top-level coordinator runs one workflow. A composed skill contributes its stages to that workflow and does not start its own.
- Group stages with `phase(name)`. Use `parallel(items, fn)` for concurrent fan-out and `pipeline(items, fn)` for ordered per-item stages. Note that `parallel` cancels remaining tasks if one fails, so validate inputs and guard optional steps.
- Apply Model routing through `agent(..., model=...)`, set `type_name="research"` for read-only workers or `"self"` for write/verification/MCP workers, set `workspace="share"` or `"branch"` for parallel edits, set a descriptive `role`, and always pass a JSON `schema` (workflow agents must return via `finish`).
- Log any skipped or dropped coverage with `log()`.
- For deep web research stages, fan out focused `agent(..., type_name="research", ...)` calls with `search_web` (or `type_name="self"` with `context7` for library docs), folding related web questions into a structured question set first.
- Synthesize the workflow's output in the coordinator and deliver the skill's normal result and model-selection report.

## Composition and fallback

Read referenced instructions before using their workflow. Expand only the active branch. Resolve relative links from the containing file after following symlinks; pass absolute instruction paths to children. If a required reference is missing, search the installed skill catalog for that skill, verify its identity, and disclose any remaining missing workflow rather than silently dropping it.

The top-level coordinator owns the queue. A composed skill runs as a workflow or leaf assignment, not a second coordinator spawning the same work. Do not recursively invoke `delegate` from its composed skills or create nested delegation loops.

When native subagents are unavailable, use the same assignments serially in the current agent. Keep review perspectives and hypotheses distinct, but disclose that execution was neither parallel nor independent. Preserve coverage and verification obligations. Do not edit global configuration, define unnecessary persistent agents, or require third-party MCP servers to enable these workflows.
