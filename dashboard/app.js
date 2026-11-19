// Token Launch Radar's page. Everything it shows comes from window.TOKEN_RADAR, the data file
// main.ts writes beside dashboard/ from the same board it hands in: no network, no framework,
// and the figures on screen are the figures in board.json.

(function () {
  'use strict';

  var D = window.TOKEN_RADAR;
  var rows = D.rows;
  var bySlug = {};
  rows.forEach(function (r) { bySlug[r.slug] = r; });

  // Where each protocol would rank on TVL alone: the board's small arrows measure the
  // distance between that rank and the implied-value rank, so a reader sees at a glance
  // which names the multiples, not the size, are carrying.
  var tvlRank = {};
  rows.slice().sort(function (a, b) { return b.tvl_usd - a.tvl_usd; })
    .forEach(function (r, i) { tvlRank[r.slug] = i + 1; });

  // ------------------------------------------------------------ formatting

  function esc(s) {
    return String(s).replace(/[&<>"']/g, function (c) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
    });
  }

  function money(n) {
    return '$' + Math.round(n).toLocaleString('en-US');
  }

  function compact(n) {
    if (n >= 1e12) return '$' + (n / 1e12).toFixed(2) + 'T';
    if (n >= 1e9) return '$' + (n / 1e9).toFixed(2) + 'B';
    if (n >= 1e6) return '$' + (n / 1e6).toFixed(1) + 'M';
    if (n >= 1e3) return '$' + (n / 1e3).toFixed(0) + 'K';
    return money(n);
  }

  function pct(c) {
    if (c === null || c === undefined) return '<span class="flat">n/a</span>';
    var cls = c > 0.05 ? 'up' : c < -0.05 ? 'down' : 'flat';
    return '<span class="' + cls + '">' + (c > 0 ? '+' : '') + c.toFixed(1) + '%</span>';
  }

  function ageText(days) {
    if (days === null || days === undefined) return 'unlisted';
    if (days >= 730) return (days / 365.25).toFixed(1) + ' yrs';
    if (days >= 60) return Math.round(days / 30.4) + ' mo';
    return days + ' d';
  }

  function badges(r) {
    var out = '';
    if (r.watchlist) out += '<span class="badge watch">WATCHLIST</span>';
    if (r.derivative) out += '<span class="badge deriv">DERIVATIVE</span>';
    if (r.risk_flags && r.risk_flags.length) {
      out += '<span class="badge risk" title="' + esc(r.risk_flags.join(' ')) + '">' +
        r.risk_flags.length + (r.risk_flags.length === 1 ? ' RISK FLAG' : ' RISK FLAGS') + '</span>';
    }
    return out;
  }

  // ------------------------------------------------------------ routing

  function parseHash() {
    var h = window.location.hash.replace(/^#/, '');
    if (h.indexOf('/p/') === 0) return { view: 'detail', slug: decodeURIComponent(h.slice(3)) };
    var q = {};
    var at = h.indexOf('?');
    if (at !== -1) {
      h.slice(at + 1).split('&').forEach(function (pair) {
        var kv = pair.split('=');
        if (kv[0]) q[decodeURIComponent(kv[0])] = decodeURIComponent(kv[1] || '');
      });
    }
    return {
      view: 'board',
      q: q.q || '',
      cat: q.cat || '',
      chain: q.chain || '',
      sort: q.sort || 'rank',
      watch: q.watch === '1',
    };
  }

  function boardHash(state) {
    var parts = [];
    if (state.q) parts.push('q=' + encodeURIComponent(state.q));
    if (state.cat) parts.push('cat=' + encodeURIComponent(state.cat));
    if (state.chain) parts.push('chain=' + encodeURIComponent(state.chain));
    if (state.sort && state.sort !== 'rank') parts.push('sort=' + encodeURIComponent(state.sort));
    if (state.watch) parts.push('watch=1');
    return '#/' + (parts.length ? '?' + parts.join('&') : '');
  }

  // ------------------------------------------------------------ board view

  var els = {};
  ['chips', 'model-note', 'controls', 'q', 'cat', 'chain', 'sort', 'watch', 'count', 'rows', 'evidence', 'board-view', 'detail-view']
    .forEach(function (id) { els[id] = document.getElementById(id); });

  function renderChips() {
    var watchCount = rows.filter(function (r) { return r.watchlist; }).length;
    els.chips.innerHTML =
      chip('Snapshot', D.as_of) +
      chip('Protocols scanned', D.scanned.toLocaleString('en-US')) +
      chip('Launch candidates ranked', rows.length.toLocaleString('en-US')) +
      chip('Watchlist covered', watchCount + ' / ' + D.watchlistCount) +
      chip('Derivatives set aside', D.setAside.length.toLocaleString('en-US')) +
      chip('Comparables fitted', D.fit.sampleSize.toLocaleString('en-US')) +
      chip('Typical model error', '\u00D7/\u00F7' + D.calibration.bandFactor.toFixed(1) + ' (leave-one-out)');
    function chip(k, v) { return '<span class="chip">' + k + ': <strong>' + esc(v) + '</strong></span>'; }
  }

  function renderModelNote() {
    els['model-note'].innerHTML =
      '<strong>How the value is derived.</strong> The model fits the ' + D.fit.sampleSize +
      ' protocols in this snapshot whose tokens already trade: their median market cap is ' +
      D.fit.globalMultiple.toFixed(2) + '&times; TVL, with a per-category multiple and a size bend of ' +
      D.fit.sizeSlope.toFixed(2) + ' (bigger protocols trade at lower multiples). The fit is robust: every comparable\u2019s ' +
      'ratio is first clamped to the sample\u2019s Tukey fences, so one wild token cannot set a whole category, and each ' +
      'category median must out-argue twenty phantom copies of the global median before it moves a row \u2014 a category ' +
      'resting on one comparable (this snapshot\u2019s Risk Curators rests on a single oracle token) stays near the global ' +
      'evidence and is flagged. Momentum counts only a quarter of a week\u2019s TVL move, clamped to +50%/&minus;40%: among ' +
      'the comparables themselves a hot week comes with no higher multiple, so a spike earns a flag, not a boost. ' +
      'And the model grades itself: leaving each comparable out in turn and predicting its market cap, its typical miss ' +
      'is &times;/&divide;' + D.calibration.bandFactor.toFixed(1) + '. Every row therefore carries that range around its ' +
      'implied value \u2014 wider where its category is thin \u2014 instead of pretending to a precision the evidence ' +
      'does not carry. No name is scored by hand.' +
      '<span class="formula">implied = TVL &times; category multiple (size-bent) &times; momentum &times; maturity &times; breadth, published with its calibrated range</span>';
  }

  function fillSelect(select, values, allLabel) {
    select.innerHTML = '<option value="">' + allLabel + '</option>' + values.map(function (v) {
      return '<option value="' + esc(v) + '">' + esc(v) + '</option>';
    }).join('');
  }

  function renderControls(state) {
    var cats = [];
    var chains = [];
    rows.forEach(function (r) {
      if (r.category && cats.indexOf(r.category) === -1) cats.push(r.category);
      r.chains.forEach(function (c) { if (chains.indexOf(c) === -1) chains.push(c); });
    });
    cats.sort(); chains.sort();
    fillSelect(els.cat, cats, 'All categories');
    fillSelect(els.chain, chains, 'All chains');
    els.q.value = state.q;
    els.cat.value = state.cat;
    els.chain.value = state.chain;
    els.sort.value = state.sort;
    els.watch.checked = state.watch;
  }

  function visibleRows(state) {
    var q = state.q.trim().toLowerCase();
    var out = rows.filter(function (r) {
      if (state.watch && !r.watchlist) return false;
      if (state.cat && r.category !== state.cat) return false;
      if (state.chain && r.chains.indexOf(state.chain) === -1) return false;
      if (q && r.name.toLowerCase().indexOf(q) === -1 && r.slug.indexOf(q) === -1) return false;
      return true;
    });
    var by = {
      rank: function (a, b) { return a.rank - b.rank; },
      tvl: function (a, b) { return b.tvl_usd - a.tvl_usd; },
      change: function (a, b) { return (b.change_7d === null ? -1e9 : b.change_7d) - (a.change_7d === null ? -1e9 : a.change_7d); },
      age: function (a, b) { return (b.age_days === null ? -1 : b.age_days) - (a.age_days === null ? -1 : a.age_days); },
      multiple: function (a, b) { return b.multiple - a.multiple; },
    };
    return out.sort(by[state.sort] || by.rank);
  }

  function renderBoard(state) {
    var list = visibleRows(state);
    els.count.textContent = list.length + ' of ' + rows.length + ' protocols';
    if (list.length === 0) {
      els.rows.innerHTML = '<tr><td colspan="9" class="empty">No protocol matches these filters. Loosen one and the radar sweeps again.</td></tr>';
      return;
    }
    els.rows.innerHTML = list.map(function (r) {
      var delta = tvlRank[r.slug] - r.rank;
      var arrow = delta === 0 ? '' :
        '<span class="delta ' + (delta > 0 ? 'up' : 'down') + '" title="By TVL alone this would rank #' +
        tvlRank[r.slug] + '; the fitted multiples move it ' + (delta > 0 ? 'up ' : 'down ') + Math.abs(delta) +
        '">' + (delta > 0 ? '\u25B2' : '\u25BC') + Math.abs(delta) + '</span>';
      return '<tr data-slug="' + esc(r.slug) + '">' +
        '<td class="num rank">' + r.rank + arrow + '</td>' +
        '<td class="name">' + esc(r.name) + badges(r) + '<span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td class="cat">' + esc(r.category || '—') + '</td>' +
        '<td class="chains">' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
        '<td class="num" title="' + money(r.tvl_usd) + '">' + compact(r.tvl_usd) + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td>' +
        '<td class="num implied" title="' + money(r.implied_value_usd) + ' \u2014 typical range ' + money(r.implied_low_usd) + ' to ' + money(r.implied_high_usd) + ' (the model\u2019s own leave-one-out error)">' + compact(r.implied_value_usd) + '</td>' +
        '<td class="num">' + r.multiple.toFixed(2) + '&times;</td>' +
        '<td class="num">' + ageText(r.age_days) + '</td>' +
        '</tr>';
    }).join('');
  }

  function renderEvidence() {
    var live = D.live.slice(0, 12).map(function (l) {
      return '<tr><td>' + esc(l.name) + (l.symbol ? ' <span class="slug">' + esc(l.symbol) + '</span>' : '') + '</td>' +
        '<td class="num">' + compact(l.tvl_usd) + '</td><td class="num">' + compact(l.mcap_usd) + '</td>' +
        '<td class="num">' + l.multiple.toFixed(2) + '&times;</td></tr>';
    }).join('');
    var cats = D.fit.categories.map(function (c) {
      return '<tr><td>' + esc(c.category) + '</td><td class="num">' + c.n + '</td><td class="num">' + c.multiple.toFixed(2) + '&times;</td></tr>';
    }).join('');
    var aside = D.setAside.slice(0, 10).map(function (a) {
      return '<tr><td>' + esc(a.name) + '</td><td>' + esc(a.category || '—') + '</td>' +
        '<td class="num">' + compact(a.tvl_usd) + '</td><td>' + (a.reason === 'derivative' ? 'Derivative' : 'Later version') + '</td></tr>';
    }).join('');
    els.evidence.innerHTML =
      '<div class="card"><h2>The evidence: tokens that already trade</h2>' +
      '<p>The board never ranks these; they are what the multiples are fitted on. The largest by TVL:</p>' +
      '<table><thead><tr><th>Protocol</th><th class="num">TVL</th><th class="num">Market cap</th><th class="num">Multiple</th></tr></thead><tbody>' + live + '</tbody></table></div>' +
      '<div class="card"><h2>Fitted multiples by category</h2>' +
      '<p>Median market cap / TVL per category across ' + D.fit.sampleSize + ' trading protocols, each comparable first clamped to the sample\u2019s Tukey fences, then shrunk toward the global median with the weight of twenty phantom samples. Read the Sample column before trusting a multiple: a category standing on one or two names is mostly the global median talking, and its rows carry a widened range and a risk flag saying so.</p>' +
      '<table><thead><tr><th>Category</th><th class="num">Sample</th><th class="num">Multiple</th></tr></thead><tbody>' + cats + '</tbody></table></div>' +
      '<div class="card"><h2>Set aside: not launches</h2>' +
      '<p>' + D.setAside.length + ' records carry no token of their own but are not launches either: wrapped, staked, bridged or exchange products of an asset that already trades, and later versions of a ranked protocol. The largest:</p>' +
      '<table><thead><tr><th>Protocol</th><th>Category</th><th class="num">TVL</th><th>Why set aside</th></tr></thead><tbody>' + aside + '</tbody></table></div>';
  }

  // ------------------------------------------------------------ detail view

  // A factor's bar runs on a log scale from 0.25x to 4x with a tick at 1x, drawn from the
  // tick outward: teal when the factor lifts the value, amber when it discounts it. A bar
  // pinned at the tick is a factor that did nothing, which is itself worth seeing.
  function factorRow(label, value, note) {
    var lo = Math.log(0.25);
    var span = Math.log(4) - lo;
    function pos(v) {
      return Math.max(0, Math.min(100, ((Math.log(Math.max(v, 0.001)) - lo) / span) * 100));
    }
    var centre = pos(1);
    var end = pos(value);
    var left = Math.min(centre, end);
    var width = Math.max(1.5, Math.abs(end - centre));
    return '<div class="factor"><span class="fname">' + label + '</span>' +
      '<span class="track"><span class="centre"></span>' +
      '<span class="fill' + (value < 1 ? ' below' : '') + '" style="left:' + left.toFixed(1) + '%;width:' + width.toFixed(1) + '%"></span></span>' +
      '<span class="fval">' + value.toFixed(2) + '&times;</span>' +
      '<span class="fnote">' + note + '</span></div>';
  }

  function renderDetail(slug) {
    var r = bySlug[slug];
    if (!r) { window.location.hash = '#/'; return; }
    var catFit = null;
    D.fit.categories.forEach(function (c) { if (c.category === (r.category || 'Uncategorised')) catFit = c; });
    var stats = [
      ['Rank', '#' + r.rank + ' of ' + rows.length],
      ['Implied value', compact(r.implied_value_usd), true],
      ['Typical range', compact(r.implied_low_usd) + ' \u2013 ' + compact(r.implied_high_usd)],
      ['TVL', money(r.tvl_usd)],
      ['7-day TVL change', r.change_7d === null ? 'not reported' : (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(1) + '%'],
      ['Tracked for', r.age_days === null ? 'listing day unreported' : ageText(r.age_days) + ' (' + r.age_days + ' days)'],
      ['Chains', r.chains.join(', ') || 'none named'],
    ];
    els['detail-view'].innerHTML =
      '<a class="backlink" href="#/">&larr; Back to the board</a>' +
      '<div class="detail-head"><h2>' + esc(r.name) + '</h2>' + badges(r) +
      '<span class="rankline">' + esc(r.slug) + ' &middot; ' + esc(r.category || 'Uncategorised') + '</span></div>' +
      '<p style="color:var(--dim);margin:4px 0 0">Records no token in the snapshot of ' + esc(D.as_of) +
      ', and is no wrapped, staked or bridged product of one that trades: a genuine launch candidate.</p>' +
      '<div class="stat-grid">' + stats.map(function (s) {
        return '<div class="stat"><div class="k">' + s[0] + '</div><div class="v' + (s[2] ? ' signal' : '') + '">' + esc(s[1]) + '</div></div>';
      }).join('') + '</div>' +
      '<div class="factors"><h3>How this implied value is built</h3>' +
      factorRow('Category multiple', r.multiple,
        catFit
          ? esc(r.category || 'Uncategorised') + ' median fitted from ' + catFit.n + ' trading comparable' + (catFit.n === 1 ? '' : 's') +
            ', clamped to the sample\u2019s fences and shrunk toward the global ' + D.fit.globalMultiple.toFixed(2) +
            '&times; with the weight of twenty phantom samples, then bent for this protocol\u2019s size.'
          : 'No comparable in this category trades, so the global median ' + D.fit.globalMultiple.toFixed(2) +
            '&times; stands in, bent for this protocol\u2019s size.') +
      factorRow('Momentum (7-day TVL)', r.momentum,
        r.change_7d === null
          ? 'No 7-day change reported, so momentum counts as neutral.'
          : 'TVL moved ' + (r.change_7d > 0 ? '+' : '') + r.change_7d.toFixed(1) + '% in seven days; the model counts a quarter of that, clamped to +50%/&minus;40%, because among the comparables a hot week earns no higher multiple.') +
      factorRow('Maturity (tracked age)', r.maturity,
        r.age_days === null
          ? 'Listing day unreported; the median tracked age of the snapshot stands in.'
          : 'Tracked for ' + r.age_days + ' days; the factor reaches 1.00&times; at three tracked years and a new listing keeps 0.85&times;.') +
      factorRow('Breadth (chains)', r.breadth,
        'Live on ' + r.chains.length + ' chain' + (r.chains.length === 1 ? '' : 's') +
        '; +1.25% per extra chain, capped at +10%, because the TVL above already sums those chains.') +
      '<p class="how">' + money(r.tvl_usd) + ' of TVL. The ' + esc(r.category || 'Uncategorised') + ' category multiple is ' +
      (catFit ? catFit.multiple.toFixed(2) : D.fit.globalMultiple.toFixed(2)) + '&times;, fitted from ' +
      (catFit ? catFit.n : 0) + ' trading protocol' + (catFit && catFit.n === 1 ? '' : 's') +
      ' and shrunk toward the global median where a category is thin; bent for this protocol\u2019s size it is the ' +
      r.multiple.toFixed(2) + '&times; above. Momentum, maturity and breadth then scale the base to ' +
      money(r.implied_value_usd) + '. Treat that as the centre of a range, not a point: leaving each of the ' +
      D.calibration.sampleSize + ' comparables out in turn and predicting its market cap, this model\u2019s typical miss is ' +
      '&times;/&divide;' + D.calibration.bandFactor.toFixed(1) + (r.category_n < 3 ? ', widened by half again here because this category rests on ' +
      (r.category_n === 0 ? 'no comparables at all' : r.category_n + ' comparable' + (r.category_n === 1 ? '' : 's')) : '') +
      ', so the typical range is ' + money(r.implied_low_usd) + ' to ' + money(r.implied_high_usd) +
      '. The full arithmetic is in the model note on the board.</p></div>' +
      '<div class="risks"><h3>Risk flags from this protocol\u2019s own figures</h3>' +
      (r.risk_flags && r.risk_flags.length
        ? '<ul>' + r.risk_flags.map(function (f) { return '<li>' + esc(f) + '</li>'; }).join('') + '</ul>'
        : '<p class="none">No data-derived flags: the category evidence is not thin, the week\u2019s TVL move is inside the counted range, the record is not short and the base is not small. The standing risks of any pre-token farm \u2014 no token may ever be issued, contracts can fail \u2014 still apply and close the plan below.</p>') +
      '</div>' +
      '<div class="plan"><h3>The farm plan</h3><ol>' +
      r.farm_steps.map(function (s) { return '<li>' + esc(s) + '</li>'; }).join('') +
      '</ol></div>';
    els['board-view'].hidden = true;
    els['detail-view'].hidden = false;
    window.scrollTo(0, 0);
  }

  // ------------------------------------------------------------ wiring

  function currentState() {
    return {
      q: els.q.value, cat: els.cat.value, chain: els.chain.value, sort: els.sort.value,
      watch: els.watch.checked,
    };
  }

  function render() {
    var route = parseHash();
    if (route.view === 'detail') { renderDetail(route.slug); return; }
    els['detail-view'].hidden = true;
    els['board-view'].hidden = false;
    renderControls(route);
    renderBoard(route);
  }

  ['q', 'cat', 'chain', 'sort', 'watch'].forEach(function (id) {
    els[id].addEventListener('change', function () {
      window.history.replaceState(null, '', boardHash(currentState()));
      renderBoard(currentState());
    });
  });
  els.q.addEventListener('input', function () {
    window.history.replaceState(null, '', boardHash(currentState()));
    renderBoard(currentState());
  });
  els.controls.addEventListener('submit', function (e) { e.preventDefault(); });
  els.rows.addEventListener('click', function (e) {
    var tr = e.target.closest('tr[data-slug]');
    if (tr) window.location.hash = '#/p/' + encodeURIComponent(tr.getAttribute('data-slug'));
  });
  window.addEventListener('hashchange', render);

  renderChips();
  renderModelNote();
  renderEvidence();
  render();
})();
