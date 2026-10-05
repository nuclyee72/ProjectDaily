// 데일리 농장 규칙 (farm/data.js · farm/engine.js) + 도트 (farm/sprites.js) — 브라우저 없이 Node에서 바로 돌린다.
// 기획 docs/farm-plan.md "검증"의 규칙 항목. 확률은 10만 번 굴려 ±0.5%p 안인지 본다.
const fs = require('fs');
const path = require('path');
const vm = require('vm');
const { check, finish } = require('./lib.cjs');

const REPO = path.resolve(__dirname, '..');
function load() {
  const ctx = { window: {} };
  vm.createContext(ctx);
  for (const f of ['farm/data.js', 'farm/engine.js', 'farm/sprites.js']) vm.runInContext(fs.readFileSync(path.join(REPO, f), 'utf8'), ctx, { filename: f });
  return ctx.window.DailyFarm;
}
const { data: D, engine: E, sprites: S } = load();
const E2 = load().engine; // 다른 실행에서도 시드 결과가 같은지

const H = E.H;
const T0 = Date.UTC(2026, 9, 5, 3); // 2026-10-05 12:00 KST
const TODAY = '2026-10-05';
const N = 100000;
const seq = (...vals) => { let i = 0; return () => (i < vals.length ? vals[i++] : 0.5); };
const fresh = () => E.newState('2026-10', T0);
const near = (a, b, tol) => Math.abs(a - b) <= tol;
const pct = (x) => `${(x * 100).toFixed(2)}%`;
const sum = (a) => a.reduce((x, y) => x + y, 0);
const same = (a, b) => JSON.stringify(a) === JSON.stringify(b);
let rng = E.mulberry32(20261005);

/** 빈도 배열이 기대 확률과 ±tol 안인지 */
function dist(counts, expect, total, tol = 0.005) {
  return expect.every((p, i) => near((counts[i] || 0) / total, p, tol));
}

// ── 데이터 ──
{
  const tiers = D.DISHES.map((d) => d.tier);
  check(D.DISHES.length === 100 && same([0, 1, 2, 3].map((t) => tiers.filter((x) => x === t).length), [40, 30, 20, 10]), '요리 100개: 일반 40 · 고급 30 · 희귀 20 · 전설 10');
  check(D.DISHES.every((d, i) => d.tier === (i < 40 ? 0 : i < 70 ? 1 : i < 90 ? 2 : 3)), '요리 등급 = 재료 중 가장 높은 작물 등급 (번호 구간과 같음)');
  check(D.DISHES.every((d) => d.ings.length <= 3 && d.ings.every(([id, n]) => D.CROP_BY_ID[id] && n >= 1 && n <= 3)), '재료는 작물만 · 최대 3종류 · 같은 재료 3개까지');
  const combos = D.DISHES.map((d) => d.ings.map(([id]) => id).sort().join('+'));
  check(new Set(combos).size === 100, '재료 종류 조합이 같은 요리 없음');
  const used = new Set(D.DISHES.flatMap((d) => d.ings.map(([id]) => id)));
  check(D.CROPS.length === 55 && D.CROPS.every((c) => used.has(c.id)), '작물 55종이 모두 요리에 쓰임');
  const probSums = [sum(D.EXPLORE.cats.map((c) => c.p)), ...D.EXPLORE.cats.map((c) => sum(c.items.map((i) => i.p))), sum(D.EXPLORE.hiddenItems.map((i) => i.p)),
    sum(D.BOX.map((b) => b.p)), ...D.SEED_TO_CROP.map(sum), sum(D.GEAR.lines), sum(D.GEAR.tiers)];
  check(probSums.every((s) => near(s, 1, 1e-9)), '확률표 합이 모두 1');
  const steps = D.CRAFT.flatMap((l) => l.steps);
  check(steps.length === 39 && sum(steps.map((s) => s.mat)) === 1415 && sum(steps.map((s) => s.mat2)) === 277 && sum(steps.map((s) => s.money)) === 51490,
    `제작 39단계 합계: 자재 1,415 · 고급 자재 277 · 돈 51,490 (${sum(steps.map((s) => s.money))})`);
  check(steps.filter((s) => s.day === 1).every((s) => s.money === 0) && D.CRAFT[0].steps[2].money === 250 && D.CRAFT[8].steps[1].money === 6700,
    '돈 = (자재 + 고급 자재 × 5) × 배수: 1일 0 · 밭 3 = 250 · 장신구 착용 2 = 6,700');
}

