# Twenty rules for durable cards — Studium paraphrase

This is an original paraphrase of Piotr Woźniak's *Effective learning: Twenty rules of formulating knowledge* (SuperMemo, first published February 1999 and subsequently updated): <https://super-memory.com/articles/20rules.htm>. The ordering and central ideas come from that article; the wording, examples, and Studium-specific checks below are new.

Apply every rule as a diagnostic, not as permission to alter a learner's approved material. The “better” examples illustrate card shape; their facts still need a registered source before use.

## 1. Require understanding before recall

Do not schedule a sentence the learner cannot explain. First repair the prerequisite or note; memorizing opaque words creates brittle recall.

- **Bad:** Q: Why is the Hessian positive semidefinite here? A: Because the theorem says so.
- **Better:** Q: What does a positive-semidefinite Hessian say about local curvature? A: It has no negative-curvature direction.

## 2. Build the map before drilling details

Place facts inside a coherent overview before extracting cards. Isolated fragments are harder to retrieve and use.

- **Bad:** Q: In step 7, what is multiplied by $V^\top$? A: $\Sigma$.
- **Better:** Q: In the SVD $A=U\Sigma V^\top$, which factor maps coordinates into right-singular-vector directions? A: $V^\top$.

## 3. Secure foundations before refinements

Card the small model and core vocabulary before exceptions or advanced consequences. A forgotten basic can block many later memories.

- **Bad:** Q: When does the compact SVD preserve the pseudoinverse formula? A: When zero singular values are omitted.
- **Better:** Q: What does a zero singular value indicate? A: A direction lost by the transformation.

## 4. Minimize each retrieval

One card should demand one small response. Split independent facts so each can be scheduled and forgotten independently.

- **Bad:** Q: Define rank and give its bounds and geometric meaning. A: Three separate facts.
- **Better:** Q: What is the rank of a matrix? A: The dimension of its column space.

## 5. Use cloze deletion for an atomic target

A short, well-cued deletion can turn source prose into a precise prompt quickly. Blank only the part that should be retrieved.

- **Bad:** The SVD is {{c1::a factorization with orthogonal matrices, singular values, rank information, and many applications}}.
- **Better:** In $A=U\Sigma V^\top$, the singular values lie on the diagonal of {{c1::$\Sigma$}}.

## 6. Prefer a useful image when shape or location matters

For spatial knowledge, a clear figure can cue memory better than a verbal tour. Use an image only when it saves review effort and its meaning is legible.

- **Bad:** Q: Describe every labeled region of the heart from top left to bottom right. A: A paragraph.
- **Better:** Q: In this heart diagram, which chamber is highlighted? A: The left ventricle.

## 7. Add a mnemonic when direct recall remains costly

Use a compact mnemonic for a stubborn item, then keep the actual answer explicit. Mnemonics help encoding; they do not replace understanding or review.

- **Bad:** Q: What is the cranial-nerve order? A: A long unaided list.
- **Better:** Q: Which nerve follows the optic nerve? A: Oculomotor. Extra: use the learner's approved cranial-nerve mnemonic.

## 8. Hide one part of a diagram at a time

Image occlusion is the visual analogue of cloze deletion: one missing label or region per prompt. Studium M2 has only basic and text-cloze cards, so do not pretend unsupported occlusion exists; use a single labeled-region basic card or defer it.

- **Bad:** Q: Name all twelve numbered bones in this image. A: Twelve names.
- **Better:** Q: In this hand diagram, what is label 4? A: The scaphoid.

## 9. Avoid unordered sets

“Name all members” has unstable recall order and unclear partial credit. Replace it with meaningful membership questions or small, structured groups.

- **Bad:** Q: Name every noble gas. A: He, Ne, Ar, Kr, Xe, Rn, Og.
- **Better:** Q: Which noble gas has atomic number 10? A: Neon.

## 10. Avoid long ordered lists

