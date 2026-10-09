# zoom-qa: proposed inputs (42 cases)

All images are rendered by `generate-cases.mjs` from a fixed seed; every expected answer comes from the generator, not a model. `answer-key-crops.png` (next to this file) shows the full-resolution region holding each answer with the expected value printed above it.

Every prompt is `@<image> <question>` followed by the same answer-format line:

> End your reply with a final line in the form "ANSWER: <answer>". If the image does not contain what is asked for, use "ANSWER: NOT FOUND".

| family | cases | what makes it hard |
|---|---:|---|
| table | 8 | 3600×2700 sheet, 1,800 six-digit cells in 9px mono; ~3px in the overview |
| chart | 6 | 4000×2400, 5 series × 24 points, every point labelled in 10px; value cannot be read off the axis |
| ui | 6 | 3200×2000 settings screen, 60 toggles with 8px labels, 9px build string |
| diagram | 6 | 3600×3600 network, 70 nodes with 10px codes, one red edge to trace |
| label | 5 | 4000×3000 cluttered photo, 5–6 small stickers; one headed SERIAL, the rest decoys |
| multi-image | 3 | two images attached, question is about the second (tests image_index routing) |
| easy | 4 | 190px banner word; answerable without zooming (measures needless zoom calls and cost) |
| absent | 4 | the thing asked about is not in the image (near-miss setting name, missing series, column AH of a 30-column sheet, no SERIAL sticker); correct answer is NOT FOUND |

| id | tags | expected | image(s) |
|---|---|---|---|
| table-0 | table, tiny-text | `813165` | table-0.png |
| table-1 | table, tiny-text | `287851` | table-1.png |
| table-2 | table, tiny-text | `512047` | table-2.png |
| table-3 | table, tiny-text | `747012` | table-3.png |
| table-4 | table, tiny-text | `851244` | table-4.png |
| table-5 | table, tiny-text | `458783` | table-5.png |
| table-6 | table, tiny-text | `770596` | table-6.png |
| table-7 | table, tiny-text | `565852` | table-7.png |
| chart-0 | chart, data-label | `3569` | chart-0.png |
| chart-1 | chart, data-label | `5439` | chart-1.png |
| chart-2 | chart, data-label | `1312` | chart-2.png |
| chart-3 | chart, data-label | `1496` | chart-3.png |
| chart-4 | chart, data-label | `5120` | chart-4.png |
| chart-5 | chart, data-label | `2506` | chart-5.png |
| ui-toggle-0 | ui, toggle | `OFF` | ui-0.png |
| ui-toggle-1 | ui, toggle | `ON` | ui-1.png |
| ui-toggle-2 | ui, toggle | `ON` | ui-2.png |
| ui-toggle-3 | ui, toggle | `ON` | ui-3.png |
| ui-build-4 | ui, footer-text | `7.17.3173-rc3` | ui-4.png |
| ui-build-5 | ui, footer-text | `6.28.2791-rc9` | ui-5.png |
| diagram-0 | diagram, line-tracing | `PJ-63` | diagram-0.png |
| diagram-1 | diagram, line-tracing | `AC-10` | diagram-1.png |
| diagram-2 | diagram, line-tracing | `ER-30` | diagram-2.png |
| diagram-3 | diagram, line-tracing | `VJ-66` | diagram-3.png |
| diagram-4 | diagram, line-tracing | `EE-47` | diagram-4.png |
| diagram-5 | diagram, line-tracing | `EF-68` | diagram-5.png |
| label-0 | label, tiny-text | `XMXT-86883-CY` | label-0.png |
| label-1 | label, tiny-text | `EP36-93932-HC` | label-1.png |
| label-2 | label, tiny-text | `T6LH-92372-VP` | label-2.png |
| label-3 | label, tiny-text | `DMPP-97392-AV` | label-3.png |
| label-4 | label, tiny-text | `Q6W8-68397-QV` | label-4.png |
| multi-0 | multi-image, chart | `2453` | multi-0-a.png, multi-0-b.png |
| multi-1 | multi-image, table | `583662` | multi-1-a.png, multi-1-b.png |
| multi-2 | multi-image, ui | `OFF` | multi-2-a.png, multi-2-b.png |
| easy-0 | easy, no-zoom-needed | `MERIDIAN` | easy-0.png |
| easy-1 | easy, no-zoom-needed | `THRESHOLD` | easy-1.png |
| easy-2 | easy, no-zoom-needed | `LANTERN` | easy-2.png |
| easy-3 | easy, no-zoom-needed | `HARBOUR` | easy-3.png |
| absent-label | absent, label | `NOT FOUND` | absent-0.png |
| absent-ui | absent, ui | `NOT FOUND` | absent-1.png |
| absent-chart | absent, chart | `NOT FOUND` | absent-2.png |
| absent-table | absent, table | `NOT FOUND` | absent-3.png |