// ── state · 시즌 ──
{
  const s = fresh();
  check(E.isValidState(s) && !E.isValidState(null) && !E.isValidState({}) && !E.isValidState({ ...s, inv: null }) && !E.isValidState({ ...s, v: 99 }), '깨진 state는 쓸 수 없음으로 판정');
  const old = { ...E.newState('2026-09', T0), codex: { 1: 2, 45: 3 } };
  const r = E.rollSeason(old, '2026-10-01', T0);
  check(r.state.season === '2026-10' && same(r.ended, { season: '2026-09', done: 2, stars: 5 }) && r.state.inv.mat === 0, '시즌이 바뀌면 history 요약(등록 2 · 별 5) + 새 state');
  const same1 = E.rollSeason(s, TODAY, T0);
  check(same1.state === s && same1.ended === null, '같은 시즌이면 그대로');
  check(E.daysLeft('2026-10-05') === 26 && E.daysLeft('2026-10-31') === 0 && E.daysLeft('2026-02-28') === 0, '남은 날: 10/5 = D-26, 마지막 날 = D-DAY');
  const cdx = E.codexDishes('2026-10');
  check(same(cdx, E2.codexDishes('2026-10')) && !same(cdx, E.codexDishes('2026-11')), '도감 6개: 같은 시즌은 늘 같고 다른 시즌은 다름');
  check(same(cdx.map((id) => D.DISH_BY_ID[id].tier), [0, 1, 1, 2, 2, 3]) && new Set(cdx).size === 6, `도감 등급별 1 · 2 · 2 · 1개 (${cdx.join(',')})`);
}

// ── NP ──
{
  const s = fresh();
  for (const d of ['2026-10-01', '2026-10-02', '2026-10-05', '2026-10-05', '2026-09-30']) E.markAttendance(s, d);
  const maps = [
    { '2026-10-01': { status: 'solved' }, '2026-10-02': { status: 'solved' }, '2026-09-30': { status: 'solved' } },
    { '2026-10-01': { status: 'solved' }, '2026-10-03': { status: 'solved' }, '2026-10-04': { status: 'failed' }, '2026-10-05': { status: 'gaveup' }, '2026-10-06': { status: 'solved' } },
  ];
  const e = E.npEarned(s, maps, TODAY);
  check(e.attend === 3 && e.solved === 4 && e.other === 2 && e.total === 31, `NP: 출석 3 + 성공 4 + 실패 2 = 31, 다른 달 · 내일은 빠짐 (${e.total})`);
  s.bonus = 100; s.spent = 6;
  check(E.npBalance(s, e) === 125, 'NP 잔액 = 번 NP + 상자 NP − 쓴 NP');
}

