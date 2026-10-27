// 路線・駅のデフォルメ配置（SVG座標系 viewBox 0 0 420 620）
// odpt: ODPT の駅ID末尾。リアルタイムデータとの突き合わせに使う。
window.NETWORK = (() => {
  const keikyu = {
    id: 'keikyu',
    name: '京急本線',
    color: '#e5171f',
    stations: [
      { id: 'kq-kawasaki', name: '京急川崎', odpt: 'KeikyuKawasaki', x: 100, y: 70, major: true },
      { id: 'kq-hatchonawate', name: '八丁畷', odpt: 'Hatchonawate', x: 100, y: 125 },
      { id: 'kq-tsurumiichiba', name: '鶴見市場', odpt: 'TsurumiIchiba', x: 100, y: 180 },
      { id: 'kq-tsurumi', name: '京急鶴見', odpt: 'KeikyuTsurumi', x: 100, y: 240, lp: 'r', major: true },
      { id: 'kq-kagetsu', name: '花月総持寺', odpt: 'KagetsuSojiji', x: 100, y: 300, major: true },
      { id: 'kq-namamugi', name: '生麦', odpt: 'Namamugi', x: 100, y: 360 },
      { id: 'kq-shinkoyasu', name: '京急新子安', odpt: 'KeikyuShinkoyasu', x: 100, y: 420 },
      { id: 'kq-koyasu', name: '子安', odpt: 'Koyasu', x: 100, y: 480, major: true, home: true },
      { id: 'kq-shinmachi', name: '神奈川新町', odpt: 'KanagawaShimmachi', x: 100, y: 540 },
      { id: 'kq-higashikanagawa', name: '京急東神奈川', odpt: 'KeikyuHigashiKanagawa', x: 100, y: 600 },
      { id: 'kq-kanagawa', name: '神奈川', odpt: 'Kanagawa', x: 100, y: 655 },
      { id: 'kq-yokohama', name: '横浜', odpt: 'Yokohama', x: 100, y: 710, major: true },
    ],
  };

  // 鶴見線：本線（鶴見〜扇町）＋海芝浦支線＋大川支線
  const tsurumi = {
    id: 'tsurumi',
    name: 'JR鶴見線',
    color: '#f6c200',
    stations: [
      { id: 'jt-tsurumi', name: 'JR鶴見', odpt: 'Tsurumi', x: 48, y: 240, lp: 't', major: true },
      { id: 'jt-kokudo', name: '国道', odpt: 'Kokudo', x: 165, y: 300, lp: 'b', major: true },
      { id: 'jt-tsurumiono', name: '鶴見小野', odpt: 'Tsurumiono', x: 200, y: 345, lp: 'r' },
      { id: 'jt-bentembashi', name: '弁天橋', odpt: 'Bentembashi', x: 235, y: 385, lp: 'r' },
      { id: 'jt-asano', name: '浅野', odpt: 'Asano', x: 270, y: 425, lp: 'l', major: true, work: true },
      { id: 'jt-anzen', name: '安善', odpt: 'Anzen', x: 305, y: 380, lp: 'r' },
      { id: 'jt-musashishiraishi', name: '武蔵白石', odpt: 'MusashiShiraishi', x: 328, y: 330, lp: 'r' },
      { id: 'jt-hamakawasaki', name: '浜川崎', odpt: 'HamaKawasaki', x: 344, y: 275, lp: 'r', major: true },
      { id: 'jt-showa', name: '昭和', odpt: 'Showa', x: 352, y: 220, lp: 'r' },
      { id: 'jt-ogimachi', name: '扇町', odpt: 'Ogimachi', x: 358, y: 165, lp: 'r' },
      { id: 'jt-shinshibaura', name: '新芝浦', odpt: 'Shinshibaura', x: 295, y: 490, lp: 'r' },
      { id: 'jt-umishibaura', name: '海芝浦', odpt: 'Umishibaura', x: 325, y: 550, lp: 'r' },
      { id: 'jt-okawa', name: '大川', odpt: 'Okawa', x: 282, y: 300, lp: 'l' },
    ],
  };

  // 臨港バス 鶴08（友だちが使う区間だけ）
  const rinko = {
    id: 'rinko',
    name: '臨港バス 鶴08',
    color: '#2aa876',
    bus: true,
    stations: [
      { id: 'rk-turbine', name: '東芝西タービン前', x: 232, y: 505, lp: 'l', major: true, friend: true },
      { id: 'rk-shioiri', name: '汐入二丁目', x: 172, y: 440, lp: 'l' },
      { id: 'rk-shiozuru', name: '汐鶴橋通', x: 138, y: 365, lp: 'r' },
      { id: 'rk-tsurumi', name: '鶴見駅東口', x: 168, y: 258, lp: 'r', major: true },
    ],
  };

  // 線の描画区間（駅IDの並び）
  const segments = [
    { line: 'keikyu', path: keikyu.stations.map(s => s.id) },
    { line: 'tsurumi', path: ['jt-tsurumi', 'jt-kokudo', 'jt-tsurumiono', 'jt-bentembashi', 'jt-asano', 'jt-anzen', 'jt-musashishiraishi', 'jt-hamakawasaki', 'jt-showa', 'jt-ogimachi'] },
    { line: 'tsurumi', path: ['jt-asano', 'jt-shinshibaura', 'jt-umishibaura'] },
    { line: 'tsurumi', path: ['jt-anzen', 'jt-okawa'] },
    { line: 'rinko', path: ['rk-turbine', 'rk-shioiri', 'rk-shiozuru', 'rk-tsurumi'], bus: true },
  ];

  // 徒歩乗り換え（分は設定で上書き可）
  const walks = [
    { id: 'walk-tsurumi', from: 'jt-tsurumi', to: 'kq-tsurumi', label: '鶴見 ⇄ 京急鶴見', minutes: 4 },
    { id: 'walk-kokudo', from: 'kq-kagetsu', to: 'jt-kokudo', label: '花月総持寺 ⇄ 国道', minutes: 5 },
  ];

  // 駅と駅の間を曲げて描く区間（鶴見線は JR鶴見を出て京急をまたいでから国道へ）
  const bends = {
    'jt-tsurumi|jt-kokudo': [[72, 262], [100, 268], [135, 282]],
  };

  // 縦方向を少し詰めて、スマホでも全体が見えるようにする
  const squeeze = (y) => Math.round(40 + (y - 70) * 0.8);
  for (const line of [keikyu, tsurumi, rinko]) for (const s of line.stations) s.y = squeeze(s.y);
  for (const k of Object.keys(bends)) bends[k] = bends[k].map(([x, y]) => ({ x, y: squeeze(y) }));

  const byId = {};
  for (const line of [keikyu, tsurumi, rinko]) for (const s of line.stations) byId[s.id] = { ...s, line: line.id };

  // 駅 a → b の線の形（両端を含む点列）
  function geom(a, b) {
    const A = byId[a], B = byId[b];
    if (bends[`${a}|${b}`]) return [A, ...bends[`${a}|${b}`], B];
    if (bends[`${b}|${a}`]) return [A, ...[...bends[`${b}|${a}`]].reverse(), B];
    return [A, B];
  }
  // a → b の線上で割合 f の位置と向き
  function pointAt(a, b, f) {
    const pts = geom(a, b);
    const lens = pts.slice(1).map((p, i) => Math.hypot(p.x - pts[i].x, p.y - pts[i].y));
    let d = f * lens.reduce((x, y) => x + y, 0);
    for (let i = 0; i < lens.length; i++) {
      if (d <= lens[i] || i === lens.length - 1) {
        const p = pts[i], q = pts[i + 1], g = lens[i] ? Math.min(1, d / lens[i]) : 0;
        return { x: p.x + (q.x - p.x) * g, y: p.y + (q.y - p.y) * g, angle: Math.atan2(q.y - p.y, q.x - p.x) };
      }
      d -= lens[i];
    }
  }

  return { lines: { keikyu, tsurumi, rinko }, segments, walks, byId, squeeze, geom, pointAt };
})();
