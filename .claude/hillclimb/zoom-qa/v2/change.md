# v2: zoom calls with no selector go to the root image, not the latest crop

**Behavior (v1 train).** 94 of 140 zoom calls passed no `source_id`, `image_index` or `path`. Those calls used the "most recent image/zoom". Every one of them sent original-pixel coordinates. When a crop had just been returned, that box was applied to the crop's 1568xN space: 26 of 94 errored ("Invalid region ... inside 1148x1056"), and a few were silently clamped into the crop. That happened in 13 of 40 train runs, mostly where the model fires several crops in parallel. Each error cost a full model turn spent re-sending the same boxes with `source_id: "image:0"`. Evidence: `chart-4_rep1`, `table-2_rep0`, `ui-toggle-2_rep0`.

Out of 140 calls the model used a no-selector call on a zoom crop intentionally at most 2 times. Calls that recursed into a crop always named `zoom:N`.

**Change.** With no selector, the default is the latest attached or read image. Recursing into a crop needs an explicit `zoom:N` source_id. The tool description says so.

**Expected.** About 13 of 40 train runs lose one wasted turn (≈$0.01 each on these runs). Latency drops on chart, table and UI. This is smaller than v1. Train cost is expected to fall about 5 to 8%, which is near the noise floor. Latency is likely to clear it.
