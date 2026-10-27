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
    plan: 'home',
    via: 'auto',        // auto | tsurumi | kokudo
    picked: null,       // 選択中の列車ID
    mode: 'demo',       // demo | timetable | live
    liveUpdated: null,
    unmatched: [],
    highlight: new Set(),
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

  // ---- 地図（背景・線・駅）----
  function drawStatic() {
    const bg = $('#layer-bg');
    bg.innerHTML = '';
    // 京浜運河と東京湾をゆるく
    const sea = 'M215 900 L 215 700 C 225 560, 250 500, 300 490 S 370 400, 398 360 S 420 270, 430 250 L 445 -300 L 1400 -300 L 1400 900 Z';
    el('path', { d: sea, fill: 'var(--sea)' }, bg);
    el('path', { d: sea, fill: 'url(#waves)', opacity: .7 }, bg);
    const deco = [
      ['⛩️', 36, 304, '總持寺'], ['🏠', 36, 484, 'おうち'], ['🏭', 232, 452, 'しごと'],
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
      const pts = seg.path.map(id => `${N.byId[id].x},${N.byId[id].y}`).join(' ');
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
      el('line', { x1: a.x, y1: a.y, x2: b.x, y2: b.y, stroke: 'var(--sub)', 'stroke-width': 3, 'stroke-dasharray': '1 6', 'stroke-linecap': 'round' }, walks);
      const min = w.id === 'walk-tsurumi' ? settings.walkTsurumi : settings.walkKokudo;
      el('text', { x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 - 7, 'text-anchor': 'middle', class: 'walk-label' }, walks).textContent = `🚶${min}分`;
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
      }
    }
  }

  // ---- 列車 ----
  const SHORT = { '普通': '普', '各駅停車': '各', '急行': '急', 'エアポート急行': '急', '特急': '特', '快特': '快', 'エアポート快特': '快' };
  function trainShape(g, line, type, live) {
    const c = color(line);
    el('circle', { r: 16, class: 'halo', fill: c, opacity: 0, 'fill-opacity': .25 }, g);
    const body = el('g', { filter: 'url(#soft)' }, g);
    if (N.lines[line].bus) {
      el('rect', { x: -13, y: -9, width: 26, height: 16, rx: 5, fill: c, stroke: '#fff', 'stroke-width': 2 }, body);
      el('rect', { x: -10, y: -6, width: 20, height: 6, rx: 2, fill: '#fff', opacity: .92 }, body);
      el('circle', { cx: -3.5, cy: -3, r: 1.3, fill: '#3b3340' }, body);
      el('circle', { cx: 3.5, cy: -3, r: 1.3, fill: '#3b3340' }, body);
      el('circle', { cx: -7, cy: 8, r: 2.6, fill: '#3b3340', stroke: '#fff', 'stroke-width': 1 }, body);
      el('circle', { cx: 7, cy: 8, r: 2.6, fill: '#3b3340', stroke: '#fff', 'stroke-width': 1 }, body);
      el('path', { class: 'arrow', d: 'M0 -15 l4 4 h-8 z', fill: c, stroke: '#fff', 'stroke-width': 1 }, g);
      return;
    }
    el('rect', { x: -12, y: -9, width: 24, height: 18, rx: 7, fill: c, stroke: '#fff', 'stroke-width': 2 }, body);
    el('rect', { x: -8, y: -5.5, width: 16, height: 6, rx: 3, fill: '#fff', opacity: .92 }, body);
    el('circle', { cx: -3.5, cy: -2.5, r: 1.3, fill: '#3b3340' }, body);
    el('circle', { cx: 3.5, cy: -2.5, r: 1.3, fill: '#3b3340' }, body);
    el('path', { d: 'M-1.6 -0.4 q1.6 1.4 3.2 0', stroke: '#3b3340', 'stroke-width': .9, fill: 'none', 'stroke-linecap': 'round' }, body);
    const tt = el('text', { y: 7, 'text-anchor': 'middle', class: 'train-type' }, body);
    tt.textContent = SHORT[type] || type.slice(0, 1);
    if (line === 'tsurumi') tt.setAttribute('fill', '#5a4500');
    el('path', { class: 'arrow', d: 'M0 -15 l4 4 h-8 z', fill: c, stroke: '#fff', 'stroke-width': 1 }, g);
    if (!live) body.setAttribute('opacity', .9);
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
        trainShape(g, trip.line, trip.type, trip.source === 'live');
        g.addEventListener('click', (e) => { e.stopPropagation(); pick(trip.id); });
        trainEls.set(trip.id, g);
      }
      // 日本は左側通行なので、進行方向の左側にずらす
      const off = 11;
      const ox = Math.sin(p.angle) * off, oy = -Math.cos(p.angle) * off;
      g.setAttribute('transform', `translate(${(p.x + ox).toFixed(1)},${(p.y + oy).toFixed(1)}) scale(1.2)`);
      const deg = p.angle * 180 / Math.PI + 90;
      g.querySelector('.arrow').setAttribute('transform', `rotate(${deg.toFixed(0)})`);
      g.classList.toggle('pick', state.picked === trip.id || state.highlight.has(trip.id));
      g.classList.toggle('dim', (state.picked || state.highlight.size) && !(state.picked === trip.id || state.highlight.has(trip.id)));
      let bubble = g.querySelector('.delay');
      const delay = Math.round(trip.delay || 0);
      if (delay >= 1) {
        if (!bubble) {
          bubble = el('g', { class: 'delay' }, g);
          el('rect', { x: 8, y: -18, width: 20, height: 12, rx: 6, fill: '#ff5a5f', stroke: '#fff', 'stroke-width': 1.5 }, bubble);
          el('text', { x: 18, y: -9.3, 'text-anchor': 'middle', class: 'delay-bubble' }, bubble);
        }
        bubble.querySelector('text').textContent = `+${delay}`;
      } else if (bubble) bubble.remove();
    }
    for (const [id, g] of trainEls) if (!seen.has(id)) { g.remove(); trainEls.delete(id); }
  }

  // ---- 乗り換えプラン ----
  // 浅野の番線：扇町方面（本線）から来る電車は2番線、海芝浦支線から来る電車は4番線
  const isBranchTrip = (trip) => ['jt-umishibaura', 'jt-shinshibaura'].includes(trip.stops[0].id);
  const asanoPlatform = (trip) => isBranchTrip(trip) ? '4番線（海芝浦から）' : '2番線（扇町方面から）';

  // 乗り換え地点：鶴見⇄京急鶴見 と 国道⇄花月総持寺
  const VIAS = {
    tsurumi: { label: '鶴見経由', jt: 'jt-tsurumi', kq: 'kq-tsurumi', walk: () => settings.walkTsurumi },
    kokudo: { label: '国道経由', jt: 'jt-kokudo', kq: 'kq-kagetsu', walk: () => settings.walkKokudo },
  };
  const name = (id) => N.byId[id].name;

  // かえる：浅野 →(鶴見線)→ 乗換駅 →(徒歩)→ 京急 → 子安
  function homeRoute(a, via) {
    const arrT = T.arrivalAt(a.trip, via.jt);
    if (arrT == null) return null;
    const ready = arrT + via.walk();
    const b = T.departures(via.kq, ready, (trip, i) => trip.dir === 'down' && T.stopsAfter(trip, i, 'kq-koyasu'), 1)[0];
    if (!b) return null;
    const end = T.arrivalAt(b.trip, 'kq-koyasu');
    return {
      via, start: a.dep, end, trips: [a.trip.id, b.trip.id], wait: b.dep - ready, firstTrip: a.trip.id,
      legs: [
        { kind: 'st', t: a.dep, name: '浅野', chips: [{ cls: 'platform', text: asanoPlatform(a.trip) }], line: 'tsurumi' },
        { kind: 'ride', line: 'tsurumi', text: `鶴見線 ${a.trip.dest}行`, delay: a.trip.delay },
        { kind: 'st', t: arrT, name: name(via.jt), line: 'tsurumi' },
        { kind: 'walk', text: `徒歩 ${via.walk()}分` },
        { kind: 'st', t: b.dep, name: name(via.kq), line: 'keikyu', chips: [waitChip(b.dep - ready)] },
        { kind: 'ride', line: 'keikyu', text: `京急 ${b.trip.type} ${b.trip.dest}行`, delay: b.trip.delay },
        { kind: 'st', t: end, name: '子安 🏠', line: 'keikyu' },
      ],
    };
  }

  // いく：子安 →(京急)→ 乗換駅 →(徒歩)→ 鶴見線 → 浅野
  function workRoute(a, via) {
    const arrT = T.arrivalAt(a.trip, via.kq);
    if (arrT == null) return null;
    const ready = arrT + via.walk();
    const b = T.departures(via.jt, ready, (trip, i) => trip.dir === 'down' && T.stopsAfter(trip, i, 'jt-asano'), 1)[0];
    if (!b) return null;
    const end = T.arrivalAt(b.trip, 'jt-asano');
    return {
      via, start: a.dep, end, trips: [a.trip.id, b.trip.id], wait: b.dep - ready, firstTrip: a.trip.id,
      legs: [
        { kind: 'st', t: a.dep, name: '子安', line: 'keikyu' },
        { kind: 'ride', line: 'keikyu', text: `京急 ${a.trip.type} ${a.trip.dest}行`, delay: a.trip.delay },
        { kind: 'st', t: arrT, name: name(via.kq), line: 'keikyu' },
        { kind: 'walk', text: `徒歩 ${via.walk()}分` },
        { kind: 'st', t: b.dep, name: name(via.jt), line: 'tsurumi', chips: [waitChip(b.dep - ready)] },
        { kind: 'ride', line: 'tsurumi', text: `鶴見線 ${b.trip.dest}行`, delay: b.trip.delay },
        { kind: 'st', t: end, name: '浅野 🏭', line: 'tsurumi' },
      ],
    };
  }

  // 両方の乗換地点で経路を作り、到着が早い順に並べる。同じ電車で帰れるなら遅く出られる方を残す。
  function plans(t0) {
    const home = state.plan === 'home';
    const firsts = home
      ? T.departures('jt-asano', t0, (trip, i) => trip.dir === 'up', 5)
      : T.departures('kq-koyasu', t0, (trip, i) => trip.dir === 'up' && T.stopsAfter(trip, i, 'kq-tsurumi'), 6);
    const vias = state.via === 'auto' ? Object.values(VIAS) : [VIAS[state.via]];
    const all = [];
    for (const a of firsts) {
      const pair = Object.values(VIAS).map(v => (home ? homeRoute : workRoute)(a, v)).filter(Boolean);
      for (const r of pair) {
        if (!vias.includes(r.via)) continue;
        r.alt = pair.find(x => x !== r);
        all.push(r);
      }
    }
    all.sort((x, y) => x.end - y.end || y.start - x.start || y.wait - x.wait);
    const seen = new Set();
    return all.filter(r => { const k = r.trips[1]; if (seen.has(k)) return false; seen.add(k); return true; });
  }

  function waitChip(w) {
    const m = Math.round(w);
    const cls = m <= 1 ? 'tight' : m >= 10 ? 'long' : '';
    return { cls: `wait ${cls}`, text: m <= 0 ? 'すぐ乗れる！' : `待ち ${m}分` };
  }

  // ---- 待ち合わせ（鶴見駅近くのお店に集合）----
  // 集合時刻に間に合う、いちばん遅い便を探す
  function latestBefore(stationId, arriveId, deadline, filter) {
    const cands = T.departures(stationId, deadline - 120, filter, 80)
      .map(d => ({ ...d, arr: T.arrivalAt(d.trip, arriveId) }))
      .filter(d => d.arr != null && d.arr <= deadline);
    return cands.at(-1) || null;
  }
  function meetPlan() {
    const meet = meetMinutes();
    const shop = settings.shopWalk;
    const me = latestBefore('jt-asano', 'jt-tsurumi', meet - shop, (trip) => trip.dir === 'up');
    const fr = latestBefore('rk-turbine', 'rk-tsurumi', meet - shop, () => true);
    return { meet, shop, me, fr };
  }
  // 集合時刻（運行日0時からの分）。今より前なら翌日扱いにはせず、そのまま。
  function meetMinutes() {
    const [h, m] = settings.meetTime.split(':').map(Number);
    let v = h * 60 + m;
    if (v < 180) v += 1440;
    return v;
  }
  function renderMeet() {
    const p = meetPlan();
    const key = 'meet' + p.meet + p.shop + settings.friendName + (p.me ? p.me.trip.id + p.me.trip.delay : '') + (p.fr ? p.fr.trip.id : '');
    state.highlight = new Set([p.me?.trip.id, p.fr?.trip.id].filter(Boolean));
    if (key === lastPlanKey) return;
    lastPlanKey = key;
    const friend = settings.friendName || 'ともだち';
    const row = (who, icon, d, from, to, extra) => !d
      ? `<div class="meet-card"><div class="who">${icon} ${who}</div><div class="empty">間に合う便が見つかりませんでした</div></div>`
      : `<div class="meet-card"><div class="who">${icon} ${who}</div>
          <div class="legs">
            <div class="t">${fmt(d.dep)}</div><div class="dot" style="--c:${color(d.trip.line)}"></div><div><b>${from}</b>${extra || ''}</div>
            <div></div><div class="bar" style="--c:${color(d.trip.line)}"></div><div class="note">${d.trip.line === 'rinko' ? '臨港バス 鶴08' : `鶴見線 ${d.trip.dest}行`}${Math.round(d.trip.delay) >= 1 ? `<span class="chip delay">${Math.round(d.trip.delay)}分遅れ</span>` : ''}</div>
            <div class="t">${fmt(d.arr)}</div><div class="dot" style="--c:${color(d.trip.line)}"></div><div><b>${to}</b><span class="chip wait">お店まで${p.shop}分・余裕${Math.round(p.meet - p.shop - d.arr)}分</span></div>
          </div>
          <button class="mini-btn" data-goto="${d.dep}">この時刻の地図を見る</button>
        </div>`;
    $('#plan').innerHTML = `
      <div class="meet-form">
        <label>集合 <input type="time" id="meet-time" value="${settings.meetTime}"></label>
        <label>お店まで <input type="number" id="shop-walk" min="0" max="20" value="${p.shop}">分</label>
        <label>名前 <input type="text" id="friend-name" value="${friend}" maxlength="10"></label>
      </div>
      ${row('あなた', '🧑‍💼', p.me, '浅野', '鶴見', p.me ? `<span class="chip platform">${asanoPlatform(p.me.trip)}</span>` : '')}
      ${row(friend, '🧑‍🔧', p.fr, '東芝西タービン前', '鶴見駅東口')}
      ${p.fr ? `<button class="share-btn wide" id="meet-share">${friend}にLINEで送る</button>` : ''}
      <p class="hint">臨港バスは時刻表からの推定です（道路の混雑による遅れは反映されません）。</p>`;
    $('#plan-mini').innerHTML = `🍚 ${settings.meetTime}集合：あなた 浅野${p.me ? fmt(p.me.dep) : '--'}発／${friend} ${p.fr ? fmt(p.fr.dep) : '--'}発のバス`;
    const save = () => {
      settings.meetTime = $('#meet-time').value || settings.meetTime;
      settings.shopWalk = Math.max(0, Number($('#shop-walk').value) || 0);
      settings.friendName = $('#friend-name').value.trim();
      store.set('meetTime', settings.meetTime); store.set('shopWalk', settings.shopWalk); store.set('friendName', settings.friendName);
      lastPlanKey = '';
    };
    ['#meet-time', '#shop-walk', '#friend-name'].forEach(id => $(id).addEventListener('change', save));
    $('#plan').querySelectorAll('[data-goto]').forEach(b => b.addEventListener('click', () => {
      const off = Math.max(0, Math.min(120, Math.round(Number(b.dataset.goto) - nowMin())));
      state.offset = off; $('#slider').value = off;
    }));
    $('#meet-share')?.addEventListener('click', () => {
      const text = `${settings.meetTime}に鶴見集合ね🍚\n🚌 鶴08 東芝西タービン前 ${fmt(p.fr.dep)}発 → 鶴見駅東口 ${fmt(p.fr.arr)}着がちょうどいいよ` +
        (p.me ? `\n🚃 わたしは浅野 ${fmt(p.me.dep)}発の鶴見線で行きます` : '');
      shareText(text);
    });
  }

  let lastPlanKey = '';
  function renderPlan() {
    if (state.plan === 'meet') return renderMeet();
    const t0 = viewMin();
    const routes = plans(t0);
    const key = state.plan + state.via + routes.map(r => r.trips.join() + r.start + r.end).join('|') + routes.map(r => r.legs.map(l => l.delay || 0).join()).join();
    state.highlight = new Set(routes[0] ? routes[0].trips : []);
    if (key === lastPlanKey) return;
    lastPlanKey = key;
    const r0 = routes[0];
    $('#plan-mini').innerHTML = !r0 ? 'この時間の乗り継ぎはありません 💤' :
      `${state.plan === 'home' ? '🏠' : '🏭'} ${r0.legs[0].name} ${fmt(r0.start)}発 → ${r0.legs.at(-1).name.replace(/ .*/, '')} ${fmt(r0.end)}着 <span class="chip via">${r0.via.label}</span>` +
      `<span class="chip ${r0.legs[4].chips[0].cls}">${r0.legs[4].chips[0].text}</span>` +
      (r0.legs[0].chips ? `<span class="chip platform">${r0.legs[0].chips[0].text.replace(/（.*/, '')}</span>` : '');
    const box = $('#plan');
    if (!routes.length) { box.innerHTML = '<div class="empty">この時間の乗り継ぎは見つかりませんでした 💤</div>'; return; }
    box.innerHTML = routes.slice(0, 3).map((r, i) => `
      <div class="route ${i === 0 ? 'best' : ''}" data-trips="${r.trips.join(',')}">
        <div class="route-head"><span>${fmt(r.start)} → ${fmt(r.end)} <span class="chip via">${r.via.label}</span></span><span class="total">${Math.round(r.end - r.start)}分${i === 0 ? '・いちばん早い' : ''}</span></div>
        <div class="legs">${r.legs.map(legHtml).join('')}</div>
        ${altHtml(r)}
      </div>`).join('');
    box.querySelectorAll('.route').forEach(div => div.addEventListener('click', () => {
      state.highlight = new Set(div.dataset.trips.split(','));
      state.picked = null;
    }));
  }
  // 同じ電車で出発した場合の、もう一方の乗換地点との比較
  function altHtml(r) {
    if (!r.alt) return '';
    const diff = Math.round(r.alt.end - r.end);
    const text = diff > 0 ? `${diff}分おそい` : diff < 0 ? `${-diff}分はやい` : '同じ到着';
    return `<div class="alt">同じ電車で${r.alt.via.label}なら ${fmt(r.alt.end)}着（${text}・待ち${Math.max(0, Math.round(r.alt.wait))}分）</div>`;
  }
  function legHtml(l) {
    const c = l.line ? `style="--c:${color(l.line)}"` : '';
    if (l.kind === 'st') {
      return `<div class="t">${fmt(l.t)}</div><div class="dot" ${c}></div><div><b>${l.name}</b>${(l.chips || []).map(ch => `<span class="chip ${ch.cls}">${ch.text}</span>`).join('')}</div>`;
    }
    if (l.kind === 'walk') return `<div></div><div class="bar walk"></div><div class="note">🚶 ${l.text}</div>`;
    const d = Math.round(l.delay || 0);
    return `<div></div><div class="bar" ${c}></div><div class="note">${l.text}${d >= 1 ? `<span class="chip delay">${d}分遅れ</span>` : ''}</div>`;
  }

  // ---- 列車の詳細と LINE 共有 ----
  function pick(id) {
    state.picked = state.picked === id ? null : id;
    renderDetail();
  }
  function describeTrip(trip) {
    const p = T.position(trip, viewMin());
    const where = !p ? '' : p.atStation ? `${N.byId[p.atStation].name}に停車中` : `${N.byId[p.from].name} → ${N.byId[p.to].name}`;
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
      renderPlan();
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
      lastPlanKey = '';
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
      state.liveUpdated = r.updated;
      state.unmatched = r.unmatched;
      state.mode = 'live';
      lastPlanKey = '';
      if (state.picked) renderDetail();
    } catch (e) {
      console.warn('live', e);
      state.mode = 'timetable';
    }
  }

  // ---- UI ----
  $('#slider').addEventListener('input', (e) => { state.offset = Number(e.target.value); if (state.picked) renderDetail(); });
  $('#live-btn').addEventListener('click', () => { state.offset = 0; $('#slider').value = 0; });
  document.querySelectorAll('.tab').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(x => x.classList.toggle('active', x === b));
    state.plan = b.dataset.plan; lastPlanKey = '';
    $('.vias').hidden = state.plan === 'meet';
  }));
  document.querySelectorAll('.via-btn').forEach(b => b.addEventListener('click', () => {
    document.querySelectorAll('.via-btn').forEach(x => x.classList.toggle('active', x === b));
    state.via = b.dataset.via; lastPlanKey = '';
  }));
  $('#map').addEventListener('click', () => { state.picked = null; renderDetail(); });

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
    drawStatic(); lastPlanKey = '';
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

  // 初回はチェックページで保存したトークンも拾う
  if (!settings.ctoken) settings.ctoken = store.get('odptChallengeToken', '');

  drawStatic();
  loadData().then(() => renderDetail());
  setInterval(pollLive, 30000);
  document.addEventListener('visibilitychange', () => { if (!document.hidden) pollLive(); });
  requestAnimationFrame(loop);

  if ('serviceWorker' in navigator && location.protocol === 'https:') navigator.serviceWorker.register('sw.js').catch(() => {});
})();
