---
name: draft-chapter
description: Draft a cited, learner-shaped chapter from registered library sources.
---

# Draft-chapter procedure

## Prepare

1. Read `PLAN.md`, `curriculum.md`, `_global/profile.md`, and the adjacent note that precedes this chapter.
2. Treat the plan's `level` as the main-path depth and the profile as tone/prerequisite guidance.
3. Use only source IDs registered under `library/`. If an operator names an unregistered source, stop and report it rather than adding an ad hoc citation.
4. Read each cited `source.md` summary and the relevant parsed section. Record useful page markers before drafting.

## Outline before prose

Create an outline with:

- the chapter question;
- three to six concept sections;
- one worked example;
- a short connection to prior and next material;
- which claims need each source.

Stop and report a scope problem if the brief requires material outside the plan or requires an unsupported central claim.

When registered sources do not cover part of the brief, return a gap report listing the missing concepts and specific proposed sources using the `find-sources` playbook. If that skill or its research tools are unavailable, report the gap to the owner for research and registration. Do not fill it with thin or uncited prose.

## Draft the file

Create the next `<set>/notes/NN-slug.md` with:

```yaml
---
title: <Chapter title>
order: <NN>
status: draft
sources: [<ids used>]
---
```

Write an orientation of two to four sentences, then one concept per `##` section. Use:

- `:::definition` for precise statements;
- `:::theorem` for results and assumptions;
- `:::example` for fully worked calculations;
- `:::deeper` for optional advanced material.

Use `$...$` and `$$...$$` math, and Mermaid only when a relationship genuinely benefits from a diagram.

## Ground and cite claims

- Attach a citation at the sentence level: `Singular values are nonnegative.[^src:lib-strang-la#p131]`.
- Define each footnote consistently and include the source's title/author.
- Cite central definitions, theorems, numerical claims, historical claims, and anything the checker cannot verify from ordinary reasoning.
- Do not cite common algebraic manipulation that you performed yourself.
- Use only short quotations if needed; summarize in the learner's context rather than pasting long passages.
- Never derive a central claim from model memory; require support in a registered source.
- Check code examples with `mcp_context7_*`: resolve the library id, then retrieve version-matched docs. State the library version checked. A docs lookup becomes citation support only after registration; if checking or registration is unavailable, report the gap before including the example.

## Handle uncertainty explicitly

If a claim is plausible but not supported by the available library:

1. either omit it from the main path;
2. or retain it only when pedagogically necessary, marked as:

```md
**Uncertain:** The proof likely requires the spectral theorem; verify against a registered source before accepting this chapter.
```

Never manufacture a citation, page number, DOI, quotation, or source title.

## Review the draft

1. Check numbering, status, frontmatter, heading hierarchy, fenced directives, math, and footnote definitions.
2. Verify every listed source ID is used and every used ID is listed.
3. Reread the worked example line by line.
4. Keep the note at `status: draft`; approval and acceptance are separate learner actions.

For purposeful visuals in notes, load `media-authoring` and follow its local-file and static-book rules.