## table-0

````text
@table-0.png What number is in column H, row 54 of this spreadsheet?

End your reply with a final line in the form "ANSWER: <answer>". If the image does not contain what is asked for, use "ANSWER: NOT FOUND".
````

expected: `813165` · answer region (image 0): x 901–1018, y 2390–2434

## table-1

````text
@table-1.png What number is in column I, row 20 of this spreadsheet?

End your reply with a final line in the form "ANSWER: <answer>". If the image does not contain what is asked for, use "ANSWER: NOT FOUND".
````

expected: `287851` · answer region (image 0): x 1019–1136, y 882–926

## table-2

````text
@table-2.png What number is in column E, row 36 of this spreadsheet?

End your reply with a final line in the form "ANSWER: <answer>". If the image does not contain what is asked for, use "ANSWER: NOT FOUND".
````

expected: `512047` · answer region (image 0): x 549–666, y 1592–1636

## table-3

````text
@table-3.png What number is in column T, row 55 of this spreadsheet?

End your reply with a final line in the form "ANSWER: <answer>". If the image does not contain what is asked for, use "ANSWER: NOT FOUND".
````

expected: `747012` · answer region (image 0): x 2309–2426, y 2434–2478

## table-4

````text
@table-4.png What number is in column Q, row 20 of this spreadsheet?

End your reply with a final line in the form "ANSWER: <answer>". If the image does not contain what is asked for, use "ANSWER: NOT FOUND".
````

expected: `851244` · answer region (image 0): x 1957–2074, y 882–926

## table-5

````text
@table-5.png What number is in column S, row 11 of this spreadsheet?

End your reply with a final line in the form "ANSWER: <answer>". If the image does not contain what is asked for, use "ANSWER: NOT FOUND".
````

expected: `458783` · answer region (image 0): x 2192–2309, y 483–527

## table-6

````text
@table-6.png What number is in column E, row 7 of this spreadsheet?

End your reply with a final line in the form "ANSWER: <answer>". If the image does not contain what is asked for, use "ANSWER: NOT FOUND".
````

expected: `770596` · answer region (image 0): x 549–666, y 306–350

## table-7

````text
@table-7.png What number is in column V, row 40 of this spreadsheet?

End your reply with a final line in the form "ANSWER: <answer>". If the image does not contain what is asked for, use "ANSWER: NOT FOUND".
````

expected: `565852` · answer region (image 0): x 2544–2661, y 1769–1813

## chart-0

````text
@chart-0.png What value is labelled on the Northwind line at month 21?

End your reply with a final line in the form "ANSWER: <answer>". If the image does not contain what is asked for, use "ANSWER: NOT FOUND".
````

expected: `3569` · answer region (image 0): x 3214–3270, y 1126–1166

## chart-1

````text
@chart-1.png What value is labelled on the Halvorsen line at month 12?

End your reply with a final line in the form "ANSWER: <answer>". If the image does not contain what is asked for, use "ANSWER: NOT FOUND".
````

expected: `5439` · answer region (image 0): x 1829–1885, y 329–369

## chart-2

````text
@chart-2.png What value is labelled on the Brightwater line at month 13?

End your reply with a final line in the form "ANSWER: <answer>". If the image does not contain what is asked for, use "ANSWER: NOT FOUND".
````

expected: `1312` · answer region (image 0): x 1983–2039, y 2087–2127

## chart-3

````text
@chart-3.png What value is labelled on the Oakridge line at month 15?

End your reply with a final line in the form "ANSWER: <answer>". If the image does not contain what is asked for, use "ANSWER: NOT FOUND".
````

expected: `1496` · answer region (image 0): x 2291–2347, y 2009–2049

## chart-4

````text
@chart-4.png What value is labelled on the Brightwater line at month 20?

End your reply with a final line in the form "ANSWER: <answer>". If the image does not contain what is asked for, use "ANSWER: NOT FOUND".
````

expected: `5120` · answer region (image 0): x 3060–3116, y 465–505

## chart-5

````text
@chart-5.png What value is labelled on the Northwind line at month 15?

