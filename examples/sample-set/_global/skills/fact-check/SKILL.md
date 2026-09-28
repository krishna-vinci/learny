---
name: fact-check
description: Verify chapter claims against cited sources and produce a severity-ranked check report.
---

# Fact-check procedure

## Load and inventory

1. Read the target note and extract every factual claim, definition, theorem, calculation, historical statement, citation, and uncertainty marker.
2. Read each cited source's `source.md`, then the referenced `parsed.md` or `parsed/NN-slug.md` sections. Use page markers when present.
3. List claims that lack a citation separately from claims whose citation does not clearly support them.
4. Do not assume the author intended correctly: classify what the sentence actually asserts.

## Verify each claim

For each claim, record:

- **Claim:** a concise restatement;
- **Source support:** an exact short quotation or a precise locator such as `lib-strang-la parsed.md, p131`;
- **Verdict:** supported, unsupported, partially supported, or unverifiable;
- **Severity:** blocker, major, or minor;
- **Suggested fix:** the narrowest wording or calculation correction.

Check calculations independently. Recompute every step; do not merely inspect whether the result looks plausible.

### Severity rubric

- **Blocker:** a central definition/equation is false, a calculation is wrong, a quotation is fabricated, a required source is absent, or continuing would teach a misconception.
- **Major:** a supporting claim or scope condition is wrong, a citation points to the wrong passage, or a central claim lacks A/B support.
- **Minor:** wording ambiguity, notation drift, an unnecessary citation, a broken nonessential anchor, or a small presentation issue.

If no severity is obvious, ask which error a learner would actually inherit.

## Cross-check when warranted

Use Wikipedia or a paper-search tool for an independent check when:

- a central theorem is unusual or high impact;
- the cited source is tier C/D;
- sources conflict;
- the note has no primary support.

Record the cross-check source separately. Never replace the required library support for a central chapter claim with only an encyclopedia or search result.

## Write the report

Create `<set>/log/checks/<note-filename>.md`:

```md
# Check: notes/03-svd.md

## Summary

One blocker, one major issue, and two minor issues.

## Issues

### 1. Blocker — wrong dimensions

- **Claim:** ...
- **Source:** lib-strang-la, p131 says: "..."
- **Problem:** ...
- **Fix:** ...
```

Include a `No issues found` section only when every claim was checked and supported. Mention unchecked claims explicitly; silence is not a passing result.

## Finish safely

- Never rewrite the note during checking.
- If the role is explicitly allowed to change note status, make only that exact frontmatter edit.
- Preserve the evidence trail so the learner can review each verdict.
