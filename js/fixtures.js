/* Fixtures, results and live scores — from ESPN's month-by-month scoreboard feed
   (…/soccer/{league}/scoreboard?dates=YYYYMM). One compact, cached copy per league-month:
   months already over are kept for a day, the current month is re-fetched every refresh,
   next month every few hours. From those events we derive each team's last-five form, its
   next (or in-play) match, and the day-by-day match list the Home tab shows. */
window.Fixtures = (function () {
  'use strict';

  var API = 'https://site.api.espn.com/apis/site/v2/sports/soccer/';
  var KEY = 'standings.fixtures.v1.';
  var TTL_PAST = 24 * 3600e3;
  var TTL_CURRENT = 45e3;
  var TTL_FUTURE = 6 * 3600e3;

  var mem = {};        // "league|yyyymm" -> { fetchedAt, events }
  var inflight = {};

  function ym(date) { return date.getUTCFullYear() * 100 + date.getUTCMonth() + 1; }
  function addMonths(yyyymm, n) {
    var y = Math.floor(yyyymm / 100), m = (yyyymm % 100) - 1 + n;
    y += Math.floor(m / 12); m = ((m % 12) + 12) % 12;
    return y * 100 + m + 1;
  }
  // European seasons run July–June; July of the season's first year.
  function seasonStart(now) {
    var y = now.getUTCFullYear();
    return now.getUTCMonth() + 1 >= 7 ? y * 100 + 7 : (y - 1) * 100 + 7;
  }
  function ttlFor(month, current) {
    return month < current ? TTL_PAST : month === current ? TTL_CURRENT : TTL_FUTURE;
  }

  function side(c) {
    var t = c.team || {};
    return {
      id: String(t.id || c.id),
      name: t.displayName || t.name || '',
      short: t.shortDisplayName || t.name || '',
      abbr: t.abbreviation || '',
      logo: t.logo || '',
      score: c.score == null ? null : Number(c.score),
      winner: !!c.winner
    };
  }

  function compact(e) {
    var comp = (e.competitions && e.competitions[0]) || {};
    var status = (comp.status || e.status || {});
    var type = status.type || {};
    var home = null, away = null;
    (comp.competitors || []).forEach(function (c) { if (c.homeAway === 'away') away = side(c); else home = side(c); });
    if (!home || !away) return null;
    return {
      id: String(e.id),
      ts: Date.parse(e.date),
      state: type.state || 'pre',                // pre | in | post
      completed: !!type.completed,
      statusName: type.name || '',
      detail: type.shortDetail || type.detail || '',
      clock: status.displayClock || '',
      period: status.period || 0,
      timeValid: comp.timeValid !== false,
      phase: (e.season && e.season.slug) || '',
      home: home,
      away: away
    };
  }

  function readStore(key) {
    try { var raw = localStorage.getItem(KEY + key); return raw ? JSON.parse(raw) : null; } catch (err) { return null; }
  }
  function writeStore(key, entry) {
    try { localStorage.setItem(KEY + key, JSON.stringify(entry)); } catch (err) { /* quota / private mode */ }
  }

  function fetchMonth(league, month, force) {
    var key = league + '|' + month;
    var now = Date.now();
    var entry = mem[key] || readStore(key);
    if (entry) mem[key] = entry;
    if (entry && !force && now - entry.fetchedAt < ttlFor(month, ym(new Date(now)))) return Promise.resolve(entry.events);
    if (inflight[key]) return inflight[key];

    inflight[key] = fetch(API + league + '/scoreboard?dates=' + month + '&limit=1000&_=' + now, { cache: 'no-store' })
      .then(function (res) { if (!res.ok) throw new Error('HTTP ' + res.status); return res.json(); })
      .then(function (json) {
        var events = (json.events || []).map(compact).filter(Boolean);
        mem[key] = { fetchedAt: Date.now(), events: events };
        writeStore(key, mem[key]);
        return events;
      })
      .catch(function (err) {
        if (entry) return entry.events;          // keep the last good copy
        throw err;
      })
      .then(function (events) { delete inflight[key]; return events; },
            function (err) { delete inflight[key]; throw err; });
    return inflight[key];
  }

  // Everything known about one competition this season. `force` re-fetches the current
  // month regardless of TTL (used by the live refresh loop); other months honour theirs.
  function load(comp, force) {
    var now = new Date();
    var current = ym(now);
    var months = [];
    for (var m = seasonStart(now); m <= addMonths(current, 1); m = addMonths(m, 1)) months.push(m);

    return Promise.all(months.map(function (m) {
      return fetchMonth(comp.espn, m, force && m === current).catch(function () { return []; });
    })).then(function (lists) {
      var seen = {}, events = [];
      lists.forEach(function (list) {
        list.forEach(function (e) { if (!seen[e.id]) { seen[e.id] = true; events.push(e); } });
      });
      events.sort(function (a, b) { return a.ts - b.ts; });
      return derive(comp, events);
    });
  }

  function result(e, teamId) {
    var us = e.home.id === teamId ? e.home : e.away;
    var them = e.home.id === teamId ? e.away : e.home;
    if (us.score == null || them.score == null) return null;
    return us.score > them.score ? 'W' : us.score < them.score ? 'L' : 'D';
  }

  function derive(comp, events) {
    var now = Date.now();
    var form = {}, next = {}, live = [];

    events.forEach(function (e) {
      e.comp = comp.id;
      var isQualifier = /qualif|preliminary|play-?off round/i.test(e.phase);
      [e.home.id, e.away.id].forEach(function (id) {
        if (e.completed && !isQualifier) {
          var r = result(e, id);
          if (r) {
            (form[id] = form[id] || []).push({
              r: r, ts: e.ts,
              home: e.home.id === id,
              opp: e.home.id === id ? e.away : e.home,
              score: (e.home.id === id ? e.home.score : e.away.score) + '–' + (e.home.id === id ? e.away.score : e.home.score)
            });
          }
        }
        // In-play beats everything; otherwise the earliest match still to come (postponed
        // games sit in "post" without being completed and are skipped).
        var candidate = e.state === 'in' || (e.state === 'pre' && e.ts > now - 3 * 3600e3);
        if (candidate) {
          var cur = next[id];
          if (!cur || (e.state === 'in' && cur.state !== 'in') || (cur.state !== 'in' && e.ts < cur.ts)) next[id] = e;
        }
      });
      if (e.state === 'in') live.push(e);
    });

    Object.keys(form).forEach(function (id) { form[id] = form[id].slice(-5); });
    return { comp: comp, events: events, form: form, next: next, live: live };
  }

  return { load: load };
})();
