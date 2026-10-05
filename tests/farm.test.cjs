// 데일리 농장 카드 (#farm) — 허브 위치 · NP · 탐험 · 심기/수확 · 제작 · 요리/판매 · 도감 · 상점 · 가방 · 장신구 넘침 · 시즌 넘김.
// 규칙 계산은 farm-engine.test.cjs가 보고, 여기선 화면에서 눌러서 그대로 되는지 본다. 시각은 page.clock, 난수는 고정.
const path = require('path');
const { chromium, startSite, check, finish, SHOTS } = require('./lib.cjs');

const NOW = new Date('2026-10-06T12:00:00+09:00');
const H = 3600000;

/** Math.random 고정 (mulberry32) — 화면 테스트도 매번 같은 결과 */
function fixRandom() {
  let a = 20261006;
  Math.random = () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
/** 이것저것 다 있는 state (시즌 중반 플레이어) */
function richState(now) {
  const E = window.DailyFarm.engine;
  const s = E.newState('2026-10', now - 30 * 3600000);
  Object.assign(s.built, { field: 6, synth: 1, eff: 2, care: 1, facility: 3, reuse: 2, bounty: 9, explore: 1, equip: 2 });
  s.plots = Array(8).fill(null);
  s.plots[0] = { seed: 0, crop: 'potato', plantedAt: now - 9 * 3600000, readyAt: now - 3600000 };
  s.plots[1] = { seed: 2, crop: 'truffle', plantedAt: now - 2 * 3600000, readyAt: now + 6 * 3600000 };
  s.plots[2] = { seed: 3, crop: 'goldapple', plantedAt: now - 5 * 3600000, readyAt: now + 3 * 3600000 };
  s.plots[5] = { seed: 1, crop: 'strawberry', plantedAt: now - 8.5 * 3600000, readyAt: now - 1800000 };
  Object.assign(s.inv, { seed: [120, 45, 12, 2], mat: 300, mat2: 60, ticket: 3, box: 2, relic: 1 });
  Object.assign(s, { money: 12345, sp: 800, ap: 90 });
  let q = 7;
  for (const c of window.DailyFarm.data.CROPS.slice(0, 30)) s.inv.crop[c.id] = Array.from({ length: 2 + (q % 9) }, () => (q = (q * 37 + 11) % 97) + 1);
  s.inv.food = { 1: [0, 1, 2, 3], 45: [1, 1], 91: [0] };
  for (let i = 0; i < 30; i++) E.rollGear(s, Math.random);
  E.equipGear(s, s.inv.gear[0].id);
  s.codex[E.codexDishes('2026-10')[0]] = 2;
  s.explore.boosts = [[now - 3600000, now + 5 * 3600000]];
  return s;
}

(async () => {
  const site = await startSite();
  const BASE = site.base;
  const b = await chromium.launch();
  const errors = [];
  async function open(seed, { size = [390, 844], hash = '#farm' } = {}) {
    const ctx = await b.newContext({ viewport: { width: size[0], height: size[1] } });
    const p = await ctx.newPage();
    p.on('pageerror', (e) => errors.push(e.message));
    p.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
    await p.clock.install({ time: NOW });
    await p.addInitScript(fixRandom);
    if (seed) await p.addInitScript(seed);
    await p.goto(BASE + hash);
    await p.waitForTimeout(200);
    return { ctx, p };
  }
  const panelTitle = (p) => p.locator('#farm .farm-panel-title').textContent();
  const panelOpen = (p) => p.locator('#farm .farm-panel').isVisible();
  const tab = (p, id) => p.click(`#farm .farm-tab[data-tab="${id}"]`);
  const fits = (p) => p.locator('#farm .landing-card').evaluate((c) => {
    const body = c.querySelector('.farm-body'), panel = c.querySelector('.farm-panel');
    return c.scrollHeight <= c.clientHeight && body.scrollHeight <= body.clientHeight + 1 && (panel.hidden || panel.scrollHeight <= panel.clientHeight + 1);
  });
  const shot = (p, name) => p.screenshot({ path: path.join(SHOTS, `farm-${name}.png`) });

  // 1. 허브 위치 · 처음 상태 · NP
  {
    const { ctx, p } = await open(() => {
      const results = {};
      for (let d = 1; d <= 6; d++) results[`2026-10-0${d}`] = { status: d % 3 ? 'solved' : 'failed', attempt: 2 };
      results['2026-09-30'] = { status: 'solved', attempt: 1 };
      localStorage.setItem('trilateral:stats', JSON.stringify({ results }));
    }, { hash: '' });
    check(new URL(p.url()).hash === '#home', `첫 화면은 여전히 홈 (${new URL(p.url()).hash})`);
    const order = await p.locator('.hub-slide').evaluateAll((s) => s.map((e) => e.id));
    check(order[0] === 'farm' && order[1] === 'home' && order.length === 6, `슬라이드: 농장 · 홈 · 게임 넷 (${order.join(',')})`);
    await p.keyboard.press('ArrowLeft');
    await p.waitForTimeout(600);
    check(new URL(p.url()).hash === '#farm', '홈에서 왼쪽 = #farm');
    const np = await p.textContent('#farm .farm-coin[data-cur="np"] .farm-coin-n');
    check(np === '21', `NP: 출석 1일 5 + 성공 4 × 3 + 실패 2 × 2 = 21, 9월 기록은 빠짐 (${np})`);
    await p.click('#farm .farm-coin[data-cur="np"]');
    check((await panelTitle(p)) === 'NP 내역' && (await p.locator('#farm .farm-np-row').count()) === 6, 'NP를 누르면 내역');
    await p.keyboard.press('Escape');
    check(!(await panelOpen(p)), 'Esc로 판 닫기');
    check(await p.locator('#farm .farm-plot').count() === 8 && await p.locator('#farm .farm-plot.is-locked').count() === 6, '밭 8칸 중 처음엔 2칸만 (6칸 잠김)');
    const saved = await p.evaluate(() => JSON.parse(localStorage.getItem('daily-farm:state')));
    check(saved.season === '2026-10' && saved.attendance.includes('2026-10-06'), '저장: 시즌 2026-10 · 오늘 출석');
    await shot(p, 'start');
    await ctx.close();
  }

  // 2. 탐험 · 심기 · 수확 (처음 상태에서 시간을 보내며)
  {
    const { ctx, p } = await open(null);
    await tab(p, 'explore');
    check(await p.locator('#farm .farm-claim').isDisabled(), '탐험: 막 시작하면 받을 게 없음');
    await p.clock.fastForward(3 * H + 40 * 60000);
    await p.waitForTimeout(1100);
    const label = await p.textContent('#farm .farm-claim');
    check(label === '받기 · 9번', `3시간 40분 뒤 9번 (${label})`);
    await p.click('#farm .farm-claim');
    check((await panelTitle(p)) === '탐험 3시간 · 9번' && (await p.locator('#farm .farm-got-cell').count()) > 0, '받기 → 얻은 것 판');
    await shot(p, 'got');
    await p.click('#farm .farm-panel .landing-btn');
    const seeds = await p.evaluate(() => JSON.parse(localStorage.getItem('daily-farm:state')).inv.seed[0]);
    check(seeds > 0, `일반 씨앗을 얻음 (${seeds}개)`);
    await tab(p, 'farm');
    await p.click('#farm .farm-plot[data-plot="0"]');
    check((await panelTitle(p)) === '1번 칸에 심기', '빈 칸 → 심기 판');
    check(await p.locator('#farm .farm-panel .farm-item').nth(1).locator('.farm-btn').first().isDisabled(), '시설 강화 전엔 고급 씨앗 못 심음');
    await p.locator('#farm .farm-panel .farm-item').first().locator('.farm-btn').first().click();
    check(await p.locator('#farm .farm-plot[data-plot="0"] .farm-plant').count() === 1, '심으면 칸에 새싹');
    const left = await p.textContent('#farm .farm-plot[data-plot="0"] .farm-plot-label');
    check(left === '8:00', `남은 시간 8:00 (${left})`);
    await p.clock.fastForward(8 * H - 60000);
    await p.waitForTimeout(1100);
    check(!(await p.locator('#farm .farm-plot[data-plot="0"]').evaluate((e) => e.classList.contains('is-ready'))), '7시간 59분 → 아직');
    await p.clock.fastForward(61000);
    await p.waitForTimeout(1100);
    check(await p.locator('#farm .farm-plot[data-plot="0"]').evaluate((e) => e.classList.contains('is-ready')), '8시간 → 다 큼 (수확!)');
    await shot(p, 'ready');
    await p.click('#farm .farm-plot[data-plot="0"]');
    const st = await p.evaluate(() => JSON.parse(localStorage.getItem('daily-farm:state')));
    check(st.plots[0] === null && Object.values(st.inv.crop).flat().length >= 2, `수확 → 작물 ${Object.values(st.inv.crop).flat().length}개 (토스트: ${await p.textContent('#farm .farm-toast')})`);
    await ctx.close();
  }

  // 3. 시즌 중반 state: 모든 탭 · 판 (그림 · 넘침 확인)
  {
    const { ctx, p } = await open(null);
    await p.evaluate(`localStorage.setItem('daily-farm:state', JSON.stringify((${richState.toString()})(Date.now())))`);
    await p.reload();
    await p.waitForTimeout(300);
    check(await p.locator('#farm .farm-plot.is-ready').count() === 2 && await p.locator('#farm .farm-plot.is-locked').count() === 0, '밭 8칸 · 다 큰 칸 2');
    await shot(p, 'tab-farm');
    await p.click('#farm .farm-plot[data-plot="1"]');
    check((await panelTitle(p)) === '2번 칸 · 자라는 중', '자라는 칸 → 즉시 완료권 판');
    await p.click('#farm .farm-panel .landing-btn');
    const t = await p.evaluate(() => JSON.parse(localStorage.getItem('daily-farm:state')));
    check(t.plots[1] === null && t.inv.ticket === 2 && t.inv.crop.truffle?.length >= 1, '즉시 완료권 → 바로 수확 (완료권 3 → 2)');
    await p.click('#farm .farm-row .farm-btn');
    check(await p.locator('#farm .farm-plot.is-ready').count() === 0, '모두 수확');

    for (const id of ['explore', 'craft', 'cook', 'codex', 'shop']) {
      await tab(p, id);
      await shot(p, 'tab-' + id);
      check(await fits(p), `${id} 탭: 카드 안에 들어감`);
    }
    // 제작
    await tab(p, 'craft');
    const before = await p.evaluate(() => JSON.parse(localStorage.getItem('daily-farm:state')).built.care);
    await p.click('#farm .farm-craft[data-line="care"] .farm-btn');
    const after = await p.evaluate(() => JSON.parse(localStorage.getItem('daily-farm:state')));
    check(after.built.care === before + 1 && after.money === 12345 - 2900, `정성스레 2 만들기 → 돈 2,900 빠짐 (${after.money})`);
    await p.click('#farm .farm-seg button[data-seg="synth"]');
    await shot(p, 'tab-craft-synth');
    await p.click('#farm .farm-item[data-synth="0"] .farm-btn');
    check((await p.evaluate(() => JSON.parse(localStorage.getItem('daily-farm:state')).inv.seed[0])) === 120 - 8, '합성: 효율 증대 2 → 일반 씨앗 8개 → 고급 1개');
    // 요리 → 판매
    await tab(p, 'cook');
    await p.click('#farm .farm-toggle');
    await p.locator('#farm .farm-dish').first().click();
    await shot(p, 'panel-cook');
    check(await fits(p), '요리 판: 카드 안에 들어감');
    await p.locator('#farm .farm-panel .landing-btn', { hasText: '요리하기' }).click();
    const stars = await p.locator('#farm .farm-result').getAttribute('data-stars');
    check(stars !== null, `요리 → 별 ${stars}개`);
    await shot(p, 'panel-cook-result');
    const m0 = await p.evaluate(() => JSON.parse(localStorage.getItem('daily-farm:state')).money);
    await p.locator('#farm .farm-panel .farm-btn', { hasText: '팔기' }).click();
    const m1 = await p.evaluate(() => JSON.parse(localStorage.getItem('daily-farm:state')).money);
    check(m1 > m0, `팔기 → 돈 ${m0} → ${m1}`);
    // 도감
    await tab(p, 'codex');
    check((await p.locator('#farm .farm-codex-cell').count()) === 6, '도감 6칸');
    // 상점
    await tab(p, 'shop');
    await p.click('#farm .farm-shop-item[data-item="ticket"] .farm-btn');
    const t2 = await p.evaluate(() => JSON.parse(localStorage.getItem('daily-farm:state')));
    check(t2.inv.ticket === 3 && t2.spent === 2, 'NP 상점: 완료권 2 NP → +1장');
    await p.click('#farm .farm-seg button[data-seg="ap"]');
    await shot(p, 'tab-shop-ap');
    // 가방
    await p.click('#farm .farm-bag');
    for (const s of ['crop', 'item', 'food', 'gear']) {
      await p.click(`#farm .farm-panel .farm-seg button[data-seg="${s}"]`);
      await shot(p, 'bag-' + s);
      check(await fits(p), `가방 ${s}: 카드 안에 들어감`);
    }
    const ap0 = await p.evaluate(() => JSON.parse(localStorage.getItem('daily-farm:state')).ap);
    await p.locator('#farm .farm-panel .farm-gear').nth(1).locator('.farm-btn', { hasText: '분해' }).click();
    const ap1 = await p.evaluate(() => JSON.parse(localStorage.getItem('daily-farm:state')).ap);
    check(ap1 > ap0, `장신구 분해 → AP ${ap0} → ${ap1}`);
    check(await p.locator('#farm .farm-panel .farm-gear').first().locator('.farm-btn', { hasText: '분해' }).isDisabled(), '착용 중인 장신구는 분해 버튼 꺼짐');
    await p.click('#farm .farm-panel .farm-seg button[data-seg="item"]');
    const sp0 = await p.evaluate(() => JSON.parse(localStorage.getItem('daily-farm:state')).sp);
    await p.locator('#farm .farm-panel .farm-item[data-seed="3"] .farm-btn', { hasText: '분해' }).click();
    check((await p.evaluate(() => JSON.parse(localStorage.getItem('daily-farm:state')).sp)) === sp0 + 100, '전설 씨앗 분해 → SP +100');
    await ctx.close();
  }

  // 4. 장신구 넘침: 98개에서 탐험으로 넘치면 고르기 판 (닫을 수 없음, 새로고침해도 다시)
  {
    const { ctx, p } = await open(null);
    await p.evaluate(() => {
      const E = window.DailyFarm.engine;
      const s = E.newState('2026-10', Date.now());
      for (let i = 0; i < 103; i++) E.rollGear(s, Math.random);
      localStorage.setItem('daily-farm:state', JSON.stringify(s));
    });
    await p.reload();
    await p.waitForTimeout(300);
    check((await panelTitle(p)).startsWith('가방이 넘쳤어요 · 3개'), `103개면 고르기 판 (${await panelTitle(p)})`);
    check(await p.locator('#farm .farm-panel-close').count() === 0, '닫기 버튼 없음');
    await p.keyboard.press('Escape');
    check(await panelOpen(p), 'Esc로도 안 닫힘');
    await shot(p, 'overflow');
    const rows = p.locator('#farm .farm-panel .farm-gear');
    for (let i = 0; i < 2; i++) await rows.nth(i).locator('.farm-btn').click();
    check(await p.locator('#farm .farm-panel .landing-btn').isDisabled(), '3개 고르기 전엔 분해 꺼짐');
    await rows.nth(2).locator('.farm-btn').click();
    await p.locator('#farm .farm-panel .landing-btn').click();
    const st = await p.evaluate(() => JSON.parse(localStorage.getItem('daily-farm:state')));
    check(!(await panelOpen(p)) && st.inv.gear.length === 100 && st.ap > 0, `3개 분해 → 100개, 판 닫힘 (AP ${st.ap})`);
    await ctx.close();
  }

  // 5. 시즌 넘김: 9월 state → 10월에 열면 history + 새 state + 안내
  {
    const { ctx, p } = await open(null);
    await p.evaluate(() => {
      const E = window.DailyFarm.engine;
      const s = E.newState('2026-09', Date.now() - 10 * 86400000);
      s.codex = { 3: 2, 50: 3, 77: 1 };
      s.money = 999;
      localStorage.setItem('daily-farm:state', JSON.stringify(s));
    });
    await p.reload();
    await p.waitForTimeout(300);
    const st = await p.evaluate(() => ({ s: JSON.parse(localStorage.getItem('daily-farm:state')), h: JSON.parse(localStorage.getItem('daily-farm:history')) }));
    check(st.s.season === '2026-10' && st.s.money === 0 && JSON.stringify(st.h) === JSON.stringify([{ season: '2026-09', done: 3, stars: 6 }]), `시즌 넘김: history ${JSON.stringify(st.h)} · 새 시즌`);
    check((await panelTitle(p)) === '9월 시즌 끝', '새 시즌 첫 진입 → 지난 시즌 결과 안내');
    await shot(p, 'season');
    const badge = await p.textContent('#home .home-farm');
    check(badge === '🌾 9월 도감 3/6 · ★6' && await p.locator('#home .home-farm').isVisible(), `홈 프로필에 지난 시즌 도감 배지 (${badge})`);
    await ctx.close();
  }

  // 6. 깨진 저장값 → 새 state
  {
    const { ctx, p } = await open(() => { localStorage.setItem('daily-farm:state', '{"v":1,"season":'); });
    const st = await p.evaluate(() => JSON.parse(localStorage.getItem('daily-farm:state')));
    check(st.season === '2026-10' && st.plots.length === 2, '깨진 저장값이면 새로 시작');
    await ctx.close();
  }

  check(errors.length === 0, `콘솔/페이지 에러 없음 ${errors.length ? JSON.stringify(errors.slice(0, 3)) : ''}`);
  await b.close();
  site.close();
  finish();
})().catch((e) => { console.error(e); process.exit(1); });
