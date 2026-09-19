/* Live standings — tables from ESPN's standings API, form / fixtures / live scores from
   fixtures.js, crests and competition marks from FootyLogos. No build step; loaded after
   competitions.js, crests.js and fixtures.js. */
(function () {
  'use strict';

  var API = 'https://site.api.espn.com/apis/v2/sports/soccer/';
  var REFRESH_MS = 60 * 1000;          // standings + fixtures while the tab is visible
  var LIVE_REFRESH_MS = 30 * 1000;     // faster while something is in play
  var STALE_MS = 45 * 1000;            // re-fetch on tab focus if older than this
  var KEY_THEMED = 'standings.themed';
  var KEY_CACHE = 'standings.cache.v3.';   // bump when the cached table shape changes
  var HOME = 'home';
  var ALL = 'all';

  var comps = window.COMPETITIONS;
  var byId = {};
  comps.forEach(function (c) { byId[c.id] = c; });

  var state = {
    view: HOME,               // 'home', 'all' or a competition id
    themed: false,
    data: {},                 // id -> { fetchedAt, stale, table }
    fx: {},                   // id -> derived fixtures (see fixtures.js)
    fxError: {},
    loading: {},
    error: {}
  };

  var $ = function (sel, root) { return (root || document).querySelector(sel); };
  var nav = $('#comp-nav');
  var main = $('#tables');
  var toggle = $('#themed-toggle');

  // ---------------------------------------------------------------- helpers
  function esc(s) {
    return String(s == null ? '' : s).replace(/[&<>"']/g, function (ch) {
      return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[ch];
    });
  }

  function slugify(name) {
    return name.normalize('NFKD').replace(/[\u0300-\u036f]/g, '').toLowerCase()
      .replace(/&/g, 'and').replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
  }

  function crestSrc(team) {
    if (window.CRESTS && window.CRESTS[team.id]) return window.CRESTS[team.id];
    var slug = slugify(team.name);
    return 'https://assets.footylogos.com/previews/' + slug + '/' + slug + '-logo-footylogos-320.webp';
  }

  function crestHTML(team, size) {
    var fallback = team.espnLogo || team.logo || '';
    return '<img class="crest" src="' + crestSrc(team) + '" data-fallback="' + esc(fallback) + '" alt="" width="' + size + '" height="' + size + '" loading="lazy" decoding="async">';
  }

  function fmtTime(ts) {
    return new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
  }

  function fmtAgo(ts) {
    var s = Math.round((Date.now() - ts) / 1000);
    if (s < 10) return 'just now';
    if (s < 60) return s + 's ago';
    var m = Math.round(s / 60);
    if (m < 60) return m + ' min ago';
    return Math.round(m / 60) + ' h ago';
  }

  function dayKey(ts) {
    var d = new Date(ts);
    return d.getFullYear() * 10000 + (d.getMonth() + 1) * 100 + d.getDate();
  }

  function dayLabel(ts, long) {
    var key = dayKey(ts), today = dayKey(Date.now()), tomorrow = dayKey(Date.now() + 864e5);
    var d = new Date(ts);
    var date = d.toLocaleDateString([], long ? { weekday: 'long', day: 'numeric', month: 'long' } : { weekday: 'short', day: 'numeric', month: 'short' });
    if (key === today) return long ? 'Today · ' + date : 'Today';
    if (key === tomorrow) return long ? 'Tomorrow · ' + date : 'Tomorrow';
    return date;
  }

  function signed(n) { return n > 0 ? '+' + n : String(n); }

  // A match's status as people read it: kick-off time, minute, HT, FT, Postponed…
  function matchStatus(e) {
    if (e.state === 'in') {
      if (/HALFTIME/i.test(e.statusName)) return 'HT';
      if (/PENALT/i.test(e.statusName)) return 'Pens';
      return e.clock || 'Live';
    }
    if (e.state === 'post') return e.detail || 'FT';
    return e.timeValid ? fmtTime(e.ts) : 'TBC';
  }

  // ---------------------------------------------------------------- standings data
  function parseGroup(child) {
    var entries = child && child.standings ? child.standings.entries : [];
    var rows = entries.map(function (e) {
      var s = {};
      (e.stats || []).forEach(function (st) { s[st.name] = st; });
      var num = function (k) { return s[k] && s[k].value != null ? Number(s[k].value) : 0; };
      var note = e.note || null;
      var logos = e.team.logos || [];
      return {
        rank: num('rank'),
        team: {
          id: String(e.team.id),
          name: e.team.displayName || e.team.name,
          short: e.team.shortDisplayName || e.team.name,
          abbr: e.team.abbreviation || '',
          espnLogo: logos.length ? logos[0].href : ''
        },
        p: num('gamesPlayed'), w: num('wins'), d: num('ties'), l: num('losses'),
        gf: num('pointsFor'), ga: num('pointsAgainst'), gd: num('pointDifferential'),
        pts: num('points'), ded: num('deductions'),
        zone: note ? window.zoneFor(note.description) : null
      };
    });
    rows.sort(function (a, b) { return a.rank - b.rank; });

    // One legend entry per zone, in order of first appearance, with every run of ranks it
    // covers (LALIGA, for instance, can flag places 6 and 10 as Europa League).
    var zones = [];
    rows.forEach(function (r) {
      if (!r.zone) return;
      var z = zones.filter(function (x) { return x.key === r.zone; })[0];
      if (!z) { z = { key: r.zone, runs: [] }; zones.push(z); }
      var run = z.runs[z.runs.length - 1];
      if (run && run.to === r.rank - 1) run.to = r.rank; else z.runs.push({ from: r.rank, to: r.rank });
    });
    return { name: (child && child.name) || '', rows: rows, zones: zones };
  }

  // ESPN returns one child per table: a single one for a league or a league phase, several
  // when a competition is split into groups. Each becomes its own panel.
  function parse(json) {
    var groups = (json.children || []).map(parseGroup).filter(function (g) { return g.rows.length; });
    var year = json.season && json.season.year;
    var played = [];
    groups.forEach(function (g) { g.rows.forEach(function (r) { played.push(r.p); }); });
    var phase = groups.length === 1 && /phase/i.test(groups[0].name) ? groups[0].name.replace(/\s*\d{4}-\d{2,4}\s*$/, '') :
      groups.length > 1 ? 'Group stage' : '';
    return {
      season: year ? year + '-' + String(year + 1).slice(-2) : '',
      phase: phase,
      matchday: played.length ? Math.max.apply(null, played) : 0,
      groups: groups
    };
  }

  function readCache(id) {
    try { var raw = localStorage.getItem(KEY_CACHE + id); return raw ? JSON.parse(raw) : null; } catch (e) { return null; }
  }
  function writeCache(id, entry) {
    try { localStorage.setItem(KEY_CACHE + id, JSON.stringify(entry)); } catch (e) { /* quota / private mode */ }
  }

  function loadTable(c) {
    if (state.loading[c.id]) return Promise.resolve();
    state.loading[c.id] = true;
    renderSection(c);

    return fetch(API + c.espn + '/standings?_=' + Date.now(), { cache: 'no-store' })
      .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
      .then(function (json) {
        var table = parse(json);
        if (!table.groups.length) throw new Error('No standings returned');
        state.data[c.id] = { fetchedAt: Date.now(), stale: false, table: table };
        state.error[c.id] = null;
        writeCache(c.id, state.data[c.id]);
      })
      .catch(function (err) {
        state.error[c.id] = err && err.message ? err.message : String(err);
        if (!state.data[c.id]) {
          var cached = readCache(c.id);
          if (cached) { cached.stale = true; state.data[c.id] = cached; }
        } else {
          state.data[c.id].stale = true;
        }
      })
      .then(function () { state.loading[c.id] = false; renderSection(c); });
  }

  function loadFixtures(c, force) {
    return window.Fixtures.load(c, force)
      .then(function (fx) { state.fx[c.id] = fx; state.fxError[c.id] = null; })
      .catch(function (err) { state.fxError[c.id] = err && err.message ? err.message : String(err); })
      .then(function () {
        if (state.view === HOME) renderHome(); else renderSection(c);
      });
  }

  function tableComps() {
    return state.view === ALL ? comps : state.view === HOME ? [] : [byId[state.view]];
  }

  function anyLive() {
    var ids = state.view === HOME || state.view === ALL ? comps.map(function (c) { return c.id; }) : [state.view];
    return ids.some(function (id) { return state.fx[id] && state.fx[id].live.length; });
  }

  function refreshVisible(force) {
    tableComps().forEach(function (c) {
      var d = state.data[c.id];
      if (force || !d || Date.now() - d.fetchedAt > STALE_MS) loadTable(c);
      loadFixtures(c, force);
    });
    if (state.view === HOME) comps.forEach(function (c) { loadFixtures(c, force); });
  }

  // ---------------------------------------------------------------- shared rendering
  function logoHTML(c, cls) {
    var html = '<span class="comp-logo mark-' + c.mark + ' ' + (cls || '') + '">' +
      '<img class="logo-light" src="' + c.logo + '" alt="" loading="lazy" decoding="async">';
    if (c.logoDark) html += '<img class="logo-dark" src="' + c.logoDark + '" alt="" loading="lazy" decoding="async">';
    return html + '</span>';
  }

  function renderNav() {
    var pill = function (view, inner, extra) {
      var active = state.view === view;
      return '<a class="pill' + (extra || '') + (active ? ' is-active' : '') + '" href="#' + view + '" data-view="' + view + '"' +
        (active ? ' aria-current="page"' : '') + '>' + inner + '</a>';
    };
    var html = pill(HOME,
      '<svg class="pill-icon" viewBox="0 0 24 24" width="16" height="16" aria-hidden="true"><path d="M3 11.5 12 4l9 7.5V20a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>' +
      '<span class="pill-label">Home</span><span class="pill-short">Home</span>', ' pill-home');
    html += '<span class="nav-divider" aria-hidden="true"></span>';
    html += comps.map(function (c, i) {
      var divider = i > 0 && comps[i - 1].group !== c.group ? '<span class="nav-divider" aria-hidden="true"></span>' : '';
      return divider + pill(c.id, logoHTML(c, 'pill-logo') + '<span class="pill-label">' + esc(c.name) + '</span><span class="pill-short">' + esc(c.short) + '</span>');
    }).join('');
    html += '<span class="nav-divider" aria-hidden="true"></span>' +
      pill(ALL, '<span class="pill-label">All tables</span><span class="pill-short">All</span>', ' pill-all');
    nav.innerHTML = html;
    // Centre the active pill in the strip without touching page scroll.
    var active = nav.querySelector('.is-active');
    if (active) nav.scrollLeft = Math.max(0, active.offsetLeft - (nav.clientWidth - active.offsetWidth) / 2);
  }

  function statusHTML(c, d) {
    var err = state.error[c.id];
    var loading = state.loading[c.id];
    var html = '';
    if (loading) html += '<span class="status status-loading"><span class="spinner"></span>Updating…</span>';
    else if (d && !d.stale) html += '<span class="status status-live"><span class="live-dot"></span>Live <span class="ago" data-ts="' + d.fetchedAt + '">' + fmtAgo(d.fetchedAt) + '</span></span>';
    else if (d && d.stale) html += '<span class="status status-stale" title="' + esc(err || '') + '">Offline — showing ' + fmtTime(d.fetchedAt) + ' snapshot</span>';
    html += '<button type="button" class="refresh" data-refresh="' + c.id + '" aria-label="Refresh ' + esc(c.name) + '"' + (loading ? ' disabled' : '') + '>' +
      '<svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5"/></svg></button>';
    return html;
  }

  // ---------------------------------------------------------------- standings rendering
  function formHTML(team, fx) {
    var list = fx && fx.form[team.id];
    if (!fx) return '<span class="form form-empty" aria-hidden="true"><i></i><i></i><i></i><i></i><i></i></span>';
    if (!list || !list.length) return '<span class="form form-none">—</span>';
    var pad = 5 - list.length;
    var html = '<span class="form" aria-label="Last five: ' + list.map(function (f) { return f.r; }).join(' ') + '">';
    for (var i = 0; i < pad; i++) html += '<i class="f-blank"></i>';
    html += list.map(function (f) {
      var title = f.r + ' ' + f.score + ' ' + (f.home ? 'v' : '@') + ' ' + esc(f.opp.short) + ', ' + new Date(f.ts).toLocaleDateString([], { day: 'numeric', month: 'short' });
      return '<i class="f-' + f.r.toLowerCase() + '" title="' + title + '">' + f.r + '</i>';
    }).join('');
    return html + '</span>';
  }

  function nextHTML(team, fx) {
    if (!fx) return '<span class="next next-empty">…</span>';
    var e = fx.next[team.id];
    if (!e) return '<span class="next next-none">—</span>';
    var home = e.home.id === team.id;
    var us = home ? e.home : e.away, them = home ? e.away : e.home;
    var opp = '<span class="next-opp">' + (home ? 'v' : '@') + ' ' + esc(them.abbr || them.short) + '</span>';
    if (e.state === 'in') {
      return '<span class="next is-live"><span class="live-pill">Live</span><span class="next-clock">' + esc(matchStatus(e)) + '</span>' +
        '<span class="next-score">' + us.score + '–' + them.score + '</span>' + opp + '</span>';
    }
    return '<span class="next"><span class="next-when">' + esc(dayLabel(e.ts) + (e.timeValid ? ' ' + fmtTime(e.ts) : ' TBC')) + '</span>' + opp + '</span>';
  }

  function rowHTML(r, fx) {
    var live = fx && fx.next[r.team.id] && fx.next[r.team.id].state === 'in';
    var zoneCls = r.zone ? ' z-' + r.zone : '';
    var ded = r.ded ? '<sup class="ded" title="Points deduction">' + signed(-Math.abs(r.ded)) + '</sup>' : '';
    return '<tr class="row' + zoneCls + (live ? ' is-playing' : '') + '">' +
      '<td class="pos"><span>' + r.rank + '</span></td>' +
      '<td class="club"><span class="club-inner">' + crestHTML(r.team, 24) +
        '<span class="club-name"><span class="name-long">' + esc(r.team.name) + '</span><span class="name-short">' + esc(r.team.short) + '</span></span>' +
        (live ? '<span class="live-pill live-pill-row" title="Playing now">Live</span>' : '') + '</span></td>' +
      '<td class="num">' + r.p + '</td>' +
      '<td class="num wdl">' + r.w + '</td>' +
      '<td class="num wdl">' + r.d + '</td>' +
      '<td class="num wdl">' + r.l + '</td>' +
      '<td class="num goals">' + r.gf + '</td>' +
      '<td class="num goals">' + r.ga + '</td>' +
      '<td class="num gd">' + signed(r.gd) + '</td>' +
      '<td class="num pts">' + r.pts + ded + '</td>' +
      '<td class="formcell">' + formHTML(r.team, fx) + '</td>' +
      '<td class="nextcell">' + nextHTML(r.team, fx) + '</td>' +
      '</tr>';
  }

  function tableHTML(g, fx) {
    return '<div class="table-wrap"><table class="standings">' +
      '<thead><tr>' +
        '<th class="pos" scope="col"><abbr title="Position">#</abbr></th>' +
        '<th class="club" scope="col">Club</th>' +
        '<th class="num" scope="col"><abbr title="Played">P</abbr></th>' +
        '<th class="num wdl" scope="col"><abbr title="Won">W</abbr></th>' +
        '<th class="num wdl" scope="col"><abbr title="Drawn">D</abbr></th>' +
        '<th class="num wdl" scope="col"><abbr title="Lost">L</abbr></th>' +
        '<th class="num goals" scope="col"><abbr title="Goals for">GF</abbr></th>' +
        '<th class="num goals" scope="col"><abbr title="Goals against">GA</abbr></th>' +
        '<th class="num gd" scope="col"><abbr title="Goal difference">GD</abbr></th>' +
        '<th class="num pts" scope="col"><abbr title="Points">Pts</abbr></th>' +
        '<th class="formcell" scope="col"><abbr title="Last five results, most recent on the right">Form</abbr></th>' +
        '<th class="nextcell" scope="col">Next</th>' +
      '</tr></thead><tbody>' + g.rows.map(function (r) { return rowHTML(r, fx); }).join('') + '</tbody></table></div>';
  }

  function legendHTML(zones) {
    if (!zones.length) return '';
    return '<ul class="legend">' + zones.map(function (z) {
      var range = (z.runs || []).map(function (run) { return run.from === run.to ? String(run.from) : run.from + '–' + run.to; }).join(', ');
      return '<li class="z-' + z.key + '"><span class="dot"></span>' + esc(window.ZONES[z.key] || z.key) +
        '<span class="range">' + range + '</span></li>';
    }).join('') + '</ul>';
  }

  function skeletonHTML(n) {
    var rows = '';
    for (var i = 0; i < n; i++) rows += '<div class="skel-row"><span class="skel skel-pos"></span><span class="skel skel-crest"></span><span class="skel skel-name"></span><span class="skel skel-num"></span><span class="skel skel-num"></span><span class="skel skel-num"></span></div>';
    return '<div class="skeleton" aria-hidden="true">' + rows + '</div>';
  }

  function metaHTML(d) {
    var parts = [];
    if (d.table.season) parts.push(d.table.season);
    if (d.table.phase) parts.push(d.table.phase);
    if (d.table.matchday) parts.push('Matchday ' + d.table.matchday);
    return parts.map(esc).join(' <span class="sep">·</span> ');
  }

  function sectionHTML(c) {
    var d = state.data[c.id];
    var fx = state.fx[c.id] || null;
    var err = state.error[c.id];
    var single = state.view !== ALL;
    var liveCount = fx ? fx.live.length : 0;

    var errorBox = err && !d ?
      '<div class="error"><strong>Couldn’t load the ' + esc(c.name) + ' table.</strong><span>' + esc(err) + '</span>' +
      '<button type="button" class="btn" data-refresh="' + c.id + '">Try again</button></div>' : '';

    var body;
    if (d) {
      var many = d.table.groups.length > 1;
      body = d.table.groups.map(function (g) {
        return '<div class="group">' + (many ? '<h3 class="group-title">' + esc(g.name) + '</h3>' : '') +
          '<div class="panel">' + tableHTML(g, fx) + '</div>' + legendHTML(g.zones) + '</div>';
      }).join('');
    } else {
      body = '<div class="panel">' + errorBox + (state.loading[c.id] ? skeletonHTML(single ? 12 : 6) : '') + '</div>';
    }

    return '<header class="comp-head">' +
        logoHTML(c, 'head-logo') +
        '<div class="comp-copy">' +
          '<p class="eyebrow">' + esc(c.region) + (d ? ' <span class="sep">·</span> ' + metaHTML(d) : '') +
            (liveCount ? ' <span class="sep">·</span> <span class="eyebrow-live">' + liveCount + ' live</span>' : '') + '</p>' +
          (single ? '<h1 class="comp-title">' : '<h2 class="comp-title">') + esc(c.name) + (single ? '</h1>' : '</h2>') +
          '<p class="comp-status">' + statusHTML(c, d) + '</p>' +
        '</div>' +
      '</header>' + body;
  }

  function sectionEl(id, cls) {
    var el = main.querySelector('section[data-comp="' + id + '"]');
    if (!el) {
      el = document.createElement('section');
      el.className = cls;
      el.setAttribute('data-comp', id);
      el.id = 'table-' + id;
      main.appendChild(el);
    }
    return el;
  }

  function renderSection(c) {
    if (tableComps().indexOf(c) === -1) return;
    sectionEl(c.id, 'comp').innerHTML = sectionHTML(c);
  }

  // ---------------------------------------------------------------- home rendering
  function matchHTML(e, showComp) {
    var c = byId[e.comp];
    var live = e.state === 'in', done = e.state === 'post';
    var centre = live || done ?
      '<span class="m-score' + (live ? ' is-live' : '') + '"><b>' + e.home.score + '</b><span class="m-dash">–</span><b>' + e.away.score + '</b></span>' :
      '<span class="m-time">' + esc(matchStatus(e)) + '</span>';
    return '<li class="match' + (live ? ' is-live' : done ? ' is-done' : ' is-pre') + '">' +
      '<span class="m-team m-home' + (e.home.winner ? ' is-winner' : '') + '"><span class="m-name"><span class="name-long">' + esc(e.home.name) + '</span><span class="name-short">' + esc(e.home.short) + '</span></span>' + crestHTML(e.home, 28) + '</span>' +
      centre +
      '<span class="m-team m-away' + (e.away.winner ? ' is-winner' : '') + '">' + crestHTML(e.away, 28) + '<span class="m-name"><span class="name-long">' + esc(e.away.name) + '</span><span class="name-short">' + esc(e.away.short) + '</span></span></span>' +
      '<span class="m-status">' + (live ? '<span class="live-pill">' + esc(matchStatus(e)) + '</span>' : done ? esc(matchStatus(e)) : (showComp ? '' : '&nbsp;')) +
        (showComp && c ? '<span class="m-comp" title="' + esc(c.name) + '">' + logoHTML(c, 'm-comp-logo') + '<span>' + esc(c.short) + '</span></span>' : '') + '</span>' +
      '</li>';
  }

  function groupHTML(c, events) {
    return '<div class="match-group" data-comp="' + c.id + '">' +
      '<h3 class="match-group-head">' + logoHTML(c, 'group-logo') + '<span>' + esc(c.name) + '</span>' +
        '<a class="group-link" href="#' + c.id + '" data-view="' + c.id + '">Table →</a></h3>' +
      '<ul class="matches">' + events.map(function (e) { return matchHTML(e, false); }).join('') + '</ul></div>';
  }

  function renderHome() {
    if (state.view !== HOME) return;
    var now = Date.now();
    var today = dayKey(now);
    var horizon = now + 7 * 864e5;
    var loaded = comps.filter(function (c) { return state.fx[c.id]; }).length;
    var failed = comps.filter(function (c) { return !state.fx[c.id] && state.fxError[c.id]; });

    var live = [], days = {}, dayOrder = [];
    comps.forEach(function (c) {
      var fx = state.fx[c.id];
      if (!fx) return;
      fx.events.forEach(function (e) {
        if (e.state === 'in') live.push(e);
        var key = dayKey(e.ts);
        if (key < today || e.ts > horizon) return;
        if (!days[key]) { days[key] = { ts: e.ts, comps: {} }; dayOrder.push(key); }
        (days[key].comps[c.id] = days[key].comps[c.id] || []).push(e);
      });
    });
    dayOrder.sort();
    live.sort(function (a, b) { return a.ts - b.ts; });

    var html = '<header class="comp-head home-head">' +
      '<span class="home-mark" aria-hidden="true"><svg viewBox="0 0 48 48" width="48" height="48"><circle cx="24" cy="24" r="21" fill="none" stroke="currentColor" stroke-width="3"/><path d="M24 3v8m0 26v8M3 24h8m26 0h8" stroke="currentColor" stroke-width="3" stroke-linecap="round"/><path d="M24 14l8.5 6.2-3.2 10H18.7l-3.2-10z" fill="currentColor"/></svg></span>' +
      '<div class="comp-copy"><p class="eyebrow">Match centre <span class="sep">·</span> ' + esc(new Date(now).toLocaleDateString([], { weekday: 'long', day: 'numeric', month: 'long' })) +
        (live.length ? ' <span class="sep">·</span> <span class="eyebrow-live">' + live.length + ' live</span>' : '') + '</p>' +
        '<h1 class="comp-title">' + (live.length ? 'Live now' : 'Matches') + '</h1>' +
        '<p class="comp-status">' + (loaded < comps.length && !failed.length ? '<span class="status status-loading"><span class="spinner"></span>Loading ' + loaded + '/' + comps.length + '…</span>' :
          '<span class="status status-live"><span class="live-dot"></span>Live <span class="ago" data-ts="' + now + '">just now</span></span>') +
          '<button type="button" class="refresh" data-refresh="home" aria-label="Refresh matches"><svg viewBox="0 0 24 24" width="14" height="14" aria-hidden="true"><path d="M20 12a8 8 0 1 1-2.34-5.66M20 4v5h-5"/></svg></button></p>' +
      '</div></header>';

    if (live.length) {
      html += '<div class="day-block day-live"><h2 class="day-title"><span class="live-pill">Live</span>In play</h2>' +
        '<div class="match-group match-group-mixed"><ul class="matches">' + live.map(function (e) { return matchHTML(e, true); }).join('') + '</ul></div></div>';
    }

    if (!days[today] && loaded) {
      html += '<div class="day-block"><h2 class="day-title">' + esc(dayLabel(now, true)) + '</h2><p class="empty">No matches today in these nine competitions.</p></div>';
    }

    dayOrder.forEach(function (key) {
      var day = days[key];
      html += '<div class="day-block"><h2 class="day-title">' + esc(dayLabel(day.ts, true)) + '</h2>' +
        comps.filter(function (c) { return day.comps[c.id]; }).map(function (c) {
          return groupHTML(c, day.comps[c.id].sort(function (a, b) { return a.ts - b.ts; }));
        }).join('') + '</div>';
    });

    if (failed.length) {
      html += '<div class="panel"><div class="error"><strong>Couldn’t load fixtures for ' + esc(failed.map(function (c) { return c.name; }).join(', ')) + '.</strong>' +
        '<button type="button" class="btn" data-refresh="home">Try again</button></div></div>';
    }
    if (!loaded && !failed.length) html += '<div class="panel">' + skeletonHTML(8) + '</div>';

    sectionEl(HOME, 'comp home').innerHTML = html;
  }

  function renderAll() {
    main.innerHTML = '';
    if (state.view === HOME) renderHome();
    else tableComps().forEach(function (c) { sectionEl(c.id, 'comp').innerHTML = sectionHTML(c); });
    document.body.setAttribute('data-comp', state.view);
    document.title = (state.view === HOME ? 'Matches' : state.view === ALL ? 'All tables' : byId[state.view].name + ' standings') + ' — Live tables';
  }

  function tickAgo() {
    var els = main.querySelectorAll('.ago');
    for (var i = 0; i < els.length; i++) els[i].textContent = fmtAgo(Number(els[i].getAttribute('data-ts')));
  }

  // ---------------------------------------------------------------- state changes
  function setView(id, fromHash) {
    if (id !== HOME && id !== ALL && !byId[id]) id = HOME;
    state.view = id;
    if (location.hash !== '#' + id) history.replaceState(null, '', '#' + id);
    renderNav();
    renderAll();
    refreshVisible(false);
    if (!fromHash) window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function setThemed(on, persist) {
    state.themed = !!on;
    document.body.classList.toggle('themed', state.themed);
    toggle.checked = state.themed;
    toggle.setAttribute('aria-checked', String(state.themed));
    if (persist) { try { localStorage.setItem(KEY_THEMED, state.themed ? '1' : '0'); } catch (e) { /* ignore */ } }
  }

  // ---------------------------------------------------------------- events
  document.addEventListener('click', function (ev) {
    var a = ev.target.closest('a[data-view]');
    if (a) { ev.preventDefault(); setView(a.getAttribute('data-view')); return; }
    var btn = ev.target.closest('[data-refresh]');
    if (btn) {
      var id = btn.getAttribute('data-refresh');
      if (id === 'home') refreshVisible(true);
      else if (byId[id]) { loadTable(byId[id]); loadFixtures(byId[id], true); }
    }
  });

  // Crest fallback: FootyLogos preview -> ESPN logo. Image errors don't bubble, so capture.
  main.addEventListener('error', function (ev) {
    var img = ev.target;
    if (!img || img.tagName !== 'IMG' || !img.classList.contains('crest')) return;
    var fb = img.getAttribute('data-fallback');
    if (fb && img.src !== fb) { img.src = fb; } else { img.classList.add('crest-missing'); }
  }, true);

  toggle.addEventListener('change', function () { setThemed(toggle.checked, true); });

  window.addEventListener('hashchange', function () {
    var id = location.hash.replace(/^#/, '') || HOME;
    if (id !== state.view) setView(id, true);
  });

  document.addEventListener('keydown', function (ev) {
    if (ev.target && /input|textarea|select/i.test(ev.target.tagName)) return;
    if (ev.key !== 'ArrowLeft' && ev.key !== 'ArrowRight') return;
    var order = [HOME].concat(comps.map(function (c) { return c.id; }), [ALL]);
    var i = order.indexOf(state.view);
    setView(order[(i + (ev.key === 'ArrowRight' ? 1 : -1) + order.length) % order.length]);
  });

  document.addEventListener('visibilitychange', function () {
    if (!document.hidden) { refreshVisible(false); tickAgo(); }
  });

  // Refresh loop: every minute, every 30s while something is in play.
  var lastRefresh = Date.now();
  setInterval(function () {
    if (document.hidden) return;
    var due = anyLive() ? LIVE_REFRESH_MS : REFRESH_MS;
    if (Date.now() - lastRefresh >= due - 500) { lastRefresh = Date.now(); refreshVisible(true); }
  }, 5 * 1000);
  setInterval(tickAgo, 15 * 1000);

  // ---------------------------------------------------------------- boot
  var themedPref = null;
  try { themedPref = localStorage.getItem(KEY_THEMED); } catch (e) { /* ignore */ }
  setThemed(themedPref === '1', false);

  // Show any cached snapshot instantly, then replace it with live data.
  comps.forEach(function (c) {
    var cached = readCache(c.id);
    if (cached && cached.table && cached.table.groups) { cached.stale = true; state.data[c.id] = cached; }
  });

  setView(location.hash.replace(/^#/, '') || HOME, true);
  refreshVisible(true);

  // Warm the other tables and fixtures in the background so switching is instant.
  window.setTimeout(function () {
    comps.forEach(function (c) {
      if (!state.data[c.id] || state.data[c.id].stale) loadTable(c);
      if (!state.fx[c.id]) loadFixtures(c, false);
    });
  }, 1500);
})();