// ── 탐험 ──
{
  const s = fresh();
  const p = E.explorePending(s, T0 + 3 * H + 40 * 60000);
  check(p.hours === 3 && p.rolls === 9, `3시간 40분 = 9번 (${p.rolls})`);
  E.claimExplore(s, T0 + 3 * H + 40 * 60000, rng);
  check(s.explore.lastAt === T0 + 3 * H && E.explorePending(s, T0 + 3 * H + 40 * 60000).accMs === 40 * 60000, '받은 뒤 40분은 남음');
  const rollsAt = (lv) => { const t = fresh(); t.built.explore = lv; const r = E.claimExplore(t, T0 + 60 * H, rng); return [r.rolls, t.explore.lastAt]; };
  const [r0, last0] = rollsAt(0);
  check(r0 === 144 && last0 === T0 + 60 * H, '60시간 = 144번 (48시간 상한) + lastAt = 지금');
  check(rollsAt(1)[0] === 192 && rollsAt(2)[0] === 240, '탐험 강화 1 · 2 뒤 60시간 = 192 · 240번');
  const back = fresh();
  const rb = E.claimExplore(back, T0 - H, rng);
  check(rb.rolls === 0 && back.explore.lastAt === T0 - H, '시계가 뒤로 가면 0번, lastAt = 지금');

  // 굴림 1번에서 나올 확률 (§4)
  const keys = ['seed0', 'seed1', 'seed2', 'seed3', 'mat', 'mat2', 'gear', 'box', 'relic'];
  const expect = [0.3564, 0.1782, 0.05346, 0.00594, 0.2772, 0.0693, 0.0495, 0.005, 0.005];
  const cnt = Object.fromEntries(keys.map((k) => [k, 0]));
  let seed0Total = 0;
  const t = fresh();
  const mods = E.gearMods(t);
  for (let i = 0; i < N; i++) {
    const got = E.emptyGot();
    E.exploreRoll(t, rng, mods, got);
    got.seed.forEach((n, k) => { if (n) cnt['seed' + k]++; });
    seed0Total += got.seed[0];
    for (const k of ['mat', 'mat2', 'box', 'relic']) if (got[k]) cnt[k]++;
    if (got.gear.length) cnt.gear++;
    if (t.inv.gear.length > 500) t.inv.gear.length = 0;
  }
  check(dist(keys.map((k) => cnt[k]), expect, N), `탐험 굴림 확률 §4 (${keys.map((k) => pct(cnt[k] / N)).join(' · ')})`);
  check(near(seed0Total / cnt.seed0, 4, 0.03), `일반 씨앗 개수 평균 4 (3~5) (${(seed0Total / cnt.seed0).toFixed(3)})`);

  // 씨앗 주머니 30%: 개수 × 1.3 (확률 반올림)
  const g = fresh();
  const gear = E.rollGear(g, seq(), [1]);
  gear.lines = [{ opt: 'seedBag', tier: 3, v: 30 }];
  E.equipGear(g, gear.id);
  const gm = E.gearMods(g);
  let n0 = 0, tot0 = 0;
  for (let i = 0; i < N; i++) {
    const got = E.emptyGot();
    E.exploreRoll(g, rng, gm, got);
    if (got.seed[0]) { n0++; tot0 += got.seed[0]; }
  }
  check(near(tot0 / n0, 5.2, 0.05), `씨앗 주머니 30%: 일반 씨앗 평균 4 → 5.2 (${(tot0 / n0).toFixed(3)})`);

  // 보물 상자
  const b = fresh();
  b.inv.box = N;
  const opened = {};
  let boxes = 0;
  for (let i = 0; i < N; i++) { const id = E.openBox(b, rng); opened[id] = (opened[id] || 0) + 1; boxes++; }
  check(dist(D.BOX.map((o) => opened[o.id]), D.BOX.map((o) => o.p), boxes), `상자 열기 19.8% × 5 · ×2 1% (${D.BOX.map((o) => pct((opened[o.id] || 0) / boxes)).join(' · ')})`);
  const one = fresh(); one.inv.box = 1;
  E.openBox(one, seq(0.1));
  check(one.bonus === 100 && one.inv.box === 0 && E.openBox(one, rng) === null, '100 NP 상자 → 잔액에 더해짐, 상자 없으면 못 엶');
}

