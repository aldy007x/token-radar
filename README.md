# Token Launch Radar

A token launch radar built for make.fun's "Build the best token launch radar" bounty. It reads
one sealed DefiLlama snapshot of 758 protocols and ranks the genuine launch candidates among
those that record no token yet — 197 of them, the house watchlist of 40 included — by an implied
token value, with a concrete farm plan for each. A further 145 pre-token records are set aside,
not ranked: wrapped, staked, bridged and exchange products of an asset that already trades, and
later versions of a ranked protocol. Neither is a token that does not exist yet.

The implied value is fitted, never assigned by hand. The 128 protocols in the same snapshot
whose tokens already trade and carry a market cap are the comparables: the model takes their
median market-cap/TVL multiple per category (shrunk toward the global median of 0.21x where a
category is thin), bends it by a pooled size slope (larger protocols trade at lower multiples),
and scales it by each subject's own seven-day TVL momentum, tracked age and chain breadth:

```
implied = TVL x category multiple (size-bent) x momentum x maturity x breadth
```

Protocols whose token already trades are never ranked; they are shown on the page as the
evidence the multiples were fitted on. Wrapped, staked, bridged and exchange products are
flagged as derivatives and can be filtered out of the board.

## Run it

```sh
mkdir -p out && MAKEFUN_OUTPUT_DIR=out node main.ts --input <path-to-snapshot.json>
```

Node 22, standard library only, no network, deterministic: the same snapshot produces the same
bytes on every run. The run writes `board.json` (the ranked board), `data.js` (the dashboard's
data), `dashboard/` (the page: sortable, filterable, with a detail view and farm plan per
protocol), `screenshots/` and `dossier.json` into the output folder. Open
`out/dashboard/index.html` in a browser to use the board.

## Layout

- `main.ts` — the entrypoint: snapshot in, hand-in out, with the gate's caps restated as refusals.
- `lib/model.ts` — the fit, the scoring, the farm plans and the board's self-check.
- `dashboard/` — the page (index.html, app.css, app.js), rendering only what `data.js` carries.
- `vendor/makefun-board.ts` — make.fun's dossier library, vendored as its header instructs.
- `screenshots/` — the board, a protocol's detail view and the watchlist-filtered view.
