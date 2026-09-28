---
title: Matrices, elimination, and rank
order: 2
status: accepted
sources: [lib-strang-la]
---

# Matrices, elimination, and rank

A matrix $A$ of size $m \times n$ acts on a vector $x \in \mathbb{R}^n$ and returns
$Ax \in \mathbb{R}^m$. Reading $A$ column by column, $Ax$ is a linear combination of
those columns.

## Elimination

Gaussian elimination subtracts multiples of one row from another to introduce zeros
below the pivots. Applied to $[A \mid b]$ it decides whether $Ax = b$ is solvable, and
the number of pivots is the **rank** of $A$.

$$A = LU$$

Here $L$ is lower triangular with unit diagonal and $U$ is upper triangular. The
factorisation is the record of everything elimination did.

## Rank and the four subspaces

- The column space is the span of the columns; its dimension is the rank $r$.
- The null space holds every $x$ with $Ax = 0$; its dimension is $n - r$.
- Row space and left null space are the transposes of the two above.

:::deeper
$LU$ and $A = CR$ are the same story told two ways: $C$ picks out a basis of the
column space, $R$ records the coefficients that rebuild every other column.
:::

[^src:lib-strang-la#p96]: Strang, *Introduction to Linear Algebra*, ch. 2.