// ── 농사 ──
{
  const s = fresh();
  check(E.plant(s, 0, 0, T0, rng) === null, '씨앗이 없으면 못 심음');
  s.inv.seed = [5, 5, 5, 5];
  check(E.plant(s, 0, 1, T0, rng) === null, '시설 강화 전엔 고급 씨앗 못 심음');
  const plot = E.plant(s, 0, 0, T0, rng);
  check(plot && plot.readyAt === T0 + 8 * H && s.inv.seed[0] === 4 && E.plant(s, 0, 0, T0, rng) === null, '일반 씨앗 심기 → 8시간 뒤, 심은 칸엔 또 못 심음');
  check([1, 2, 5, 8].map((h) => E.growthStage(plot, T0 + h * H)).join() === '0,1,2,3', '그림 단계: 씨앗 · 새싹 · 자람 · 다 큼');
  check(E.harvest(s, 0, T0 + 8 * H - 60000, rng) === null, '7시간 59분 → 아직');
  const hv = E.harvest(s, 0, T0 + 8 * H, rng);
  check(hv && hv.qualities.length >= 2 && s.plots[0] === null && s.inv.crop[hv.crop].length === hv.qualities.length, `8시간 → 수확 (${D.CROP_BY_ID[hv.crop].name} ${hv.qualities.length}개)`);
  E.plant(s, 1, 0, T0, rng);
  s.inv.ticket = 1;
  check(E.useTicket(s, 1, T0 + H) && s.inv.ticket === 0 && E.harvest(s, 1, T0 + H, rng) !== null, '즉시 완료권 → 바로 수확');

  // 씨앗 등급 → 작물 등급 (§5)
  const t = fresh();
  const ok = D.SEED_TO_CROP.map((row, seedTier) => {
    const c = [0, 0, 0, 0];
    for (let i = 0; i < N; i++) c[E.rollCrop(t, seedTier, rng).tier]++;
    return dist(c, row, N);
  });
  check(ok.every(Boolean), '씨앗 등급마다 작물 등급 비율 §5 표대로');

  // 풍작
  const mean = (lv, tier) => { const u = fresh(); u.built.bounty = lv; let x = 0; for (let i = 0; i < 200000; i++) x += E.harvestCount(u, tier, rng); return x / 200000; };
  const full = [0, 1, 2].map((tier) => mean(16, tier));
  check(near(full[0], 6.6, 0.05) && near(full[1], 6.05, 0.05) && near(full[2], 3.0, 0.05), `풍작 16 수확 평균 일반 6.6 · 고급 6.05 · 희귀 3.0 (${full.map((x) => x.toFixed(3)).join(' · ')})`);
  const none = [0, 1, 2, 3].map((tier) => mean(0, tier));
  check(near(none[0], 2.5, 0.02) && near(none[2], 1.5, 0.02) && none[3] === 1, '풍작 없음: 일반 2.5 · 희귀 1.5 · 전설 1');

  // 재사용 3 → 일반 작물 수확 때 씨앗 반환 30%
  const r = fresh();
  r.built.reuse = 3;
  let back = 0;
  for (let i = 0; i < 50000; i++) {
    r.plots[0] = { seed: 0, crop: 'potato', plantedAt: 0, readyAt: 0 };
    back += E.harvest(r, 0, 1, rng).seedBack;
    r.inv.crop = {};
  }
  check(near(back / 50000, 0.3, 0.01), `재사용 3: 씨앗 반환 30% (${pct(back / 50000)})`);
}

// ── 품질 ──
{
  const { p } = E.quality;
  check(p.length === 100 && p.slice(0, 30).every((x) => near(x, p[0], 1e-15)) && p.slice(30).every((x, i) => x < p[29 + i]), '품질: 1~30 같은 확률, 31부터 계속 감소');
  check(near(p[99], 0.001, 1e-7) && near(sum(p), 1, 1e-12) && near(p[0], 0.015047, 2e-6), `p(100) = 0.100% · 합 1 · p(1) = 1.505% (σ ${E.quality.sigma.toFixed(2)})`);
  let le30 = 0, tot = 0;
  for (let i = 0; i < N; i++) { const q = E.rollQuality(rng); if (q <= 30) le30++; tot += q; }
  check(near(le30 / N, 0.4514, 0.005) && near(tot / N, 36.18, 0.3), `10만 번: P(≤30) ${pct(le30 / N)} · 평균 ${(tot / N).toFixed(2)}`);
  const low = (lv, th) => { let c = 0; for (let i = 0; i < N; i++) if (E.rollQuality(rng, lv) <= th) c++; return c / N; };
  const c1 = low(1, 8), c2 = low(2, 16);
  check(near(c1, 0.0145, 0.002) && near(c2, 0.058, 0.003), `정성스레 1: 8 이하 ${pct(c1)} (≈1.45%) · 2: 16 이하 ${pct(c2)} (≈5.8%)`);
}

