---
title: Vectors and linear combinations
order: 1
status: accepted
sources: [lib-strang-la]
---

# Vectors and linear combinations

A vector in $\mathbb{R}^n$ is an ordered list of $n$ real numbers. We can add vectors
and scale them, and almost everything else in linear algebra is built from those two
moves.

## Linear combinations

A linear combination of vectors $v_1, \dots, v_k$ is any expression
$c_1 v_1 + \dots + c_k v_k$ with scalars $c_i$. The set of all such combinations is the
**span** of the vectors.

- The dot product $u \cdot v = \sum_i u_i v_i$ measures alignment.
- Two vectors are orthogonal exactly when $u \cdot v = 0$.
- The length of a vector is $\lVert v \rVert = \sqrt{v \cdot v}$.

## Worked example

Take $u = (1, 0)$ and $v = (0, 1)$. Every vector $(a, b)$ is $a u + b v$, so these two
span the whole plane. Add a third vector $w = (1, 1)$ and the span does not grow,
because $w$ is already a combination of $u$ and $v$.

:::deeper
A set of vectors spans $\mathbb{R}^n$ exactly when $A c = b$ has a solution for every
$b$. Checking that is what elimination is for, in the next note.
:::

[^src:lib-strang-la#p12]: Strang, *Introduction to Linear Algebra*, ch. 1.

Changing a scalar changes how far we travel along a vector. In Visuals, adjust the slope, then step through the vector stretch.

::visual{src="../visuals/slope.json" title="Slope and stretch"}
::visual{src="../visuals/stretch.html" title="Stretch a vector"}
