// Token launch radar: the model that turns the sealed DefiLlama snapshot into a ranked board.
//
// The question the board answers is narrow: if a protocol that records no token today issued
// one at the value its already-trading peers support, what would that token be worth, and what
// should a reader do on the protocol now to be counted if it ever does? Nothing here predicts
// that a token will be issued. The implied value is a claim built only from the snapshot's own
// figures, in four moves:
//
//   1. Fit. Every protocol whose token already trades and has a recorded market cap is a
//      comparable. In log space we take the median market-cap/TVL ratio overall and per
//      category (each category median shrunk toward the global one by its sample size), and a
//      pooled size slope: across the comparables, doubling TVL comes with a lower multiple,
//      so the fitted multiple for a subject bends with its size exactly as the market's does.
//   2. Momentum. A protocol whose TVL grew over the last seven days is launching into demand;
//      one that shrank is not. The week's change, clamped, scales the fitted value.
//   3. Maturity. A protocol DefiLlama has tracked for years with no token has a settled
//      product and a settled user base; one listed last month has neither. Age since listing,
//      on a log curve, scales the fitted value.
//   4. Breadth. A protocol live on many chains distributes any launch across all of them;
//      each extra chain adds a small premium.
//
// implied = TVL x category multiple (size-bent) x momentum x maturity x breadth, in dollars.
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
  version: 'radar-mk2',
  shrinkK: 5, // a category median's pull toward the global median, in phantom samples
  sizeSlopeClamp: 1.2, // the most the size bend may move a multiple, in log points
  multipleFloor: 0.004,
  multipleCeiling: 6,
  momentumWeight: 0.5, // a +100% week at most doubles nothing: it adds half again
  momentumClampPct: 120,
  momentumFloorPct: -60,
  maturityBase: 0.72, // a protocol listed today keeps 72% of its fitted value
  maturityFullDays: 1095, // three tracked years earns the whole maturity factor
  breadthPerChain: 0.05,
  breadthMaxChains: 8,
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

/** The protocols that can teach the model anything: a token, a market cap and a TVL. */
export function comparables(protocols: Protocol[]): Protocol[] {
  return protocols.filter((p) => !recordsNoToken(p) && p.mcap_usd !== null && p.mcap_usd > 0 && p.tvl_usd > 0);
}

export function fitMultiples(protocols: Protocol[]): MultipleFit {
  const sample = comparables(protocols);
  if (sample.length < 8) throw new Error(`only ${sample.length} comparables: too few to fit a model`);
  const logs = sample.map(logRatio);
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
  for (const p of sample) {
    const key = p.category ?? 'Uncategorised';
    const list = byCategory.get(key);
    if (list === undefined) byCategory.set(key, [logRatio(p)]);
    else list.push(logRatio(p));
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

type Playbook = (p: Protocol, chain: string) => [string, string];

const PLAYBOOKS: Record<string, Playbook> = {
  dex: (p, chain) => [
    `Swap through ${p.name}'s main pairs on ${chain} in both directions, $200-400 a round trip, twice a week, so your wallet shows real trading volume rather than one wash day.`,
    `Provide liquidity to ${p.name}'s deepest ${chain} pool with half your capital and leave it in place; liquidity providers are the users a DEX launch rewards first and most visibly.`,
  ],
  lending: (p, chain) => [
    `Supply your capital as collateral on ${p.name} on ${chain} and keep the position open; supplied balances are the figure lending launches have historically snapshotted.`,
    `Borrow a modest amount against your collateral on ${p.name}, repay it in full, and repeat monthly, so the wallet carries both sides of the market's history, not just deposits.`,
  ],
  derivatives: (p, chain) => [
    `Open small perpetual positions on ${p.name} on ${chain}, a few hundred dollars of notional at a time, and close them over days rather than minutes, building genuine trading volume.`,
    `Post margin on ${p.name} and keep an open position through each weekly cycle; sustained open interest is the activity a derivatives launch measures, not one large trade.`,
  ],
  yield: (p, chain) => [
    `Deposit your capital into ${p.name}'s flagship ${chain} vault or strategy and leave it deposited; time-weighted balances are what vault launches reward, not deposits made the week before.`,
    `Use a second ${p.name} strategy on ${chain} with a smaller share of capital, and rebalance between the two monthly, so the wallet shows considered use of the whole product.`,
  ],
  staking: (p, chain) => [
    `Stake through ${p.name} on ${chain} with your capital and hold the resulting position without interruption; staking duration is the one figure a staking launch can snapshot fairly.`,
    `Restake or delegate a second, smaller tranche through ${p.name} and claim any rewards it issues on schedule, so the wallet shows an active, maintained staking history.`,
  ],
  bridge: (p, chain) => [
    `Bridge funds to ${chain} through ${p.name} in amounts of $300-500, then bridge part back a week later, so both directions of the route carry your wallet's history.`,
    `Make ${p.name} your default route for moving capital onto ${chain} for the whole plan period; repeated genuine transfers are what bridge launches have rewarded.`,
  ],
  rwa: (p, chain) => [
    `Complete ${p.name}'s onboarding on ${chain}, including any identity checks it requires, early: a finished account predating a launch is worth more than one opened after.`,
    `Hold a position in ${p.name}'s main ${chain} offering for the full plan period, adding a small amount monthly, so the account shows a holder rather than a passer-by.`,
  ],
  cex: (p, chain) => [
    `Trade spot on ${p.name} weekly in modest size and keep a balance on the exchange between trades; account age plus steady volume is what exchange launches have measured.`,
    `Use ${p.name}'s earn or staking product with a share of your capital for the plan period, so the account carries product history beyond trading alone.`,
  ],
  generic: (p, chain) => [
    `Use ${p.name}'s core product on ${chain} with your capital every week, in the way its documentation leads with; launches reward the users the product was built for.`,
    `Take part in ${p.name}'s second surface as well, a companion feature, quest or integration on ${chain}, so your history is not a single repeated transaction.`,
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

/** A five-step plan a reader can start this week, written from the protocol's own figures. */
export function farmSteps(p: Protocol, age: number | null): string[] {
  const chain = p.chains[0] ?? 'Ethereum';
  const capital = capitalFor(p.tvl_usd);
  const weeks = weeksFor(age);
  const [core1, core2] = playbookFor(p.category)(p, chain);
  const steps: string[] = [
    `Set up a dedicated wallet for ${p.name} and fund it with about ${money(capital)} on ${chain}; budget for ${feeNote(chain)}, and never farm with money you cannot leave untouched for months.`,
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
    `Follow ${p.name}'s official channels weekly for a points programme or token announcement, and log every transaction hash and date in a spreadsheet, so you can prove the history if a claim ever asks.`,
  );
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
  fit: MultipleFit;
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

  const rows: BoardRow[] = scored.map(({ p, s }, i) => ({
    slug: p.slug,
    name: p.name,
    rank: i + 1,
    implied_value_usd: s.implied,
    farm_steps: farmSteps(p, s.age),
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
  }));

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
    fit,
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
