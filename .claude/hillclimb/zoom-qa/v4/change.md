# v4: crop only the needed region; drop coarse-to-fine framing

**Behavior (v3 train).** In 10 of 40 runs the first crop was a whole strip, column or quadrant. It came back downscaled, 7 of 12 at 0.22 to 0.25x (the preview's own resolution), so it was re-cropped tighter on a later turn. The result was 12 useless images, 12 forced re-crops and about 12 extra turns. Guideline 3 ("use that source_id for a tighter recursive crop") and the context block ("can be zoomed again") both describe that two-pass strategy. Evidence: table-3_rep0 (a 7200x200 strip at 1568x44, then a re-crop), multi-1_rep0, ui-toggle-3_rep1 (four 3100px quadrants at 0.48x, $0.10) vs rep0 (two 840px columns, $0.05).

**Change.** Replace guideline 3 with "Crop only the region you need to read, not the strip, band, or panel around it. Output is capped at the preview's size budget, so a crop spanning most of the image comes back no sharper than the preview. Re-crop a zoom:* result only if it is still unreadable." Drop the recursion sentence from the context block. The zoom:N frame is still stated in the tool description and in every result.

**Expected.** About -12% cost (analyzer's counterfactual estimate). Risk: UI search cases might crop more, tighter regions.
