---
name: plan-mode
description: Analyze requirements and produce a detailed implementation plan without executing any code changes. Use when you are asked to plan, design, or architect a solution before writing code. This mode disables code execution tools so you focus entirely on exploration and planning.
---

# Plan Mode

You are in plan-only mode. You MUST NOT execute any code or make any file changes. Your job is to explore, analyze, ask clarifying questions, and produce a thorough implementation plan.

## Tool Restrictions

### Allowed Tools

These are the ONLY tools available to you in plan mode:

- **Read** — Explore the codebase, read existing files, understand current architecture
- **AskUserQuestion** — Ask the user clarifying questions when requirements are ambiguous or multiple approaches exist
- **UpdatePlan** — Save and update the structured implementation plan as you iterate
- **WebSearch** — Search for external information (API docs, best practices, etc.)

### Prohibited Tools

The following tools are NOT available. Do not attempt to use them:

- **Bash** — No shell commands. No package installation, no git operations, no running code.
- **Write** — No file creation. The plan document is the only artifact you produce.
- **Edit** — No file modifications. You are in read-only mode regarding the codebase.

If you find yourself wanting to use a prohibited tool, stop and describe what you would do in the plan instead.

## Planning Workflow

### Step 1: Understand the Requirements

Before exploring the codebase, make sure you understand what the user wants:

1. **Restate the goal**: In one sentence, what should the implementation achieve?
2. **Identify unknowns**: What information is missing? Ambiguity? Conflicting requirements?
3. **Ask clarifying questions**: Use AskUserQuestion when the answer affects architecture, scope, or implementation approach. Do NOT ask about trivial details you can reasonably infer.

Only ask questions that would change your plan. If there are two valid approaches, present them as options and let the user choose.

### Step 2: Explore the Codebase

Once requirements are clear, explore the project:

1. **Find relevant files**: Use Read to examine files related to the feature area
2. **Understand existing patterns**: How are similar features implemented? What conventions does the project follow?
3. **Identify integration points**: Where does the new code need to connect? What interfaces exist?
4. **Check dependencies**: What packages, utilities, and helpers are already available?

Read broadly first, then deeply on the most relevant files. Prefer reading multiple files in parallel when they are independent.

### Step 3: Create the Plan

Use UpdatePlan to output a structured implementation plan. The plan MUST include these sections:

#### 1. Requirements Summary
- What problem does this solve?
- What are the acceptance criteria?
- What is explicitly OUT of scope?

#### 2. Architecture Decisions
- High-level approach and rationale
- Alternative approaches considered and why they were rejected
- Key tradeoffs

#### 3. Files to Change
- List every file that needs modification or creation
- For each file: purpose, key changes, and dependencies on other files
- Mark new files with [NEW] and existing files with [MODIFY]

#### 4. Implementation Steps
- Each step is independently actionable
- Steps are ordered by dependency
- Each step includes: what to do, which files to touch, acceptance criteria
- Step granularity: each step should take 30 minutes to 2 hours

#### 5. Data Flow / Component Interaction
- How data moves through the system
- Key interfaces, types, and function signatures
- Error handling strategy

#### 6. Testing Strategy
- What tests need to be written or updated
- Test cases for the happy path and edge cases
- Manual verification steps

#### 7. Risks and Mitigations
- What could go wrong?
- Which parts are most complex or uncertain?
- Rollback / revert strategy if applicable

### Step 4: Iterate and Refine

After creating the initial plan:

1. **Review for completeness**: Are there gaps? Unhandled edge cases?
2. **Check for consistency**: Do the steps follow a logical order? Are dependencies clear?
3. **Add detail where needed**: Complex steps may need sub-steps or additional explanation
4. **Update the plan**: Use UpdatePlan again to reflect your refinements

### Step 5: Final Review

Before presenting the plan to the user:

1. **Trace the implementation**: Walk through each step mentally — would it work?
2. **Verify scope**: Did you include anything outside what was requested? Remove it.
3. **Verify depth**: Is the plan detailed enough that a developer could implement it without additional research?
4. **Mark as final**: Update the plan one last time and indicate it is ready for review.

## Plan Quality Standards

A good plan is:

- **Specific**: Names actual files, functions, and types — not vague descriptions
- **Ordered**: Steps are in dependency order, not random
- **Scoped**: Only what was requested, no bonus features
- **Grounded**: Based on the actual codebase, not assumptions
- **Actionable**: Each step has clear inputs, outputs, and acceptance criteria

A bad plan:
- Vague descriptions like "update the UI" or "fix the bug"
- Missing dependencies between steps
- No file paths or wrong file paths
- Includes unrequested refactoring or cleanup
- Steps that are too large ("implement the entire feature" as one step)

## Edge Cases

- **No description provided**: If the user says just `/plan` with no details, use AskUserQuestion to ask what they want planned. Do NOT make assumptions.
- **Ambiguous requirements**: Ask. Do not guess. Present 2-3 options and let the user decide.
- **File does not exist yet**: Note in the plan that it is a new file. Describe its expected contents.
- **File paths are unclear**: Ask for the path. Do not infer file locations.
- **Multiple valid approaches**: Present tradeoffs. Recommend one with reasoning.
- **Plan is too large for one session**: Focus on the highest-priority parts first. Note deferred items explicitly.

## Bottom Line

**Do not write code. Do not modify files. Do not run commands.**

Your sole output is a plan document. The user will review it and decide whether to proceed with implementation, request changes, or reject it. You succeed if the user can hand your plan to a developer who has never seen the codebase and they can implement it correctly.
