# Plan: Judge Disagreement Highlighting

## Summary

When multiple judges evaluate a response and their scores diverge by more than 2.5 points, we display a visible "Judges disagree" indicator and an educational explanation encouraging users to think critically about AI evaluation subjectivity. This is a frontend-only change — no backend, type, or GraphQL modifications needed.

## PRD Requirements (minus analytics)

1. **Disagreement Threshold**: Score divergence > 2.5 points triggers the indicator
2. **Collapsed View Indicator**: A distinct chip/icon visible without expanding
3. **Expanded View Explanation**: Educational text explaining why AI judges disagree

## Changes

All changes are in a single file: `src/components/ResponseQualityRating.tsx`

### Step 1: Add disagreement detection helper

Add a pure function `hasJudgeDisagreement(ratings: JudgeRatings): boolean` near the top of `ResponseQualityRating.tsx` alongside the existing helpers (`getRatingColor`, `getRatingLabel`).

Logic:
- Collect all scores from the ratings object
- If fewer than 2 scores exist, return `false`
- Compute `max(scores) - min(scores)`
- Return `true` if the spread exceeds `2.5`

This is intentionally the simplest possible metric — max minus min across all judges. No need for pairwise comparisons or standard deviation.

### Step 2: Add a "Judges disagree" indicator chip (collapsed view)

In the main `ResponseQualityRating` component's returned JSX, add a chip after the list of `SingleRatingBadge` components (inside the same flex container).

Conditions for display:
- `hasJudgeDisagreement(ratings)` returns `true`
- At least 2 judges have completed ratings (not still loading)

Chip design:
- MUI `<Chip>` with `color="info"` (blue — contrasts with the green/amber/red rating chips)
- Import and use `BalanceIcon` from `@mui/icons-material/Balance` as the icon (scales icon — visually communicates weighing/comparison)
- Label text: **"Judges disagree"**
- `size="small"`, `variant="outlined"` to match existing badge style
- Clicking it expands the detail view (same as clicking any rating badge)

### Step 3: Add educational explanation in expanded view

In the `<Collapse>` section, when `hasJudgeDisagreement(ratings)` is true, prepend an `<Alert>` component above the rating detail cards.

Alert design:
- MUI `<Alert>` with `severity="info"` and `variant="outlined"`
- Same `BalanceIcon` used as the custom `icon` prop
- Body text: *"These AI judges evaluated this response differently. This is normal — AI systems have different strengths and biases. Consider reading both explanations to decide for yourself."*
- Typography `variant="body2"` for the text
- Margin-bottom to separate it from the rating cards below

### Step 4: Add MUI imports

Add these imports to the top of `ResponseQualityRating.tsx`:
- `Alert` from `@mui/material`
- `BalanceIcon` from `@mui/icons-material/Balance`

## Files Modified

| File | Change |
|------|--------|
| `src/components/ResponseQualityRating.tsx` | Add disagreement detection function, indicator chip, and educational alert |

## What We're NOT Doing

- **No analytics tracking** (per user request — analytics infrastructure doesn't exist yet)
- **No backend changes** — all data needed (scores) is already present in `JudgeRatings`
- **No new files** — this is a small, self-contained UI enhancement
- **No type changes** — we use the existing `JudgeRatings` / `QualityRating` types as-is
- **No threshold configurability** — the 2.5 threshold is hardcoded as a constant, matching the PRD spec. Can be extracted later if needed.
