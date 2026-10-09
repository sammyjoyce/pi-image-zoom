# v5: magnification cap 2x -> 1.5x

**Hypothesis.** v3's cap gave -14% with zoom calls flat, so legibility was not the limit. At v3, 54 of 113 train zoom images still came back at exactly 2x. A 1.5x cap shrinks those by about 44% in pixels. If 1.5x is still legible, cost falls further. If not, either `correct` drops (the smallest-text cases are 4.5px digits, which come out at about 6.75px) or zoom calls rise as the model re-crops. This pushes the same lever further, as a threshold probe.