End your reply with a final line in the form "ANSWER: <answer>". If the image does not contain what is asked for, use "ANSWER: NOT FOUND".
````

expected: `2506` · answer region (image 0): x 2291–2347, y 1578–1618

## ui-toggle-0

````text
@ui-0.png In this settings screenshot, is "Translate status updates" switched on or off?

End your reply with a final line in the form "ANSWER: <answer>". If the image does not contain what is asked for, use "ANSWER: NOT FOUND".
````

expected: `OFF` · answer region (image 0): x 850–1270, y 1342–1392

## ui-toggle-1

````text
@ui-1.png In this settings screenshot, is "Archive shared folders" switched on or off?

End your reply with a final line in the form "ANSWER: <answer>". If the image does not contain what is asked for, use "ANSWER: NOT FOUND".
````

expected: `ON` · answer region (image 0): x 2410–2830, y 1678–1728

## ui-toggle-2

````text
@ui-2.png In this settings screenshot, is "Backup drafts" switched on or off?

End your reply with a final line in the form "ANSWER: <answer>". If the image does not contain what is asked for, use "ANSWER: NOT FOUND".
````

expected: `ON` · answer region (image 0): x 2410–2830, y 894–944

## ui-toggle-3

````text
@ui-3.png In this settings screenshot, is "Pin old sessions" switched on or off?

End your reply with a final line in the form "ANSWER: <answer>". If the image does not contain what is asked for, use "ANSWER: NOT FOUND".
````

expected: `ON` · answer region (image 0): x 70–490, y 1566–1616

## ui-build-4

````text
@ui-4.png What build number is shown in the footer of this screenshot?

End your reply with a final line in the form "ANSWER: <answer>". If the image does not contain what is asked for, use "ANSWER: NOT FOUND".
````

expected: `7.17.3173-rc3` · answer region (image 0): x 2930–3190, y 1956–1986

## ui-build-5

````text
@ui-5.png What build number is shown in the footer of this screenshot?

End your reply with a final line in the form "ANSWER: <answer>". If the image does not contain what is asked for, use "ANSWER: NOT FOUND".
````

expected: `6.28.2791-rc9` · answer region (image 0): x 2930–3190, y 1956–1986

## diagram-0

````text
@diagram-0.png Which node is connected to HT-35 by the red line? Give its code.

End your reply with a final line in the form "ANSWER: <answer>". If the image does not contain what is asked for, use "ANSWER: NOT FOUND".
````

expected: `PJ-63` · answer region (image 0): x 3021–3390, y 2657–3143

## diagram-1

````text
@diagram-1.png Which node is connected to NC-70 by the red line? Give its code.

End your reply with a final line in the form "ANSWER: <answer>". If the image does not contain what is asked for, use "ANSWER: NOT FOUND".
````

expected: `AC-10` · answer region (image 0): x 849–1337, y 1702–2155

## diagram-2

````text
@diagram-2.png Which node is connected to VA-67 by the red line? Give its code.

End your reply with a final line in the form "ANSWER: <answer>". If the image does not contain what is asked for, use "ANSWER: NOT FOUND".
````

expected: `ER-30` · answer region (image 0): x 2229–2452, y 1171–1696

## diagram-3

````text
@diagram-3.png Which node is connected to JK-88 by the red line? Give its code.

End your reply with a final line in the form "ANSWER: <answer>". If the image does not contain what is asked for, use "ANSWER: NOT FOUND".
````

expected: `VJ-66` · answer region (image 0): x 1611–2099, y 2661–2771

## diagram-4

````text
@diagram-4.png Which node is connected to KL-36 by the red line? Give its code.

End your reply with a final line in the form "ANSWER: <answer>". If the image does not contain what is asked for, use "ANSWER: NOT FOUND".
````

expected: `EE-47` · answer region (image 0): x 224–693, y 1685–1815

## diagram-5

````text
@diagram-5.png Which node is connected to VN-29 by the red line? Give its code.

End your reply with a final line in the form "ANSWER: <answer>". If the image does not contain what is asked for, use "ANSWER: NOT FOUND".
````

expected: `EF-68` · answer region (image 0): x 2965–3107, y 1205–1736

## label-0

````text
@label-0.png What is the code printed on the sticker headed SERIAL?

End your reply with a final line in the form "ANSWER: <answer>". If the image does not contain what is asked for, use "ANSWER: NOT FOUND".
````

expected: `XMXT-86883-CY` · answer region (image 0): x 2906–3076, y 504–558

## label-1

````text
@label-1.png What is the code printed on the sticker headed SERIAL?