// ── 제작 ──
{
  const s = fresh();
  check(E.canCraft(s, 'field') === 'cost', '재료가 없으면 못 만듦');
  s.inv.mat = 8;
  check(E.craft(s, 'field') && s.built.field === 1 && s.plots.length === 3 && s.inv.mat === 0, '밭 1 → 밭 3칸, 재료 빠짐');
  s.inv.mat = 1000; s.inv.mat2 = 1000;
  E.craft(s, 'field');
  check(E.canCraft(s, 'field') === 'cost' && (s.money = 250) && E.craft(s, 'field') && s.money === 0, '밭 3은 돈 250도 있어야 만듦');
  check(E.canCraft(s, 'eff') === 'requires', '효율 증대는 씨앗 합성기 다음');
  s.money = 1e6;
  for (let i = 0; i < 4; i++) E.craft(s, 'reuse');
  check(s.built.reuse === 4 && E.canCraft(s, 'reuse') === 'max' && !E.craft(s, 'reuse'), '같은 줄은 순서대로, 끝까지 만들면 더 없음');
  check(E.synthesize(s, 0, 1, rng) === 0, '합성기 전엔 합성 못 함');
  E.craft(s, 'synth');
  const ratios = [];
  for (let lv = 0; lv <= 3; lv++) {
    s.built.eff = lv;
    s.inv.seed = [E.synthRatio(s), 0, 0, 0];
    const out = E.synthesize(s, 0, 1, rng);
    ratios.push(out === 1 && s.inv.seed[0] === 0 && s.inv.seed[1] === 1 ? E.synthRatio(s) : -1);
  }
  check(same(ratios, [10, 9, 8, 7]), `합성 10 · 9 · 8 · 7개 → 1개 (${ratios})`);
  check(E.synthesize(s, 3, 1, rng) === 0 && E.synthesize(s, 0, 1, rng) === 0, '전설은 합성 못 하고, 씨앗이 모자라면 안 됨');
  const slots = [E.equipSlots(s)];
  E.craft(s, 'equip'); slots.push(E.equipSlots(s));
  E.craft(s, 'equip'); slots.push(E.equipSlots(s));
  check(same(slots, [1, 2, 3]), '장신구 착용 칸: 기본 1 → 2 → 3');
}

// ── 장신구 ──
{
  const s = fresh();
  const lines = [0, 0, 0], tiers = [0, 0, 0, 0], opts = {};
  let lineN = 0, dup = 0, badV = 0;
  for (let i = 0; i < N; i++) {
    const g = E.rollGear(s, rng);
    lines[g.lines.length]++;
    if (new Set(g.lines.map((l) => l.opt)).size !== g.lines.length) dup++;
    for (const l of g.lines) {
      lineN++; tiers[l.tier]++; opts[l.opt] = (opts[l.opt] || 0) + 1;
      const o = E.OPT_BY_ID[l.opt]; const [lo, hi] = o.range[l.tier];
      if (l.v < lo - 1e-9 || l.v > hi + 1e-9 || !near(Math.round((l.v - lo) / o.step) * o.step, l.v - lo, 1e-9)) badV++;
    }
    if (s.inv.gear.length > 500) s.inv.gear.length = 0;
  }
  check(dist(lines, D.GEAR.lines, N), `효과 줄 수 0 · 1 · 2 = ${lines.map((x) => pct(x / N)).join(' · ')}`);
  check(dist(tiers, D.GEAR.tiers, lineN), `효과 등급 = ${tiers.map((x) => pct(x / lineN)).join(' · ')}`);
  check(dist(D.GEAR.opts.map((o) => opts[o.id]), D.GEAR.opts.map(() => 1 / 9), lineN), '옵션 9개 1/9씩');
  check(dup === 0 && badV === 0, '한 장신구에 같은 옵션 두 줄 없음 · 수치가 등급 범위와 단위 안');
  s.inv.relic = 1000;
  let relicOk = true;
  for (let i = 0; i < 1000; i++) {
    const g = E.openRelic(s, rng);
    const legend = E.OPT_BY_ID[g.lines[0].opt].range[3][0];
    if (g.lines.length !== 2 || g.lines[0].tier !== 3 || g.lines[0].v !== legend || g.lines[0].opt === g.lines[1].opt) relicOk = false;
  }
  check(relicOk && E.openRelic(s, rng) === null, '고대 유물: 늘 2줄, 1줄은 전설 고정값, 두 줄 옵션이 다름');

  // 분해 · 착용 · 잠금 · 가방
  const t = fresh();
  const zero = E.rollGear(t, seq(0.1)); // 0줄
  const lr = E.rollGear(t, seq(0.1)); lr.lines = [{ opt: 'bounty', tier: 3, v: 30 }, { opt: 'hurry', tier: 2, v: 7 }];
  const locked = E.rollGear(t, seq(0.1)); E.toggleLock(t, locked.id);
  const worn = E.rollGear(t, seq(0.1)); E.equipGear(t, worn.id);
  check(E.gearAp(zero) === 1 && E.gearAp(lr) === 71, '장신구 AP: 0줄 = 1 · 전설 + 희귀 = 71');
  const ap = E.dismantleGear(t, [zero.id, lr.id, locked.id, worn.id]);
  check(ap === 72 && t.ap === 72 && t.inv.gear.length === 2, '분해 → AP, 잠금 · 착용 중은 분해 안 됨');
  check(!E.equipGear(t, locked.id) && E.unequipGear(t, worn.id) && E.equipGear(t, locked.id), '착용 칸보다 많이 못 낌, 빼면 낄 수 있음');
  const m = fresh();
  for (let i = 0; i < 98; i++) E.rollGear(m, seq(0.1));
  for (let i = 0; i < 5; i++) E.rollGear(m, seq(0.1));
  check(E.gearOverflow(m) === 3, '98개에서 5개 얻으면 넘친 3개');
  E.dismantleGear(m, m.inv.gear.slice(-3).map((g) => g.id));
  check(E.gearOverflow(m) === 0 && m.inv.gear.length === 100, '3개를 AP로 → 100개');
  const two = fresh(); two.built.equip = 1;
  const a1 = E.rollGear(two, seq(0.1)); a1.lines = [{ opt: 'seedBag', tier: 1, v: 15 }];
  const a2 = E.rollGear(two, seq(0.1)); a2.lines = [{ opt: 'seedBag', tier: 0, v: 7 }, { opt: 'treasure', tier: 0, v: 0.2 }];
  E.equipGear(two, a1.id); E.equipGear(two, a2.id);
  const gm = E.gearMods(two);
  check(gm.seedBag === 22 && gm.treasure === 0.2 && gm.bounty === 0, '같은 옵션을 여러 개 착용하면 수치를 더함');

  // 씨앗 분해
  const sd = fresh(); sd.inv.seed = [10, 10, 10, 10];
  const sp = [0, 1, 2, 3].map((tier) => E.dismantleSeeds(sd, tier, 1));
  check(same(sp, [1, 3, 15, 100]) && sd.sp === 119 && E.dismantleSeeds(sd, 0, 99) === 9 && sd.inv.seed[0] === 0, '씨앗 분해 1 · 3 · 15 · 100 SP, 가진 만큼만');
}

