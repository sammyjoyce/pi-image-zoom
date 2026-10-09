# Seed cases from real use

Drop real images here, plus one line per case in `seeds.jsonl`:

```json
{"id": "invoice-total", "images": ["invoice.jpg"], "question": "What is the invoice total?", "expected": "1,284.50", "answer_type": "number", "tags": ["document"]}
```

- `images`: file names in this directory. With more than one image, the question should say which one it means.
- `expected`: the correct answer, written or checked by a person.
- `answer_type`: `number` (compares numerically, ignores commas and currency signs), `text` (case- and whitespace-insensitive), `onoff`, or `notfound`.
- `target` (optional): `{"image": 0, "left": 0, "top": 0, "width": 0, "height": 0}` in original-image pixels. When present, the report also checks whether zoom crops landed on it.

Then run `node evals/zoom-qa/generate-cases.mjs` to rebuild `cases.jsonl`.
