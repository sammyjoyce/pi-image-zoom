# v1: address attached images in original pixels

**Behavior (train, baseline).** In 36 of 36 zoom-using runs, the first `zoom_image` call gave coordinates in original-image pixels (e.g. 7200x5400). `image:N` sources were defined in overview pixels (e.g. 1269x952). 32 runs got `Invalid region` errors. 4 runs got a clamped, near-full-image crop. All 60 first-turn boxes overlap a crop the model made successfully a turn later, so the region was right and the frame was wrong. Pi's own `<file>` note ("displayed at 2000x1500, multiply by 3.60") pushes the model toward original pixels as well. The analyzer estimated this costs 17 to 19% of spend.

**Change.** `image:N` and read sources now take original-pixel coordinates, the same frame as `path` sources and Pi's note. The context block states the frame and the preview-to-original multiplier in words. Pi's resize note is removed once the extension has replaced the preview. `zoom:N` sources are unchanged.

Evidence (quoted by the analyzer): `label-0_rep0` thinking says "converting their bounding box coordinates ... back to the original 8000x6000 resolution using the scale factor of about 6.3", then five `Invalid region ... inside 1269x952` errors. `diagram-0_rep0` sent `x1:5950 ... y2:6350` and got `inside 1092x1092`; the retry at `(900,800)-(1040,960)` cropped the same region.

**Risk.** The model might send preview coordinates, which would now be a silent miss instead of an error. `zoom_on_target` will show that.
