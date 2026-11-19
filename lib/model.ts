// Token launch radar: the model that turns the sealed DefiLlama snapshot into a ranked board.
//
// The question the board answers is narrow: if a protocol that records no token today issued
// one at the value its already-trading peers support, what would that token be worth, and what
// should a reader do on the protocol now to be counted if it ever does? Nothing here predicts
// that a token will be issued. The implied value is a claim built only from the snapshot's own
// figures, in five moves:
//
//   1. Fit. Every protocol whose token already trades and has a recorded market cap is a
//      comparable. In log space we take the median market-cap/TVL ratio overall and per
//      category (each category median shrunk toward the global one with the weight of
//      twenty phantom samples, so a category resting on one or two names — this snapshot's
//      Risk Curators multiple rested on a single comparable, an oracle token — cannot pull
//      its subjects far from the global evidence), and a pooled size slope: across the
//      comparables, doubling TVL comes with a lower multiple, so the fitted multiple for a
//      subject bends with its size exactly as the market's does. The fit is robust: every
//      comparable's log ratio is first clamped to the sample's own Tukey fences
//      (Q1 - 1.5 IQR, Q3 + 1.5 IQR), so one wild comparable — a token trading at hundreds of
//      times its protocol's TVL — cannot set a whole category's multiple.
//   2. Momentum. A protocol whose TVL grew over the last seven days is launching into demand;
//      one that shrank is not. The week's change, clamped to +50% / -40%, counts at a quarter
//      of its size: among the snapshot's own comparables a hot week comes with no higher
//      multiple at all (the correlation is slightly negative), so the factor is kept as a
//      small demand tilt, never a reward for a spike — a protocol whose TVL multiplied
//      forty-fold in a week is flagged on the board, not boosted to the clamp.
//   3. Maturity. A protocol DefiLlama has tracked for years with no token has a settled
//      product and a settled user base; one listed last month has neither. Age since listing,
//      on a log curve, scales the fitted value gently (a new listing keeps 85%).
//   4. Breadth. A protocol live on many chains distributes any launch across all of them, but
//      its TVL already sums those chains, so the premium is kept smallest of all: chain
//      count alone must never carry a ranking the other factors do not.
//   5. Calibration. The model grades itself on the comparables by leave-one-out: fit on all
//      but one, predict that one's market cap, and take the median absolute log error as the
//      typical miss (about x/3.6 on this snapshot). Every row publishes that range around
//      its implied value — widened by half again where its category rests on fewer than
//      three comparables — and the data-derived risk flags behind it, so no point estimate
//      on the board pretends to a precision the evidence does not carry.
//
// implied = TVL x category multiple (size-bent) x momentum x maturity x breadth, in dollars,
// published with the calibrated range the model's own leave-one-out error supports.
//
// The board ranks the genuine launch candidates among the protocols that record no token:
// the house watchlist included, and every candidate below its floor besides. Two kinds of
// pre-token record are set aside rather than ranked, because neither is a token that does not
// exist yet: wrapped, staked, bridged and exchange products of an asset that already trades
// (WBTC is Bitcoin on Ethereum, not a launch), and later versions of a protocol whose first
// version is the candidate. Protocols whose token already trades are never ranked either:
// they are the evidence, listed as comparables. The dashboard shows all three separations.

export interface Protocol {
  slug: string;
  name: string;
  category: string | null;
  chains: string[];
  tvl_usd: number;
  change_7d: number | null;
  mcap_usd: number | null;
  listed_at: string | null;
  gecko_id: string | null;
  symbol: string | null;
}

export interface Snapshot {
  as_of: string;
  source: string;
  floor_usd: number;
  protocols: Protocol[];
  watchlist: string[];
}

/** The model's constants, stated on the dashboard so a reader can disagree with them. */
export const MODEL = {
  version: 'radar-mk4',
  shrinkK: 20, // a category median's pull toward the global median, in phantom samples
  sizeSlopeClamp: 1.2, // the most the size bend may move a multiple, in log points
  multipleFloor: 0.004,
  multipleCeiling: 6,
  momentumWeight: 0.25, // a +50% week adds an eighth: the comparables support no more
  momentumClampPct: 50,
  momentumFloorPct: -40,
  maturityBase: 0.85, // a protocol listed today keeps 85% of its fitted value
  maturityFullDays: 1095, // three tracked years earns the whole maturity factor
  breadthPerChain: 0.0125, // +1.25% a chain, +10% at most: TVL already aggregates the chains
  breadthMaxChains: 8,
  thinCategoryN: 3, // below this many comparables a category's band widens and a flag is raised
  thinBandWiden: 1.5, // the log half-width multiplier for a thin category's range
};

