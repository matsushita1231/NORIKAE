(() => {
  const N = window.NETWORK;
  const T = window.Timetable;
  const O = window.ODPT;
  const SVGNS = 'http://www.w3.org/2000/svg';
  const $ = (s) => document.querySelector(s);

  // ---- 設定 ----
  const store = {
    get(k, d) { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (e) { return d; } },
    set(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* 保存できなくても動かす */ } },
  };
  const settings = {
    ctoken: store.get('odptChallengeToken', ''),
    walkTsurumi: Number(store.get('walkTsurumi', 4)),
    walkKokudo: Number(store.get('walkKokudo', 5)),
    meetTime: store.get('meetTime', '19:00'),
    shopWalk: Number(store.get('shopWalk', 3)),
    friendName: store.get('friendName', ''),
  };

  const state = {
    offset: 0,          // スライダーの分
    from: store.get('from', 'kq-koyasu'),
    to: store.get('to', ''),
    dir: 'all',         // 方面の絞り込み（到着駅を指定しないとき）
    meet: false,        // 待ち合わせ画面
    picked: null,       // 選択中の列車ID
    mode: 'demo',       // demo | timetable | live
    liveUpdated: null,
    highlight: new Set(),
    geo: null,          // {lat, lon, list:[{id, dist, walk}]}
  };

  // ---- 時刻ユーティリティ ----
  const nowMin = () => O.nowMin(new Date());
  const viewMin = () => nowMin() + state.offset;
  const fmt = (m) => {
    const v = ((Math.round(m) % 1440) + 1440) % 1440;
    return `${Math.floor(v / 60)}:${String(v % 60).padStart(2, '0')}`;
  };
  const el = (tag, attrs = {}, parent) => {
    const e = document.createElementNS(SVGNS, tag);
    for (const [k, v] of Object.entries(attrs)) e.setAttribute(k, v);
    if (parent) parent.appendChild(e);
    return e;
  };
  const color = (line) => N.lines[line].color;
  const name = (id) => N.byId[id]?.name || id;
  const walkMin = (w) => w.id === 'walk-tsurumi' ? settings.walkTsurumi : w.id === 'walk-kokudo' ? settings.walkKokudo : w.minutes;

  // ---- 地図（背景・線・駅）----
  function drawStatic() {
    const bg = $('#layer-bg');
    bg.innerHTML = '';
    // 京浜運河と東京湾をゆるく
    const sea = 'M215 900 L 215 700 C 225 560, 250 500, 300 490 S 370 400, 398 360 S 420 270, 430 250 L 445 -300 L 1400 -300 L 1400 900 Z';
    el('path', { d: sea, fill: 'var(--sea)' }, bg);
    el('path', { d: sea, fill: 'url(#waves)', opacity: .7 }, bg);
    const deco = [
      ['⛩️', 36, 330, '總持寺'], ['🏠', 36, 484, 'おうち'], ['🏭', 232, 452, 'しごと'],
      ['🌊', 370, 600, ''], ['🚢', 320, 640, ''], ['🏗️', 392, 300, ''],
    ];
    for (const [e, x, y0, label] of deco) {
      const y = N.squeeze(y0);
      const g = el('g', { opacity: .9 }, bg);
      el('text', { x, y, 'font-size': 16, 'text-anchor': 'middle' }, g).textContent = e;
      if (label) el('text', { x, y: y + 12, 'text-anchor': 'middle', class: 'walk-label' }, g).textContent = label;
    }

    const lines = $('#layer-lines');
    lines.innerHTML = '';
    for (const seg of N.segments) {
      const pts = seg.path.flatMap((id, i) => i === 0 ? [N.byId[id]] : N.geom(seg.path[i - 1], id).slice(1)).map(p => `${p.x},${p.y}`).join(' ');
      if (seg.bus) {
        el('polyline', { points: pts, fill: 'none', stroke: color(seg.line), 'stroke-opacity': .85, 'stroke-width': 8, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, lines);
        el('polyline', { points: pts, fill: 'none', stroke: '#fff', 'stroke-width': 1.6, 'stroke-dasharray': '5 5', 'stroke-linecap': 'round' }, lines);
        continue;
      }
      el('polyline', { points: pts, fill: 'none', stroke: color(seg.line), 'stroke-width': 11, 'stroke-linecap': 'round', 'stroke-linejoin': 'round' }, lines);
      el('polyline', { points: pts, fill: 'none', stroke: '#fff', 'stroke-opacity': .35, 'stroke-width': 3, 'stroke-linecap': 'round', 'stroke-linejoin': 'round', transform: 'translate(-2,-2)' }, lines);
    }
    // 京急は表示範囲の外へも続いている感じを出す
    const kqs = N.lines.keikyu.stations;
    for (const [y1, y2] of [[kqs[0].y, kqs[0].y - 60], [kqs.at(-1).y, kqs.at(-1).y + 60]]) {
      el('line', { x1: 100, y1, x2: 100, y2, stroke: color('keikyu'), 'stroke-width': 11, 'stroke-dasharray': '2 16', 'stroke-linecap': 'round' }, lines);
    }

    const walks = $('#layer-walks');
    walks.innerHTML = '';
    for (const w of N.walks) {
      const a = N.byId[w.from], b = N.byId[w.to];
      el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: 'var(--sub)', 'stroke-width': w.quiet ? 2 : 3, 'stroke-opacity': w.quiet ? .5 : 1, 'stroke-dasharray': '1 6', 'stroke-linecap': 'round' }, walks);
      if (w.quiet) continue;
      el('text', { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 + (w.id === 'walk-kokudo' ? 14 : -7), 'text-anchor': 'middle', class: 'walk-label' }, walks).textContent = `🚶${walkMin(w)}分`;
    }

    const st = $('#layer-stations');
    const lab = $('#layer-labels');
    st.innerHTML = ''; lab.innerHTML = '';
    for (const line of Object.values(N.lines)) {
      for (const s of line.stations) {
        const r = s.major ? 7.5 : 5.5;
        if (line.bus) el('rect', { x: s.x - r + 1, y: s.y - r + 1, width: 2 * r - 2, height: 2 * r - 2, rx: 3, fill: '#fff', stroke: line.color, 'stroke-width': 3 }, st);
        else el('circle', { cx: s.x, cy: s.y, r, fill: '#fff', stroke: line.color, 'stroke-width': s.major ? 4 : 3, filter: s.major ? 'url(#soft)' : '' }, st);
        if (s.home || s.work || s.friend) el('circle', { cx: s.x, cy: s.y, r: 13, fill: 'none', stroke: s.friend ? line.color : 'var(--accent)', 'stroke-width': 2, 'stroke-dasharray': '3 3' }, st);
        const lp = s.lp || 'l';
        const pos = { l: [-22, 4, 'end'], r: [18, 4, 'start'], b: [0, 24, 'middle'], t: [0, -16, 'middle'] }[lp];
        el('text', { x: s.x + pos[0], y: s.y + pos[1], 'text-anchor': pos[2], class: `st-label${s.major ? '' : ' minor'}` }, lab).textContent = s.name;
        const hit = el('circle', { cx: s.x, cy: s.y, r: 15, fill: 'transparent', class: 'st-hit' }, st);
        hit.addEventListener('click', (e) => { e.stopPropagation(); if (!MapZoom.wasDrag()) chooseStation(s.id); });
      }
    }
    drawHere();
  }

  // 現在地の印（最寄り駅のそばに出す）
  function drawHere() {
    const lab = $('#layer-labels');
    lab.querySelector('.here')?.remove();
    if (!state.geo) return;
    const s = N.byId[state.geo.list[0].id];
    const g = el('g', { class: 'here', transform: `translate(${s.x},${s.y})` }, lab);
    el('circle', { r: 18, fill: '#3b82f6', opacity: .15, class: 'here-pulse' }, g);
    el('circle', { r: 5, fill: '#3b82f6', stroke: '#fff', 'stroke-width': 2 }, g);
  }

  // ---- 車両（上から見た形。進行方向に回転させる）----
  const SHORT = { '普通': '普', '各駅停車': '各', '急行': '急', 'エアポート急行': '急', '特急': '特', '快特': '快', 'エアポート快特': '快', '鶴08': '08' };
  const LIVERY = {
    keikyu: { body: '#e5171f', roof: '#c90f18', band: '#ffffff' },
    tsurumi: { body: '#dfe3e8', roof: '#c3c9d1', band: '#f6c200' },
    rinko: { body: '#ffffff', roof: '#e9efe9', band: '#2aa876' },
  };
  function car(g, x, len, lv, { front = false, back = false, pantograph = false } = {}) {
    // 車体（両端を少し丸く）＋ 屋根の帯 ＋ 前面ガラス
    el('rect', { x, y: -5, width: len, height: 10, rx: 2.5, fill: lv.body, stroke: 'rgba(0,0,0,.25)', 'stroke-width': .6 }, g);
    el('rect', { x: x + 1.5, y: -2.4, width: len - 3, height: 4.8, rx: 1.5, fill: lv.roof }, g);
    el('rect', { x, y: -5, width: len, height: 1.3, fill: lv.band, opacity: .95 }, g);
    el('rect', { x, y: 3.7, width: len, height: 1.3, fill: lv.band, opacity: .95 }, g);
    if (front) el('path', { d: `M${x + len - 2.2} -4 q2 4 0 8 h1.2 q1.6 -4 0 -8 z`, fill: '#26323d' }, g);
    if (back) el('path', { d: `M${x + 2.2} -4 q-2 4 0 8 h-1.2 q-1.6 -4 0 -8 z`, fill: '#26323d', opacity: .6 }, g);
    if (pantograph) el('path', { d: `M${x + len * .3} -2.2 l2.2 2.2 l-2.2 2.2 M${x + len * .3 + 4.4} -2.2 l-2.2 2.2 l2.2 2.2`, stroke: '#3b3340', 'stroke-width': .7, fill: 'none' }, g);
  }
  function vehicleShape(g, trip) {
    const lv = LIVERY[trip.line];
    el('circle', { r: 17, class: 'halo', fill: color(trip.line), 'fill-opacity': .25 }, g);
    const veh = el('g', { class: 'veh', filter: 'url(#soft)' }, g);
    if (trip.line === 'rinko') {
      el('rect', { x: -10, y: -5.2, width: 20, height: 10.4, rx: 3, fill: lv.body, stroke: 'rgba(0,0,0,.3)', 'stroke-width': .6 }, veh);
      el('rect', { x: -10, y: -5.2, width: 20, height: 1.6, rx: .8, fill: lv.band }, veh);
      el('rect', { x: -10, y: 3.6, width: 20, height: 1.6, rx: .8, fill: lv.band }, veh);
      el('rect', { x: -4, y: -2.6, width: 7, height: 5.2, rx: 1, fill: '#cfd8d3' }, veh); // 屋根のエアコン
      el('path', { d: 'M8 -4.2 q2.2 4.2 0 8.4 h1 q1.6 -4.2 0 -8.4 z', fill: '#26323d' }, veh);
    } else {
      const lead = trip.line === 'keikyu' ? 2 : 2;
      const len = 15;
      // 2両編成っぽく見せる（中心を原点に）
      const total = lead * len + (lead - 1) * 1.2;
      for (let k = 0; k < lead; k++) {
        const x = -total / 2 + k * (len + 1.2);
        car(veh, x, len, lv, { front: k === lead - 1, back: k === 0, pantograph: k === lead - 1 });
      }
    }
    // 種別のバッジは回転させない
    const badge = el('g', { class: 'badge' }, g);
    el('circle', { cx: 0, cy: -12, r: 5.6, fill: color(trip.line), stroke: '#fff', 'stroke-width': 1.4 }, badge);
    const tt = el('text', { x: 0, y: -9.6, 'text-anchor': 'middle', class: 'train-type' }, badge);
    tt.textContent = SHORT[trip.type] || trip.type.slice(0, 1);
    if (trip.line === 'tsurumi') tt.setAttribute('fill', '#5a4500');
  }

  const trainEls = new Map();
  function renderTrains() {
    const t = viewMin();
    const layer = $('#layer-trains');
    const seen = new Set();
    for (const trip of T.getTrips()) {
      const p = T.position(trip, t);
      if (!p || N.byId[p.from]?.offscreen && (!p.to || N.byId[p.to]?.offscreen)) continue;
      seen.add(trip.id);
      let g = trainEls.get(trip.id);
      if (!g) {
        g = el('g', { class: 'train' }, layer);
        vehicleShape(g, trip);
        g.addEventListener('click', (e) => { e.stopPropagation(); pick(trip.id); });
        trainEls.set(trip.id, g);
      }
      // 日本は左側通行なので、進行方向の左側にずらす
      const off = 8;
      const ox = Math.sin(p.angle) * off, oy = -Math.cos(p.angle) * off;
      g.setAttribute('transform', `translate(${(p.x + ox).toFixed(1)},${(p.y + oy).toFixed(1)}) scale(1.25)`);
      g.querySelector('.veh').setAttribute('transform', `rotate(${(p.angle * 180 / Math.PI).toFixed(0)})`);
      const on = state.picked === trip.id || state.highlight.has(trip.id);
      g.classList.toggle('pick', on);
      g.classList.toggle('dim', (state.picked || state.highlight.size) && !on);
      let bubble = g.querySelector('.delay');
      const delay = Math.round(trip.delay || 0);
      if (delay >= 1) {
        if (!bubble) {
          bubble = el('g', { class: 'delay' }, g);
          el('rect', { x: 5, y: -19, width: 20, height: 12, rx: 6, fill: '#ff5a5f', stroke: '#fff', 'stroke-width': 1.5 }, bubble);
          el('text', { x: 15, y: -10.3, 'text-anchor': 'middle', class: 'delay-bubble' }, bubble);
        }
        bubble.querySelector('text').textContent = `+${delay}`;
      } else if (bubble) bubble.remove();
    }
    for (const [id, g] of trainEls) if (!seen.has(id)) { g.remove(); trainEls.delete(id); }
  }

  // ---- 共通の表示部品 ----
  // 浅野の番線：扇町方面（本線）から来る電車は2番線、海芝浦支線から来る電車は4番線
  const isBranchTrip = (trip) => ['jt-umishibaura', 'jt-shinshibaura'].includes(trip.stops[0].id);
  const asanoPlatform = (trip) => isBranchTrip(trip) ? '4番線（海芝浦から）' : '2番線（扇町方面から）';
  const platformChip = (stationId, trip) => stationId === 'jt-asano' && trip.dir === 'up' ? `<span class="chip platform">${asanoPlatform(trip)}</span>` : '';
  const lineLabel = (trip) => trip.line === 'keikyu' ? `京急 ${trip.type}` : trip.line === 'tsurumi' ? '鶴見線' : '臨港バス 鶴08';
  const delayChip = (trip) => Math.round(trip.delay || 0) >= 1 ? `<span class="chip delay">${Math.round(trip.delay)}分遅れ</span>` : '';
  function waitChip(w) {
    const m = Math.round(w);
    const cls = m <= 1 ? 'tight' : m >= 10 ? 'long' : '';
    return `<span class="chip wait ${cls}">${m <= 0 ? 'すぐ乗れる！' : `待ち ${m}分`}</span>`;
  }
  // ---- 出発駅・到着駅の選択 ----
  function fillSelects() {
    const opts = (sel, withNone) => (withNone ? `<option value="">指定なし（次の電車を見る）</option>` : '') +
      Object.values(N.lines).map(line => `<optgroup label="${line.name}">${line.stations.map(x => `<option value="${x.id}" ${x.id === sel ? 'selected' : ''}>${x.name}</option>`).join('')}</optgroup>`).join('');
    $('#from').innerHTML = opts(state.from, false);
    $('#to').innerHTML = opts(state.to, true);
  }
  function setOD(from, to) {
    state.from = from; state.to = to || '';
    if (state.to === state.from) state.to = '';
    state.dir = 'all'; state.meet = false;
    store.set('from', state.from); store.set('to', state.to);
    fillSelects(); lastKey = '';
    $('#sheet').classList.remove('collapsed');
  }
  // 地図の駅をタップ：出発駅が未選択扱いなら出発に、そうでなければ到着に入れる
  function chooseStation(id) {
    if (state.to || id === state.from) setOD(id, '');
    else setOD(state.from, id);
  }

  // ---- 次の電車（到着駅を指定しないとき）----
  const DIRS = {
    keikyu: [['up', '上り 川崎・品川方面'], ['down', '下り 横浜方面']],
    tsurumi: [['up', '鶴見方面'], ['down', '扇町・海芝浦方面']],
    rinko: [['up', '鶴見駅東口方面']],
  };
  function renderBoard() {
    const id = state.from;
    const st = N.byId[id];
    const t0 = viewMin();
    const dirs = DIRS[st.line].filter(([d]) => state.dir === 'all' || state.dir === d);
    const groups = dirs.map(([dir, label]) => ({ dir, label, rows: T.departures(id, t0, (trip) => trip.dir === dir, state.dir === 'all' ? 4 : 8) }));
    const key = 'b' + id + state.dir + Math.floor(t0 * 2) + T.getVersion() + groups.map(g => g.rows.map(r => r.trip.id).join()).join('|');
    state.highlight = new Set(groups.map(g => g.rows[0]?.trip.id).filter(Boolean));
    if (key === lastKey) return;
    lastKey = key;
    const rowHtml = (r) => {
      const left = r.dep - t0;
      const p = T.position(r.trip, t0);
      const first = r.trip.stops[0];
      const where = !p ? (first.id === id ? '当駅始発' : `${name(first.id)} ${fmt(first.dep + (r.trip.delay || 0))}発`)
        : p.atStation === id ? 'まもなく発車' : p.atStation ? `いま${name(p.atStation)}` : `いま${name(p.from)}→${name(p.to)}`;
      const d = Math.round(r.trip.delay || 0);
      return `<div class="board-row" data-trip="${r.trip.id}">
        <div class="left"><b>${left < 1 ? 'まもなく' : `${Math.floor(left)}分`}</b><small>${fmt(r.dep)}${d >= 1 ? `（+${d}）` : ''}</small></div>
        <div class="body"><div><span class="type t-${r.trip.line}">${r.trip.type}</span> ${r.trip.dest}行${platformChip(id, r.trip)}</div>
          <div class="note">${where}</div></div>
      </div>`;
    };
    const dirChips = DIRS[st.line].length > 1
      ? `<div class="vias">${[['all', 'すべての方面'], ...DIRS[st.line]].map(([d, l]) => `<button class="via-btn ${state.dir === d ? 'active' : ''}" data-dir="${d}">${l}</button>`).join('')}</div>` : '';
    const g = state.geo?.list.find(x => x.id === id);
    $('#plan').innerHTML = `
      ${dirChips}
      ${g && g.dist < 2500 ? `<div class="walk-row">📍 現在地から${name(id)}まで約${Math.round(g.dist / 10) * 10}m</div>` : ''}
      ${groups.map(g => `<div class="board"><div class="board-head">${g.label}</div>${g.rows.length ? g.rows.map(rowHtml).join('') : '<div class="empty">この先の電車はありません 💤</div>'}</div>`).join('')}`;
    $('#plan-mini').innerHTML = `🚉 ${st.name}：` + groups.map(g => g.rows[0] ? `${g.label.split(' ')[0]} あと${Math.max(0, Math.floor(g.rows[0].dep - t0))}分` : '').filter(Boolean).join('・');
    $('#plan').querySelectorAll('[data-dir]').forEach(b => b.addEventListener('click', () => { state.dir = b.dataset.dir; lastKey = ''; }));
    $('#plan').querySelectorAll('.board-row').forEach(div => div.addEventListener('click', () => pick(div.dataset.trip)));
  }

  // ---- 経路（出発駅→到着駅）----
  let routeCache = { key: '', routes: [] };
  function routesNow(t0) {
    const key = [state.from, state.to, Math.floor(t0 * 2), T.getVersion(), settings.walkTsurumi, settings.walkKokudo].join('|');
    if (routeCache.key !== key) routeCache = { key, routes: Route.search(state.from, state.to, t0, { walkMin }) };
    return routeCache.routes;
  }
  function viaSummary(r) {
    const rides = r.legs.filter(l => l.kind === 'ride');
    if (rides.length === 1) return '乗り換えなし';
    const w = r.legs.find((l, i) => l.kind === 'walk' && i > 0 && i < r.legs.length - 1);
    return w ? `${name(w.from)}→${name(w.to)} 徒歩乗換` : `${name(rides[0].to)}で乗換`;
  }
  function renderRoutes() {
    const t0 = viewMin();
    const routes = routesNow(t0);
    const key = 'r' + routeCache.key + Math.floor(t0 * 2);
    state.highlight = new Set(routes[0] ? routes[0].legs.filter(l => l.kind === 'ride').map(l => l.trip.id) : []);
    if (key === lastKey) return;
    lastKey = key;
    const r0 = routes[0];
    $('#plan-mini').innerHTML = !r0 ? `${name(state.from)}→${name(state.to)}：この時間の経路はありません 💤`
      : `${name(state.from)} ${fmt(r0.start)}発 → ${name(state.to)} ${fmt(r0.end)}着 <span class="chip via">${viaSummary(r0)}</span>` +
        (r0.legs.find(l => l.runOpt) ? `<span class="chip run">🏃 走れば${fmt(r0.legs.find(l => l.runOpt).runOpt.end)}着</span>` : '');
    const box = $('#plan');
    if (!routes.length) {
      box.innerHTML = `<div class="empty">この時間の経路が見つかりませんでした 💤${N.byId[state.to].line === 'rinko' ? '<br>臨港バスは鶴見駅東口ゆきだけ入っています。' : ''}</div>`;
      return;
    }
    box.innerHTML = routes.map((r, i) => `
      <div class="route ${i === 0 ? 'best' : ''}" data-trips="${r.legs.filter(l => l.kind === 'ride').map(l => l.trip.id).join(',')}">
        <div class="route-head"><span>${fmt(r.start)} → ${fmt(r.end)} <span class="chip via">${viaSummary(r)}</span></span><span class="total">${Math.round(r.end - r.start)}分${i === 0 ? '・いちばん早い' : ''}</span></div>
        <div class="leave">${r.start - t0 < 1 ? 'まもなく出発' : `あと${Math.floor(r.start - t0)}分で出発`}</div>
        <div class="legs">${legsHtml(r)}</div>
        ${r.legs.filter(l => l.runOpt).map(l => `<div class="run">🏃 走れば（${l.runOpt.run}分）${name(l.from)} ${fmt(l.runOpt.dep)}発の${lineLabel(l.runOpt.trip)}に間に合う → ${fmt(l.runOpt.end)}着（${Math.round(r.end - l.runOpt.end)}分はやい）</div>`).join('')}
      </div>`).join('');
    box.querySelectorAll('.route').forEach(div => div.addEventListener('click', () => {
      state.highlight = new Set(div.dataset.trips.split(','));
      state.picked = null;
    }));
  }
  function legsHtml(r) {
    const dot = (line) => `<div class="dot" style="--c:${line ? color(line) : 'var(--sub)'}"></div>`;
    const stRow = (t, id, line, chips = '') => `<div class="t">${fmt(t)}</div>${dot(line)}<div><b>${name(id)}</b>${chips}</div>`;
    let html = '';
    r.legs.forEach((l, i) => {
      const prev = r.legs[i - 1];
      if (l.kind === 'walk') {
        if (i === 0) html += stRow(l.t ?? (r.legs[1].dep - l.min), l.from, null);
        html += `<div></div><div class="bar walk"></div><div class="note">🚶 徒歩 ${l.min}分</div>`;
        if (i === r.legs.length - 1) html += stRow(r.end, l.to, null);
        return;
      }
      const chips = platformChip(l.from, l.trip) + (l.wait != null ? waitChip(l.wait) : '');
      if (!prev || prev.kind === 'walk' || prev.to !== l.from) html += stRow(l.dep, l.from, l.trip.line, chips);
      else html += `<div></div><div></div><div class="note">${name(l.from)}で乗り換え ${chips}</div>`;
      html += `<div></div><div class="bar" style="--c:${color(l.trip.line)}"></div><div class="note">${lineLabel(l.trip)} ${l.trip.dest}行${delayChip(l.trip)}</div>`;
      html += stRow(l.arr, l.to, l.trip.line);
    });
    return html;
  }

  // ---- 待ち合わせ（鶴見駅近くのお店に集合）----
  function latestBefore(stationId, arriveId, deadline, filter) {
    const cands = T.departures(stationId, deadline - 120, filter, 80)
      .map(d => ({ ...d, arr: T.arrivalAt(d.trip, arriveId, d.index) }))
      .filter(d => d.arr != null && d.arr <= deadline);
    return cands.at(-1) || null;
  }
  function meetMinutes() {
    const [h, m] = settings.meetTime.split(':').map(Number);
    let v = h * 60 + m;
    if (v < 180) v += 1440;
    return v;
  }
  function renderMeet() {
    const meet = meetMinutes();
    const shop = settings.shopWalk;
    const meFrom = state.from && N.byId[state.from].line === 'tsurumi' ? state.from : 'jt-asano';
    const me = latestBefore(meFrom, 'jt-tsurumi', meet - shop, (trip) => trip.dir === 'up');
    const fr = latestBefore('rk-turbine', 'rk-tsurumi', meet - shop, () => true);
    const friend = settings.friendName || 'ともだち';
    const key = 'meet' + meet + shop + friend + meFrom + (me ? me.trip.id + me.trip.delay : '') + (fr ? fr.trip.id : '');
    state.highlight = new Set([me?.trip.id, fr?.trip.id].filter(Boolean));
    if (key === lastKey) return;
    lastKey = key;
    const row = (who, icon, d, from, to, extra) => !d
      ? `<div class="meet-card"><div class="who">${icon} ${who}</div><div class="empty">間に合う便が見つかりませんでした</div></div>`
      : `<div class="meet-card"><div class="who">${icon} ${who}</div>
          <div class="legs">
            <div class="t">${fmt(d.dep)}</div><div class="dot" style="--c:${color(d.trip.line)}"></div><div><b>${from}</b>${extra || ''}</div>
            <div></div><div class="bar" style="--c:${color(d.trip.line)}"></div><div class="note">${d.trip.line === 'rinko' ? '臨港バス 鶴08' : `鶴見線 ${d.trip.dest}行`}${delayChip(d.trip)}</div>
            <div class="t">${fmt(d.arr)}</div><div class="dot" style="--c:${color(d.trip.line)}"></div><div><b>${to}</b><span class="chip wait">お店まで${shop}分・余裕${Math.round(meet - shop - d.arr)}分</span></div>
          </div>
          <button class="mini-btn" data-goto="${d.dep}">この時刻の地図を見る</button>
        </div>`;
    $('#plan').innerHTML = `
      <div class="meet-form">
        <label>集合 <input type="time" id="meet-time" value="${settings.meetTime}"></label>
        <label>お店まで <input type="number" id="shop-walk" min="0" max="20" value="${shop}">分</label>
        <label>名前 <input type="text" id="friend-name" value="${friend}" maxlength="10"></label>
      </div>
      ${row('あなた', '🧑‍💼', me, name(meFrom), 'JR鶴見', me ? platformChip(meFrom, me.trip) : '')}
      ${row(friend, '🧑‍🔧', fr, '東芝西タービン前', '鶴見駅東口')}
      ${fr ? `<button class="share-btn wide" id="meet-share">${friend}にLINEで送る</button>` : ''}
      <p class="hint">あなたの出発駅は、出発駅が鶴見線の駅ならその駅、ほかは浅野です。臨港バスは時刻表からの推定です（道路の混雑による遅れは反映されません）。</p>`;
    $('#plan-mini').innerHTML = `🍚 ${settings.meetTime}集合：あなた ${name(meFrom)}${me ? fmt(me.dep) : '--'}発／${friend} ${fr ? fmt(fr.dep) : '--'}発のバス`;
    const save = () => {
      settings.meetTime = $('#meet-time').value || settings.meetTime;
      settings.shopWalk = Math.max(0, Number($('#shop-walk').value) || 0);
      settings.friendName = $('#friend-name').value.trim();
      store.set('meetTime', settings.meetTime); store.set('shopWalk', settings.shopWalk); store.set('friendName', settings.friendName);
      lastKey = '';
    };
    ['#meet-time', '#shop-walk', '#friend-name'].forEach(id => $(id).addEventListener('change', save));
    $('#plan').querySelectorAll('[data-goto]').forEach(b => b.addEventListener('click', () => {
      const off = Math.max(0, Math.min(60, Math.round(Number(b.dataset.goto) - nowMin())));
      state.offset = off; $('#slider').value = off;
    }));
    $('#meet-share')?.addEventListener('click', () => {
      const text = `${settings.meetTime}に鶴見集合ね🍚\n🚌 鶴08 東芝西タービン前 ${fmt(fr.dep)}発 → 鶴見駅東口 ${fmt(fr.arr)}着がちょうどいいよ` +
        (me ? `\n🚃 わたしは${name(meFrom)} ${fmt(me.dep)}発の鶴見線で行きます` : '');
      shareText(text);
    });
  }

  let lastKey = '';
  function renderPanel() {
    $('#presets').querySelectorAll('[data-preset]').forEach(b => b.classList.toggle('active',
      b.dataset.preset === 'meet' ? state.meet : !state.meet && b.dataset.preset === `${state.from}>${state.to}`));
    if (state.meet) return renderMeet();
    if (!state.to) return renderBoard();
    return renderRoutes();
  }

  // ---- 列車の詳細と LINE 共有 ----
  function pick(id) {
    if (MapZoom.wasDrag()) return;
    state.picked = state.picked === id ? null : id;
    renderDetail();
  }
  function describeTrip(trip) {
    const p = T.position(trip, viewMin());
    const where = !p ? '' : p.atStation ? `${name(p.atStation)}に停車中` : `${name(p.from)} → ${name(p.to)}`;
    const lineName = { keikyu: '京急', tsurumi: '鶴見線', rinko: '臨港バス' }[trip.line];
    const d = Math.round(trip.delay || 0);
    return { lineName, where, delay: d, head: `${lineName} ${trip.type} ${trip.dest}行` };
  }
  function renderDetail() {
    const box = $('#train-detail');
    const trip = T.getTrips().find(t => t.id === state.picked);
    if (!trip) { box.innerHTML = ''; return; }
    const d = describeTrip(trip);
    const src = trip.source === 'live' ? '📡 リアルタイム' : trip.source === 'timetable' ? '🕒 時刻表から推定' : trip.source === 'bus' ? '🕒 時刻表から推定（遅れは反映されません）' : '🧸 デモダイヤ';
    box.innerHTML = `<div class="detail"><div class="info"><b>${d.head}</b><br>${d.where}${d.delay >= 1 ? `<span class="chip delay">${d.delay}分遅れ</span>` : ''}<br><span class="note">${src}</span></div>
      <button class="share-btn" id="share">LINEで送る</button></div>`;
    $('#share').addEventListener('click', () => share(trip));
  }
  async function share(trip) {
    const d = describeTrip(trip);
    const text = `いま${d.head}に乗ってるよ🚃\n${d.where}${d.delay >= 1 ? `（${d.delay}分遅れ）` : ''}`;
    const url = `${location.href.split('#')[0]}#train=${encodeURIComponent(trip.id)}`;
    shareText(text, url);
  }
  async function shareText(text, url) {
    if (navigator.share) {
      try { await navigator.share(url ? { text, url } : { text }); return; } catch (e) { if (e.name === 'AbortError') return; }
    }
    location.href = `https://line.me/R/share?text=${encodeURIComponent(url ? `${text}\n${url}` : text)}`;
  }

  // ---- 現在地 ----
  async function locate(silent) {
    const btn = $('#locate');
    btn.classList.add('busy');
    try {
      const pos = await Geo.locate();
      state.geo = { ...pos, list: Geo.nearest(pos.lat, pos.lon) };
      const near = state.geo.list[0];
      if (near.dist > 5000) {
        $('#near').innerHTML = '📍 近くに対象の駅がありません（表示範囲から5km以上）';
      } else {
        setOD(near.id, state.to === near.id ? '' : state.to);
        renderNear();
      }
      drawHere();
      lastKey = '';
    } catch (e) {
      if (!silent) $('#near').textContent = `📍 ${e.message}`;
    } finally {
      btn.classList.remove('busy');
    }
  }
  // 最寄りの駅を路線ごとに1つずつ（近い順に3つまで）
  function renderNear() {
    if (!state.geo) { $('#near').innerHTML = ''; return; }
    const seen = new Set();
    const picks = state.geo.list.filter(x => { const l = N.byId[x.id].line; if (seen.has(l)) return false; seen.add(l); return true; }).slice(0, 3);
    $('#near').innerHTML = '📍 最寄り：' + picks.map(x => `<button class="near-btn ${x.id === state.from ? 'active' : ''}" data-id="${x.id}">${name(x.id)} ${x.dist < 1000 ? `${Math.round(x.dist / 10) * 10}m` : `${(x.dist / 1000).toFixed(1)}km`}</button>`).join('');
    $('#near').querySelectorAll('[data-id]').forEach(b => b.addEventListener('click', () => { setOD(b.dataset.id, state.to); renderNear(); }));
  }

  // ---- 表示の更新 ----
  function renderClock() {
    const t = viewMin();
    $('#clock').textContent = fmt(nowMin());
    $('#time-label').textContent = state.offset ? fmt(t) : `いま ${fmt(t)}`;
    $('#time-sub').textContent = state.offset ? `+${state.offset}分後の予想` : '';
    $('#live-btn').classList.toggle('on', state.offset === 0);
    const pill = $('#mode-pill');
    pill.className = 'mode-pill';
    if (state.offset) { pill.textContent = '🔮 予想図'; pill.classList.add('future'); }
    else if (state.mode === 'live') { pill.textContent = `ライブ ${state.liveUpdated ? fmt(O.nowMin(new Date(state.liveUpdated))) + '更新' : ''}`; pill.classList.add('live'); }
    else if (state.mode === 'timetable') pill.textContent = '🕒 時刻表から推定';
    else pill.textContent = '🧸 デモダイヤ（トークン未設定）';
  }

  let lastFrame = 0;
  function loop(ts) {
    if (ts - lastFrame > 100) {
      lastFrame = ts;
      renderClock();
      renderPanel();
      renderTrains();
    }
    requestAnimationFrame(loop);
  }

  // ---- データ読み込み ----
  let dayKey = null;
  async function loadData() {
    O.setToken(settings.ctoken);
    const day = O.serviceDay(new Date());
    const bus = Bus.trips(day.calendar);
    if (!O.hasToken()) { T.setTrips([...T.demoTrips(), ...bus]); state.mode = 'demo'; return; }
    dayKey = day.key;
    try {
      const [kq, jt] = await Promise.all([O.loadKeikyuTrips(day), O.loadTsurumiTrips(day)]);
      T.setTrips([...kq, ...jt, ...bus]);
      state.mode = 'timetable';
      lastKey = '';
      O.loadStationGeo().catch(() => {});
      await pollLive();
    } catch (e) {
      console.error(e);
      T.setTrips([...T.demoTrips(), ...bus]);
      state.mode = 'demo';
      $('#mode-pill').textContent = `読み込み失敗：${e.message}`;
    }
  }
  async function pollLive() {
    if (!O.hasToken()) return;
    if (O.serviceDay(new Date()).key !== dayKey) return loadData();
    try {
      const r = await O.applyKeikyuLive(T.getTrips(), nowMin());
      T.touch();
      state.liveUpdated = r.updated;
      state.mode = 'live';
      lastKey = '';
      if (state.picked) renderDetail();
    } catch (e) {
      console.warn('live', e);
      state.mode = 'timetable';
    }
  }

  // ---- UI ----
  $('#slider').addEventListener('input', (e) => { state.offset = Number(e.target.value); if (state.picked) renderDetail(); });
  $('#live-btn').addEventListener('click', () => { state.offset = 0; $('#slider').value = 0; });
  $('#from').addEventListener('change', (e) => setOD(e.target.value, state.to));
  $('#to').addEventListener('change', (e) => setOD(state.from, e.target.value));
  $('#swap').addEventListener('click', () => { if (state.to) setOD(state.to, state.from); });
  $('#locate').addEventListener('click', () => locate(false));
  $('#presets').querySelectorAll('[data-preset]').forEach(b => b.addEventListener('click', () => {
    if (b.dataset.preset === 'meet') { state.meet = !state.meet; lastKey = ''; return; }
    const [f, t] = b.dataset.preset.split('>');
    setOD(f, t);
  }));
  $('#map').addEventListener('click', () => { if (MapZoom.wasDrag()) return; state.picked = null; renderDetail(); });
  MapZoom.attach($('#map'));
  $('#zoom-in').addEventListener('click', () => MapZoom.zoomCenter(1.5));
  $('#zoom-out').addEventListener('click', () => MapZoom.zoomCenter(1 / 1.5));
  $('#zoom-reset').addEventListener('click', () => MapZoom.reset());

  $('#open-settings').addEventListener('click', () => {
    $('#set-ctoken').value = settings.ctoken;
    $('#set-walk-tsurumi').value = settings.walkTsurumi;
    $('#set-walk-kokudo').value = settings.walkKokudo;
    $('#settings').showModal();
  });
  $('#settings').addEventListener('close', () => {
    if ($('#settings').returnValue !== 'save') return;
    const tokenChanged = settings.ctoken !== $('#set-ctoken').value.trim();
    settings.ctoken = $('#set-ctoken').value.trim();
    settings.walkTsurumi = Number($('#set-walk-tsurumi').value) || 4;
    settings.walkKokudo = Number($('#set-walk-kokudo').value) || 5;
    store.set('odptChallengeToken', settings.ctoken);
    store.set('walkTsurumi', settings.walkTsurumi);
    store.set('walkKokudo', settings.walkKokudo);
    drawStatic(); lastKey = '';
    if (tokenChanged) loadData();
  });
  $('#open-about').addEventListener('click', () => $('#about').showModal());
  const sheet = $('#sheet');
  if (store.get('sheetCollapsed', '0') === '1') sheet.classList.add('collapsed');
  $('#grabber').addEventListener('click', () => {
    sheet.classList.toggle('collapsed');
    store.set('sheetCollapsed', sheet.classList.contains('collapsed') ? '1' : '0');
  });
  $('#plan-mini').addEventListener('click', () => { sheet.classList.remove('collapsed'); store.set('sheetCollapsed', '0'); });

  // 共有リンクから開いたとき
  const m = location.hash.match(/train=([^&]+)/);
  if (m) state.picked = decodeURIComponent(m[1]);

  if (!N.byId[state.from]) state.from = 'kq-koyasu';
  if (state.to && !N.byId[state.to]) state.to = '';
  fillSelects();
  drawStatic();
  loadData().then(() => renderDetail());
  setInterval(pollLive, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pollLive(); });
  requestAnimationFrame(loop);
  // 位置情報をすでに許可していれば、起動時に最寄り駅を出す
  Geo.granted().then(ok => { if (ok) locate(true); });

  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
