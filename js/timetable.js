// ダイヤ（列車ごとの停車駅と時刻）と、そこから位置・発車を求める関数群。
// 時刻は「その日の0時からの分」。深夜帯は24時以降として扱う。
// 本物の時刻表データが取れるまでは、それっぽいデモダイヤを生成して使う。
window.Timetable = (() => {
  const N = window.NETWORK;
  const KQ = N.lines.keikyu.stations.map(s => s.id);

  const range = (from, to, step) => { const a = []; for (let t = from; t <= to; t += step) a.push(t); return a; };

  // stopsAt: 停車する駅IDの集合（null なら全駅停車）。hop: 1駅あたりの所要分（通過は短め）。
  function buildTrip({ id, line, type, dest, dir, path, start, stopsAt = null, hop = 2, passHop = 1.3, dwell = 0.5 }) {
    const stops = [];
    let t = start;
    path.forEach((sid, i) => {
      const stop = !stopsAt || stopsAt.has(sid) || i === 0 || i === path.length - 1;
      const arr = t;
      const dep = stop && i < path.length - 1 && i > 0 ? t + dwell : t;
      stops.push({ id: sid, arr, dep, pass: !stop });
      if (i < path.length - 1) {
        const nextStop = !stopsAt || stopsAt.has(path[i + 1]);
        t = dep + (stop && nextStop ? hop : passHop);
      }
    });
    return { id, line, type, dest, dir, stops, delay: 0, source: 'demo' };
  }

  function demoTrips() {
    const trips = [];
    const down = KQ;                 // 川崎 → 横浜（下り）
    const up = [...KQ].reverse();    // 横浜 → 川崎（上り）
    const express = new Set(['kq-kawasaki', 'kq-tsurumi', 'kq-shinmachi', 'kq-yokohama']);
    const limited = new Set(['kq-kawasaki', 'kq-yokohama']);

    for (const t of range(5 * 60 + 2, 24 * 60 + 32, 10)) {
      trips.push(buildTrip({ id: `kq-l-d-${t}`, line: 'keikyu', type: '普通', dest: '浦賀', dir: 'down', path: down, start: t }));
      trips.push(buildTrip({ id: `kq-l-u-${t}`, line: 'keikyu', type: '普通', dest: '品川', dir: 'up', path: up, start: t + 3 }));
    }
    for (const t of range(5 * 60 + 30, 23 * 60 + 50, 10)) {
      trips.push(buildTrip({ id: `kq-lx-d-${t}`, line: 'keikyu', type: '快特', dest: '三崎口', dir: 'down', path: down, start: t, stopsAt: limited, passHop: 1 }));
      trips.push(buildTrip({ id: `kq-lx-u-${t}`, line: 'keikyu', type: '快特', dest: '泉岳寺', dir: 'up', path: up, start: t + 6, stopsAt: limited, passHop: 1 }));
    }
    for (const t of range(6 * 60 + 7, 23 * 60 + 7, 20)) {
      trips.push(buildTrip({ id: `kq-ex-d-${t}`, line: 'keikyu', type: '急行', dest: '逗子・葉山', dir: 'down', path: down, start: t, stopsAt: express, passHop: 1.2 }));
      trips.push(buildTrip({ id: `kq-ex-u-${t}`, line: 'keikyu', type: '急行', dest: '羽田空港', dir: 'up', path: up, start: t + 9, stopsAt: express, passHop: 1.2 }));
    }

    const T = ['jt-tsurumi', 'jt-kokudo', 'jt-tsurumiono', 'jt-bentembashi', 'jt-asano'];
    const toOgi = [...T, 'jt-anzen', 'jt-musashishiraishi', 'jt-hamakawasaki', 'jt-showa', 'jt-ogimachi'];
    const toHama = [...T, 'jt-anzen', 'jt-musashishiraishi', 'jt-hamakawasaki'];
    const toUmi = [...T, 'jt-shinshibaura', 'jt-umishibaura'];
    const toOkawa = [...T, 'jt-anzen', 'jt-okawa'];
    const ts = (id, dest, path, start, dir) =>
      buildTrip({ id, line: 'tsurumi', type: '各駅停車', dest, dir, path, start, hop: 2, dwell: 0.5 });

    for (const h of range(5, 23, 1)) {
      const m = h * 60;
      trips.push(ts(`jt-o-d-${m}`, '扇町', toOgi, m + 2, 'down'));
      trips.push(ts(`jt-h-d-${m}`, '浜川崎', toHama, m + 22, 'down'));
      trips.push(ts(`jt-u-d-${m}`, '海芝浦', toUmi, m + 40, 'down'));
      trips.push(ts(`jt-o-u-${m}`, '鶴見', [...toOgi].reverse(), m + 28, 'up'));
      trips.push(ts(`jt-h-u-${m}`, '鶴見', [...toHama].reverse(), m + 47, 'up'));
      trips.push(ts(`jt-u-u-${m}`, '鶴見', [...toUmi].reverse(), m + 58, 'up'));
      if ((h >= 7 && h <= 9) || (h >= 17 && h <= 19)) {
        trips.push(ts(`jt-o2-d-${m}`, '扇町', toOgi, m + 12, 'down'));
        trips.push(ts(`jt-u2-d-${m}`, '海芝浦', toUmi, m + 30, 'down'));
        trips.push(ts(`jt-o2-u-${m}`, '鶴見', [...toOgi].reverse(), m + 8, 'up'));
        trips.push(ts(`jt-u2-u-${m}`, '鶴見', [...toUmi].reverse(), m + 18, 'up'));
      }
    }
    for (const m of [7 * 60 + 15, 8 * 60 + 15, 17 * 60 + 35, 18 * 60 + 35]) {
      trips.push(ts(`jt-k-d-${m}`, '大川', toOkawa, m, 'down'));
      trips.push(ts(`jt-k-u-${m}`, '鶴見', [...toOkawa].reverse(), m + 16, 'up'));
    }
    return trips;
  }

  let trips = demoTrips();
  const setTrips = (list) => { trips = list; };
  const getTrips = () => trips;

  const at = (stop, key, trip) => stop[key] + (trip.delay || 0);
  const firstDep = (trip) => at(trip.stops[0], 'dep', trip);
  const lastArr = (trip) => at(trip.stops[trip.stops.length - 1], 'arr', trip);
  const ease = (f) => f < 0.5 ? 2 * f * f : 1 - Math.pow(-2 * f + 2, 2) / 2;

  // 時刻 t における列車の位置。{x, y, angle, atStation, from, to}
  function position(trip, t) {
    if (t < firstDep(trip) - 1 || t > lastArr(trip) + 0.5) return null;
    const s = trip.stops;
    for (let i = 0; i < s.length; i++) {
      const a = N.byId[s[i].id];
      if (t <= at(s[i], 'dep', trip) && (i === 0 || t >= at(s[i], 'arr', trip))) {
        const angle = s[i + 1] ? N.pointAt(s[i].id, s[i + 1].id, 0).angle : N.pointAt(s[i - 1].id, s[i].id, 1).angle;
        return { x: a.x, y: a.y, angle, atStation: s[i].id, from: s[i].id, to: s[i + 1]?.id || null };
      }
      if (i < s.length - 1 && t > at(s[i], 'dep', trip) && t < at(s[i + 1], 'arr', trip)) {
        const f = ease((t - at(s[i], 'dep', trip)) / (at(s[i + 1], 'arr', trip) - at(s[i], 'dep', trip)));
        const q = N.pointAt(s[i].id, s[i + 1].id, f);
        return { x: q.x, y: q.y, angle: q.angle, atStation: null, from: s[i].id, to: s[i + 1].id };
      }
    }
    return null;
  }

  // 駅 stationId を時刻 t 以降に発車（停車）する列車。filter(trip, stopIndex) で絞り込み。
  function departures(stationId, t, filter = () => true, limit = 5) {
    const out = [];
    for (const trip of trips) {
      const i = trip.stops.findIndex(s => s.id === stationId && !s.pass);
      if (i < 0 || i === trip.stops.length - 1) continue;
      const dep = at(trip.stops[i], 'dep', trip);
      if (dep >= t && filter(trip, i)) out.push({ trip, index: i, dep });
    }
    return out.sort((a, b) => a.dep - b.dep).slice(0, limit);
  }

  const arrivalAt = (trip, stationId) => {
    const s = trip.stops.find(x => x.id === stationId && !x.pass);
    return s ? at(s, 'arr', trip) : null;
  };
  const stopsAfter = (trip, i, stationId) => trip.stops.slice(i + 1).some(s => s.id === stationId && !s.pass);

  return { position, departures, arrivalAt, stopsAfter, getTrips, setTrips, demoTrips };
})();
