# Skill Registry — autoreas-mobile

**Generated:** 2026-04-06  
**Project:** autoreas-mobile  
**SDD Mode:** engram

---

## Available Skills

| Skill | Location | Trigger |
|-------|----------|---------|
| sdd-init | ~/.config/opencode/skills/sdd-init/SKILL.md | Initialize SDD context in a project |
| sdd-explore | ~/.config/opencode/skills/sdd-explore/SKILL.md | Explore/investigate ideas before committing to a change |
| sdd-propose | ~/.config/opencode/skills/sdd-propose/SKILL.md | Create change proposal with intent and scope |
| sdd-spec | ~/.config/opencode/skills/sdd-spec/SKILL.md | Write specifications with requirements and Given/When/Then scenarios |
| sdd-design | ~/.config/opencode/skills/sdd-design/SKILL.md | Create technical design document |
| sdd-tasks | ~/.config/opencode/skills/sdd-tasks/SKILL.md | Break down change into implementation task checklist |
| sdd-apply | ~/.config/opencode/skills/sdd-apply/SKILL.md | Implement tasks from change following specs and design |
| sdd-verify | ~/.config/opencode/skills/sdd-verify/SKILL.md | Validate implementation matches specs, design, and tasks |
| sdd-archive | ~/.config/opencode/skills/sdd-archive/SKILL.md | Sync delta specs to main specs and archive completed change |
| branch-pr | ~/.config/opencode/skills/branch-pr/SKILL.md | Create PR following issue-first enforcement system |
| issue-creation | ~/.config/opencode/skills/issue-creation/SKILL.md | Create GitHub issue for bug or feature request |
| judgment-day | ~/.config/opencode/skills/judgment-day/SKILL.md | Adversarial parallel review protocol (dual review) |
| kin | ~/.config/opencode/skills/kin/SKILL.md | Resolve external library docs through staged protocol |
| kin-init | ~/.config/opencode/skills/kin-init/SKILL.md | Register KIN integration points in project |
| react-doctor | ~/.config/opencode/skills/react-doctor/SKILL.md | Catch React issues after making changes |
| cognitive-complexity | ~/.config/opencode/skills/cognitive-complexity/SKILL.md | Analyze and calculate Cognitive Complexity scores |
| skill-creator | ~/.config/opencode/skills/skill-creator/SKILL.md | Create new AI agent skills |
| go-testing | ~/.config/opencode/skills/go-testing/SKILL.md | Go testing patterns including Bubbletea TUI |
| tdd | ~/.agents/skills/tdd/SKILL.md | TDD red-green-refactor loop |
| grill-me | ~/.agents/skills/grill-me/SKILL.md | Interview user relentlessly about a plan |
| find-skills | ~/.agents/skills/find-skills/SKILL.md | Discover and install agent skills |
| no-duplication | ~/.claude/skills/no-duplication/SKILL.md | Eliminate SonarQube code duplication in Go test files |
| stylistic-addon-testing | ~/.claude/skills/stylistic-addon-testing/SKILL.md | Testing conventions for stylistic-addon Word Add-in |
| stylistic-addon-debugging | ~/.claude/skills/stylistic-addon-debugging/SKILL.md | Bug investigation for stylistic-addon Word Add-in |

---

## Project Conventions Files

| File | Status | Notes |
|------|--------|-------|
| AGENTS.md | ✅ Present | Empty — no project-level agent instructions yet |
| CLAUDE.md | ✅ Present | Empty — no project-level Claude instructions yet |

---

## SDD Workflow for autoreas-mobile

```
sdd-explore → sdd-propose → sdd-spec → sdd-design → sdd-tasks → sdd-apply → sdd-verify → sdd-archive
```

### Skill Routing by SDD Phase
| Phase | Skill | Notes |
|-------|-------|-------|
| Exploration | sdd-explore | Think through feature, investigate codebase |
| Proposal | sdd-propose | Create/update change proposal |
| Spec | sdd-spec | Write Given/When/Then scenarios |
| Design | sdd-design | Architecture decisions + sequence diagrams |
| Tasks | sdd-tasks | Hierarchical task checklist (1.1, 1.2...) |
| Implementation | sdd-apply | Code following specs; strict_tdd=false until SDD-00 installs runner |
| Verification | sdd-verify | Compare implementation vs every spec scenario |
| Archive | sdd-archive | Sync delta to main specs, archive change |

---

## Context Notes

- **Persistence mode:** engram (no openspec/ directory)
- **Strict TDD:** UNAVAILABLE — no test runner configured yet
- **SDD-00 is MANDATORY FIRST STEP** — installs test runner, tooling, precommit hooks
- **Spec order (strict):** SDD-00 → SDD-01 → SDD-02 → (SDD-03 | SDD-04 | SDD-06) → SDD-05 → SDD-07
- **SDD-00 spec file missing** — must be written before implementation starts