// ── 요리 · 판매 ──
{
  check(same(E.starChances(78, 0), [0.78, 0.53, 0.28]), '평균 품질 78 일반 요리 = 78% · 53% · 28%');
  check(E.rollStars(78, 0, seq(0.1, 0.1, 0.9)) === 2, '고정 난수 성공 · 성공 · 실패 → 2성');
  check(same(E.starChances(10, 0), [0.1, 0.05, 0.05]) && same(E.starChances(10, 3), [0.05, 0.05, 0.05]) && E.starChances(100, 0)[0] === 0.95, '하한 5% · 상한 95%, 전설 감점 15');
  let calls = 0;
  check(E.rollStars(100, 0, () => { calls++; return 0; }) === 3 && calls === 3, '3성에서 멈춤');
  const c = [0, 0, 0, 0];
  for (let i = 0; i < N; i++) c[E.rollStars(78, 0, rng)]++;
  const ev = (c[0] + c[1] * 5 + c[2] * 30 + c[3] * 200) / N;
  check(dist(c, [0.22, 0.3666, 0.2976, 0.1158], N) && near(ev, 34.1, 0.6), `품질 78 일반: ${c.map((x) => pct(x / N)).join(' · ')} · 기대 배율 ×${ev.toFixed(1)}`);

  const s = fresh();
  s.inv.crop.potato = [80, 70, 60, 50];
  check(E.cook(s, '1', { potato: [0, 1] }, rng) === null && E.cook(s, '1', { potato: [0, 0, 1] }, rng) === null && E.cook(s, '1', { potato: [0, 1, 2], onion: [0] }, rng) === null,
    '레시피 개수와 다르게 고르면 요리 안 됨');
  check(E.cook(s, '7', { potato: [0, 1, 2], onion: [0] }, rng) === null, '재료가 모자라면 요리 안 됨 (감자전: 양파 없음)');
  check(same(E.bestPicks(s, '1'), { potato: [0, 1, 2] }) && E.bestPicks(s, '7') === null, '가장 좋은 재료 고르기');
  const r = E.cook(s, '1', { potato: [0, 1, 2] }, seq(0.1, 0.1, 0.9));
  check(r && r.avg === 70 && r.stars === 2 && same(s.inv.crop.potato, [50]) && same(s.inv.food['1'], [2]), '찐 감자: 평균 70 → 2성, 쓴 감자 빠짐');

  const prices = D.DISHES.map((d) => E.dishPrice(d.id));
  check(D.DISHES.every((d, i) => { const b = D.COOK.basePrice[d.tier]; return prices[i] >= Math.round(b * 0.9) && prices[i] <= Math.round(b * 1.1); }), '원래 값이 등급 기본 가격의 90~110% 안');
  check(same(prices, D.DISHES.map((d) => E2.dishPrice(d.id))) && new Set(prices.slice(90)).size > 1, '같은 요리는 늘 같은 값 (요리마다 다름)');
  s.inv.food['1'] = [0, 1, 2, 3];
  const got = [0, 1, 2, 3].map((st) => E.sellFood(s, '1', st));
  check(same(got, [1, 5, 30, 200].map((m) => prices[0] * m)) && !s.inv.food['1'] && s.money === sum(got) && E.sellFood(s, '1', 0) === 0, `판매 값 = 원래 값 × 1 · 5 · 30 · 200 (${got.join(' · ')})`);
}

