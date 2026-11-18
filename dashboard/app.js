// Token Launch Radar's page. Everything it shows comes from window.TOKEN_RADAR, the data file
// main.ts writes beside dashboard/ from the same board it hands in: no network, no framework,
// and the figures on screen are the figures in board.json.

(function () {
  'use strict';

  var D = window.TOKEN_RADAR;
  var rows = D.rows;
  var bySlug = {};
  rows.forEach(function (r) { bySlug[r.slug] = r; });

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
      chip('Watchlist covered', watchCount + ' / ' + watchCount) +
      chip('Derivatives set aside', D.setAside.length.toLocaleString('en-US')) +
      chip('Comparables fitted', D.fit.sampleSize.toLocaleString('en-US'));
    function chip(k, v) { return '<span class="chip">' + k + ': <strong>' + esc(v) + '</strong></span>'; }
  }

  function renderModelNote() {
    els['model-note'].innerHTML =
      '<strong>How the value is derived.</strong> The model fits the ' + D.fit.sampleSize +
      ' protocols in this snapshot whose tokens already trade: their median market cap is ' +
      D.fit.globalMultiple.toFixed(2) + '&times; TVL, with a per-category multiple and a size bend of ' +
      D.fit.sizeSlope.toFixed(2) + ' (bigger protocols trade at lower multiples). Each pre-token protocol is then scored ' +
      'from its own TVL, its category multiple, its 7-day TVL change, its tracked age and its chain count. No name is scored by hand.' +
      '<span class="formula">implied = TVL &times; category multiple (size-bent) &times; momentum &times; maturity &times; breadth</span>';
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
      return '<tr data-slug="' + esc(r.slug) + '">' +
        '<td class="num rank">' + r.rank + '</td>' +
        '<td class="name">' + esc(r.name) + badges(r) + '<span class="slug">' + esc(r.slug) + '</span></td>' +
        '<td class="cat">' + esc(r.category || '—') + '</td>' +
        '<td class="chains">' + esc(r.chains.slice(0, 3).join(', ')) + (r.chains.length > 3 ? ' +' + (r.chains.length - 3) : '') + '</td>' +
        '<td class="num">' + compact(r.tvl_usd) + '</td>' +
        '<td class="num">' + pct(r.change_7d) + '</td>' +
        '<td class="num implied">' + compact(r.implied_value_usd) + '</td>' +
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
      '<p>Median market cap / TVL per category across ' + D.fit.sampleSize + ' trading protocols, shrunk toward the global median where a category is thin.</p>' +
      '<table><thead><tr><th>Category</th><th class="num">Sample</th><th class="num">Multiple</th></tr></thead><tbody>' + cats + '</tbody></table></div>' +
      '<div class="card"><h2>Set aside: not launches</h2>' +
      '<p>' + D.setAside.length + ' records carry no token of their own but are not launches either: wrapped, staked, bridged or exchange products of an asset that already trades, and later versions of a ranked protocol. The largest:</p>' +
      '<table><thead><tr><th>Protocol</th><th>Category</th><th class="num">TVL</th><th>Why set aside</th></tr></thead><tbody>' + aside + '</tbody></table></div>';
  }

  // ------------------------------------------------------------ detail view

  function factorRow(label, value, note) {
    var width = Math.max(3, Math.min(100, (value / 1.6) * 100));
    return '<div class="factor"><span class="fname">' + label + '</span>' +
      '<span class="track"><span class="fill" style="display:block;width:' + width.toFixed(0) + '%"></span></span>' +
      '<span class="fval">' + value.toFixed(2) + '&times;</span></div>' +
      (note ? '' : '');
  }

  function renderDetail(slug) {
    var r = bySlug[slug];
    if (!r) { window.location.hash = '#/'; return; }
    var catFit = null;
    D.fit.categories.forEach(function (c) { if (c.category === (r.category || 'Uncategorised')) catFit = c; });
    var stats = [
      ['Rank', '#' + r.rank + ' of ' + rows.length],
      ['Implied value', compact(r.implied_value_usd), true],
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
      factorRow('Category multiple', r.multiple, '') +
      factorRow('Momentum (7-day TVL)', r.momentum, '') +
      factorRow('Maturity (tracked age)', r.maturity, '') +
      factorRow('Breadth (chains)', r.breadth, '') +
      '<p class="how">' + money(r.tvl_usd) + ' of TVL. The ' + esc(r.category || 'Uncategorised') + ' category multiple is ' +
      (catFit ? catFit.multiple.toFixed(2) : D.fit.globalMultiple.toFixed(2)) + '&times;, fitted from ' +
      (catFit ? catFit.n : 0) + ' trading protocol' + (catFit && catFit.n === 1 ? '' : 's') +
      ' and shrunk toward the global median where a category is thin; bent for this protocol\u2019s size it is the ' +
      r.multiple.toFixed(2) + '&times; above. Momentum, maturity and breadth then scale the base to ' +
      money(r.implied_value_usd) + '. The full arithmetic is in the model note on the board.</p></div>' +
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
