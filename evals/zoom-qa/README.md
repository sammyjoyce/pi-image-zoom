# zoom-qa eval

Measures whether Pi, running Opus 5.5 with the `zoom_image` extension, answers fine-detail questions about large images correctly, and compares that with the same cases run with no extension loaded.

- **Cases:** `cases.jsonl`, 42 generated cases (table, chart, UI, diagram, sticker label, two-image, easy, absent), plus anything in `seeds/`. Expected answers come from the generator, never from a model. Review copy: `review/inputs.md` and `review/answer-key-crops.png`.
- **Runner:** `run-eval.mjs` runs the real `pi` CLI headless per case, in a temp directory holding only that case's images, with `--tools read,zoom_image` (`read` only in the no-extension arm) and `--thinking medium`.
- **Grading:** programmatic. The last `ANSWER:` line is compared with the key (numbers numerically, text ignoring case and spacing, on/off synonyms, `NOT FOUND` for absent cases). Metrics: `correct` (headline), `format_ok`, `refused`. Per case it also records `zoom_calls`, `zoom_on_target` (did any crop contain the answer region), `tool_calls`, tokens and latency.
- **Results:** `.claude/hillclimb/zoom-qa/<variant>/` (`baseline` = extension, `v1` = none; set in `_state.json` `variant_config`).

## Run

```bash
npm ci
node evals/zoom-qa/generate-cases.mjs            # renders images/ (gitignored), rebuilds cases.jsonl
# gateway key and URL: PI_GATEWAY_KEY / ZOOM_EVAL_BASE_URL, else ANTHROPIC_API_KEY / ANTHROPIC_BASE_URL
# optional: ZOOM_EVAL_THINKING (default medium),
#           ZOOM_EVAL_CASES=table-0,chart-0 to run only those cases

F=.claude/hillclimb/zoom-qa
node evals/zoom-qa/run-eval.mjs --flow $F --variant baseline --model claude-opus-5-5 --reps 2
node evals/zoom-qa/run-eval.mjs --flow $F --variant v1       --model claude-opus-5-5 --reps 2
```

The runner refuses to start until a person has reviewed it and run it once with `--approve-harness`. That records a hash of the runner, the lockfile, `cases.jsonl` and `generate-cases.mjs`, and any later change to them needs approving again. Reruns resume: finished (case, rep) pairs are skipped. Failed attempts go to `errors.jsonl`, never into the scores.

Report: run the `/claude-api` skill's `build-report-lite.mjs` on `$F`.

## Wire check (free)

`stub-gateway.mjs` is a scripted stand-in for the Messages API. Run the runner against it with `ZOOM_EVAL_BASE_URL=http://127.0.0.1:<port>`:
- `STUB_MODE=oracle` should score 100%, with every zoom on target.
- `null` should score 0%.
- `empty` should give `format_ok` 0.
- `flaky` should score 100%, with the retries recorded.
- `refuse` should give `refused` 1.

## Known limits

- Pi's Anthropic provider does not record the model id the server reports, so the runner cannot detect a gateway-side model substitution. Check the gateway once directly (a `POST /v1/messages` should report `"model": "claude-opus-5-5"`) and cross-check its billing records.
- Pi's own `<file>` tag still tells the model the image is "displayed at 2000x1500", while the extension's context block reports the real overview size (e.g. 1269x952). `zoom_on_target` shows whether that mismatch causes misplaced crops.
