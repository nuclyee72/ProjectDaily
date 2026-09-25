// 허브 카드 안 통계 = 게임 통계창 (숫자 · 분포 · 달력 공유 문구 · 오늘 결과 공유 문구),
// 자유 연습: 카드 안 모드 고르기 → 게임 바로 시작 → 메인 화면 = 허브
const { chromium, startSite, check, finish } = require('./lib.cjs');

const TODAY = '2026-09-24';
const SEED = {
  'wordship:seen-help': '1',
  // 스도쿠: 성공 2 · 실패 1, 오늘 익스텐디드 포기
  'dsudoku:stats:standard': { results: { '2026-09-20': { status: 'solved', elapsedMs: 312000, pct: 100 }, '2026-09-21': { status: 'timeout', elapsedMs: 900000, pct: 62 }, '2026-09-23': { status: 'solved', elapsedMs: 700000, pct: 100 } } },
  'dsudoku:stats:extended': { results: { [TODAY]: { status: 'gaveup', elapsedMs: 200000, pct: 40 } } },
  'dsudoku:progress:2026-09-24:extended': { date: TODAY, variant: 'extended', status: 'gaveup', elapsedMs: 200000, pct: 40, cells: null },
  // 삼각관계: 오늘 스탠다드 2번째에 성공
  'trilateral:stats': { results: { '2026-09-22': { status: 'failed', attempt: null }, '2026-09-23': { status: 'solved', attempt: 3 }, [TODAY]: { status: 'solved', attempt: 2 } } },
  'trilateral:progress:2026-09-24': { date: TODAY, status: 'solved', guesses: [{ correct: [true, false, true, false, true, true, false, true, true, false, true, true, true, false] }, { correct: Array(14).fill(true) }] },
  // 워드십: 오늘 사자성어 실패 (추측 없음)
  'wordship:stats:idiom': { results: { '2026-09-23': { status: 'solved', attempt: 12 }, [TODAY]: { status: 'failed', attempt: null } } },
  'wordship:progress:idiom:2026-09-24': { date: TODAY, status: 'failed', guesses: [] },
};

async function newCtx(b) {
  const ctx = await b.newContext({ viewport: { width: 390, height: 844 }, permissions: ['clipboard-read', 'clipboard-write'] });
  await ctx.addInitScript((seed) => { for (const [k, v] of Object.entries(seed)) localStorage.setItem(k, typeof v === 'string' ? v : JSON.stringify(v)); }, SEED);
  return ctx;
}
const clip = (p) => p.evaluate(() => navigator.clipboard.readText());

