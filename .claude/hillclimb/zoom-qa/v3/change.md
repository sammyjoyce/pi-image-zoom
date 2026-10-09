# v3: cap crop magnification at 2x

**Behavior (v2 train).** Cache writes are 70% of cost ($0.044 of $0.061 per run), and most of that is zoom images. Every crop is magnified to fill the 1568-patch budget whatever its size. A 250x91 cell crop came back as 1568x571 (6.3x). 45 of 112 zoom images were magnified more than 3x, and they hold 47% of all zoom pixels. Median magnification is 1.96x. Readable answers came from crops at 2x and below throughout the transcripts.

**Change.** `zoomSize` magnifies a crop by at most 2x. Large crops still downscale to the budget.

**Expected.** Up to about 40% fewer zoom-image pixels, which cuts cache writes and every later cache read of them. Risk: tiny-text cases, i.e. 4.5 px digits that come out at 9 px after 2x. The model may re-zoom tighter, or it may misread. `correct` will show which.