// ── 도감 ──
{
  const s = fresh();
  const cdx = E.codexDishes(s.season);
  const notCodex = D.DISHES.find((d) => !cdx.includes(d.id)).id;
  s.inv.food[notCodex] = [3];
  check(!E.submitCodex(s, notCodex, 3), '도감 6개가 아닌 요리는 제출 안 됨');
  const id = cdx[0];
  s.inv.food[id] = [1, 2, 1];
  check(E.submitCodex(s, id, 1) && s.codex[id] === 1 && same(s.inv.food[id], [2, 1]), '제출하면 등록 + 가방에서 빠짐');
  check(!E.canSubmit(s, id, 1) && E.submitCodex(s, id, 2) && s.codex[id] === 2 && !E.canSubmit(s, id, 1), '1성 등록 뒤 2성 → 갱신, 같거나 낮은 별은 안 됨');
  check(same(E.rollSeason(s, '2026-11-01', T0).ended, { season: '2026-10', done: 1, stars: 2 }), '시즌이 바뀌면 history에 등록 수 · 별 합');
}

// ── NP 상점 ──
{
  const s = fresh();
  const buys = [1, 2, 3, 4].map(() => E.buyNp(s, 'ticket', TODAY, 100, T0));
  check(same(buys, ['ok', 'ok', 'ok', 'limit']) && s.inv.ticket === 3 && s.spent === 6, '완료권 2 NP → +1장, 하루 3개까지');
  check(E.buyNp(s, 'ticket', '2026-10-06', 100, T0) === 'ok', '06:00 (날짜가 바뀌면) 다시 살 수 있음');
  check(E.buyNp(s, 'boost', '2026-10-06', 5, T0) === 'np', 'NP가 모자라면 못 삼');

  const b = fresh();
  E.buyNp(b, 'boost', TODAY, 100, T0);
  check(E.explorePending(b, T0 + 10 * H).rolls === 8 * 6 + 2 * 3, '부스트 뒤 10시간 = 8시간 × 6번 + 2시간 × 3번 = 54');
  E.buyNp(b, 'boost', TODAY, 100, T0 + H);
  check(same(b.explore.boosts[1], [T0 + 8 * H, T0 + 16 * H]) && E.explorePending(b, T0 + 20 * H).rolls === 16 * 6 + 4 * 3, '켜진 동안 또 사면 끝 시각 +8시간 (×4 아님)');
  const late = fresh();
  E.buyNp(late, 'boost', TODAY, 100, T0 + 5 * H);
  check(E.explorePending(late, T0 + 10 * H).rolls === 5 * 3 + 5 * 6, '사기 전에 쌓인 시간은 그대로');
  E.claimExplore(b, T0 + 20 * H, rng);
  check(b.explore.boosts.length === 0, '지난 부스트 구간은 받은 뒤 지움');
}