/** Categories whose products are claims on an asset that already trades, per the watchlist's own exclusions. */
const DERIVATIVE_CATEGORIES = new Set([
  'Bridge',
  'Canonical Bridge',
  'Cross Chain Bridge',
  'Liquid Staking',
  'Liquid Restaking',
  'Restaked BTC',
  'CEX',
]);

const DERIVATIVE_NAME = /\b(wrapped|staked|staking)\b/i;
const VERSION_SUFFIX = /\s(V\d+(\.\d+)?|v\d+(\.\d+)?|\d+\.\d+)$/;

/** A protocol records no token when DefiLlama carries neither a Gecko id nor a symbol for it. */
export function recordsNoToken(p: Protocol): boolean {
  return p.gecko_id === null && p.symbol === null;
}

/** A wrapped, staked, bridged or exchange product of an asset that already trades. */
export function isDerivative(p: Protocol): boolean {
  if (p.category !== null && DERIVATIVE_CATEGORIES.has(p.category)) return true;
  if (DERIVATIVE_NAME.test(p.name)) return true;
  return false;
}

/** A later version of a protocol whose earlier version is the launch candidate. */
export function isVersioned(p: Protocol): boolean {
  return VERSION_SUFFIX.test(p.name);
}

// ------------------------------------------------------------------ snapshot

export function parseSnapshot(text: string): Snapshot {
  let raw: unknown;
  try {
    raw = JSON.parse(text);
  } catch {
    throw new Error('snapshot is not valid JSON');
  }
  const snap = raw as Snapshot;
  if (typeof snap !== 'object' || snap === null) throw new Error('snapshot is not an object');
  if (typeof snap.as_of !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(snap.as_of)) {
    throw new Error('snapshot.as_of is not a YYYY-MM-DD date');
  }
  if (!Array.isArray(snap.protocols) || snap.protocols.length === 0) {
    throw new Error('snapshot.protocols is not a non-empty array');
  }
  if (!Array.isArray(snap.watchlist)) throw new Error('snapshot.watchlist is not an array');
  const seen = new Set<string>();
  for (const p of snap.protocols) {
    if (typeof p.slug !== 'string' || p.slug.length === 0) throw new Error('a protocol has no slug');
    if (seen.has(p.slug)) throw new Error(`snapshot lists ${p.slug} twice`);
    seen.add(p.slug);
    if (typeof p.name !== 'string' || p.name.length === 0) throw new Error(`${p.slug} has no name`);
    if (typeof p.tvl_usd !== 'number' || !(p.tvl_usd >= 0)) throw new Error(`${p.slug} has no TVL`);
    if (!Array.isArray(p.chains)) throw new Error(`${p.slug} has no chains array`);
  }
  for (const slug of snap.watchlist) {
    if (!seen.has(slug)) throw new Error(`watchlist names ${slug}, which the protocols do not`);
  }
  return snap;
}

// ------------------------------------------------------------------ the fit

export interface MultipleFit {
  /** exp of the median log market-cap/TVL across every comparable. */
  globalMultiple: number;
  /** Mean log TVL of the comparables: the size the multiples are centred on. */
  centreLogTvl: number;
  /** Pooled slope of log multiple on log TVL: negative, because size cheapens a multiple. */
  sizeSlope: number;
  /** How many comparables the fit stands on. */
  sampleSize: number;
  /** Per-category fitted multiples at the centre size, with their sample sizes. */
  categories: { category: string; n: number; multiple: number }[];
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const mid = sorted.length >> 1;
  return sorted.length % 2 === 1 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}

function logRatio(p: Protocol): number {
  return Math.log(p.mcap_usd! / p.tvl_usd);
}

/** The q-quantile of an ascending array, linearly interpolated between its neighbours. */
function quantile(sorted: number[], q: number): number {
  const at = (sorted.length - 1) * q;
  const lo = Math.floor(at);
  const hi = Math.min(lo + 1, sorted.length - 1);
  return sorted[lo]! + (sorted[hi]! - sorted[lo]!) * (at - lo);
}

