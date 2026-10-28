// 出発駅 → 到着駅の経路探索（乗り換えは1回まで）。
// 乗り換えは「同じ駅で乗り換え」と「徒歩でつながる駅へ歩いて乗り換え」（鶴見⇄京急鶴見、国道⇄花月総持寺など）。
window.Route = (() => {
  const T = window.Timetable;
  const N = window.NETWORK;
  const SAME_STATION_CHANGE = 1; // 同じ駅での乗り換えにかかる分

  // 走ったときの乗り換え時間（歩きの6割、最低1分）
  const runMin = (walk) => Math.max(1, Math.round(walk * 0.6));

  // 徒歩でつながる駅 [{id, min, walkId}]
  function links(id, walkMin) {
    const out = [];
    for (const w of N.walks) {
      if (w.from === id) out.push({ id: w.to, min: walkMin(w), walkId: w.id });
      if (w.to === id) out.push({ id: w.from, min: walkMin(w), walkId: w.id });
    }
    return out;
  }

  // 列車 trip の i 番目の停車駅より後で、targets（駅ID → 降りた後の徒歩分）のどれかに止まるなら最初の一つ
  function alightAt(trip, i, targets) {
    for (let k = i + 1; k < trip.stops.length; k++) {
      const s = trip.stops[k];
      if (!s.pass && targets.has(s.id)) return { k, id: s.id, t: s.arr + (trip.delay || 0), walk: targets.get(s.id) };
    }
    return null;
  }

  // ride: {trip, i(乗車), k(降車), from, to, dep, arr}
  const ride = (trip, i, a) => ({
    kind: 'ride', trip, from: trip.stops[i].id, to: a.id,
    dep: trip.stops[i].dep + (trip.delay || 0), arr: a.t,
  });

  function search(from, to, t0, { walkMin = (w) => w.minutes, limit = 4 } = {}) {
    if (!from || !to || from === to) return [];
    // 出発：その駅から、または歩いて行ける駅から
    const starts = [{ id: from, t: t0, walk: null }, ...links(from, walkMin).map(l => ({ id: l.id, t: t0 + l.min, walk: { from, to: l.id, min: l.min } }))];
    // 到着：その駅、または歩いて行ける駅で降りる
    const targets = new Map([[to, 0], ...links(to, walkMin).filter(l => l.id !== from).map(l => [l.id, l.min])]);
    const results = [];

    const finish = (legs, lastArrStation, lastArr, walkAfter) => {
      const all = [...legs];
      if (walkAfter) all.push({ kind: 'walk', from: lastArrStation, to, min: walkAfter, t: lastArr });
      const firstRide = all.find(l => l.kind === 'ride');
      const start = all[0].kind === 'walk' ? firstRide.dep - all[0].min : firstRide.dep;
      results.push({ start, end: lastArr + (walkAfter || 0), legs: all, rides: all.filter(l => l.kind === 'ride').length });
    };

    for (const st of starts) {
      const pre = st.walk ? [{ kind: 'walk', ...st.walk }] : [];
      for (const a of T.departures(st.id, st.t, () => true, 10)) {
        // 直通
        const direct = alightAt(a.trip, a.index, targets);
        if (direct) finish([...pre, ride(a.trip, a.index, direct)], direct.id, direct.t, direct.walk);
        // 乗り換え1回
        for (let k = a.index + 1; k < a.trip.stops.length; k++) {
          const x = a.trip.stops[k];
          if (x.pass || targets.has(x.id)) continue;
          const tx = x.arr + (a.trip.delay || 0);
          const changes = [{ id: x.id, min: SAME_STATION_CHANGE, walk: null }, ...links(x.id, walkMin).map(l => ({ id: l.id, min: l.min, walk: l }))];
          for (const c of changes) {
            const ready = tx + c.min;
            const okB = (trip, i) => trip !== a.trip && !!alightAt(trip, i, targets);
            const b = T.departures(c.id, ready, okB, 1)[0];
            if (!b) continue;
            const end = alightAt(b.trip, b.index, targets);
            const first = ride(a.trip, a.index, { id: x.id, t: tx });
            const legs = [...pre, first];
            if (c.walk) legs.push({ kind: 'walk', from: x.id, to: c.id, min: c.min, t: tx });
            const second = ride(b.trip, b.index, end);
            second.wait = b.dep - ready;
            // 歩く乗り換えで、走れば一本前に乗れるか
            if (c.walk) {
              const run = runMin(c.min);
              const r = run < c.min && T.departures(c.id, tx + run, okB, 1)[0];
              if (r && r.dep < b.dep) {
                const rEnd = alightAt(r.trip, r.index, targets);
                second.runOpt = { run, dep: r.dep, trip: r.trip, end: rEnd.t + (rEnd.walk || 0) };
              }
            }
            legs.push(second);
            finish(legs, end.id, end.t, end.walk);
          }
        }
      }
    }

    // 早く着く順。同じ到着なら遅く出られる方、乗り換えが少ない方。
    results.sort((x, y) => x.end - y.end || y.start - x.start || x.rides - y.rides);
    const kept = [];
    for (const r of results) {
      // ほかの案より「出発が早いのに到着は同じか遅い」ものは省く
      const sig = (x) => x.legs.filter(l => l.kind === 'ride').map(l => l.from + l.to).join();
      if (kept.some(k => k.end <= r.end && k.start >= r.start && (k.end < r.end || k.start > r.start || sig(k) === sig(r)))) continue;
      kept.push(r);
      if (kept.length >= limit) break;
    }
    return kept;
  }

  return { search, runMin };
})();