End your reply with a final line in the form "ANSWER: <answer>". If the image does not contain what is asked for, use "ANSWER: NOT FOUND".
````

expected: `EP36-93932-HC` · answer region (image 0): x 2139–2309, y 604–658

## label-2

````text
@label-2.png What is the code printed on the sticker headed SERIAL?

End your reply with a final line in the form "ANSWER: <answer>". If the image does not contain what is asked for, use "ANSWER: NOT FOUND".
````

expected: `T6LH-92372-VP` · answer region (image 0): x 1626–1796, y 2289–2343

## label-3

````text
@label-3.png What is the code printed on the sticker headed SERIAL?

End your reply with a final line in the form "ANSWER: <answer>". If the image does not contain what is asked for, use "ANSWER: NOT FOUND".
````

expected: `DMPP-97392-AV` · answer region (image 0): x 1781–1951, y 743–797

## label-4

````text
@label-4.png What is the code printed on the sticker headed SERIAL?

End your reply with a final line in the form "ANSWER: <answer>". If the image does not contain what is asked for, use "ANSWER: NOT FOUND".
````

expected: `Q6W8-68397-QV` · answer region (image 0): x 3384–3554, y 909–963

## multi-0

````text
@multi-0-a.png @multi-0-b.png In the second image, what value is labelled on the Brightwater line at month 10?

End your reply with a final line in the form "ANSWER: <answer>". If the image does not contain what is asked for, use "ANSWER: NOT FOUND".
````

expected: `2453` · answer region (image 1): x 1521–1577, y 1601–1641

## multi-1

````text
@multi-1-a.png @multi-1-b.png In the second image, what number is in column Z, row 33?

End your reply with a final line in the form "ANSWER: <answer>". If the image does not contain what is asked for, use "ANSWER: NOT FOUND".
````

expected: `583662` · answer region (image 1): x 3013–3130, y 1459–1503

## multi-2

````text
@multi-2-a.png @multi-2-b.png In the second image, is "Notify on status updates" switched on or off?

End your reply with a final line in the form "ANSWER: <answer>". If the image does not contain what is asked for, use "ANSWER: NOT FOUND".
````

expected: `OFF` · answer region (image 1): x 850–1270, y 446–496

## easy-0

````text
@easy-0.png What word is written on the large blue banner?

End your reply with a final line in the form "ANSWER: <answer>". If the image does not contain what is asked for, use "ANSWER: NOT FOUND".
````

expected: `MERIDIAN` · answer region (image 0): x 200–2200, y 500–920

## easy-1

````text
@easy-1.png What word is written on the large blue banner?

End your reply with a final line in the form "ANSWER: <answer>". If the image does not contain what is asked for, use "ANSWER: NOT FOUND".
````

expected: `THRESHOLD` · answer region (image 0): x 200–2200, y 500–920

## easy-2

````text
@easy-2.png What word is written on the large blue banner?

End your reply with a final line in the form "ANSWER: <answer>". If the image does not contain what is asked for, use "ANSWER: NOT FOUND".
````

expected: `LANTERN` · answer region (image 0): x 200–2200, y 500–920

## easy-3

````text
@easy-3.png What word is written on the large blue banner?

End your reply with a final line in the form "ANSWER: <answer>". If the image does not contain what is asked for, use "ANSWER: NOT FOUND".
````

expected: `HARBOUR` · answer region (image 0): x 200–2200, y 500–920

## absent-label

````text
@absent-0.png What is the code printed on the sticker headed SERIAL?

End your reply with a final line in the form "ANSWER: <answer>". If the image does not contain what is asked for, use "ANSWER: NOT FOUND".
````

expected: `NOT FOUND`

## absent-ui

````text
@absent-1.png In this settings screenshot, is "Auto-sync contacts" switched on or off?

End your reply with a final line in the form "ANSWER: <answer>". If the image does not contain what is asked for, use "ANSWER: NOT FOUND".
````

expected: `NOT FOUND`

## absent-chart

````text
@absent-2.png What value is labelled on the Pemberton line at month 9?

End your reply with a final line in the form "ANSWER: <answer>". If the image does not contain what is asked for, use "ANSWER: NOT FOUND".
````

expected: `NOT FOUND`

## absent-table

````text
@absent-3.png What number is in column AH, row 12 of this spreadsheet?

End your reply with a final line in the form "ANSWER: <answer>". If the image does not contain what is asked for, use "ANSWER: NOT FOUND".
````

expected: `NOT FOUND`