/**
 * The comparables' log ratios with each one clamped to the sample's Tukey fences
 * (Q1 - 1.5 IQR to Q3 + 1.5 IQR). One comparable whose token trades at hundreds of times
 * its protocol's TVL is evidence about that token, not about its whole category: inside
 * the fences every figure stands as recorded, outside them it counts at the fence.
 */
function winsorizedLogs(sample: Protocol[]): number[] {
  const raw = sample.map(logRatio);
  const sorted = [...raw].sort((a, b) => a - b);
  const q1 = quantile(sorted, 0.25);
  const q3 = quantile(sorted, 0.75);
  const lo = q1 - 1.5 * (q3 - q1);
  const hi = q3 + 1.5 * (q3 - q1);
  return raw.map((v) => Math.max(lo, Math.min(hi, v)));
}

/** The protocols that can teach the model anything: a token, a market cap and a TVL. */
export function comparables(protocols: Protocol[]): Protocol[] {
  return protocols.filter((p) => !recordsNoToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
}

export function fitMultiples(protocols: Protocol[]): MultipleFit {
  const sample = comparables(protocols);
  if (sample.length < 8) throw new Error(`only ${sample.length} comparables: too few to fit a model`);
  const logs = winsorizedLogs(sample);
  const globalLog = median(logs);
  const centreLogTvl = sample.reduce((sum, p) => sum + Math.log(p.tvl_usd), 0) / sample.length;

  // Pooled least squares of log ratio on centred log TVL.
  let num = 0;
  let den = 0;
  const meanLog = logs.reduce((a, b) => a + b, 0) / logs.length;
  for (let i = 0; i < sample.length; i++) {
    const dx = Math.log(sample[i]!.tvl_usd) - centreLogTvl;
    num += dx * (logs[i]! - meanLog);
    den += dx * dx;
  }
  const sizeSlope = den === 0 ? 0 : num / den;

  const byCategory = new Map<string, number[]>();
  for (let i = 0; i < sample.length; i++) {
    const key = sample[i]!.category ?? 'Uncategorised';
    const list = byCategory.get(key);
    if (list === undefined) byCategory.set(key, [logs[i]!]);
    else list.push(logs[i]!);
  }
  const categories = [...byCategory.entries()]
    .map(([category, values]) => {
      const shrunk = (values.length * median(values) + MODEL.shrinkK * globalLog) / (values.length + MODEL.shrinkK);
      return { category, n: values.length, multiple: Math.exp(shrunk) };
    })
    .sort((a, b) => (a.category < b.category ? -1 : 1));

  return {
    globalMultiple: Math.exp(globalLog),
    centreLogTvl,
    sizeSlope,
    sampleSize: sample.length,
    categories,
  };
}

/** The multiple the fit gives one protocol: its category's, bent by its size, clamped sane. */
function multipleFor(p: Protocol, fit: MultipleFit): number {
  const cat = fit.categories.find((c) => c.category === (p.category ?? 'Uncategorised'));
  const base = cat === undefined ? fit.globalMultiple : cat.multiple;
  const bend = Math.max(
    -MODEL.sizeSlopeClamp,
    Math.min(MODEL.sizeSlopeClamp, fit.sizeSlope * (Math.log(Math.max(p.tvl_usd, 1)) - fit.centreLogTvl)),
  );
  const bent = base * Math.exp(bend);
  return Math.max(MODEL.multipleFloor, Math.min(MODEL.multipleCeiling, bent));
}

// ------------------------------------------------------------------ scoring

/** Whole days from a YYYY-MM-DD listing day to the snapshot's day; null when unlisted. */
export function ageDays(asOf: string, listedAt: string | null): number | null {
  if (listedAt === null) return null;
  const ms = Date.parse(`${asOf}T00:00:00Z`) - Date.parse(`${listedAt}T00:00:00Z`);
  if (Number.isNaN(ms)) return null;
  return Math.max(0, Math.round(ms / 86_400_000));
}

export interface Scored {
  implied: number;
  multiple: number;
  momentum: number;
  maturity: number;
  breadth: number;
  age: number | null;
}

function momentumOf(change7d: number | null): number {
  if (change7d === null) return 1;
  const clamped = Math.max(MODEL.momentumFloorPct, Math.min(MODEL.momentumClampPct, change7d));
  return 1 + MODEL.momentumWeight * (clamped / 100);
}

function maturityOf(age: number): number {
  const share = Math.min(1, Math.log1p(age) / Math.log1p(MODEL.maturityFullDays));
  return MODEL.maturityBase + (1 - MODEL.maturityBase) * share;
}

function breadthOf(chainCount: number): number {
  return 1 + MODEL.breadthPerChain * Math.min(Math.max(chainCount - 1, 0), MODEL.breadthMaxChains);
}

export function score(p: Protocol, fit: MultipleFit, asOf: string, standInAge: number): Scored {
  const multiple = multipleFor(p, fit);
  const momentum = momentumOf(p.change_7d);
  const age = ageDays(asOf, p.listed_at);
  const maturity = maturityOf(age ?? standInAge);
  const breadth = breadthOf(p.chains.length);
  const implied = Math.max(1, Math.round(p.tvl_usd * multiple * momentum * maturity * breadth));
  return { implied, multiple, momentum, maturity, breadth, age };
}

// ------------------------------------------------------------------ calibration

export interface Calibration {
  /** Median absolute log error of the leave-one-out predictions on the comparables. */
  looMedianAbsLog: number;
  /** exp of the above: the typical miss, as a multiply/divide factor on a point estimate. */
  bandFactor: number;
  /** How many comparables the calibration stands on. */
  sampleSize: number;
}

/**
 * The model's measured error, by leave-one-out on the comparables themselves: fit on all
 * but one comparable, score the held-out one with the full formula, and compare with the
 * market cap it actually trades at. The median absolute log error is the honest width of
 * every range the board publishes — computed from the snapshot at run time, never a
 * constant the author picked.
 */
export function calibrateBand(snapshot: Snapshot, standInAge: number): Calibration {
  const sample = comparables(snapshot.protocols);
  const errors: number[] = [];
  for (const held of sample) {
    const rest = snapshot.protocols.filter((p) => p !== held);
    const trainFit = fitMultiples(rest);
    const predicted = score(held, trainFit, snapshot.as_of, standInAge).implied;
    errors.push(Math.abs(Math.log(predicted / held.mcap_usd!)));
  }
  const looMedianAbsLog = errors.length === 0 ? 0 : median(errors);
  return { looMedianAbsLog, bandFactor: Math.exp(looMedianAbsLog), sampleSize: sample.length };
}

/** The log half-width of one row's published range: the calibrated error, widened for thin categories. */
export function bandHalfLog(calibration: Calibration, categoryN: number): number {
  return calibration.looMedianAbsLog * (categoryN < MODEL.thinCategoryN ? MODEL.thinBandWiden : 1);
}

// ------------------------------------------------------------------ risk flags

/**
 * What the snapshot's own figures say against a protocol, stated as flags a farmer should
 * read before the plan: thin category evidence, a TVL spike or collapse inside one week,
 * a short or unreported record, a small base. Derived only from the row's own figures and
 * its category's sample size, in a fixed order, at most four.
 */
export function riskFlags(p: Protocol, age: number | null, categoryN: number): string[] {
  const flags: string[] = [];
  if (categoryN === 0) {
    flags.push(
      `No trading comparable in ${p.category ?? 'its category'}: the global median multiple carries this row, not category evidence, so the range is wide.`,
    );
  } else if (categoryN < MODEL.thinCategoryN) {
    flags.push(
      `Thin category evidence: the ${p.category} multiple rests on ${categoryN} trading comparable${categoryN === 1 ? '' : 's'}, so one name's mispricing moves this whole row.`,
    );
  }
  if (p.change_7d !== null && p.change_7d > MODEL.momentumClampPct) {
    flags.push(
      `TVL spiked +${p.change_7d.toFixed(0)}% in seven days, far past the +${MODEL.momentumClampPct}% the model counts; capital that arrives that fast is often incentivised and leaves the same way.`,
    );
  } else if (p.change_7d !== null && p.change_7d <= -40) {
    flags.push(
      `TVL fell ${p.change_7d.toFixed(0)}% in seven days; the base a plan commits to may keep shrinking before any snapshot is taken.`,
    );
  }
  if (age === null) {
    flags.push(
      'Listing day unreported: the maturity factor uses the snapshot median age, an assumption standing in for a measurement.',
    );
  } else if (age < 90) {
    flags.push(
      `Short record: tracked for only ${age} days, so neither the product nor its user base has been tested by a full market quarter.`,
    );
  }
  if (p.tvl_usd < 10_000_000) {
    flags.push(
      'Small base: under $10M of TVL, so a launch valuation at this size can be moved by a handful of wallets and exit liquidity will be thin.',
    );
  }
  return flags.slice(0, 4);
}

// ------------------------------------------------------------------ farm plans

/** Working capital a farmer should expect to commit, by the protocol's size. */
export function capitalFor(tvl: number): number {
  if (tvl >= 1_000_000_000) return 2500;
  if (tvl >= 250_000_000) return 1500;
  if (tvl >= 50_000_000) return 750;
  if (tvl >= 10_000_000) return 350;
  return 150;
}

/** What one on-chain action roughly costs in fees on a chain, in the farmer's own planning terms. */
export function feeNote(chain: string): string {
  switch (chain) {
    case 'Ethereum':
      return 'Ethereum mainnet fees of roughly $25-45 per transaction at ordinary gas';
    case 'Solana':
      return 'Solana fees of a few cents per transaction';
    case 'Bitcoin':
      return 'Bitcoin fees of roughly $2-8 per transaction';
    case 'Base':
    case 'Arbitrum':
    case 'Optimism':
    case 'zkSync Era':
    case 'Linea':
    case 'Scroll':
    case 'Mantle':
      return `${chain} fees of roughly $0.20-2 per transaction`;
    default:
      return `${chain} fees of roughly $0.50-5 per transaction`;
  }
}

/** Weeks of steady activity the plan runs, longer for younger protocols with a longer runway. */
export function weeksFor(age: number | null): number {
  if (age === null) return 20;
  if (age >= 900) return 10;
  if (age >= 365) return 14;
  if (age >= 90) return 18;
  return 24;
}

/** Round a planning amount to the nearest $10, never below $10. */
function round10(n: number): number {
  return Math.max(10, Math.round(n / 10) * 10);
}

/**
 * A category's playbook: the exact first action, the position step that follows it, and the
 * one metric worth tracking weekly. Amounts come from the plan's own capital split: pos is
 * the position half of the wallet, act the size of one recurring action.
 */
type Playbook = (p: Protocol, chain: string, pos: number, act: number) => [string, string, string];

const PLAYBOOKS: Record<string, Playbook> = {
  dex: (p, chain, pos, act) => [
    `First action: swap about ${money(act)} through ${p.name}'s deepest ${chain} pair today, in and back out. Then repeat round trips of that size twice a week, in both directions, so the wallet builds real trading volume rather than one wash day.`,
    `Commit the position half, about ${money(pos)}, as liquidity in that same ${chain} pool and leave it in place; liquidity providers are the users a DEX launch rewards first and most visibly.`,
    'your cumulative swap volume and your share of the pool',
  ],
  lending: (p, chain, pos, act) => [
    `First action: supply about ${money(pos)}, the position half, as collateral on ${p.name} on ${chain} today and leave it untouched; supplied balances are the figure lending launches have historically snapshotted.`,
    `Once a month, borrow about ${money(act)} against that collateral, hold it a few days and repay in full, so the wallet carries both sides of the market's history, not just deposits.`,
    'your net supplied balance and your count of completed borrow-and-repay cycles',
  ],
  derivatives: (p, chain, pos, act) => [
    `First action: post about ${money(pos)} of margin on ${p.name} on ${chain} today and open one small position, a few times the margin in notional, holding it for days rather than minutes.`,
    `Keep a position open through each weekly cycle, resizing with about ${money(act)} of margin adjustments rather than flattening; sustained open interest is the activity a derivatives launch measures, not one large trade.`,
    'your cumulative notional volume and your count of days with an open position',
  ],
  yield: (p, chain, pos, act) => [
    `First action: deposit about ${money(pos)}, the position half, into ${p.name}'s flagship ${chain} vault today and leave it deposited; time-weighted balances are what vault launches reward, not deposits made the week before.`,
    `Put about ${money(act)} into a second ${p.name} strategy on ${chain} and rebalance between the two monthly, so the wallet shows considered use of the whole product.`,
    'your time-weighted balance in each vault',
  ],
  staking: (p, chain, pos, act) => [
    `First action: stake about ${money(pos)}, the position half, through ${p.name} on ${chain} today and do not unstake; staking duration is the one figure a staking launch can snapshot fairly.`,
    `Stake a second tranche of about ${money(act)} through ${p.name} a month later and claim any rewards it issues on schedule, so the wallet shows an active, maintained staking history.`,
    'your staked balance multiplied by the days it has been held',
  ],
  bridge: (p, chain, pos, act) => [
    `First action: bridge about ${money(act)} to ${chain} through ${p.name} today, then bridge a third of it back a week later, so both directions of the route carry your wallet's history.`,
    `Make ${p.name} your default route for moving capital onto ${chain} for the whole plan period, in amounts of about ${money(act)} and keeping roughly ${money(pos)} working on the far side; repeated genuine transfers are what bridge launches have rewarded.`,
    'your bridged volume in each direction and the number of distinct weeks you bridged',
  ],
  rwa: (p, chain, pos, act) => [
    `First action: complete ${p.name}'s onboarding on ${chain} today, including any identity checks it requires, before depositing anything: a finished account predating a launch is worth more than one opened after.`,
    `Then hold about ${money(pos)} in ${p.name}'s main ${chain} offering for the full plan period, adding about ${money(act)} a month, so the account shows a holder rather than a passer-by.`,
    'your held balance and the age of your completed account',
  ],
  cex: (p, chain, pos, act) => [
    `First action: deposit about ${money(pos)} on ${p.name} today and make one spot trade of about ${money(act)}; account age plus steady volume is what exchange launches have measured.`,
    `Trade spot weekly in that size, keep the balance on the exchange between trades, and use ${p.name}'s earn or staking product with part of it, so the account carries product history beyond trading alone.`,
    'your monthly spot volume and your average held balance',
  ],
  generic: (p, chain, pos, act) => [
    `First action: use ${p.name}'s core product on ${chain} with about ${money(act)} today, in the way its documentation leads with; launches reward the users the product was built for.`,
    `Commit about ${money(pos)}, the position half, to that core use, and take part in ${p.name}'s second surface as well — a companion feature, quest or integration on ${chain} — so your history is not a single repeated transaction.`,
    'your count of active weeks and your total volume through the product',
  ],
};

/** Category to playbook: the product's own shape decides what farming it looks like. */
const PLAYBOOK_BY_CATEGORY: Record<string, Playbook> = {
  Dexs: PLAYBOOKS.dex!,
  Lending: PLAYBOOKS.lending!,
  CDP: PLAYBOOKS.lending!,
  Derivatives: PLAYBOOKS.derivatives!,
  'Liquid Staking': PLAYBOOKS.staking!,
  'Staking Pool': PLAYBOOKS.staking!,
  'Liquid Restaking': PLAYBOOKS.staking!,
  'Restaked BTC': PLAYBOOKS.staking!,
  Bridge: PLAYBOOKS.bridge!,
  'Canonical Bridge': PLAYBOOKS.bridge!,
  'Cross Chain Bridge': PLAYBOOKS.bridge!,
  RWA: PLAYBOOKS.rwa!,
  CEX: PLAYBOOKS.cex!,
  Yield: PLAYBOOKS.yield!,
  'Yield Aggregator': PLAYBOOKS.yield!,
  'Basis Trading': PLAYBOOKS.yield!,
  'Leveraged Farming': PLAYBOOKS.yield!,
  'Onchain Capital Allocator': PLAYBOOKS.yield!,
  'Risk Curators': PLAYBOOKS.yield!,
  Indexes: PLAYBOOKS.yield!,
};

function playbookFor(category: string | null): Playbook {
  if (category !== null && PLAYBOOK_BY_CATEGORY[category] !== undefined) return PLAYBOOK_BY_CATEGORY[category]!;
  return PLAYBOOKS.generic!;
}

const money = (n: number): string => `$${n.toLocaleString('en-US')}`;

/** A plan a reader can start this week, written from the protocol's own figures, closing with its risk check. */
export function farmSteps(p: Protocol, age: number | null, flags: string[] = []): string[] {
  const chain = p.chains[0] ?? 'Ethereum';
  const capital = capitalFor(p.tvl_usd);
  const pos = round10(capital / 2);
  const act = round10(capital / 5);
  const weeks = weeksFor(age);
  const [core1, core2, metric] = playbookFor(p.category)(p, chain, pos, act);
  const steps: string[] = [
    `Set up a dedicated wallet for ${p.name} and fund it with about ${money(capital)} on ${chain}, split in two halves: one backs the position step below, the other funds the recurring activity and the fees. Budget for ${feeNote(chain)}, and never farm with money you cannot leave untouched for months.`,
    core1,
    core2,
  ];
  if (p.chains.length > 1) {
    const second = p.chains[1]!;
    steps.push(
      `Repeat the same activity on ${second}, ${p.name}'s second chain, with a third of the capital; multi-chain users are counted on both networks if a launch snapshots either.`,
    );
  } else {
    steps.push(
      `Keep the cadence for ${weeks} weeks without a gap: one or two actions a week, similar sizes each time, because eligibility snapshots favour steady users over one large week.`,
    );
  }
  steps.push(
    `Hold the routine for about ${weeks} weeks, then keep the position and the wallet alive with one action a month; a dead wallet in the month of a snapshot reads as an exited user.`,
    `Follow ${p.name}'s official channels weekly for a points programme or token announcement. Log every transaction hash and date in a spreadsheet and total ${metric} each week, so the history is provable if a claim ever asks.`,
  );
  if (flags.length > 0) {
    steps.push(
      `Risk check before committing a dollar: ${flags[0]} Read every flag on this protocol's detail view, and size the plan so the total loss of the farmed capital is survivable.`,
    );
  } else {
    steps.push(
      `Risk check before committing a dollar: no token may ever be issued, so farm only for the product's own use and yield, verify ${p.name}'s audits and admin keys before the first deposit, and keep the farmed capital to an amount whose total loss is survivable.`,
    );
  }
  return steps;
}

// ------------------------------------------------------------------ the board

export interface BoardRow {
  slug: string;
  name: string;
  rank: number;
  implied_value_usd: number;
  farm_steps: string[];
  category: string | null;
  tvl_usd: number;
  change_7d: number | null;
  chains: string[];
  age_days: number | null;
  watchlist: boolean;
  derivative: boolean;
  multiple: number;
  momentum: number;
  maturity: number;
  breadth: number;
  /** How many trading comparables the row's category multiple rests on (0 = global median). */
  category_n: number;
  /** The calibrated typical range around the implied value: the model's own leave-one-out error. */
  implied_low_usd: number;
  implied_high_usd: number;
  band_factor: number;
  /** Data-derived warnings from the row's own figures; see riskFlags. */
  risk_flags: string[];
}

export interface LiveRow {
  slug: string;
  name: string;
  symbol: string | null;
  category: string | null;
  tvl_usd: number;
  mcap_usd: number;
  multiple: number;
}

/** A pre-token record the board sets aside instead of ranking, with the reason why. */
export interface SetAside {
  slug: string;
  name: string;
  category: string | null;
  tvl_usd: number;
  reason: 'derivative' | 'versioned';
}

export interface Radar {
  as_of: string;
  source: string;
  floor_usd: number;
  model_version: string;
  scanned: number;
  /** How many protocols the snapshot's watchlist names, so coverage reads as a real fraction. */
  watchlistCount: number;
  fit: MultipleFit;
  /** The model's leave-one-out error on the comparables: the width of every published range. */
  calibration: Calibration;
  rows: BoardRow[];
  live: LiveRow[];
  setAside: SetAside[];
}

/** Build the whole radar: fit the comparables, score every pre-token protocol, rank them. */
export function buildRadar(snapshot: Snapshot): Radar {
  const fit = fitMultiples(snapshot.protocols);
  const watch = new Set(snapshot.watchlist);
  const dated = snapshot.protocols
    .map((p) => ageDays(snapshot.as_of, p.listed_at))
    .filter((a): a is number => a !== null);
  const standInAge = dated.length === 0 ? 365 : median(dated);

  const isCandidate = (p: Protocol): boolean => recordsNoToken(p) && !isDerivative(p) && !isVersioned(p);
  const scored = snapshot.protocols
    .filter(isCandidate)
    .map((p) => ({ p, s: score(p, fit, snapshot.as_of, standInAge) }))
    .sort((a, b) => b.s.implied - a.s.implied || b.p.tvl_usd - a.p.tvl_usd || (a.p.slug < b.p.slug ? -1 : 1));

  const setAside: SetAside[] = snapshot.protocols
    .filter((p) => recordsNoToken(p) && !isCandidate(p))
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      category: p.category,
      tvl_usd: p.tvl_usd,
      reason: isDerivative(p) ? ('derivative' as const) : ('versioned' as const),
    }))
    .sort((a, b) => b.tvl_usd - a.tvl_usd);

  const calibration = calibrateBand(snapshot, standInAge);
  const categoryN = (p: Protocol): number =>
    fit.categories.find((c) => c.category === (p.category ?? 'Uncategorised'))?.n ?? 0;

  const rows: BoardRow[] = scored.map(({ p, s }, i) => {
    const n = categoryN(p);
    const flags = riskFlags(p, s.age, n);
    const half = bandHalfLog(calibration, n);
    return {
      slug: p.slug,
      name: p.name,
      rank: i + 1,
      implied_value_usd: s.implied,
      farm_steps: farmSteps(p, s.age, flags),
      category: p.category,
      tvl_usd: p.tvl_usd,
      change_7d: p.change_7d,
      chains: p.chains,
      age_days: s.age,
      watchlist: watch.has(p.slug),
      derivative: isDerivative(p),
      multiple: s.multiple,
      momentum: s.momentum,
      maturity: s.maturity,
      breadth: s.breadth,
      category_n: n,
      implied_low_usd: Math.max(1, Math.round(s.implied / Math.exp(half))),
      implied_high_usd: Math.round(s.implied * Math.exp(half)),
      band_factor: Math.exp(half),
      risk_flags: flags,
    };
  });

  const live: LiveRow[] = comparables(snapshot.protocols)
    .sort((a, b) => b.tvl_usd - a.tvl_usd)
    .slice(0, 40)
    .map((p) => ({
      slug: p.slug,
      name: p.name,
      symbol: p.symbol,
      category: p.category,
      tvl_usd: p.tvl_usd,
      mcap_usd: p.mcap_usd!,
      multiple: p.mcap_usd! / p.tvl_usd,
    }));

  return {
    as_of: snapshot.as_of,
    source: snapshot.source,
    floor_usd: snapshot.floor_usd,
    model_version: MODEL.version,
    scanned: snapshot.protocols.length,
    watchlistCount: snapshot.watchlist.length,
    fit,
    calibration,
    rows,
    live,
    setAside,
  };
}

