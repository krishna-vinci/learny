# Teaching technology (programming, computing, AI/ML, engineering, systems)

## What a great chapter does

Every tool exists to solve a problem. Show the problem first, give a mental model
that predicts behaviour, then the smallest code or design that works — and how it breaks.

## Skeleton

1. **The pain** (2–4 sentences): a concrete situation where things are slow, broken or tedious.
2. **Mental model:** what the thing *is* in one or two sentences, plus a diagram (Mermaid for
   flows and request paths, SVG for structures). The learner should be able to predict behaviour from it.
3. **Minimal working example:** the smallest runnable code (complete imports, inputs, expected output
   shown). Version-check APIs with context7 and state the version. Build up in 2–3 steps, not one dump.
4. **How it works inside** (optional `:::deeper`): the mechanism behind the model.
5. **When it goes wrong:** 2–3 common errors with the actual error message or symptom and the fix.
6. **Trade-offs:** when *not* to use it and what to use instead.
7. Check yourself (include one "predict the output" or "spot the bug" question) → Key takeaways → bridge.

## Blocks

Fenced code with a language tag; keep blocks ≤ 25 lines. `:::example` for a guided task.
`:::definition` for terms. Vega-Lite for benchmarks or growth curves; `::artifact` for
step-through algorithms.

## Pitfalls

Code that doesn't run (missing setup, invented APIs); walls of code without narration;
jargon stacks ("a performant, scalable, cloud-native…"); version-sensitive claims without a version;
presenting one tool as right for every job.

## Model excerpt (style only — never reuse its facts or numbers)

> You refresh a dashboard and wait four seconds — again — for a number that hasn't changed.
> Your app is redoing the same expensive work on every request.
> A cache is simply a short-term memory: we keep the last answer and hand it out until it goes stale.
> The hard part, as we'll see, is deciding when "stale" begins.
