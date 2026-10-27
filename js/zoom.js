// 地図（SVG）だけをピンチ・ドラッグ・ホイールで拡大縮小／移動する。ページ自体は拡大させない。
window.MapZoom = (() => {
  let svg, base, vb, dragged = false;
  const pointers = new Map();
  let last = null; // 直前のジェスチャー状態 {cx, cy, dist}

  const MAX_ZOOM = 4;
  const apply = () => svg.setAttribute('viewBox', `${vb.x} ${vb.y} ${vb.w} ${vb.h}`);

  // 画面座標 → SVG座標（preserveAspectRatio="xMidYMid meet" を考慮）
  function toSvg(cx, cy) {
    const r = svg.getBoundingClientRect();
    const s = Math.max(vb.w / r.width, vb.h / r.height);
    const ox = (r.width * s - vb.w) / 2, oy = (r.height * s - vb.h) / 2;
    return { x: vb.x - ox + (cx - r.left) * s, y: vb.y - oy + (cy - r.top) * s, s };
  }

  function clamp() {
    vb.w = Math.min(base.w, Math.max(base.w / MAX_ZOOM, vb.w));
    vb.h = vb.w * base.h / base.w;
    // 地図の外へ行き過ぎないように（少しだけはみ出しは許す）
    const m = 40;
    vb.x = Math.min(base.x + base.w - vb.w + m, Math.max(base.x - m, vb.x));
    vb.y = Math.min(base.y + base.h - vb.h + m, Math.max(base.y - m, vb.y));
    if (vb.w === base.w) { vb.x = base.x; vb.y = base.y; }
  }

  function zoomAt(cx, cy, factor) {
    const p = toSvg(cx, cy);
    const nw = Math.min(base.w, Math.max(base.w / MAX_ZOOM, vb.w / factor));
    const k = nw / vb.w;
    vb.x = p.x - (p.x - vb.x) * k;
    vb.y = p.y - (p.y - vb.y) * k;
    vb.w = nw;
    clamp(); apply();
  }

  function gesture() {
    const pts = [...pointers.values()];
    const cx = pts.reduce((a, p) => a + p.x, 0) / pts.length;
    const cy = pts.reduce((a, p) => a + p.y, 0) / pts.length;
    const dist = pts.length > 1 ? Math.hypot(pts[0].x - pts[1].x, pts[0].y - pts[1].y) : 0;
    return { cx, cy, dist, n: pts.length };
  }

  function onDown(e) {
    pointers.set(e.pointerId, { x: e.clientX, y: e.clientY, x0: e.clientX, y0: e.clientY });
    last = gesture();
    if (pointers.size === 1) dragged = false;
  }
  function onMove(e) {
    const p = pointers.get(e.pointerId);
    if (!p) return;
    p.x = e.clientX; p.y = e.clientY;
    if (Math.hypot(p.x - p.x0, p.y - p.y0) > 6) { dragged = true; svg.classList.add('dragging'); }
    const g = gesture();
    if (!last || g.n !== last.n) { last = g; return; }
    const { s } = toSvg(g.cx, g.cy);
    vb.x -= (g.cx - last.cx) * s;
    vb.y -= (g.cy - last.cy) * s;
    clamp(); apply();
    if (g.n > 1 && last.dist > 0) zoomAt(g.cx, g.cy, g.dist / last.dist);
    last = g;
  }
  function onUp(e) {
    pointers.delete(e.pointerId);
    last = pointers.size ? gesture() : null;
    if (!pointers.size) svg.classList.remove('dragging');
  }

  function attach(el) {
    svg = el;
    const [x, y, w, h] = svg.getAttribute('viewBox').split(/\s+/).map(Number);
    base = { x, y, w, h };
    vb = { ...base };
    svg.addEventListener('pointerdown', onDown);
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    svg.addEventListener('wheel', (e) => { e.preventDefault(); zoomAt(e.clientX, e.clientY, Math.exp(-e.deltaY * 0.002)); }, { passive: false });
    svg.addEventListener('dblclick', (e) => { e.preventDefault(); zoomAt(e.clientX, e.clientY, 2); });
    // iOS Safari のページ全体のピンチ拡大を止める
    document.addEventListener('gesturestart', (e) => e.preventDefault());
  }
  function zoomCenter(factor) {
    const r = svg.getBoundingClientRect();
    zoomAt(r.left + r.width / 2, r.top + r.height / 2, factor);
  }
  const reset = () => { vb = { ...base }; apply(); };
  // 直前の操作がドラッグだったか（タップ判定用）
  const wasDrag = () => dragged;
  return { attach, zoomCenter, reset, wasDrag };
})();
