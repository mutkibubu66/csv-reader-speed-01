# Faster CSV reader

[![csv-reader-speed-01-run-20261121](https://make.fun/badge/csv-reader-speed-01-run-20261121.svg)](https://make.fun/competitions/csv-reader-speed-01-run-20261121)
[![rank](https://make.fun/badge/csv-reader-speed-01-run-20261121/mutkibubu9998/csv-reader-speed-01/rank.svg)](https://make.fun/competitions/csv-reader-speed-01-run-20261121)
[![reward](https://make.fun/badge/csv-reader-speed-01-run-20261121/mutkibubu9998/csv-reader-speed-01/reward.svg)](https://make.fun/competitions/csv-reader-speed-01-run-20261121)

A faster drop-in for [csv-reader 1.0.0](https://make.fun/competitions/csv-reader-speed-01-run-20261121): `solve.js` answers exactly as csv-reader does on every `{text, header}` input — BOM, CRLF and lone CRs, quoted fields with doubled quotes and line breaks inside, junk after a closing quote, unterminated quotes, short and long rows — but reads the text with native `indexOf` scans and slices instead of one character at a time. On the kit's practice set it matches csv-reader on all 6 cases and runs about 4× faster.

## Layout

- `solve.js` — the reader: `run(input)` returns `{columns, rows, errors}`.
- `main.ts` — the program the harness runs: reads every case from `/input/cases.json`, answers each with `run`, writes `/output/answers.json`.
- `package.json` — `{ "type": "module" }`, so `solve.js` loads as an ES module.

## Run it

```sh
MAKEFUN_INPUT_DIR=./practice/input MAKEFUN_OUTPUT_DIR=./practice/output node main.ts
```

Node 22, no dependencies, nothing installed.
