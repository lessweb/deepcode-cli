---
name: skill-digester
description: Reviews and improves another DeepCode skill's SKILL.md description field against the Agent Skills description-field rules. Use when the user asks to "digest" a skill, including requests like "digest the pdf skill" or "消化 pdf 技能".
---

# Skill Digester

Use this skill to review and optionally rewrite the `description` field of another DeepCode skill.

## Interaction Rule

Whenever user input is needed, call the `AskUserQuestion` tool. Do not ask follow-up questions as plain assistant text. This includes missing skill names, language preference, duplicate matches, malformed frontmatter decisions, and whether to apply a recommended rewrite.

## Workflow

1. Identify the target skill from the user's request.
   - If the user did not provide a skill name, use `AskUserQuestion` to ask for one.
   - Locate the skill by running the bundled Node script from this skill directory:

     ```bash
     node ~/.deepcode/skills/skill-digester/scripts/find-skill.js "<skill-name-or-path>" "<project-root>"
     ```

     If this skill is loaded from a project-level or different user-level path, use the `scripts/find-skill.js` file next to this `SKILL.md` instead.

   - The script searches the same roots Deep Code CLI scans, in priority order:
     1. Project native skills: `./.deepcode/skills/<folder>/SKILL.md`
     2. Project interoperable skills: `./.agents/skills/<folder>/SKILL.md`
     3. User native skills: `~/.deepcode/skills/<folder>/SKILL.md`
     4. User interoperable skills: `~/.agents/skills/<folder>/SKILL.md`
   - Treat `./` as the current Deep Code project root only; do not scan parent directories unless the running project root is changed.
   - The script resolves each candidate's skill name the way Deep Code does: use the trimmed frontmatter `name` when present, otherwise use the folder name with underscores converted to hyphens.
   - Match the user's input against the resolved skill name first. If needed, also consider the folder name or an explicit path the user provided.
   - Treat the matched skill's `path` as the source `SKILL.md` to review.
   - Treat the matched skill's `digestTarget.path` as the only output `SKILL.md` path to create or edit.
   - `digestTarget.path` always points to the same scope's native Deep Code root:
     - Project sources from `./.deepcode/skills` or `./.agents/skills` digest to `./.deepcode/skills/<folder>/SKILL.md`.
     - User sources from `~/.deepcode/skills` or `~/.agents/skills` digest to `~/.deepcode/skills/<folder>/SKILL.md`.
   - If the script returns one active match, use its `path` for reading and `digestTarget.path` for writing.
   - If the script returns active and shadowed matches, present each source path and digest target path, then use `AskUserQuestion` before using a shadowed source.
   - If the script returns no match, state that the skill was not found in Deep Code's scanned skill roots and use `AskUserQuestion` to ask whether the user wants to try another name.

2. Infer the user's preferred language before reviewing.
   - Infer a likely language from the user's wording. For example, if the user says `消化pdf技能`, infer Chinese.
   - Confirm the language with `AskUserQuestion` in the inferred language. For Chinese, ask: `请选择您偏好的语言。`
   - Offer the inferred language first and include `English` as a fallback. The UI provides an `Other` option, so the user can type a different language.
   - Use the confirmed preferred language for every later question, recommendation, and rewritten `description` field.

3. Read the source `SKILL.md`.
   - Parse the YAML frontmatter and Markdown body from the matched source path.
   - Preserve all frontmatter fields and body content except for the `description` field if the user approves a rewrite.
   - If frontmatter is missing or malformed, explain the issue and use `AskUserQuestion` before making structural repairs.

4. Review the current `description` field against the Agent Skills specification.
   - Required constraints:
     - It must be non-empty.
     - It must be 1-1024 characters.
     - It should describe what the skill does.
     - It should describe when to use the skill.
     - It should include specific keywords that help agents identify relevant tasks.
   - Compare the description with the actual `SKILL.md` body. Flag mismatches, missing capabilities, overbroad activation language, vague wording, or important trigger keywords that are absent.
   - Do not rewrite for style alone if the existing description is accurate, specific, and useful.

5. Present the review and recommendation.
   - If the description is already good, say so and do not change the file unless the user asks.
   - If improvements are useful, show:
     - The current description.
     - Concise review findings.
     - A recommended replacement written in the preferred language.
     - The source path being reviewed.
     - The digest output path that would be created or edited.
   - Use `AskUserQuestion` to ask the user to choose one of three actions in the preferred language:
     - Apply the recommended change.
     - Abandon the change.
     - Continue discussing the wording.

6. Apply the change only after explicit approval.
   - Write only to `digestTarget.path`; never write the digested result to `.agents/skills`.
   - If `digestTarget.sameAsSource` is true, update only the `description` field in that existing native `SKILL.md`.
   - If `digestTarget.sameAsSource` is false and `digestTarget.exists` is false, create the native target skill directory by copying the source skill directory first, then update only the target `SKILL.md` description. This preserves bundled scripts, references, and assets.
   - If `digestTarget.sameAsSource` is false and `digestTarget.exists` is true, update only the `description` field in the existing native target `SKILL.md`; do not overwrite its body or bundled files unless the user explicitly asks.
   - Keep the original `name` and any other frontmatter fields unchanged in the file being written.
   - Preserve body content exactly unless the user separately asks to edit it.
   - After editing, report the source path, updated digest output path, and final description.

## AskUserQuestion Patterns

Use one question at a time unless two decisions are tightly coupled. Each question must include `options`; rely on the UI's `Other` option for free-form input.

Examples:

```json
{
  "questions": [
    {
      "question": "请选择您偏好的语言。",
      "options": [
        { "label": "中文", "description": "后续询问和推荐描述都使用中文。" },
        { "label": "English", "description": "Use English for follow-up questions and the recommended description." }
      ]
    }
  ]
}
```

```json
{
  "questions": [
    {
      "question": "How should I proceed with this description recommendation?",
      "options": [
        {
          "label": "Apply change",
          "description": "Update only the description field in the native digest output SKILL.md."
        },
        { "label": "Abandon change", "description": "Leave the file unchanged." },
        { "label": "Discuss wording", "description": "Continue refining the proposed description before editing." }
      ]
    }
  ]
}
```

## Review Heuristics

A strong description is short, concrete, and activation-oriented. Prefer this pattern:

```text
<What the skill does>. Use when <task types, file types, tools, domains, or user phrases that should trigger it>.
```

Avoid descriptions that are only generic labels, marketing copy, or internal implementation notes.

## Safety Notes

- Never modify a different skill with a similar name without asking.
- Never save the digested output under `.agents/skills`; `.agents/skills` is only a source root for digestion.
- Never move a skill between project and user level during digestion.
- Never change the target skill's language preference after confirmation unless the user asks.
