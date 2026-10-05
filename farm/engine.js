/**
 * farm/engine.js — 데일리 농장 규칙. DOM 없이 state만 다룬다 (docs/farm-plan.md §2–§15).
 * 바꾸는 함수는 state를 그 자리에서 고치고 결과를 돌려준다. 저장은 화면(farm.js)이 한다.
 * 난수는 rng(() => [0, 1)), 시각은 now(ms)를 인자로 받아 테스트에서 고정할 수 있다.
 */
(function () {
  const root = typeof window !== 'undefined' ? window : globalThis;
  const F = (root.DailyFarm = root.DailyFarm || {});
  const D = F.data;
  const H = 3600000;
  const VERSION = 1;

  // ── 난수 (DailyBWSweeper/src/core/random.js와 같은 것) ──
  function hashString(str) {
    let h = 0x811c9dc5;
    for (let i = 0; i < str.length; i++) {
      h ^= str.charCodeAt(i);
      h = Math.imul(h, 0x01000193);
    }
    return h >>> 0;
  }
  function mulberry32(seed) {
    let a = seed >>> 0;
    return () => {
      a = (a + 0x6d2b79f5) >>> 0;
      let t = a;
      t = Math.imul(t ^ (t >>> 15), t | 1);
      t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
  }
  const rngFromSeed = (str) => mulberry32(hashString(str));

  const randInt = (rng, lo, hi) => lo + Math.floor(rng() * (hi - lo + 1));
  /** 확률 배열에서 인덱스 하나 */
  function pickIndex(rng, probs) {
    let u = rng();
    for (let i = 0; i < probs.length; i++) {
      u -= probs[i];
      if (u < 0) return i;
    }
    return probs.length - 1;
  }
  const pick = (rng, list) => list[pickIndex(rng, list.map((it) => it.p))];
  /** 소수는 그 비율의 확률로 올림 (3.51 → 51%로 4) */
  function probRound(x, rng) {
    const f = Math.floor(x);
    return x - f > 1e-9 && rng() < x - f ? f + 1 : f;
  }
  function shuffle(list, rng) {
    const a = [...list];
    for (let i = a.length - 1; i > 0; i--) {
      const j = Math.floor(rng() * (i + 1));
      [a[i], a[j]] = [a[j], a[i]];
    }
    return a;
  }
  const clamp = (x, lo, hi) => Math.min(hi, Math.max(lo, x));

  // ── 품질 (§6) ──
  /** σ를 이분법으로 맞춰 p(k)와 누적표를 만든다 */
  function buildQuality() {
    const { flatEnd, p100, max } = D.QUALITY;
    const weights = (sig) => Array.from({ length: max }, (_, i) => (i + 1 <= flatEnd ? 1 : Math.exp(-((i + 1 - flatEnd) ** 2) / (2 * sig * sig))));
    const pMax = (sig) => { const w = weights(sig); return w[max - 1] / w.reduce((a, b) => a + b, 0); };
    let lo = 1, hi = 300;
    for (let i = 0; i < 100; i++) {
      const mid = (lo + hi) / 2;
      if (pMax(mid) > p100) hi = mid; else lo = mid;
    }
    const sigma = (lo + hi) / 2;
    const w = weights(sigma);
    const sum = w.reduce((a, b) => a + b, 0);
    const p = w.map((x) => x / sum);
    let c = 0;
    const cum = p.map((x) => (c += x));
    cum[max - 1] = 1;
    return { sigma, p, cum };
  }
  const QT = buildQuality();
  function drawQuality(rng) {
    const u = rng();
    let lo = 0, hi = QT.cum.length - 1;
    while (lo < hi) {
      const mid = (lo + hi) >> 1;
      if (QT.cum[mid] > u) hi = mid; else lo = mid + 1;
    }
    return lo + 1;
  }
  /** 정성스레 단계만큼 낮은 품질을 한 번 다시 굴린다 */
  function rollQuality(rng, careLevel = 0) {
    const q = drawQuality(rng);
    return careLevel > 0 && q <= D.CARE[careLevel - 1] ? drawQuality(rng) : q;
  }

  // ── state ──
  const CRAFT_BY_ID = Object.fromEntries(D.CRAFT.map((l) => [l.id, l]));
  const CROPS_BY_TIER = [0, 1, 2, 3].map((t) => D.CROPS.filter((c) => c.tier === t));
  const seasonOf = (today) => today.slice(0, 7);

  function newState(season, now) {
    return {
      v: VERSION, season, attendance: [], bonus: 0, spent: 0, sp: 0, ap: 0, money: 0,
      inv: { seed: [0, 0, 0, 0], mat: 0, mat2: 0, crop: {}, food: {}, gear: [], box: 0, relic: 0, ticket: 0 },
      plots: Array(D.FIELD.start).fill(null),
      built: Object.fromEntries(D.CRAFT.map((l) => [l.id, 0])),
      explore: { lastAt: now, boosts: [] },
      shop: { day: null, bought: {} },
      equip: [], codex: {}, nextGear: 1,
    };
  }
  /** 저장된 값이 쓸 만한지 (깨졌으면 화면이 새 state를 만든다) */
  function isValidState(s) {
    const num = (x) => typeof x === 'number' && Number.isFinite(x);
    try {
      return !!s && s.v === VERSION && typeof s.season === 'string' && Array.isArray(s.attendance)
        && [s.bonus, s.spent, s.sp, s.ap, s.money, s.nextGear].every(num)
        && Array.isArray(s.inv.seed) && s.inv.seed.length === 4 && [s.inv.mat, s.inv.mat2, s.inv.box, s.inv.relic, s.inv.ticket].every(num)
        && typeof s.inv.crop === 'object' && typeof s.inv.food === 'object' && Array.isArray(s.inv.gear)
        && Array.isArray(s.plots) && s.plots.length === D.FIELD.start + s.built.field
        && D.CRAFT.every((l) => num(s.built[l.id]))
        && num(s.explore.lastAt) && Array.isArray(s.explore.boosts)
        && typeof s.shop.bought === 'object' && Array.isArray(s.equip) && typeof s.codex === 'object';
    } catch { return false; }
  }

  // ── 시즌 (§3) ──
  function codexSummary(state) {
    const stars = Object.values(state.codex);
    return { done: stars.length, stars: stars.reduce((a, b) => a + b, 0) };
  }
  /** 시즌이 바뀌었으면 새 state와 끝난 시즌 요약(history에 넣을 것)을 돌려준다 */
  function rollSeason(state, today, now) {
    const season = seasonOf(today);
    if (state && state.season === season) return { state, ended: null };
    return { state: newState(season, now), ended: state ? { season: state.season, ...codexSummary(state) } : null };
  }
  /** 그 달 마지막 날까지 남은 날 (0 = D-DAY) */
  function daysLeft(today) {
    const [y, m, d] = today.split('-').map(Number);
    return new Date(Date.UTC(y, m, 0)).getUTCDate() - d;
  }

  // ── NP (§2) ──
  function markAttendance(state, today) {
    if (seasonOf(today) === state.season && !state.attendance.includes(today)) state.attendance.push(today);
  }
  /** 이번 시즌 번 NP. resultMaps = 게임 × 모드마다 { 날짜: { status } } */
  function npEarned(state, resultMaps, today) {
    const inSeason = (d) => d.startsWith(state.season + '-') && d <= today;
    const attend = state.attendance.filter(inSeason).length;
    let solved = 0, other = 0;
    for (const map of resultMaps) {
      for (const [d, r] of Object.entries(map || {})) {
        if (!r || !inSeason(d)) continue;
        if (r.status === 'solved') solved++; else other++;
      }
    }
    return { attend, solved, other, total: attend * D.NP.attend + solved * D.NP.solved + other * D.NP.other };
  }
  const npBalance = (state, earned) => earned.total + state.bonus - state.spent;

  // ── 장신구 (§11) ──
  const OPT_BY_ID = Object.fromEntries(D.GEAR.opts.map((o) => [o.id, o]));
  const equipSlots = (state) => D.GEAR.equipBase + state.built.equip;
  const findGear = (state, id) => state.inv.gear.find((g) => g.id === id);
  /** 착용 중인 장신구의 옵션 합 { 옵션 id: % } */
  function gearMods(state) {
    const mods = Object.fromEntries(D.GEAR.opts.map((o) => [o.id, 0]));
    for (const id of state.equip) {
      const g = findGear(state, id);
      if (g) for (const l of g.lines) mods[l.opt] += l.v;
    }
    for (const k in mods) mods[k] = Math.round(mods[k] * 10) / 10;
    return mods;
  }
  function rollLine(rng, exclude, tier) {
    const opts = D.GEAR.opts.filter((o) => !exclude.includes(o.id));
    const opt = opts[Math.floor(rng() * opts.length)];
    const t = tier ?? pickIndex(rng, D.GEAR.tiers);
    const [lo, hi] = opt.range[t];
    const v = Math.round((lo + randInt(rng, 0, Math.round((hi - lo) / opt.step)) * opt.step) * 10) / 10;
    return { opt: opt.id, tier: t, v };
  }
  function addGear(state, lines) {
    const g = { id: state.nextGear++, lines, lock: false };
    state.inv.gear.push(g);
    return g;
  }
  /** 줄 수를 굴려(또는 lineProbs대로) 장신구 하나를 가방에 넣는다. 한 장신구 안에서 옵션은 서로 다름 */
  function rollGear(state, rng, lineProbs = D.GEAR.lines) {
    const n = pickIndex(rng, lineProbs);
    const lines = [];
    for (let i = 0; i < n; i++) lines.push(rollLine(rng, lines.map((l) => l.opt)));
    return addGear(state, lines);
  }
  /** 고대 유물: 2줄, 1줄째는 전설 고정 */
  function openRelic(state, rng) {
    if (state.inv.relic < 1) return null;
    state.inv.relic--;
    const first = rollLine(rng, [], 3);
    return addGear(state, [first, rollLine(rng, [first.opt])]);
  }
  function equipGear(state, id) {
    if (!findGear(state, id) || state.equip.includes(id) || state.equip.length >= equipSlots(state)) return false;
    state.equip.push(id);
    return true;
  }
  function unequipGear(state, id) {
    const i = state.equip.indexOf(id);
    if (i < 0) return false;
    state.equip.splice(i, 1);
    return true;
  }
  function toggleLock(state, id) {
    const g = findGear(state, id);
    if (g) g.lock = !g.lock;
    return !!g;
  }
  const gearAp = (g) => D.DISMANTLE.gearApBase + g.lines.reduce((s, l) => s + D.DISMANTLE.gearApLine[l.tier], 0);
  const canDismantle = (state, g) => !g.lock && !state.equip.includes(g.id);
  /** 장신구 분해 → AP. 잠금 · 착용 중은 건너뜀. 얻은 AP를 돌려준다 */
  function dismantleGear(state, ids) {
    let ap = 0;
    for (const id of ids) {
      const g = findGear(state, id);
      if (!g || !canDismantle(state, g)) continue;
      state.inv.gear.splice(state.inv.gear.indexOf(g), 1);
      ap += gearAp(g);
    }
    state.ap += ap;
    return ap;
  }
  /** 가방 한도를 넘은 개수 (0이 아니면 화면이 고르기 판을 띄운다) */
  const gearOverflow = (state) => Math.max(0, state.inv.gear.length - D.GEAR.bag);

  /** 씨앗 분해 → SP */
  function dismantleSeeds(state, tier, n) {
    const k = Math.min(n, state.inv.seed[tier]);
    if (k <= 0) return 0;
    state.inv.seed[tier] -= k;
    state.sp += k * D.DISMANTLE.seedSp[tier];
    return k * D.DISMANTLE.seedSp[tier];
  }

  // ── 탐험 (§4) ──
  const rollsPerHour = (state) => D.EXPLORE.rollsPerHour + state.built.explore;
  const boostedAt = (state, t) => state.explore.boosts.some(([a, b]) => t >= a && t < b);
  /** 쌓인 시간과 받을 굴림 수. 부스트 구간에서 시작한 1시간은 2배 */
  function explorePending(state, now) {
    const { lastAt } = state.explore;
    const accMs = clamp(now - lastAt, 0, D.EXPLORE.capHours * H);
    const hours = Math.floor(accMs / H);
    const r = rollsPerHour(state);
    let rolls = 0;
    for (let i = 0; i < hours; i++) rolls += boostedAt(state, lastAt + i * H) ? r * D.SHOP.boostMult : r;
    return { accMs, hours, rolls, capped: now - lastAt >= D.EXPLORE.capHours * H };
  }
  const emptyGot = () => ({ seed: [0, 0, 0, 0], mat: 0, mat2: 0, gear: [], box: 0, relic: 0 });
  /** 굴림 1번 → state.inv와 got에 더한다 */
  function exploreRoll(state, rng, mods, got) {
    if (rng() < D.EXPLORE.hidden + mods.treasure / 100) {
      const it = pick(rng, D.EXPLORE.hiddenItems);
      state.inv[it.kind]++;
      got[it.kind]++;
      return;
    }
    const it = pick(rng, pick(rng, D.EXPLORE.cats).items);
    if (it.kind === 'gear') {
      got.gear.push(rollGear(state, rng).id);
      return;
    }
    let n = randInt(rng, it.n[0], it.n[1]);
    if (it.kind === 'seed') {
      let tier = it.tier;
      if (tier < 3 && mods.goodSeed > 0 && rng() < mods.goodSeed / 100) {
        tier++;
        const up = D.EXPLORE.cats[0].items.find((s) => s.tier === tier);
        n = randInt(rng, up.n[0], up.n[1]);
      }
      n = probRound(n * (1 + mods.seedBag / 100), rng);
      state.inv.seed[tier] += n;
      got.seed[tier] += n;
    } else {
      n = probRound(n * (1 + mods.matBag / 100), rng);
      state.inv[it.kind] += n;
      got[it.kind] += n;
    }
  }
  /** 쌓인 탐험 보상을 받는다. 48시간 넘긴 시간은 버리고, 1시간 안 된 나머지는 남긴다 */
  function claimExplore(state, now, rng) {
    const { lastAt } = state.explore;
    const got = emptyGot();
    if (now < lastAt) { // 시계가 뒤로 감
      state.explore.lastAt = now;
      return { rolls: 0, hours: 0, got };
    }
    const p = explorePending(state, now);
    const mods = gearMods(state);
    for (let i = 0; i < p.rolls; i++) exploreRoll(state, rng, mods, got);
    state.explore.lastAt = p.capped ? now : lastAt + p.hours * H;
    state.explore.boosts = state.explore.boosts.filter(([, b]) => b > state.explore.lastAt);
    return { rolls: p.rolls, hours: p.hours, got };
  }
  /** 보물 상자 열기 → 결과 id */
  function openBox(state, rng) {
    if (state.inv.box < 1) return null;
    state.inv.box--;
    const o = pick(rng, D.BOX);
    if (o.np) state.bonus += o.np;
    if (o.seed) o.seed.forEach((n, t) => { state.inv.seed[t] += n; });
    if (o.mat2) state.inv.mat2 += o.mat2;
    if (o.ticket) state.inv.ticket += o.ticket;
    if (o.box) state.inv.box += o.box;
    return o.id;
  }

  // ── 농사 (§5 · §7) ──
  const plotCount = (state) => D.FIELD.start + state.built.field;
  const canPlantTier = (state, tier) => tier <= state.built.facility;
  function rollCrop(state, seedTier, rng, mods = gearMods(state)) {
    let tier = pickIndex(rng, D.SEED_TO_CROP[seedTier]);
    if (tier < 3 && mods.mutation > 0 && rng() < mods.mutation / 100) tier++;
    const list = CROPS_BY_TIER[tier];
    return list[Math.floor(rng() * list.length)];
  }
  function plant(state, i, seedTier, now, rng) {
    if (i < 0 || i >= plotCount(state) || state.plots[i]) return null;
    if (!canPlantTier(state, seedTier) || state.inv.seed[seedTier] < 1) return null;
    state.inv.seed[seedTier]--;
    const crop = rollCrop(state, seedTier, rng);
    state.plots[i] = { seed: seedTier, crop: crop.id, plantedAt: now, readyAt: now + D.FIELD.growHours * H };
    return state.plots[i];
  }
  /** 0 씨앗 · 1 새싹 · 2 자람 · 3 다 큼 */
  function growthStage(plot, now) {
    if (now >= plot.readyAt) return 3;
    const p = (now - plot.plantedAt) / (plot.readyAt - plot.plantedAt);
    return p < 0.15 ? 0 : p < 0.5 ? 1 : 2;
  }
  function useTicket(state, i, now) {
    const plot = state.plots[i];
    if (!plot || now >= plot.readyAt || state.inv.ticket < 1) return false;
    state.inv.ticket--;
    plot.readyAt = now;
    return true;
  }
  /** 풍작 표에서 지금 단계의 확률 */
  function bountyP(table, level) {
    let p = 0;
    for (const [lv, v] of Object.entries(table)) if (level >= Number(lv)) p = v;
    return p;
  }
  /** 수확 개수 = 기본 + 풍작 · 풍년 더하기, 그다음 곱하기 */
  function harvestCount(state, tier, rng, mods = gearMods(state)) {
    const L = state.built.bounty;
    let n = randInt(rng, ...D.HARVEST[tier]);
    for (const b of D.BOUNTY.add) {
      const p = b.tiers.includes(tier) ? bountyP(b.p, L) : 0;
      if (p > 0 && rng() < p) n++;
    }
    if (mods.bounty > 0 && rng() < mods.bounty / 100) n++;
    for (const m of D.BOUNTY.mul) {
      const p = m.tiers.includes(tier) ? bountyP(m.p, L) : 0;
      if (p > 0 && rng() < p) n = probRound(n * m.x, rng);
    }
    return n;
  }
  function harvest(state, i, now, rng) {
    const plot = state.plots[i];
    if (!plot || now < plot.readyAt) return null;
    const mods = gearMods(state);
    const crop = D.CROP_BY_ID[plot.crop];
    const n = harvestCount(state, crop.tier, rng, mods);
    const qualities = Array.from({ length: n }, () => rollQuality(rng, state.built.care));
    (state.inv.crop[crop.id] ||= []).push(...qualities);
    let seedBack = 0;
    const reuse = D.REUSE[state.built.reuse][crop.tier];
    if (reuse > 0 && rng() < reuse) seedBack++;
    if (mods.seedBack > 0 && rng() < mods.seedBack / 100) seedBack++;
    state.inv.seed[plot.seed] += seedBack;
    const ticket = mods.hurry > 0 && rng() < mods.hurry / 100 ? 1 : 0;
    state.inv.ticket += ticket;
    state.plots[i] = null;
    return { crop: crop.id, qualities, seedBack, ticket };
  }

  // ── 제작 (§7 · §8) ──
  const nextStep = (state, lineId) => CRAFT_BY_ID[lineId].steps[state.built[lineId]] ?? null;
  /** 'ok' · 'max'(다 만듦) · 'requires'(먼저 만들 것) · 'cost'(재료 · 돈 모자람) */
  function canCraft(state, lineId) {
    const line = CRAFT_BY_ID[lineId];
    if (line.requires && !state.built[line.requires]) return 'requires';
    const st = nextStep(state, lineId);
    if (!st) return 'max';
    if (state.inv.mat < st.mat || state.inv.mat2 < st.mat2 || state.money < st.money) return 'cost';
    return 'ok';
  }
  function craft(state, lineId) {
    if (canCraft(state, lineId) !== 'ok') return false;
    const st = nextStep(state, lineId);
    state.inv.mat -= st.mat;
    state.inv.mat2 -= st.mat2;
    state.money -= st.money;
    state.built[lineId]++;
    if (lineId === 'field') state.plots.push(null);
    return true;
  }
  const synthRatio = (state) => D.SYNTH.base - state.built.eff;
  /** 아래 등급 씨앗 (비율 × times)개 → 윗등급 times개 (합성 대성공이면 2개씩). 만든 개수 */
  function synthesize(state, fromTier, times, rng) {
    if (!state.built.synth || fromTier < 0 || fromTier > 2 || !(times >= 1)) return 0;
    const k = synthRatio(state);
    if (state.inv.seed[fromTier] < k * times) return 0;
    const crit = gearMods(state).synthCrit;
    state.inv.seed[fromTier] -= k * times;
    let out = 0;
    for (let i = 0; i < times; i++) out += crit > 0 && rng() < crit / 100 ? 2 : 1;
    state.inv.seed[fromTier + 1] += out;
    return out;
  }

  // ── 요리 (§13 · §14) ──
  /** k번째 룰렛 성공 확률 (0~1) */
  function starChances(avgQuality, tier) {
    const { penalty, step, min, max, maxStars } = D.COOK;
    return Array.from({ length: maxStars }, (_, k) => clamp(avgQuality - penalty[tier] - step * k, min, max) / 100);
  }
  /** 실패할 때까지 룰렛, 성공 횟수 = 별 */
  function rollStars(avgQuality, tier, rng) {
    const ch = starChances(avgQuality, tier);
    let s = 0;
    while (s < ch.length && rng() < ch[s]) s++;
    return s;
  }
  /**
   * picks = { 작물 id: [가방 안 인덱스, ...] } — 레시피 개수와 정확히 같아야 한다.
   * 성공하면 재료를 빼고 음식(별)을 넣는다.
   */
  function cook(state, dishId, picks, rng) {
    const dish = D.DISH_BY_ID[dishId];
    if (!dish || Object.keys(picks).length !== dish.ings.length) return null;
    const qualities = [];
    for (const [cropId, n] of dish.ings) {
      const have = state.inv.crop[cropId] || [];
      const idx = picks[cropId];
      if (!Array.isArray(idx) || idx.length !== n || new Set(idx).size !== n) return null;
      if (idx.some((i) => !Number.isInteger(i) || i < 0 || i >= have.length)) return null;
      qualities.push(...idx.map((i) => have[i]));
    }
    const avg = qualities.reduce((a, b) => a + b, 0) / qualities.length;
    const stars = rollStars(avg, dish.tier, rng);
    for (const [cropId] of dish.ings) {
      const have = state.inv.crop[cropId];
      for (const i of [...picks[cropId]].sort((a, b) => b - a)) have.splice(i, 1);
      if (!have.length) delete state.inv.crop[cropId];
    }
    (state.inv.food[dishId] ||= []).push(stars);
    return { stars, avg };
  }
  /** 품질이 가장 높은 재료로 고른 picks (모자라면 null) */
  function bestPicks(state, dishId) {
    const dish = D.DISH_BY_ID[dishId];
    const picks = {};
    for (const [cropId, n] of dish.ings) {
      const have = state.inv.crop[cropId] || [];
      if (have.length < n) return null;
      picks[cropId] = have.map((q, i) => [q, i]).sort((a, b) => b[0] - a[0]).slice(0, n).map(([, i]) => i);
    }
    return picks;
  }
  const priceCache = {};
  /** 원래 값: 등급 기본 가격 ± 폭, 요리마다 시드로 한 번 정해 모두에게 같다 */
  function dishPrice(dishId) {
    if (!(dishId in priceCache)) {
      const { basePrice, priceSpread } = D.COOK;
      const u = rngFromSeed('farm:price:' + dishId)();
      priceCache[dishId] = Math.round(basePrice[D.DISH_BY_ID[dishId].tier] * (1 + (u * 2 - 1) * priceSpread));
    }
    return priceCache[dishId];
  }
  const foodValue = (dishId, stars) => dishPrice(dishId) * D.COOK.starMult[stars];
  function takeFood(state, dishId, stars) {
    const list = state.inv.food[dishId];
    const i = list ? list.indexOf(stars) : -1;
    if (i < 0) return false;
    list.splice(i, 1);
    if (!list.length) delete state.inv.food[dishId];
    return true;
  }
  /** 음식 1개 판매 → 돈 */
  function sellFood(state, dishId, stars) {
    if (!takeFood(state, dishId, stars)) return 0;
    const v = foodValue(dishId, stars);
    state.money += v;
    return v;
  }

  // ── 도감 (§14) ──
  const codexCache = {};
  /** 시즌 도감 6개 (시드 farm:{season}:codex, 등급별 1 · 2 · 2 · 1개) */
  function codexDishes(season) {
    if (!codexCache[season]) {
      const rng = rngFromSeed(`farm:${season}:codex`);
      codexCache[season] = D.COOK.codex.flatMap((n, tier) => shuffle(D.DISHES.filter((d) => d.tier === tier).map((d) => d.id), rng).slice(0, n));
    }
    return codexCache[season];
  }
  /** 처음이거나 지금 기록보다 별이 높을 때만 */
  const canSubmit = (state, dishId, stars) => codexDishes(state.season).includes(dishId)
    && (state.inv.food[dishId] || []).includes(stars) && !(state.codex[dishId] >= stars);
  function submitCodex(state, dishId, stars) {
    if (!canSubmit(state, dishId, stars)) return false;
    takeFood(state, dishId, stars);
    state.codex[dishId] = stars;
    return true;
  }

  // ── 상점 (§15) ──
  const boughtToday = (state, key, today) => (state.shop.day === today ? state.shop.bought[key] || 0 : 0);
  function countBuy(state, key, today) {
    if (state.shop.day !== today) state.shop = { day: today, bought: {} };
    state.shop.bought[key] = (state.shop.bought[key] || 0) + 1;
  }
  /** 부스트 구간을 넣는다. 켜져 있으면 끝 시각에 이어 붙인다 (×4 아님) */
  function addBoost(state, now) {
    const b = state.explore.boosts;
    const last = b[b.length - 1];
    const from = last && last[1] > now ? last[1] : now;
    b.push([from, from + D.SHOP.boostHours * H]);
  }
  /** NP 상점. balance = 지금 NP 잔액. 'ok' · 'limit' · 'np' · 'none' */
  function buyNp(state, itemId, today, balance, now) {
    const it = D.SHOP.np.find((x) => x.id === itemId);
    if (!it) return 'none';
    if (boughtToday(state, 'np:' + itemId, today) >= it.limit) return 'limit';
    if (balance < it.price) return 'np';
    countBuy(state, 'np:' + itemId, today);
    state.spent += it.price;
    if (itemId === 'boost') addBoost(state, now);
    else state.inv.ticket++;
    return 'ok';
  }
  const offerCache = {};
  /** 그날 AP · SP 상점 상품 (시드 farm:{날짜}:shop, 같은 날 두 상점에 같은 상품 없음) */
  function shopOffers(today) {
    if (!offerCache[today]) {
      const ids = shuffle(D.SHOP.apsp.map((x) => x.id), rngFromSeed(`farm:${today}:shop`));
      const k = D.SHOP.offers;
      offerCache[today] = { ap: ids.slice(0, k), sp: ids.slice(k, 2 * k) };
    }
    return offerCache[today];
  }
  const shopPrice = (item, cur) => (cur === 'ap' ? item.ap : item.ap * D.SHOP.spRatio);
  /** AP · SP 상점. cur = 'ap' | 'sp'. 'ok' · 'none'(오늘 상품 아님) · 'limit' · 'ap' | 'sp'(모자람) */
  function buyShop(state, cur, itemId, today, rng) {
    const it = D.SHOP.apsp.find((x) => x.id === itemId);
    if (!it || !shopOffers(today)[cur]?.includes(itemId)) return 'none';
    const key = cur + ':' + itemId;
    if (boughtToday(state, key, today) >= it.limit) return 'limit';
    const price = shopPrice(it, cur);
    if (state[cur] < price) return cur;
    countBuy(state, key, today);
    state[cur] -= price;
    const g = it.give || {};
    if (g.mat) state.inv.mat += g.mat;
    if (g.mat2) state.inv.mat2 += g.mat2;
    if (g.ticket) state.inv.ticket += g.ticket;
    if (g.seed) g.seed.forEach((n, t) => { state.inv.seed[t] += n; });
    if (it.gearLines) rollGear(state, rng, it.gearLines);
    return 'ok';
  }

  F.engine = {
    H, VERSION, rngFromSeed, hashString, mulberry32, quality: QT, rollQuality,
    seasonOf, newState, isValidState, rollSeason, daysLeft, codexSummary,
    markAttendance, npEarned, npBalance,
    equipSlots, gearMods, rollGear, openRelic, equipGear, unequipGear, toggleLock, gearAp, canDismantle, dismantleGear, gearOverflow,
    dismantleSeeds, OPT_BY_ID,
    rollsPerHour, explorePending, claimExplore, openBox, exploreRoll, emptyGot,
    plotCount, canPlantTier, rollCrop, plant, growthStage, useTicket, harvestCount, harvest,
    nextStep, canCraft, craft, synthRatio, synthesize,
    starChances, rollStars, cook, bestPicks, dishPrice, foodValue, sellFood,
    codexDishes, canSubmit, submitCodex,
    boughtToday, buyNp, shopOffers, shopPrice, buyShop,
  };
})();
