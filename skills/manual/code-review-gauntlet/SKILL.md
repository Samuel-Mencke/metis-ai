---
name: code-review-gauntlet
description: Review a completed implementation from independent correctness and maintainability angles, then repair real findings and re-verify affected behavior.
---

# Code review gauntlet

Review the actual diff, not the task description.

Run independent passes over the changed behavior:
- Line-by-line correctness: wrong conditions, missing awaits, null/falsy handling, boundary errors, swallowed failures, race/state mistakes.
- Removed behavior: for deleted or replaced guards/paths, identify the invariant they used to enforce and confirm where it now lives.
- Cross-file effects: inspect callers and callees of changed interfaces and state transitions.
- Reuse and simplification: reject duplicate infrastructure, unnecessary state and special-case patches when an existing shared mechanism can solve the root cause.
- Efficiency: flag avoidable repeated I/O, serialization, heavyweight work in hot paths, or unsafe parallel/sequential scheduling.
- Root-cause depth: prefer fixing the shared mechanism that creates the defect instead of layering another symptom-specific branch.
- Project conventions: enforce explicit repo instructions only when an applicable rule can be identified.

For every candidate finding, name a concrete failure scenario or concrete maintenance/runtime cost. Re-check candidates against the surrounding code before treating them as real. Correctness and data-loss/race issues outrank cleanup findings.

When a real finding requires a code change, repair it and repeat runtime verification for every affected surface. Do not mark the run done merely because the review found nothing else.