Sequences are better than unordered sets but still overload one review. Use overlapping clozes, small chunks, or independently cued steps.

- **Bad:** Q: List all stages of mitosis in order. A: Prophase through cytokinesis.
- **Better:** During mitosis, metaphase is followed by {{c1::anaphase}}.

## 11. Detect and reduce interference

Similar prompts or answers can make each other harder to recall. Differentiate them with discriminating cues, merge duplicates, or reject the new card. In Studium, compare against approved and exported cards and cite the conflicting card id.

- **Bad:** Q: Which matrix contains right singular vectors? A: $V$. (Near-duplicate of `c-a1b2c3d4`.)
- **Better:** Q: SVD — are right singular vectors columns of $U$ or $V$? A: $V$.

## 12. Tighten wording

Remove setup that does not help identify the target. The learner should spend review time retrieving, not parsing.

- **Bad:** Q: Considering the lengthy discussion above about matrices, what can we say rank means in this situation? A: Column-space dimension.
- **Better:** Q: Matrix rank equals the dimension of which space? A: The column space.

## 13. Cue with already-known memories

Anchor a new distinction to stable knowledge when that makes the prompt shorter and less confusable. Do not use an anchor the learner has not mastered.

- **Bad:** Q: What is covariance? A: Joint variability.
- **Better:** Q: Unlike variance of one variable, covariance measures what? A: How two variables vary together.

## 14. Personalize with a concrete example

Connect an abstract fact to an example already meaningful to this learner. Use only profile facts or examples the learner supplied; never invent personal history.

- **Bad:** Q: What is exponential decay? A: Decrease proportional to current amount.
- **Better:** Q: In the learner's battery-discharge example, what makes the model exponential? A: Loss rate is proportional to charge remaining.

## 15. Use vivid emotion carefully

A distinctive, emotionally salient example can strengthen a weak memory. It must remain accurate, respectful, and retrievable without requiring the same mood.

- **Bad:** Q: What is loss aversion? A: Preferring to avoid losses.
- **Better:** Q: Why can losing ₹500 feel stronger than finding ₹500? A: Loss aversion.

## 16. Supply a compact context cue

A short domain label can disambiguate a term without a long preamble. Context must narrow the answer rather than leak it.

- **Bad:** Q: What is a kernel? A: The central part.
- **Better:** Q: Linear algebra — kernel of $A$? A: Vectors mapped to zero by $A$.

## 17. Allow useful redundancy across atomic cards

Minimum information limits each retrieval, not the number of useful retrieval routes. Important knowledge may deserve separate forward, reverse, applied, or derivation cards.

- **Bad:** Q: Translate “chien” and also recognize, spell, and use it. A: Dog plus several tasks.
- **Better:** Q: French → English: *chien*? A: Dog. Separate card: Q: English → French: dog? A: *chien*.

## 18. Keep provenance beside the card

Record where a claim came from so conflicts and updates can be checked later. The source is metadata unless recalling it is itself the learning goal.

- **Bad:** Q: What is the recommended dose? A: 20 mg. (No source or population.)
- **Better:** Q: Guideline X — adult starting dose for condition Y? A: 20 mg. `src: lib-guideline-x#p14`

## 19. Date or version facts that can expire

Attach a year, edition, jurisdiction, or software version to volatile knowledge. Do not silently present a snapshot as timeless.

- **Bad:** Q: What is Python's latest stable version? A: 3.x.
- **Better:** Q: As of 2026-09, which Python release does this note target? A: 3.x. `src: lib-python-docs#version-3.x`

## 20. Spend reviews on the highest-value knowledge

The possible deck is larger than the learner's time. Prefer concepts that unlock the plan, recur often, or prevent costly errors; omit low-value trivia even when it is easy to card.

- **Bad:** Q: On which page does the SVD chapter begin? A: Page 361.
- **Better:** Q: Which SVD components determine the rank of $A$? A: The nonzero singular values.
