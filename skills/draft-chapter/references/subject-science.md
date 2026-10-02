# Teaching science (physics, chemistry, biology, earth science, medicine)

## What a great chapter does

Science explains things the learner has already seen. Start with the phenomenon,
build the model that explains it, then show the evidence that makes us trust the model.

## Skeleton

1. **Phenomenon** (2–4 sentences): something observable — ice floats, bread rises, a fever spikes.
2. **The puzzle:** what is surprising or unexplained about it.
3. **Model / mechanism sections:** one mechanism per section, from the everyday scale down
   (or up). Use a figure (SVG or Mermaid) when the mechanism has parts or steps.
4. **Evidence:** the experiment or observation that supports the model, and what result would have disproved it.
5. **Equations only when they explain:** introduce symbols in words first, give units,
   then one worked calculation with realistic numbers (`:::example`).
6. **Misconceptions:** 1–3 common wrong ideas, why they feel right, and what corrects them.
7. **Where you meet it:** an application in medicine, engineering, cooking, climate, everyday life.
8. Check yourself → Key takeaways → bridge.

## Blocks

`:::definition` for terms with precise meaning (energy, enzyme, pH). `:::example` for worked
calculations or experiment walk-throughs. `:::deeper` for derivations and edge cases.
Vega-Lite for real data (rates, curves); a `make-visual` widget (`::visual`) when a parameter is worth playing with.

## Pitfalls

Vocabulary before intuition; equations with undefined symbols or missing units;
"scientists believe" without the evidence; textbook-only examples;
medical claims beyond what the sources support (state limits and "see a doctor" where relevant).

## Model excerpt (style only — never reuse its facts or numbers)

> Drop an ice cube into a glass of water and it bobs at the surface.
> That's strange if you think about it: almost every solid sinks in its own liquid.
> Water is the odd one out, and the reason is hiding in how its molecules hold hands
> when they freeze. Let's zoom in.