/** The board as board.json carries it: the gate's fields first, the radar's own beside them. */
export function boardRows(radar: Radar): BoardRow[] {
  return radar.rows;
}

/** A plain-language reason the gate would refuse this board, or null when it would not. */
export function boardIssue(rows: BoardRow[], snapshot: Snapshot): string | null {
  if (rows.length < 100 || rows.length > 4000) return `board holds ${rows.length} rows, outside 100 to 4000`;
  const slugs = new Set(snapshot.protocols.map((p) => p.slug));
  const seen = new Set<string>();
  let previous = Number.POSITIVE_INFINITY;
  let allSame = true;
  for (let i = 0; i < rows.length; i++) {
    const row = rows[i]!;
    if (!slugs.has(row.slug)) return `row ${i + 1} names ${row.slug}, which the snapshot does not`;
    if (seen.has(row.slug)) return `${row.slug} appears twice`;
    seen.add(row.slug);
    if (row.rank !== i + 1) return `${row.slug} carries rank ${row.rank} where ${i + 1} belongs`;
    if (!Number.isInteger(row.implied_value_usd) || row.implied_value_usd <= 0) {
      return `${row.slug} has no positive whole implied value`;
    }
    if (row.implied_value_usd > 100_000_000_000_000) return `${row.slug} exceeds the implied value cap`;
    if (row.implied_value_usd > previous) return `${row.slug} is worth more than the row above it`;
    if (row.implied_value_usd !== rows[0]!.implied_value_usd) allSame = false;
    previous = row.implied_value_usd;
    if (row.farm_steps.length < 3 || row.farm_steps.length > 12) {
      return `${row.slug} carries ${row.farm_steps.length} farm steps, outside 3 to 12`;
    }
    for (const step of row.farm_steps) {
      const len = step.trim().length;
      if (len < 20 || len > 600) return `${row.slug} has a farm step of ${len} characters, outside 20 to 600`;
    }
  }
  if (allSame) return 'every row carries the same implied value: that is not a ranking';
  for (const slug of snapshot.watchlist) {
    if (!seen.has(slug)) return `the watchlist's ${slug} is missing from the board`;
  }
  return null;
}

/** The dashboard's data file: one assignment the page reads, nothing computed twice. */
export function dataScript(radar: Radar): string {
  return `window.TOKEN_RADAR = ${JSON.stringify(radar)};\n`;
}