// ── AP · SP 상점 ──
{
  const days = Array.from({ length: 20 }, (_, i) => `2026-10-${String(i + 1).padStart(2, '0')}`);
  const offers = days.map((d) => E.shopOffers(d));
  check(offers.every((o) => o.ap.length === 2 && o.sp.length === 2 && new Set([...o.ap, ...o.sp]).size === 4), 'AP · SP 상점 2개씩, 같은 날 겹치지 않음');
  check(same(offers, days.map((d) => E2.shopOffers(d))) && new Set(offers.map((o) => o.ap.join())).size > 5, '날짜 시드: 모두에게 같고 날마다 바뀜');
  const day = days.find((d) => E.shopOffers(d).ap.includes('gearBox2'));
  const s = fresh();
  s.ap = 100; s.sp = 1000;
  const notToday = D.SHOP.apsp.find((x) => !E.shopOffers(day).ap.includes(x.id)).id;
  check(E.buyShop(s, 'ap', notToday, day, rng) === 'none', '그날 상품이 아니면 못 삼');
  check(E.buyShop(s, 'ap', 'gearBox2', day, rng) === 'ok' && s.ap === 60 && s.inv.gear.length === 1 && s.inv.gear[0].lines.length === 2, '고급 장신구 상자 40 AP → 2줄 장신구');
  check(E.buyShop(s, 'ap', 'gearBox2', day, rng) === 'limit', '한도 하루 1');
  const spDay = days.find((d) => E.shopOffers(d).sp.includes('seed2'));
  const t = fresh(); t.sp = 650;
  const r = [E.buyShop(t, 'sp', 'seed2', spDay, rng), E.buyShop(t, 'sp', 'seed2', spDay, rng)];
  check(same(r, ['ok', 'ok']) && t.sp === 50 && t.inv.seed[2] === 10, '희귀 씨앗 ×5 = 30 AP × 10 = 300 SP');
  t.sp = 0;
  const day3 = days.find((d) => E.shopOffers(d).sp.includes('mat'));
  check(E.buyShop(t, 'sp', 'mat', day3, rng) === 'sp', 'SP가 모자라면 못 삼');
}

// ── 도트 (음영 계산까지. 캔버스로 그리는 건 화면 테스트에서) ──
{
  const names = S.names();
  check(names.length === 242 && new Set(names).size === 242, `도트 242장 (기타 32 · 작물 55 · 다 큰 작물 55 · 요리 100) (${names.length})`);
  const bad = [];
  for (const n of names) {
    const d = S.def(n);
    if (!d) { bad.push(n + ' 정의 없음'); continue; }
    for (const L of d.layers) {
      const w = L.rows[0].length;
      if (L.rows.some((r) => r.length !== w) || L.x + w > d.w || L.y + L.rows.length > d.h) bad.push(n + ' 크기');
    }
    const p = S.pixels(n);
    const holes = [];
    d.layers.forEach((L) => L.rows.forEach((r, y) => [...r].forEach((ch, x) => {
      if (ch !== '.' && !/^#[0-9a-f]{6}$/.test(p.px[L.y + y][L.x + x] || '')) holes.push(`${x},${y}:${ch}`);
    })));
    if (holes.length) bad.push(n + ' 색 없음 ' + holes.slice(0, 3).join(' '));
  }
  check(bad.length === 0, `픽셀맵: 줄 길이가 같고 크기 안, 모든 픽셀에 색 ${bad.slice(0, 5).join(' / ')}`);
  check(D.CROPS.every((c) => S.def('crop:' + c.id).w === 16 && S.def('ready:' + c.id).h === 20) && D.DISHES.every((d) => S.def('dish:' + d.id).h === 16),
    '작물 16×16 · 다 큰 작물 16×20 (줄기 위에 작물) · 요리 16×16');
  const r = S.ramp('#e53935');
  check(r.length === 7 && r[3] === '#e53935' && new Set(r).size === 7, '음영 7단계 (가운데가 바탕색)');
  const tomato = S.pixels('crop:tomato').px.flat().filter(Boolean);
  check(new Set(tomato).size >= 10, `토마토 한 장에 색 ${new Set(tomato).size}가지 (음영 단계 + 외곽선 섞임)`);
  check(S.TIER_COLORS.length === 4, '등급 테두리 색 4개');
}

finish();
