| round | change | test correct | train correct | test $/case | train $/case | test latency | zooms/case | verdict |
|---|---|---|---|---|---|---|---|---|
| 0 | baseline (2x cases, extension at d23f19d) | 44/44 | 40/40 | $0.0789 | $0.0693 | 19.3s | 3.01 | |
| 1 | image:N takes original-pixel coordinates | 44/44 | 40/40 | $0.0702 | $0.0684 | 14.2s | 3.01 | kept |
| 2 | no-selector default is the latest image, not the latest crop | 44/44 | 40/40 | $0.0653 | $0.0609 | 12.3s | 2.95 | kept |
| 3 | magnify crops at most 2x | 44/44 | 40/40 | $0.0562 | $0.0532 | 12.3s | 2.98 | kept (best) |
| 4 | guideline: crop only the needed region | 44/44 | 40/40 | $0.0597 | $0.0554 | 11.9s | 3.02 | reverted (+6.1% ± 6.1%) |
| 5 | magnification cap 1.5x | 44/44 | 40/40 | $0.0551 | $0.0527 | 11.9s | 2.88 | reverted (within noise) |

Best: round 3. Against baseline it measures test cost -28.7% ± 10.5% and test latency -36.4% ± 12.9%, with correct 84/84 throughout (2 reps × 42 cases, 21/21 train/test split stratified by family).

The three kept changes all fix the extension's mechanics, not its prose. v1 and v2 remove a coordinate-frame mismatch: the model always sends original-image pixels, but `image:N` and the no-selector default resolved to other spaces. Zoom errors went 126 → 50 → 0, and each error had cost a full model turn, which is where most of the latency win came from. v3 stops magnifying small crops to fill the patch budget. Those 4 to 13x images were 47% of zoom pixels and bought no extra legibility, since zoom calls did not rise when they were capped. The one prompt-only change (v4) did not move behavior enough to pay for its tokens. v5 showed the magnification lever is spent below 2x.

`correct` was 100% at every round on these cases, so it could not move. Plan 3 (harder cases until the extension drops below 100%) follows.

## Plan 3: harder cases (probes, not committed)

Run with v3 code. I tried three ways to push the extension below 100%:

| probe | cases × reps | extension correct | no-extension correct | $/case (ext) |
|---|---|---|---|---|
| 4x image scale (14400x10800 tables) | 42 × 1 | 42/42 | not run | $0.090 |
| hard set A: row max, chart peak month, count toggles by prefix, 4-hop red path | 16 × 2 | 31/32 | 4/16 | $0.081 |
| hard set B: column max (60 cells), count > 800000 in a row, count all 60 toggles, 8-hop path | 16 × 2 | 31/32 | 6/16 | about $0.08 |

The extension fails 2 of 64 runs. Both misses are one-off reading slips, not strategy failures. `hard-rowmax-3` rep 0 read all 30 cells and picked the second-largest. `hard-allon-3` rep 0 counted 60 toggles from one 0.27x crop and got 30 instead of 32. The other rep of each case was correct. At 2 of 64 the noise floor is larger than the headroom: a 95% interval on a 97% pass rate over 64 runs is about ±4 points, the same size as all the remaining errors. `correct` therefore cannot be hillclimbed on these cases with an eval this size. Spend for plan 3 was $11.16 (measured).
