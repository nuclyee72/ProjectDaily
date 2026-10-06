// 허브 카드의 메인·모든 하위 화면이 여러 화면 크기에서 카드 폭 그대로 · 스크롤 없이 들어가는지 (6줄 달 기준)
// 농장 카드: 탭 6개 + 판(가방 5칸 · 장신구 칸 고르기 · NP · 심기 · 요리 · 도움말 8쪽 · 넘친 가방)이 본문 · 판 안에 넘치지 않는지 (물건이 많은 시즌 중반 기준)
const path = require('path');
const { chromium, startSite, check, finish, SHOTS } = require('./lib.cjs');
const SIZES = [[320, 480], [375, 548], [360, 640], [390, 664], [393, 700], [412, 780], [390, 844], [1280, 720], [1280, 600]];
const VIEWS = [['메인', null], ['지난 퍼즐', null], ['자유 연습', null], ['통계', '달력'], ['통계', '분포']];
(async () => {
  const site = await startSite();
  const BASE = site.base;
  const b = await chromium.launch();
  let bad = 0, worst = {};
  for (const [w, h] of SIZES) {
    const ctx = await b.newContext({ viewport: { width: w, height: h } });
    const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.clock.setFixedTime(new Date('2027-01-15T12:00:00+09:00'));
    // 홈은 기록이 있을 때 가장 길다 — 긴 닉네임 · 세 자리 판 수
    await p.addInitScript(() => {
      localStorage.setItem('daily-hub:profile', JSON.stringify({ avatar: '🐙', name: '가나다라마바사아자차카타' }));
      const results = {};
      for (let d = 1; d <= 31; d++) for (const m of ['01', '12']) results[`2026-${m}-${String(d).padStart(2, '0')}`] = { status: d % 4 ? 'solved' : 'failed', attempt: 3 };
      localStorage.setItem('wordship:stats', JSON.stringify({ results }));
      localStorage.setItem('trilateral:stats', JSON.stringify({ results }));
      localStorage.setItem('daily-farm:history', JSON.stringify([{ season: '2026-12', done: 6, stars: 18 }]));
    });
    await p.goto(BASE);
    // 농장: 물건이 많은 state를 넣고 다시 연다
    await p.evaluate(() => {
      const E = window.DailyFarm.engine;
      const s = E.newState('2027-01', Date.now() - 30 * 3600000);
      Object.assign(s.built, { field: 6, synth: 1, eff: 3, care: 2, facility: 3, reuse: 4, bounty: 16, explore: 2, equip: 2 });
      s.plots = Array.from({ length: 8 }, (_, i) => (i % 3 ? { seed: 2, crop: 'goldapple', plantedAt: Date.now() - 9 * 3600000, readyAt: Date.now() - (i % 2) * 7200000 + 3600000 } : null));
      Object.assign(s.inv, { seed: [12345, 4567, 890, 12], mat: 2345, mat2: 456, ticket: 23, box: 12, relic: 3 });
      Object.assign(s, { money: 1234567, sp: 23456, ap: 1234, bonus: 900 });
      for (const c of window.DailyFarm.data.CROPS) s.inv.crop[c.id] = Array.from({ length: 18 }, (_, k) => ((k * 37) % 100) + 1); // 990개 (한도 1,000 아래)
      for (const d of window.DailyFarm.data.DISHES.slice(0, 40)) s.inv.food[d.id] = [0, 1, 2, 3];
      for (let i = 0; i < 100; i++) E.rollGear(s, () => ((i * 7919) % 1000) / 1000);
      s.explore.boosts = [[Date.now() - 3600000, Date.now() + 5 * 3600000]];
      localStorage.setItem('daily-farm:state', JSON.stringify(s));
    });
    await p.reload();
    {
      await p.evaluate(() => document.getElementById('farm').scrollIntoView({ behavior: 'instant', inline: 'start' }));
      const card = p.locator('#farm .landing-card');
      const w0 = await p.locator('#sudoku .landing-card').evaluate((e) => e.getBoundingClientRect().width);
      const views = [];
      for (const t of ['farm', 'explore', 'craft', 'cook', 'codex', 'shop']) views.push([t, () => p.click(`#farm .farm-tab[data-tab="${t}"]`)]);
      for (const sg of ['crop', 'item', 'food', 'gear', 'misc']) views.push(['가방/' + sg, async () => { await p.click('#farm .farm-bag'); await p.click(`#farm .farm-panel .farm-seg button[data-seg="${sg}"]`); }]);
      views.push(['가방/장신구 칸', async () => { await p.click('#farm .farm-bag'); await p.click('#farm .farm-panel .farm-seg button[data-seg="gear"]'); await p.click('#farm .farm-equip-slot[data-slot="0"]'); }]);
      views.push(['가방/완료권', async () => { await p.click('#farm .farm-bag'); await p.click('#farm .farm-panel .farm-seg button[data-seg="misc"]'); await p.click('#farm .farm-item[data-misc="ticket"] .farm-btn'); }]);
      views.push(['NP', () => p.click('#farm .farm-coin[data-cur="np"]')]);
      views.push(['심기', async () => { await p.click('#farm .farm-tab[data-tab="farm"]'); await p.click('#farm .farm-plot.is-empty'); }]);
      // 요리: 재료 칸이 가장 많은 배추김치 (7칸)
      views.push(['요리', async () => {
        await p.click('#farm .farm-tab[data-tab="cook"]');
        while (!(await p.locator('#farm .farm-dish[data-dish="12"]').count())) await p.locator('#farm .farm-body .farm-page-btn').last().click();
        await p.click('#farm .farm-dish[data-dish="12"]');
      }]);
      for (let k = 0; k < 8; k++) views.push(['도움말' + k, async () => { await p.click('#farm .farm-help-btn'); await p.locator('#farm .farm-help-nav button').nth(k).click(); }]);
      for (const [key, go] of views) {
        await go();
        await p.waitForTimeout(80);
        const r = await card.evaluate((c) => {
          const cr = c.getBoundingClientRect(); const slide = c.parentElement;
          const dots = document.getElementById('hub-dots').getBoundingClientRect();
          const body = c.querySelector('.farm-body'), panel = c.querySelector('.farm-panel');
          const over = [...c.querySelectorAll('.farm-row, .farm-wallet, .farm-head')].some((e) => e.scrollWidth > e.clientWidth + 1);
          return { w: cr.width, h: Math.round(cr.height), scroll: c.scrollHeight - c.clientHeight, slide: slide.scrollHeight - slide.clientHeight, top: Math.round(cr.top), gap: Math.round(dots.top - cr.bottom),
            body: body.scrollHeight - body.clientHeight, panel: panel.hidden ? 0 : panel.scrollHeight - panel.clientHeight, over };
        });
        const ok = Math.abs(r.w - w0) < 0.5 && r.scroll <= 0 && r.slide <= 0 && r.top >= 0 && r.gap >= 0 && r.body <= 1 && r.panel <= 1 && !r.over;
        if (!ok) { bad++; console.log(`FAIL ${w}x${h} farm ${key}: ${JSON.stringify(r)}`); }
        worst['농장/' + key] = Math.max(worst['농장/' + key] ?? 0, r.h);
        if ((w === 390 && h === 844) || (w === 320 && h === 480)) await p.screenshot({ path: path.join(SHOTS, `view-farm-${key.replace('/', '-')}-${w}x${h}.png`) });
        await p.keyboard.press('Escape');
      }
      // 넘친 가방 (닫을 수 없음, 알림 줄이 한 줄 더): 작물 1,010개 · 장신구 103개
      for (const kind of ['crop', 'gear']) {
        await p.evaluate((k) => {
          const s = JSON.parse(localStorage.getItem('daily-farm:state'));
          if (k === 'crop') s.inv.crop.potato.push(...Array(20).fill(50));
          else for (let i = 0; i < 3; i++) window.DailyFarm.engine.rollGear(s, Math.random);
          localStorage.setItem('daily-farm:state', JSON.stringify(s));
        }, kind);
        await p.reload();
        await p.evaluate(() => document.getElementById('farm').scrollIntoView({ behavior: 'instant', inline: 'start' }));
        await p.waitForTimeout(80);
        const r = await card.evaluate((c) => {
          const panel = c.querySelector('.farm-panel');
          return { title: c.querySelector('.farm-panel-title')?.textContent, scroll: c.scrollHeight - c.clientHeight, panel: panel.hidden ? -1 : panel.scrollHeight - panel.clientHeight };
        });
        const ok = r.title === '가방이 넘쳤어요' && r.scroll <= 0 && r.panel >= 0 && r.panel <= 1;
        if (!ok) { bad++; console.log(`FAIL ${w}x${h} farm 넘침/${kind}: ${JSON.stringify(r)}`); }
        if ((w === 390 && h === 844) || (w === 320 && h === 480)) await p.screenshot({ path: path.join(SHOTS, `view-farm-overflow-${kind}-${w}x${h}.png`) });
      }
    }
    {
      await p.evaluate(() => document.getElementById('home').scrollIntoView({ behavior: 'instant', inline: 'start' }));
      await p.waitForTimeout(150);
      const r = await p.locator('#home .landing-card').evaluate((c) => {
        const cr = c.getBoundingClientRect(); const slide = c.parentElement;
        const dots = document.getElementById('hub-dots').getBoundingClientRect();
        const over = [...c.querySelectorAll('.home-tile, .home-ratio-legend, .home-week-head')].some((e) => e.scrollWidth > e.clientWidth + 1);
        return { w: cr.width, h: Math.round(cr.height), scroll: c.scrollHeight - c.clientHeight, slide: slide.scrollHeight - slide.clientHeight, top: Math.round(cr.top), gap: Math.round(dots.top - cr.bottom), over };
      });
      const w0 = await p.locator('#sudoku .landing-card').evaluate((e) => e.getBoundingClientRect().width);
      const ok = Math.abs(r.w - w0) < 0.5 && r.scroll <= 0 && r.slide <= 0 && r.top >= 0 && r.gap >= 0 && !r.over;
      if (!ok) { bad++; console.log(`FAIL ${w}x${h} home: 폭 ${Math.round(r.w)} (게임 카드 ${Math.round(w0)}) 높이 ${r.h} 위 ${r.top} 점까지 ${r.gap} 가로 넘침 ${r.over}`); }
      worst['홈'] = Math.max(worst['홈'] ?? 0, r.h);
      if (w === 390 && h === 844) await p.screenshot({ path: path.join(SHOTS, 'view-home.png') });
      if (w === 320 && h === 480) await p.screenshot({ path: path.join(SHOTS, 'view-home-320x480.png') });
    }
    for (const slug of ['sudoku', 'trilateral', 'wordship', 'bwsweeper']) {
      await p.evaluate((s) => { location.hash = s; }, slug);
      await p.evaluate((s) => document.getElementById(s).scrollIntoView({ behavior: 'instant', inline: 'start' }), slug);
      const card = p.locator(`#${slug} .landing-card`);
      const w0 = await card.evaluate((e) => e.getBoundingClientRect().width);
      for (const [btn, pane] of VIEWS) {
        const opener = p.locator(`#${slug} .landing-stack:not([hidden]) :is(.landing-btn,.landing-mini-btn)`, { hasText: btn });
        if (btn === '자유 연습' && slug === 'sudoku') continue; // 스도쿠는 바로 게임으로
        if (btn !== '메인') await opener.evaluate((e) => e.click());
        if (pane) { await p.locator(`#${slug} .stats-seg button`, { hasText: pane }).evaluate((e) => e.click()); }
        await p.waitForTimeout(150);
        const r = await card.evaluate((c) => {
          const cr = c.getBoundingClientRect(); const slide = c.parentElement;
          const dots = document.getElementById('hub-dots').getBoundingClientRect();
          return { w: cr.width, h: Math.round(cr.height), scroll: c.scrollHeight - c.clientHeight, slide: slide.scrollHeight - slide.clientHeight, top: Math.round(cr.top), gap: Math.round(dots.top - cr.bottom) };
        });
        const ok = Math.abs(r.w - w0) < 0.5 && r.scroll <= 0 && r.slide <= 0 && r.top >= 0 && r.gap >= 0;
        const key = `${btn}${pane ? '/' + pane : ''}`;
        if (!ok) { bad++; console.log(`FAIL ${w}x${h} ${slug} ${key}: 폭 ${Math.round(w0)}→${Math.round(r.w)} 높이 ${r.h} 위 ${r.top} 점까지 ${r.gap}`); }
        worst[key] = Math.max(worst[key] ?? 0, r.h);
        if (w === 390 && h === 844) await p.screenshot({ path: path.join(SHOTS, `view-${slug}-${key.replace('/', '-')}.png`) });
        if (btn !== '메인') await p.locator(`#${slug} .hub-back`).evaluate((e) => e.click());
      }
    }
    if (errs.length) { bad++; console.log(`에러 ${w}x${h}: ${errs.join(' | ')}`); }
    await ctx.close();
  }
  await b.close(); site.close();
  console.log('최대 높이(px):', JSON.stringify(worst));
  check(bad === 0, `모든 화면 · ${SIZES.length}가지 크기에서 카드 폭 그대로 · 스크롤 없음`);
  finish();
})().catch((e) => { console.error(e); process.exit(1); });