(async () => {
  const site = await startSite();
  const BASE = site.base;
  const b = await chromium.launch();
  const games = [
    { slug: 'sudoku', dir: 'DailySudoku', mode: 'extended', label: '익스텐디드', tab: (p) => p.click('.daily-stats-tab[data-variant="extended"]') },
    { slug: 'sudoku', dir: 'DailySudoku', mode: 'standard', label: '스탠다드', tab: async () => {} },
    { slug: 'trilateral', dir: 'DailyTrilateral', mode: 'standard', label: '스탠다드', tab: async () => {} },
    // 워드십은 게임 주소로 바로 가면 허브로 가므로, 허브가 쓰는 ?open= 으로 게임 통계창을 연다
    { slug: 'wordship', dir: 'DailyWordship', mode: 'idiom', label: '사자성어', viaOpen: true, tab: (p) => p.click('.daily-stats-tab[data-mode="idiom"]') },
  ];
  for (const g of games) {
    // 게임 통계창
    const gctx = await newCtx(b); const gp = await gctx.newPage();
    await gp.clock.setFixedTime(new Date(`${TODAY}T12:00:00+09:00`));
    if (g.viaOpen) {
      await gp.goto(`${BASE}${g.dir}/?open=btn-landing-stats`);
      await gp.waitForSelector('#daily-stats-modal.show');
    } else {
      await gp.goto(`${BASE}${g.dir}/`);
      await gp.click('#btn-landing-stats');
    }
    await g.tab(gp);
    await gp.waitForTimeout(200);
    const gameNums = await gp.evaluate(() => ['stat-played', 'stat-winrate', 'stat-streak', 'stat-maxstreak'].map((id) => document.getElementById(id).textContent));
    const gameDist = await gp.evaluate(() => [...document.getElementById('daily-stats-dist').children].map((r) => r.textContent.replace(/\s+/g, '')));
    await gp.click('#btn-cal-share'); await gp.waitForTimeout(200);
    const gameCal = await clip(gp);
    let gameShare = null;
    if (!(await gp.isDisabled('#btn-daily-stats-share'))) { await gp.click('#btn-daily-stats-share'); await gp.waitForTimeout(600); gameShare = await clip(gp); }
    await gctx.close();

    // 허브 카드 안 통계
    const hctx = await newCtx(b); const hp = await hctx.newPage();
    const errs = []; hp.on('pageerror', (e) => errs.push(e.message));
    await hp.clock.setFixedTime(new Date(`${TODAY}T12:00:00+09:00`));
    await hp.goto(`${BASE}#${g.slug}`);
    await hp.locator(`#${g.slug} .landing-mini-btn`, { hasText: '통계' }).click();
    check(new URL(hp.url()).pathname.endsWith('/ProjectDaily/') && await hp.locator(`#${g.slug} .stats-stack`).isVisible(), `${g.slug}: 통계 → 페이지 이동 없이 카드 안`);
    await hp.locator(`#${g.slug} .stats-stack .mode-tab`, { hasText: g.label }).click();
    await hp.waitForTimeout(300);
    const hubNums = await hp.locator(`#${g.slug} .stats-num strong`).allTextContents();
    check(JSON.stringify(hubNums) === JSON.stringify(gameNums), `${g.slug} ${g.label}: 숫자 = 게임 통계창 ${JSON.stringify(hubNums)}`);
    await hp.locator(`#${g.slug} .stats-seg button`, { hasText: '분포' }).click();
    const hubDist = await hp.locator(`#${g.slug} .dist-row`).evaluateAll((rows) => rows.map((r) => r.textContent.replace(/\s+/g, '')));
    check(JSON.stringify(hubDist) === JSON.stringify(gameDist), `${g.slug} ${g.label}: 분포 = 게임 (${hubDist.length}줄)`);
    await hp.locator(`#${g.slug} .stats-seg button`, { hasText: '달력' }).click();
    await hp.locator(`#${g.slug} .mini-share`).click(); await hp.waitForTimeout(200);
    check((await clip(hp)) === gameCal, `${g.slug} ${g.label}: 달력 공유 문구 = 게임`);
    await hp.evaluate(() => navigator.clipboard.writeText(''));
    await hp.locator(`#${g.slug} .stats-share`).click(); await hp.waitForTimeout(800);
    const note = await hp.locator(`#${g.slug} .stats-stack > .share-note`).textContent();
    const hubShare = await clip(hp);
    if (process.env.DEBUG === g.slug) console.log('GAME:', JSON.stringify(gameShare), '\nHUB :', JSON.stringify(hubShare), '\nNOTE:', note);
    if (gameShare) check(hubShare === gameShare && note.includes('복사'), `${g.slug} ${g.label}: 오늘 결과 공유 문구 = 게임`);
    else check(note === '오늘 퍼즐을 먼저 풀어주세요.' && (await hp.locator(`#${g.slug} .stats-stack > .share-note`).getAttribute('data-tone')) === 'info',
      `${g.slug} ${g.label}: 오늘 안 풀었으면 "먼저 풀어주세요" (안내 색)`);
    check(errs.length === 0, `${g.slug}: 에러 없음 ${errs.join(' | ')}`);
    await hctx.close();
  }

  // 자유 연습 — 카드 안에서 모드 고르기 → 게임 바로 시작 → 메인 화면 = 허브
  for (const [slug, dir, label] of [['trilateral', 'DailyTrilateral', '익스텐디드'], ['wordship', 'DailyWordship', '사자성어']]) {
    const ctx = await newCtx(b); const p = await ctx.newPage();
    const errs = []; p.on('pageerror', (e) => errs.push(e.message));
    await p.goto(`${BASE}#${slug}`);
    await p.locator(`#${slug} .landing-btn`, { hasText: '자유 연습' }).click();
    check(new URL(p.url()).pathname.endsWith('/ProjectDaily/') && await p.locator(`#${slug} .sub-title`).isVisible(), `${slug}: 자유 연습 → 카드 안에서 모드 고르기`);
    await p.locator(`#${slug} .hub-back`).click();
    check(await p.locator(`#${slug} .daily-cards`).first().isVisible(), `${slug}: ‹ 뒤로 → 카드 메인`);
    await p.locator(`#${slug} .landing-btn`, { hasText: '자유 연습' }).click();
    await p.locator(`#${slug} .daily-card`, { hasText: label }).last().click();
    await p.waitForURL(new RegExp(`${dir}/$`));
    await p.waitForFunction(() => !document.getElementById('game-screen').classList.contains('hidden'), null, { timeout: 20000 });
    const modal = await p.evaluate(() => document.getElementById('freeplay-mode-modal').classList.contains('show'));
    check(!modal && !p.url().includes('free='), `${slug}: ${label} 자유 연습 바로 시작 (게임 쪽 모드 창 없음)`);
    await p.click('#btn-go-landing');
    await p.waitForURL(new RegExp(`/ProjectDaily/#${slug}$`));
    check(true, `${slug}: 자유 연습 → 메인 화면 → 허브`);
    check(errs.length === 0, `${slug}: 에러 없음 ${errs.join(' | ')}`);
    await ctx.close();
  }
  await b.close(); site.close();
  finish();
})().catch((e) => { console.error(e); process.exit(1); });
