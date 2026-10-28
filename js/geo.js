// 現在地から最寄り駅を探す。
// 駅の緯度経度は目安の値。チャレンジ用トークンがあれば ODPT の駅情報で上書きする（odpt.js）。
window.Geo = (() => {
  const LL = {
    'kq-kawasaki': [35.5328, 139.7010], 'kq-hatchonawate': [35.5238, 139.6928], 'kq-tsurumiichiba': [35.5163, 139.6873],
    'kq-tsurumi': [35.5077, 139.6786], 'kq-kagetsu': [35.5016, 139.6746], 'kq-namamugi': [35.4957, 139.6687],
    'kq-shinkoyasu': [35.4876, 139.6593], 'kq-koyasu': [35.4836, 139.6555], 'kq-shinmachi': [35.4804, 139.6492],
    'kq-higashikanagawa': [35.4783, 139.6332], 'kq-kanagawa': [35.4712, 139.6268], 'kq-yokohama': [35.4657, 139.6223],
    'jt-tsurumi': [35.5075, 139.6760], 'jt-kokudo': [35.4996, 139.6789], 'jt-tsurumiono': [35.4985, 139.6869],
    'jt-bentembashi': [35.4985, 139.6947], 'jt-asano': [35.4994, 139.6998], 'jt-anzen': [35.5040, 139.7066],
    'jt-musashishiraishi': [35.5086, 139.7101], 'jt-hamakawasaki': [35.5147, 139.7151], 'jt-showa': [35.5181, 139.7211],
    'jt-ogimachi': [35.5207, 139.7268], 'jt-shinshibaura': [35.4951, 139.7016], 'jt-umishibaura': [35.4922, 139.7047],
    'jt-okawa': [35.5101, 139.7054],
    'rk-tsurumi': [35.5080, 139.6800], 'rk-shiozuru': [35.5045, 139.6852], 'rk-shioiri': [35.5000, 139.6905],
    'rk-turbine': [35.4955, 139.6962],
  };
  const override = (id, lat, lon) => { if (LL[id] && lat && lon) LL[id] = [lat, lon]; };

  function distance(a, b) {
    const R = 6371000, rad = Math.PI / 180;
    const dLat = (b[0] - a[0]) * rad, dLon = (b[1] - a[1]) * rad;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(a[0] * rad) * Math.cos(b[0] * rad) * Math.sin(dLon / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
  }
  // 道のりは直線距離の1.3倍、分速80mで歩く想定
  const walkMinutes = (m) => Math.max(1, Math.ceil(m * 1.3 / 80));

  // 近い順の駅リスト [{id, dist, walk}]
  function nearest(lat, lon) {
    return Object.entries(LL)
      .map(([id, ll]) => { const dist = distance([lat, lon], ll); return { id, dist, walk: walkMinutes(dist) }; })
      .sort((a, b) => a.dist - b.dist);
  }

  function locate() {
    return new Promise((resolve, reject) => {
      if (!navigator.geolocation) return reject(new Error('この端末では現在地が使えません'));
      navigator.geolocation.getCurrentPosition(
        (p) => resolve({ lat: p.coords.latitude, lon: p.coords.longitude, acc: p.coords.accuracy }),
        (e) => reject(new Error(e.code === 1 ? '位置情報の利用が許可されていません' : '現在地を取得できませんでした')),
        { enableHighAccuracy: true, timeout: 10000, maximumAge: 60000 });
    });
  }
  // すでに許可済みなら true（起動時に自動で現在地を使うかの判断）
  async function granted() {
    try { return (await navigator.permissions.query({ name: 'geolocation' })).state === 'granted'; } catch (e) { return false; }
  }

  return { nearest, locate, granted, override };
})();
