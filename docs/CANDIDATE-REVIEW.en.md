# 0.7.3: consistent chat and candidate-review entrances

[中文](CANDIDATE-REVIEW.md)

## Reproduced defect

The 0.7.2 parser recognized “打回当前候选” but not “拒绝候选” or “拒绝当前候选”. A directly rejected candidate therefore remained awaiting_review. Repair must not impersonate human rejection, and runtime recovery must not invent an incident to unlock it.

The old bundle provided an “原任务返修” control inside Settings → Plugins → Playbook, not a mandatory “拒绝候选” button in the chat tool card. The new bundle labels the actual settings control “拒绝候选”. The panel is optional; a direct chat decision is valid.

This is a code reproduction grounded in the supplied excerpt, not a diagnosis of a newly retrieved full deployment Session.

## Direct user flow

Send “拒绝候选”, optionally followed by concrete revision scope, or “打回当前候选”. Only admitted direct-user text can trigger a review transition. The plugin persists the feedback, increments the revision of the original run, enters its declared revision stage and contributes an acknowledgement to the same Agent step. There is no cancel, state clearing, new run or automatic QA pass.

Turning new-task auto-routing off no longer disables explicit review of an existing candidate. Quotations, code blocks, negations, explanation/translation requests, child-Agent prompts and tool/plugin text are not review authority. Parsing remains conservative, not a perfect language classifier. Explicit human `/playbook revise <feedback>` remains supported; `/playbook reject <feedback>` is an alias.

Duplicate message IDs do not spend another revision or reject a later candidate, including after hydration. A failed state write produces an actual registration error and permits retry of the same event. Existing budgets remain enforced.

## Controller and panel

Awaiting-review status includes `reviewControl`: the displayed candidate target, supported direct phrases, human commands and optional panel location, with `uiRequired=false`. Repair returns structured `USER_REVIEW_REQUIRED`; recovery returns `await_direct_user_review`. Neither can forge a human rejection. The model surface does not expose reject/accept/revise actions.

The settings panel offers reject, accept and optional feedback, and refreshes read-only state every three seconds while visible. Button commands bind the viewed session and candidate target; the server checks run/revision/epoch/candidate identity inside the serialized transaction. A stale target or switched session cannot mutate a different candidate. This binding is not a signature or authorization credential.

A panel click records the review; return to chat to continue. Sending review plus change instructions directly in chat supports the same-step Agent path and requires no panel visit.

## Update and test limits

Back up existing state. Update main with the original account/DSH_HOME, restart the Profile and refresh the browser. Return to the same conversation and resend the decision; do not clear/cancel/recreate. `runtimePluginVersion` is 0.7.3; pinned method versions remain unchanged.

New Host regressions cover direct/quoted/negated messages, auto off, duplicates, persistence failures, scope, limits and non-authoritative model repair. A separate React + jsdom smoke renders the actual Client bundle, clicks its real controls and invokes the actual Host handler through simulated transport, covering same-run revision, stale targets, session changes and acceptance. It is not a deployed browser-engine, E5 or live-model end-to-end test.

Media quality gates, artifact isolation and permissions are retained. No revised video, visual inspection or real production-quality improvement is claimed.
