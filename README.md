[![make.fun · token-radar-01](https://make.fun/badge/token-radar-01.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![rank](https://make.fun/badge/token-radar-01/aldy007x/token-radar/rank.svg)](https://make.fun/bounty/token-radar-01/leaderboard?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)
[![reward](https://make.fun/badge/token-radar-01/aldy007x/token-radar/reward.svg)](https://make.fun/bounty/token-radar-01?utm_source=github&utm_medium=readme&utm_campaign=token-radar-01)

# Token Launch Radar

A token launch radar built for make.fun's "Build the best token launch radar" bounty. It reads
one sealed DefiLlama snapshot of 758 protocols and ranks the genuine launch candidates among
those that record no token yet — 197 of them, the house watchlist of 40 included — by an implied
token value, with a concrete farm plan for each. A further 145 pre-token records are set aside,
not ranked: wrapped, staked, bridged and exchange products of an asset that already trades, and
later versions of a ranked protocol. Neither is a token that does not exist yet.

The implied value is fitted, never assigned by hand. The 128 protocols in the same snapshot
whose tokens already trade and carry a market cap are the comparables: the model takes their
median market-cap/TVL multiple per category (shrunk toward the global median of 0.21x with
the weight of twenty phantom samples, so a category resting on one comparable — this
snapshot's Risk Curators multiple rested on a single oracle token — stays near the global
evidence), bends it by a pooled size slope (larger protocols trade at lower multiples),
and scales it by each subject's own seven-day TVL momentum (a quarter of the move, clamped
to +50%/−40%: among the comparables themselves a hot week earns no higher multiple, so a
spike is flagged, not boosted), tracked age and chain breadth (deliberately smallest at
+1.25% per extra chain, because a protocol's TVL already sums its chains):

```
implied = TVL x category multiple (size-bent) x momentum x maturity x breadth
```

Every row also carries the model's own measured error. Calibrating by leave-one-out on the
comparables — fit on all but one, predict that one's market cap — the typical miss is
×/÷3.6, so each implied value is published with that range around it (widened by half again
where the category rests on fewer than three comparables), plus the data-derived risk flags
behind it: thin category evidence, a one-week TVL spike or collapse, a short or unreported
record, a small base. No point estimate on the board pretends to a precision the evidence
does not carry.

## Validation (leave-one-out on the snapshot's comparables)

The mk4 weights above were chosen against the mk3 model they replaced, both scored by
leave-one-out prediction of the comparables' actual market caps (log-space errors; lower is
better except Spearman):

| Test population | Model | RMSE | MAE | Spearman |
| --- | --- | --- | --- | --- |
| All 128 comparables | mk3 | 2.152 | 1.633 | 0.357 |
| All 128 comparables | mk4 | 2.125 | 1.606 | 0.379 |
| 90 non-derivative comparables | mk3 | 2.085 | 1.601 | 0.271 |
| 90 non-derivative comparables | mk4 | 2.082 | 1.586 | 0.300 |

A modest but consistent win on both populations — and the structural fixes matter more
than the averages: under mk3 the board's top was priced off one-name categories (Risk
Curators from Api3 alone at 0.33×, Polymarket from a single comparable whose raw ratio is
400×), and a +4,448% one-week TVL spike took the maximum momentum boost. Under mk4 those
multiples sit at 0.24× and near the global median respectively, the spike is clamped and
flagged, and every thin-evidence row says so on its face.

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
