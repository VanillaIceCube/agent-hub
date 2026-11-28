# Reviewer actions

| Action | What it does |
| --- | --- |
| [get-pr-diff](get-pr-diff/action.yml) | Reads the PR’s base and head from Git, numbers added lines for review and reports whether the complete source diff fits the budget. |
| [get-prior-ai-reviews](get-prior-ai-reviews/action.yml) | Verifies the reviewer's bot identity and collects bounded, attributed PR discussion for that reviewer. |
| [request-ai-response](request-ai-response/action.yml) | Validates the model, effort and token limit, calls the Responses API and records aggregate usage. |
| [publish-ai-review](publish-ai-review/action.yml) | Publishes the reviewer’s verdict on the current PR head and reconciles eligible threads owned by that reviewer. |
| [track-security-alerts](track-security-alerts/action.yml) | Validates the native issue schema, fetches one feed, groups open findings and reconciles the tracking issues. |

## 🔐 Reviewer contract

Each persona has its own GitHub App and OpenAI credentials. A read-only App token collects evidence. The publishing step mints a separate App token when the caller enables publication. The workflow token reads evidence about checks, statuses and branch rules. PR text, prior discussion and scanner output are untrusted inputs. Forks receive the independent gates. The three review workflows have credentials only on eligible same-repository PRs. [Credential setup](../../README.md#-reviewers-and-alert-triage)

**Inputs and budgets.** All three reviewers accept a complete source diff up to 2,000,000 bytes. A larger diff gets an incomplete-review notice and a failing check. Infrastructure includes all lockfiles. The prior-discussion collector limits pages, entries and UTF-8 bytes and identifies truncated or unavailable history. The code-review context also bounds changed-file content.

**Model requests.** The defaults are `gpt-6-luna`, medium effort and 16,000 output tokens. The caller resolves the optional `AI_REVIEW_*` settings. The [request policy](request-ai-response/request-ai-response.js) rejects unsupported values before a request. Each call records aggregate usage and latency. Web search is available to the code reviewer only for Dependabot major-upgrade evidence.

**Verdicts and threads.** `REQUEST_CHANGES` fails the check even when the same finding appeared earlier. Valid `APPROVE` and `COMMENT` results pass. Missing credentials, malformed output, incomplete major-upgrade evidence or an outdated head prevent an approval. To resolve one of its own threads, the [publisher](publish-ai-review/reconcile-ai-review.js) verifies the current head, original author, complete conversation, exact source replacement, approval and successful independent checks. Threads with another participant or insufficient evidence stay open. It checks the result after mutation and handles head changes without treating stale feedback as resolved. Writers for the same persona and PR are serialized.

**Alert tracking.** The [alert action](track-security-alerts/action.yml) reads feeds with RoboCop’s read-only token and uses a separate write token to reconcile issues when publication is enabled. It accounts for every source alert before closing superseded issues. Empty feeds still reconcile existing tickets. For field setup, priorities and recovery, see [the workflow guide](../../README.md#-reviewers-and-alert-triage).

The request action accepts four files directly under `RUNNER_TEMP`, named `code-review-context.txt`, `build-review-context.txt`, `security-review-context.txt`, and `security-alerts.json`. Each must be a regular file with a single hard link. The action rejects symbolic links.

Run `npm test --prefix .github` in AgentHub to exercise review verdicts, API failures, previews and reconciliation.
