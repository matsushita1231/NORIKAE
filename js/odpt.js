// ODPT（チャレンジ2026 API）からダイヤとリアルタイム位置を取ってきて、Timetable 用の列車データに変換する。
window.ODPT = (() => {
  const BASE = 'https://api-challenge.odpt.org/api/v4/';
  const N = window.NETWORK;
  const SERVICE_DAY_START = 3 * 60; // 3時より前は前日のダイヤとして扱う

  // 祝日（＋年末年始）。休日ダイヤ判定に使う。
  const HOLIDAYS = new Set([
    '2026-01-01', '2026-01-02', '2026-01-03', '2026-01-12', '2026-02-11', '2026-02-23', '2026-03-20', '2026-04-29',
    '2026-05-03', '2026-05-04', '2026-05-05', '2026-05-06', '2026-07-20', '2026-08-11', '2026-09-21', '2026-09-22',
    '2026-09-23', '2026-10-12', '2026-11-03', '2026-11-23', '2026-12-30', '2026-12-31',
    '2027-01-01', '2027-01-02', '2027-01-03', '2027-01-11', '2027-02-11', '2027-02-23', '2027-03-21', '2027-03-22',
    '2027-04-29', '2027-05-03', '2027-05-04', '2027-05-05', '2027-07-19', '2027-08-11', '2027-09-20', '2027-09-23',
    '2027-10-11', '2027-11-03', '2027-11-23', '2027-12-30', '2027-12-31',
  ]);

  const KQ_TYPES = {
    Local: '普通', Express: '急行', AirportExpress: 'エアポート急行', LimitedExpress: '特急',
    RapidLimitedExpress: '快特', AirportRapidLimitedExpress: 'エアポート快特', EveningWing: 'イブニング・ウィング',
    MorningWing: 'モーニング・ウィング', WingLimitedExpress: 'ウィング号',
  };
  const tail = (id) => (id || '').split(/[.:]/).pop();
  const typeName = (id) => KQ_TYPES[tail(id)] || (tail(id) === 'Local' ? '各駅停車' : tail(id));

  let token = '';
  const setToken = (t) => { token = (t || '').trim(); };
  const hasToken = () => !!token;

  async function get(path) {
    const url = `${BASE}${path}${path.includes('?') ? '&' : '?'}acl:consumerKey=${encodeURIComponent(token)}`;
    const r = await fetch(url);
    if (!r.ok) throw new Error(`${r.status} ${path.split('?')[0]}`);
    return r.json();
  }

  // ---- 時刻と運行日 ----
  const pad = (n) => String(n).padStart(2, '0');
  function serviceDay(date = new Date()) {
    const d = new Date(date);
    if (d.getHours() * 60 + d.getMinutes() < SERVICE_DAY_START) d.setDate(d.getDate() - 1);
    const key = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
    const dow = d.getDay();
    const holiday = dow === 0 || dow === 6 || HOLIDAYS.has(key);
    return { key, calendar: holiday ? 'SaturdayHoliday' : 'Weekday', midnight: new Date(d.getFullYear(), d.getMonth(), d.getDate()) };
  }
  // "HH:MM" → 運行日0時からの分（深夜は +24h）
  const toMin = (hhmm) => {
    if (!hhmm) return null;
    const [h, m] = hhmm.split(':').map(Number);
    const v = h * 60 + m;
    return v < SERVICE_DAY_START ? v + 1440 : v;
  };
  const nowMin = (date = new Date()) => (date - serviceDay(date).midnight) / 60000;

  // ---- キャッシュ（運行日ごと）----
  const cacheGet = (k) => { try { return JSON.parse(localStorage.getItem(k)); } catch (e) { return null; } };
  const cacheSet = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* 容量超過などは無視 */ } };

  // ---- 京急：駅順を取って、画面外の駅にも座標を割り振る ----
  let kqOrder = null; // [{odpt, title, id}]
  async function loadKeikyuOrder() {
    const cached = cacheGet('kqOrder.v1');
    let order = cached;
    if (!order) {
      const rail = await get('odpt:Railway?owl:sameAs=odpt.Railway:Keikyu.Main');
      order = (rail[0]['odpt:stationOrder'] || [])
        .sort((a, b) => a['odpt:index'] - b['odpt:index'])
        .map(s => ({ odpt: s['odpt:station'], title: (s['odpt:stationTitle'] || {}).ja }));
      cacheSet('kqOrder.v1', order);
    }
    const local = N.lines.keikyu.stations;
    const first = local[0], last = local[local.length - 1];
    const i0 = order.findIndex(s => s.title === first.name);
    const i1 = order.findIndex(s => s.title === last.name);
    const step = (last.y - first.y) / (local.length - 1);
    order.forEach((s, i) => {
      const hit = local.find(l => l.name === s.title);
      if (hit) { s.id = hit.id; return; }
      s.id = `kq-x-${tail(s.odpt)}`;
      const y = i < i0 ? first.y - (i0 - i) * step : last.y + (i - i1) * step;
      N.byId[s.id] = { id: s.id, name: s.title, x: first.x, y, line: 'keikyu', offscreen: true };
    });
    kqOrder = order;
    return order;
  }

  // 京急の駅時刻表を、種別・行先・時刻のつながりから列車ごとのダイヤに組み立てる
  function chainKeikyu(timetables, order, calendar) {
    const trips = [];
    const idx = Object.fromEntries(order.map((s, i) => [s.odpt, i]));
    for (const dir of ['Outbound', 'Inbound']) {
      const seq = order.filter(s => s.fetched);
      if (dir === 'Inbound') seq.reverse();
      const active = [];
      seq.forEach((st, k) => {
        const tt = timetables.find(t => t['odpt:station'] === st.odpt && tail(t['odpt:calendar']) === calendar && tail(t['odpt:railDirection']) === dir);
        if (!tt) return;
        const deps = (tt['odpt:stationTimetableObject'] || [])
          .map(o => ({ t: toMin(o['odpt:departureTime']), type: o['odpt:trainType'], dest: (o['odpt:destinationStation'] || [])[0] }))
          .filter(d => d.t != null)
          .sort((a, b) => a.t - b.t);
        const usedHere = new Set();
        for (const d of deps) {
          let best = null, bestGap = Infinity;
          for (const trip of active) {
            if (usedHere.has(trip) || trip.type !== d.type || trip.dest !== d.dest) continue;
            const gapSt = k - trip.lastK;
            const gap = d.t - trip.lastT;
            if (gap < 0.8 * gapSt || gap > 3.5 * gapSt + 2) continue;
            if (gap < bestGap) { best = trip; bestGap = gap; }
          }
          if (best) {
            best.stops.push({ id: st.id, arr: d.t - 0.5, dep: d.t });
            best.lastK = k; best.lastT = d.t; usedHere.add(best);
          } else {
            const trip = { type: d.type, dest: d.dest, dir, lastK: k, lastT: d.t, stops: [{ id: st.id, arr: d.t, dep: d.t }] };
            active.push(trip); trips.push(trip); usedHere.add(trip);
          }
        }
      });
      // 終点が範囲内にある列車は、終点への到着を足す
      for (const trip of trips.filter(t => t.dir === dir)) {
        const destIdx = idx[trip.dest];
        const lastIdx = idx[order.find(s => s.id === trip.stops[trip.stops.length - 1].id)?.odpt];
        if (destIdx == null || lastIdx == null || destIdx === lastIdx) continue;
        const destSt = order[destIdx];
        if (!destSt.fetched) continue;
        const hops = Math.abs(destIdx - lastIdx);
        trip.stops.push({ id: destSt.id, arr: trip.lastT + hops * 2, dep: trip.lastT + hops * 2 });
      }
    }
    return trips.filter(t => t.stops.length >= 2).map((t, i) => ({
      id: `kq-${calendar}-${t.dir}-${i}`,
      line: 'keikyu',
      type: typeName(t.type),
      typeKey: tail(t.type),
      dest: destTitle(t.dest),
      dir: t.dir === 'Outbound' ? 'down' : 'up',
      stops: t.stops.map(s => ({ ...s, pass: false })),
      delay: 0,
      source: 'timetable',
    }));
  }

  const DEST_JA = {
    Uraga: '浦賀', Misakiguchi: '三崎口', ZushiHayama: '逗子・葉山', KeikyuKurihama: '京急久里浜', KanazawaBunko: '金沢文庫',
    KanazawaHakkei: '金沢八景', Kamiooka: '上大岡', Yokohama: '横浜', KanagawaShimmachi: '神奈川新町', Shinagawa: '品川',
    Sengakuji: '泉岳寺', KeikyuKamata: '京急蒲田', KeikyuKawasaki: '京急川崎', HanedaAirportTerminal1and2: '羽田空港',
    HanedaAirportTerminal3: '羽田空港第3', Horinouchi: '堀ノ内', Oshiage: '押上', Aoto: '青砥', InbaNihonIdai: '印旛日本医大',
    NaritaAirportTerminal1: '成田空港', ShibayamaChiyoda: '芝山千代田', Nishimagome: '西馬込', KeiseiTakasago: '京成高砂',
    Tsurumi: '鶴見', Ogimachi: '扇町', HamaKawasaki: '浜川崎', UmiShibaura: '海芝浦', MusashiShiraishi: '武蔵白石',
    Okawa: '大川', Bentembashi: '弁天橋',
  };
  function destTitle(id) {
    const t = tail(id);
    if (DEST_JA[t]) return DEST_JA[t];
    const hit = (kqOrder || []).find(s => s.odpt === id);
    return hit ? hit.title : t;
  }

  async function loadKeikyuTrips(day) {
    const key = `kqTrips.v1.${day.key}`;
    const cached = cacheGet(key);
    const order = await loadKeikyuOrder();
    if (cached) return cached;
    // 表示範囲の前後数駅（近づいてくる列車がわかる範囲）まで取る
    const iA = order.findIndex(s => s.id === N.lines.keikyu.stations[0].id);
    const iB = order.findIndex(s => s.id === N.lines.keikyu.stations.at(-1).id);
    const target = order.slice(Math.max(0, iA - 4), iB + 5);
    target.forEach(s => { s.fetched = true; });
    const results = await Promise.all(target.map(s => get(`odpt:StationTimetable?odpt:station=${s.odpt}`).catch(() => [])));
    const trips = chainKeikyu(results.flat(), order, day.calendar);
    cacheSet(key, trips);
    return trips;
  }

  // ---- 鶴見線：列車時刻表をそのまま使う ----
  const JT_IDS = Object.fromEntries(N.lines.tsurumi.stations.map(s => [s.odpt.toLowerCase(), s.id]));
  const jtId = (odptId) => JT_IDS[tail(odptId).toLowerCase()];
  // 支線駅が時刻表に載っていない場合に外挿するための所要分
  const BRANCH = {
    'jt-umishibaura': [['jt-shinshibaura', 2], ['jt-umishibaura', 4]],
    'jt-okawa': [['jt-okawa', 3]],
  };

  async function loadTsurumiTrips(day) {
    const key = `jtTrips.v1.${day.key}`;
    const cached = cacheGet(key);
    if (cached) return cached;
    const data = await get('odpt:TrainTimetable?odpt:railway=odpt.Railway:JR-East.Tsurumi');
    const trips = [];
    for (const t of data) {
      if (tail(t['odpt:calendar']) !== day.calendar) continue;
      const stops = [];
      for (const o of t['odpt:trainTimetableObject'] || []) {
        const sid = jtId(o['odpt:departureStation'] || o['odpt:arrivalStation']);
        if (!sid) continue;
        const arr = toMin(o['odpt:arrivalTime'] || o['odpt:departureTime']);
        const dep = toMin(o['odpt:departureTime'] || o['odpt:arrivalTime']);
        const prev = stops[stops.length - 1];
        if (prev && prev.id === sid) { prev.dep = dep; continue; }
        stops.push({ id: sid, arr, dep, pass: false });
      }
      if (!stops.length) continue;
      const dest = jtId((t['odpt:destinationStation'] || [])[0]);
      const origin = jtId((t['odpt:originStation'] || [])[0]);
      // 行先が支線なのに支線駅が無い → 浅野／安善から外挿
      if (BRANCH[dest] && stops.at(-1).id !== dest) {
        const base = stops.at(-1);
        for (const [sid, m] of BRANCH[dest]) stops.push({ id: sid, arr: base.dep + m, dep: base.dep + m, pass: false });
      }
      if (BRANCH[origin] && stops[0].id !== origin) {
        // 支線の終点ほど早い時刻になるよう、遠い駅から順に前へ足す
        const base = stops[0];
        const pre = [...BRANCH[origin]].reverse().map(([sid, m]) => ({ id: sid, arr: base.arr - m, dep: base.arr - m, pass: false }));
        stops.unshift(...pre);
      }
      if (stops.length < 2) continue;
      trips.push({
        id: `jt-${t['odpt:trainNumber']}`,
        trainNumber: t['odpt:trainNumber'],
        line: 'tsurumi',
        type: '各駅停車',
        dest: destTitle((t['odpt:destinationStation'] || [])[0]),
        origin: origin,
        dir: tail(t['odpt:railDirection']) === 'Inbound' ? 'up' : 'down',
        stops,
        delay: 0,
        source: 'timetable',
      });
    }
    cacheSet(key, trips);
    return trips;
  }

  // ---- 京急リアルタイム：列車位置から遅れを推定 ----
  const kqIdByOdpt = (odptId) => (kqOrder || []).find(s => s.odpt === odptId)?.id;
  const matches = {}; // trainNumber → tripId（一度対応づけた列車は継続して使う）

  // 列車 trip が駅 a〜b 間（b が無ければ a に停車中）にいるはずの時刻（ダイヤ上）
  function scheduledTimeAt(trip, aId, bId) {
    const s = trip.stops;
    const ia = s.findIndex(x => x.id === aId);
    if (bId == null) {
      if (ia >= 0) return (s[ia].arr + s[ia].dep) / 2;
      return passTime(trip, aId);
    }
    const ta = ia >= 0 ? s[ia].dep : passTime(trip, aId);
    const ib = s.findIndex(x => x.id === bId);
    const tb = ib >= 0 ? s[ib].arr : passTime(trip, bId);
    if (ta == null || tb == null || tb < ta) return null;
    return (ta + tb) / 2;
  }
  // 通過駅の通過時刻を前後の停車駅から内分で求める
  function passTime(trip, sid) {
    const y = N.byId[sid]?.y;
    if (y == null) return null;
    const s = trip.stops;
    for (let i = 0; i < s.length - 1; i++) {
      const ya = N.byId[s[i].id].y, yb = N.byId[s[i + 1].id].y;
      if ((y - ya) * (y - yb) <= 0 && ya !== yb) return s[i].dep + (s[i + 1].arr - s[i].dep) * (y - ya) / (yb - ya);
    }
    return null;
  }

  async function applyKeikyuLive(trips, now) {
    const live = await get('odpt:Train?odpt:operator=odpt.Operator:Keikyu');
    const kq = trips.filter(t => t.line === 'keikyu');
    kq.forEach(t => { t.live = null; });
    const unmatched = [];
    let updated = null;
    for (const tr of live) {
      if (tail(tr['odpt:railway']) !== 'Main') continue;
      updated = tr['dc:date'];
      const a = kqIdByOdpt(tr['odpt:fromStation']);
      const b = tr['odpt:toStation'] ? kqIdByOdpt(tr['odpt:toStation']) : null;
      if (!a) continue;
      const dir = tail(tr['odpt:railDirection']) === 'Outbound' ? 'down' : 'up';
      const typeKey = tail(tr['odpt:trainType']);
      const no = tr['odpt:trainNumber'];
      let best = null, bestScore = Infinity, bestDelay = 0;
      for (const trip of kq) {
        if (trip.dir !== dir || trip.typeKey !== typeKey || (trip.live && trip.live.no !== no)) continue;
        const sched = scheduledTimeAt(trip, a, b);
        if (sched == null) continue;
        const delay = now - sched;
        if (delay < -2.5 || delay > 90) continue;
        const score = Math.abs(delay) - (matches[no] === trip.id ? 5 : 0);
        if (score < bestScore) { best = trip; bestScore = score; bestDelay = delay; }
      }
      const info = { no, from: a, to: b, typeKey };
      if (best) {
        best.delay = Math.max(0, Math.round(bestDelay * 2) / 2);
        best.live = info;
        best.source = 'live';
        matches[no] = best.id;
      } else if (N.byId[a] && !N.byId[a].offscreen) {
        unmatched.push({ ...info, dir, type: typeName(tr['odpt:trainType']) });
      }
    }
    return { updated, unmatched };
  }

  return { setToken, hasToken, serviceDay, nowMin, toMin, loadKeikyuTrips, loadTsurumiTrips, applyKeikyuLive };
})();
