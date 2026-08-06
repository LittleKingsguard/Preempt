# Workspace Agent Rules

## Anti-Pattern Documentation & Verification Directive
Whenever an anti-pattern, unsupported design choice, or prohibited practice is mentioned by the user, identified in code reviews, or encountered during planning/debugging:
1. **Check Existing Documentation**: Immediately search `docs/skills/` and `.agents/skills/` to check whether the anti-pattern is already documented.
2. **Document If Missing**: If the anti-pattern is missing or incomplete, document it immediately in the appropriate skill documentation file under `docs/skills/` (e.g. `placements.md`, `components.md`, `overview.md`) and `.agents/skills/preempt-workflow/SKILL.md`.
3. **Detail the Anti-Pattern**: Describe what the anti-pattern is, why it is unsupported/breaking, and what the correct supported pattern is.
