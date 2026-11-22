# Review and investigation contract

Reviews are read-only. Do not modify source, apply fixes, install dependencies, run migrations, alter shared databases, or write reports into the reviewed repository. Inspect code and run justified, safe verification under the rules below. Investigation uses the same target and verification rules during initial diagnosis.

## Target and scope

Support `scope=diff`, `scope=module path=<path>`, and `scope=repo` (`repository` is an alias). Scope arguments are prompt conventions, not CLI flags parsed by an executable. Honor an explicit scope. Otherwise infer DIFF from a branch/change request, MODULE from a named subsystem, and REPOSITORY from a whole-codebase request. When no context identifies the target, state `scope=repo` as the default. Resolve the repository root and applicable `GEMINI.md`, `CLAUDE.md`, or `AGENTS.md`, project decisions, and relevant manifests. Validate a module path belongs to the intended target; ask only if an essential path or ambiguous comparison cannot be resolved.

Record target revision, initial working-tree state, and any exclusions. Pin Git refs to commit IDs once, including a named target branch or `target=<ref>`; use HEAD only when reviewing the current checkout. Inspect non-current targets through Git objects without checking out or changing source. Do not fetch or mutate branches merely to establish the target. Use safe argument quoting and delimit paths with `--`.

### DIFF

With no comparison target, review uncommitted changes against HEAD: inspect staged changes (`git diff --cached`), unstaged changes (`git diff`), and relevant untracked files (`git ls-files --others --exclude-standard`). Account for staged content that differs from the final working-tree version. Deletions and renames need affected callers examined. An empty tracked diff does not mean an empty target when untracked source exists.

Honor an explicit range or staged-only/unstaged-only request exactly. For `base=<ref>` on a branch request, use the merge-base comparison (`git diff <pinned-base>...<pinned-target>`) and disclose that choice. For an explicit endpoint comparison, use two-dot semantics. Include relevant working-tree changes as a separately identified overlay by default for the current checkout; `worktree=exclude` or an explicitly commit-only request excludes them. For a non-current target, exclude the current checkout's overlay unless the user requests it and its relationship to the target is established. Do not attribute overlay changes to a committed branch. If a required ref cannot resolve, explain the limitation instead of inventing a comparison.

Trace surrounding callers and contracts to validate changed behavior; distinguish change-caused findings from preexisting issues found in context. Do not label an unchanged issue a new regression. In a non-Git target, diff scope needs supplied before/after artifacts; module and repository scopes still work.

### MODULE and REPOSITORY

MODULE covers the named subsystem plus the boundaries needed to evaluate it. REPOSITORY covers the current codebase, including existing bugs and relevant untracked source, not only recent changes. Inventory files with targeted searches; exclude dependency directories, build output, generated and vendored code unless a critical boundary needs them. Record exclusions explicitly.

Before a repository-wide review, map languages, frameworks, build systems, packages, apps, services, boundaries, shared infrastructure, data stores, trust boundaries, critical paths, tests, and CI. Use this map to plan logical workstreams. Give every major subsystem and important interaction an owner or an explicit deferred reason. Assess test coverage by behavior and assertions; the presence of test files is not proof of coverage.

For each area record depth (mapped, representative paths inspected, or deeply validated), reviewed paths, perspective, and remaining gaps. Prioritize critical paths before low-risk repetition. Subdivide complex areas, and add targeted work when discoveries justify it. Never claim exhaustive review from representative sampling.

## Verification and read-only safeguards

Prefer code traces, existing tests, logs, and focused reproductions before full suites. Inspect commands and their scripts for side effects before execution. Commands that write build artifacts or caches may run only in an isolated scratch copy outside the reviewed repository, with external state isolated or disabled. A safe existing command that leaves source and shared state untouched may run directly. Report blocked verification instead of silently executing an unsafe substitute.

Re-open exact source lines for substantive findings; trace inputs, callers, failure handling, and tests to establish reachability. Independently check ambiguous high-impact findings when useful, without seeding a verifier with the proposed conclusion. Record actual commands and results; a proposed reproduction is not an executed test. At completion compare working-tree status to the initial state. If unexpected changes appear, report them without reverting, deleting, or claiming the review caused them.

## Findings and priority

Use consistent priorities:

- **P0 / Critical:** immediate action; severe, broadly reachable compromise, loss, or failure with established impact.
- **P1 / High:** serious correctness, security, reliability, or integrity failure on a credible important path.
- **P2 / Medium:** meaningful failure under narrower conditions, or a concrete structural problem with substantial consequences.
- **P3 / Low:** limited impact or low urgency with an actionable consequence.

Severity describes impact; confidence describes evidence. A scary hypothetical is not automatically P0. Label each candidate **Confirmed issue** (complete static proof or successful reproduction), **Likely issue** (strong evidence, a material condition unverified), **Potential risk requiring verification** (specific plausible path, evidence still incomplete), or **Architectural improvement** (design benefit without demonstrated failure). Explain uncertainty rather than inventing confidence percentages.

Each substantive finding includes title, priority, classification, affected file path and exact line, trigger conditions, expected behavior, actual or predicted failure, evidence or trace, impact, recommended action, and confidence. For structural findings use a dependency path and desired responsibility or contract instead of a fabricated reproduction. Keep these details compact. Tie test gaps to specific uncovered behavior; generic advice is not a finding. Redact secret values.

Merge reports by root cause and failure path, preserving all affected locations and the strongest evidence. Resolve conflicting claims against primary evidence; report unresolved contradictions as uncertainty. Put critical correctness/security defects first, then high-impact reliability/integrity, integration/concurrency, other bugs, structural consequences, and maintainability improvements. Architectural preferences never become correctness defects.

End with reviewed and unreviewed/partial areas, exclusions, verification performed and not run, test gaps, and remaining uncertainty. Say when no substantial issues qualify; do not claim bug-free software.
