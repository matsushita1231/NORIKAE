// 臨港バス 鶴08（東芝西タービン前 → 鶴見駅東口）の時刻表。
// ODPT では提供されていないため、公開時刻表を手入力している（2026年10月時点）。所要13分。
window.Bus = (() => {
  const H = (h, ...mins) => mins.map(m => h * 60 + m);
  const every20 = (from, to) => { const a = []; for (let h = from; h <= to; h++) a.push(...H(h, 0, 20, 40)); return a; };
  const DEPARTURES = {
    Weekday: [
      ...H(6, 43, 53), ...H(7, 1, 9, 16, 23, 30, 37, 44, 51, 58), ...H(8, 5, 12, 19, 26, 36, 47, 58), ...H(9, 9, 20, 40),
      ...every20(10, 15), ...H(16, 0, 10, 19, 27, 35, 43, 51, 56), ...H(17, 1, 6, 11, 17, 23, 31, 39, 47, 55),
      ...H(18, 3, 11, 19, 27, 35, 43, 53), ...H(19, 3, 13, 23, 40), ...H(20, 0, 20, 40), ...H(21, 0, 40), ...H(22, 20),
    ],
    SaturdayHoliday: [
      ...H(6, 43), ...H(7, 0, 26, 40, 53), ...H(8, 6, 20, 40), ...every20(9, 15), ...H(16, 0, 20, 40, 57),
      ...H(17, 10, 23, 36, 49), ...H(18, 2, 20, 40), ...every20(19, 20), ...H(21, 0, 40), ...H(22, 20),
    ],
  };
  // 停留所ごとの経過分（途中停留所は所要13分からの目安）
  const STOPS = [['rk-turbine', 0], ['rk-shioiri', 5], ['rk-shiozuru', 9], ['rk-tsurumi', 13]];

  function trips(calendar) {
    return (DEPARTURES[calendar] || DEPARTURES.Weekday).map(t => ({
      id: `rk-${calendar}-${t}`,
      line: 'rinko',
      type: '鶴08',
      dest: '鶴見駅東口',
      dir: 'up',
      stops: STOPS.map(([id, m], i) => ({ id, arr: t + m, dep: t + m + (i > 0 && i < STOPS.length - 1 ? 0.3 : 0), pass: false })),
      delay: 0,
      source: 'bus',
    }));
  }
  return { trips };
})();
