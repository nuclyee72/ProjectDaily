/**
 * farm/farm.js — 허브 맨 왼쪽 데일리 농장 카드 (#farm). 규칙은 engine.js, 숫자는 data.js, 그림은 sprites.js.
 * index.html이 공용 함수를 넘겨 DailyFarm.build(ctx)로 만든다 (home.js와 같은 방식).
 * 카드 안은 스크롤하지 않는다: 긴 목록은 쪽(‹ ›)으로 나누고, 가방 · 결과 · 고르기는 카드를 덮는 판으로 띄운다.
 * 저장: daily-farm:state (이번 시즌) · daily-farm:history (지난 시즌 도감 기록, 초기화 안 됨).
 */
(function () {
  const STATE_KEY = 'daily-farm:state';
  const HISTORY_KEY = 'daily-farm:history';
  const TABS = [['farm', '농장', 'tab:farm'], ['explore', '탐험', 'tab:explore'], ['craft', '제작', 'tab:craft'],
    ['cook', '요리', 'tab:cook'], ['codex', '도감', 'tab:codex'], ['shop', '상점', 'tab:shop']];
  const CURRENCIES = [['np', 'NP'], ['sp', 'SP'], ['ap', 'AP'], ['money', '돈']];
  const BOX_TEXT = { np100: '100 NP', np200: '200 NP', seed3: '전설 씨앗 ×3', mat50: '고급 자재 ×50', ticket10: '즉시 완료권 ×10', box2: '보물 상자 ×2' };

  const fmtNum = (n) => (n < 10000 ? n.toLocaleString('ko-KR') : `${(n / 10000).toFixed(n < 100000 ? 1 : 0).replace(/\.0$/, '')}만`);
  /** 남은 시간: 1시간 넘으면 h:mm, 아니면 n분 */
  function fmtLeft(ms) {
    const m = Math.max(1, Math.ceil(ms / 60000));
    return m >= 60 ? `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}` : `${m}분`;
  }
  const fmtHM = (ms) => { const m = Math.floor(ms / 60000); return `${Math.floor(m / 60)}:${String(m % 60).padStart(2, '0')}`; };
  const stars = (n, max = 3) => '★'.repeat(n) + '☆'.repeat(max - n);

  function build(ctx) {
    const { GAMES, todayStr, untilNextReset, readJSON, el, button } = ctx;
    const { data: D, engine: E, sprites: S } = window.DailyFarm;
    const TIER = D.TIERS;
    const rng = Math.random;
    const img = (name, cls) => { const i = S.img(name); if (cls) i.classList.add(...cls.split(' ')); return i; };

    // ── 저장 ──
    let state = null;
    let history = [];
    let earnedCache = null;
    function save() {
      try {
        localStorage.setItem(STATE_KEY, JSON.stringify(state));
        localStorage.setItem(HISTORY_KEY, JSON.stringify(history));
      } catch { /* 저장이 막혀도 화면은 이번 방문 동안 그대로 */ }
    }
    /** 시즌 넘김 · 출석 — 처음 열 때와 refresh 때마다 */
    function sync() {
      const today = todayStr();
      if (!state) {
        const saved = readJSON(STATE_KEY);
        const h = readJSON(HISTORY_KEY);
        history = Array.isArray(h) ? h : [];
        state = E.isValidState(saved) ? saved : null;
      }
      const r = E.rollSeason(state, today, Date.now());
      state = r.state;
      if (r.ended) {
        history.push(r.ended);
        openNotice(r.ended);
      }
      E.markAttendance(state, today);
      earnedCache = null;
      save();
    }
    const resultMaps = () => GAMES.flatMap((g) => g.modes.map(([m]) => readJSON(g.statsKey(m))?.results || {}));
    const earned = () => (earnedCache ||= E.npEarned(state, resultMaps(), todayStr()));
    const npNow = () => E.npBalance(state, earned());

    // ── 뼈대 ──
    const slide = el('section', 'hub-slide');
    slide.id = 'farm';
    slide.setAttribute('aria-label', '데일리 농장');
    const card = el('div', 'landing-card farm-card');

    const head = el('div', 'farm-head');
    const title = el('h1', 'farm-title', '데일리 농장');
    const seasonEl = el('span', 'farm-season');
    const bagBtn = button('farm-bag');
    bagBtn.setAttribute('aria-label', '가방');
    bagBtn.append(img('icon:bag'));
    bagBtn.addEventListener('click', () => openPanel('bag', bagPanel));
    head.append(title, seasonEl, bagBtn);

    const wallet = el('div', 'farm-wallet');
    const coinN = {};
    for (const [k, label] of CURRENCIES) {
      const c = k === 'np' ? button('farm-coin') : el('span', 'farm-coin');
      c.dataset.cur = k;
      c.title = label;
      coinN[k] = el('span', 'farm-coin-n', '0');
      c.append(img('cur:' + k), coinN[k]);
      wallet.append(c);
    }
    wallet.firstChild.setAttribute('aria-label', 'NP 내역');
    wallet.firstChild.addEventListener('click', () => openPanel('np', npPanel));

    const tabsEl = el('nav', 'farm-tabs');
    tabsEl.setAttribute('aria-label', '농장 메뉴');
    const tabBtns = {};
    for (const [id, label, icon] of TABS) {
      const b = button('farm-tab');
      b.dataset.tab = id;
      b.append(img(icon), el('span', null, label));
      b.addEventListener('click', () => { ui.tab = id; renderBody(); paintTabs(); });
      tabBtns[id] = b;
      tabsEl.append(b);
    }
    const body = el('div', 'farm-body');
    const toastEl = el('p', 'farm-toast');
    const panel = el('div', 'farm-panel');
    panel.hidden = true;
    card.append(head, wallet, tabsEl, body, toastEl, panel);
    slide.append(card);

    const ui = { tab: 'farm', craftSeg: 'build', shopSeg: 'np', bagSeg: 'crop', cookTier: 0, cookReady: false, page: {} };
    const rows = (name) => Number(getComputedStyle(card).getPropertyValue('--farm-' + name)) || 4;
    const pageOf = (key, total, per) => {
      const pages = Math.max(1, Math.ceil(total / per));
      ui.page[key] = Math.min(Math.max(0, ui.page[key] || 0), pages - 1);
      return [ui.page[key], pages];
    };
    function pager(key, page, pages, redraw) {
      const p = el('div', 'farm-pager');
      if (pages <= 1) return p;
      const prev = button('farm-page-btn', '‹');
      const next = button('farm-page-btn', '›');
      prev.setAttribute('aria-label', '이전 쪽');
      next.setAttribute('aria-label', '다음 쪽');
      prev.disabled = page === 0;
      next.disabled = page >= pages - 1;
      prev.addEventListener('click', () => { ui.page[key] = page - 1; redraw(); });
      next.addEventListener('click', () => { ui.page[key] = page + 1; redraw(); });
      p.append(prev, el('span', 'farm-page-n', `${page + 1} / ${pages}`), next);
      return p;
    }
    function seg(items, cur, onPick) {
      const s = el('div', 'stats-seg farm-seg');
      for (const [id, label] of items) {
        const b = button(cur === id ? 'active' : null, label);
        b.dataset.seg = id;
        b.addEventListener('click', () => onPick(id));
        s.append(b);
      }
      return s;
    }
    const btn = (label, onClick, disabled = false, cls = 'farm-btn') => {
      const b = button(cls, label);
      b.disabled = disabled;
      b.addEventListener('click', onClick);
      return b;
    };
    /** 그림 + 개수 한 덩어리 */
    function count(icon, n, label) {
      const s = el('span', 'farm-count');
      s.title = label;
      s.append(img(icon), el('span', null, fmtNum(n)));
      return s;
    }
    function toast(text) {
      toastEl.textContent = text;
      toastEl.classList.add('is-on');
      clearTimeout(toastEl._t);
      toastEl._t = setTimeout(() => toastEl.classList.remove('is-on'), 2800);
    }
    /** 바꾼 뒤: 저장 · 다시 그리기 · 넘친 장신구 확인 */
    function commit() {
      save();
      render();
      if (E.gearOverflow(state) > 0 && panelName !== 'overflow') openPanel('overflow', overflowPanel, true);
    }

    // ── 판 (카드를 덮는 작은 화면) ──
    let panelName = null;
    let panelDraw = null;
    let panelForced = false;
    function openPanel(name, draw, forced = false) {
      panelName = name;
      panelDraw = draw;
      panelForced = forced;
      panel.hidden = false;
      drawPanel();
    }
    function drawPanel() {
      if (!panelName) return;
      const [titleText, ...content] = panelDraw();
      const top = el('div', 'farm-panel-head');
      top.append(el('h2', 'farm-panel-title', titleText));
      if (!panelForced) {
        const x = button('farm-panel-close', '✕');
        x.setAttribute('aria-label', '닫기');
        x.addEventListener('click', closePanel);
        top.append(x);
      }
      panel.replaceChildren(top, ...content);
    }
    function closePanel() {
      if (panelForced && E.gearOverflow(state) > 0) return;
      const was = panelName;
      panelName = null;
      panel.hidden = true;
      panel.replaceChildren();
      render();
      if (was !== 'overflow' && E.gearOverflow(state) > 0) openPanel('overflow', overflowPanel, true);
    }

    // ── 머리 ──
    function paintHead() {
      const today = todayStr();
      const left = E.daysLeft(today);
      seasonEl.textContent = `${Number(state.season.slice(5))}월 시즌 · ${left ? `D-${left}` : 'D-DAY'}`;
      seasonEl.classList.toggle('is-ending', left <= 1);
      coinN.np.textContent = fmtNum(npNow());
      coinN.sp.textContent = fmtNum(state.sp);
      coinN.ap.textContent = fmtNum(state.ap);
      coinN.money.textContent = fmtNum(state.money);
    }
    function paintTabs() {
      for (const [id, b] of Object.entries(tabBtns)) b.setAttribute('aria-current', String(id === ui.tab));
    }

    // ── 농장 ──
    let farmSig = '';
    const farmLabels = [];
    function plotView(i, now) {
      const unlocked = i < E.plotCount(state);
      const plot = unlocked ? state.plots[i] : null;
      const b = button('farm-plot');
      b.dataset.plot = i;
      b.append(img(unlocked ? 'tile:tilled' : 'tile:locked', 'farm-ground'));
      let label;
      if (!unlocked) {
        b.classList.add('is-locked');
        b.append(img('icon:lock', 'farm-lock'));
        label = '잠김';
      } else if (!plot) {
        b.classList.add('is-empty');
        label = '심기';
      } else {
        const stage = E.growthStage(plot, now);
        b.append(img(stage === 3 ? 'ready:' + plot.crop : 'grow:' + stage, stage === 3 ? 'farm-plant is-ready' : 'farm-plant'));
        if (stage === 3) { b.classList.add('is-ready'); label = '수확!'; } else label = fmtLeft(plot.readyAt - now);
      }
      const lab = el('span', 'farm-plot-label', label);
      farmLabels[i] = lab;
      b.append(lab);
      b.addEventListener('click', () => onPlot(i));
      return b;
    }
    const farmSignature = (now) => state.plots.map((p) => (p ? `${p.crop}${E.growthStage(p, now)}` : '-')).join() + E.plotCount(state);
    function farmTab() {
      const now = Date.now();
      farmSig = farmSignature(now);
      const left = E.daysLeft(todayStr());
      const parts = [];
      if (left <= 1) parts.push(el('p', 'farm-alert', `${left ? '내일' : '오늘'}이 시즌 마지막 날 · 시즌이 끝나면 전부 초기화돼요 (도감 기록만 남아요)`));
      const grid = el('div', 'farm-plots');
      for (let i = 0; i < 8; i++) grid.append(plotView(i, now));
      const row = el('div', 'farm-row');
      const ready = state.plots.some((p) => p && now >= p.readyAt);
      row.append(count('item:ticket', state.inv.ticket, '즉시 완료권'), btn('모두 수확', harvestAll, !ready));
      parts.push(grid, row, el('p', 'farm-hint', '빈 칸을 눌러 심고, 다 크면 눌러 수확해요. 8시간이면 다 커요.'));
      return parts;
    }
    function onPlot(i) {
      const now = Date.now();
      if (i >= E.plotCount(state)) { toast('제작 › 밭을 만들면 칸이 늘어요'); return; }
      const plot = state.plots[i];
      if (!plot) { openPanel('plant', () => plantPanel(i)); return; }
      if (now >= plot.readyAt) { harvestOne(i); return; }
      openPanel('growing', () => growingPanel(i));
    }
    function harvestOne(i) {
      const r = E.harvest(state, i, Date.now(), rng);
      if (!r) return;
      const extra = [r.seedBack ? `씨앗 +${r.seedBack}` : '', r.ticket ? '완료권 +1' : ''].filter(Boolean).join(' · ');
      toast(`${D.CROP_BY_ID[r.crop].name} ×${r.qualities.length} · 품질 ${r.qualities.join(' ')}${extra ? ' · ' + extra : ''}`);
      commit();
    }
    function harvestAll() {
      const now = Date.now();
      let n = 0, items = 0;
      state.plots.forEach((p, i) => {
        if (p && now >= p.readyAt) { const r = E.harvest(state, i, now, rng); n++; items += r.qualities.length; }
      });
      if (n) toast(`${n}칸 수확 · 작물 ${items}개`);
      commit();
    }
    function plantPanel(i) {
      const list = el('div', 'farm-list');
      const empty = () => state.plots.map((p, k) => (k < E.plotCount(state) && !p ? k : -1)).filter((k) => k >= 0);
      for (let t = 0; t < 4; t++) {
        const have = state.inv.seed[t];
        const ok = E.canPlantTier(state, t);
        const row = el('div', 'farm-item');
        row.append(img('seed:' + t, 'farm-icon'));
        const txt = el('div', 'farm-item-text');
        txt.append(el('strong', null, `${TIER[t]} 씨앗`), el('span', null, ok ? `${fmtNum(have)}개` : `시설 강화 ${t} 필요`));
        row.append(txt);
        const plant = (cells) => {
          const now = Date.now();
          let n = 0;
          for (const k of cells) if (state.inv.seed[t] > 0 && E.plant(state, k, t, now, rng)) n++;
          if (n) toast(`${TIER[t]} 씨앗 ${n}칸 심음`);
          closePanel();
          commit();
        };
        const many = Math.min(have, empty().length);
        row.append(btn('심기', () => plant([i]), !ok || !have), btn(`빈 칸 모두${many > 1 ? ` ${many}` : ''}`, () => plant(empty()), !ok || many < 2));
        list.append(row);
      }
      return [`${i + 1}번 칸에 심기`, list, el('p', 'farm-hint', '씨앗 등급이 높을수록 좋은 작물이 나와요. 무엇이 자랄지는 심는 순간 정해져요.')];
    }
    function growingPanel(i) {
      const plot = state.plots[i];
      if (!plot) { setTimeout(closePanel); return ['', el('div')]; }
      const crop = D.CROP_BY_ID[plot.crop];
      const box = el('div', 'farm-detail');
      box.append(img('crop:' + crop.id, 'farm-icon-lg'), el('strong', null, crop.name), el('span', 'farm-tier-name', TIER[crop.tier]),
        el('span', null, `${fmtLeft(plot.readyAt - Date.now())} 뒤 수확`));
      const use = btn(`즉시 완료권 쓰기 (${state.inv.ticket}장)`, () => {
        if (E.useTicket(state, i, Date.now())) { closePanel(); harvestOne(i); }
      }, state.inv.ticket < 1, 'landing-btn primary-btn farm-wide');
      return [`${i + 1}번 칸 · 자라는 중`, box, use];
    }

    // ── 탐험 ──
    let exploreSig = '';
    const exploreRefs = {};
    function boostEnd(now) {
      const live = state.explore.boosts.filter(([, b]) => b > now);
      return live.length ? Math.max(...live.map(([, b]) => b)) : 0;
    }
    function exploreTab() {
      const now = Date.now();
      const p = E.explorePending(state, now);
      exploreSig = String(p.rolls);
      const scene = el('div', 'farm-scene');
      const walker = el('div', 'farm-walker');
      for (let f = 0; f < 3; f++) walker.append(img('char:' + f, 'farm-walk-frame'));
      scene.append(walker);
      const bar = el('div', 'farm-bar');
      const fill = el('span', 'farm-bar-fill');
      fill.style.width = `${(p.accMs / (D.EXPLORE.capHours * 3600000)) * 100}%`;
      bar.append(fill);
      const time = el('p', 'farm-explore-time');
      const boost = el('p', 'farm-explore-boost');
      exploreRefs.fill = fill;
      exploreRefs.time = time;
      exploreRefs.boost = boost;
      paintExplore(now);
      const claim = btn(p.rolls ? `받기 · ${p.rolls}번` : '받기', claimExplore, !p.rolls, 'landing-btn primary-btn farm-wide');
      claim.classList.add('farm-claim');
      const boxes = el('div', 'farm-row');
      boxes.append(
        count('item:box', state.inv.box, '보물 상자'), btn('열기', openBoxOne, state.inv.box < 1),
        count('item:relic', state.inv.relic, '고대 유물'), btn('열기', openRelicOne, state.inv.relic < 1),
      );
      return [scene, bar, time, boost, claim, boxes,
        el('p', 'farm-hint', `1시간마다 ${E.rollsPerHour(state)}번 찾아요. 최대 ${D.EXPLORE.capHours}시간까지 쌓여요.`)];
    }
    function paintExplore(now) {
      const p = E.explorePending(state, now);
      exploreRefs.fill.style.width = `${(p.accMs / (D.EXPLORE.capHours * 3600000)) * 100}%`;
      exploreRefs.time.textContent = `쌓인 시간 ${fmtHM(p.accMs)} / ${D.EXPLORE.capHours}:00${p.capped ? ' · 가득 참' : ''}`;
      const end = boostEnd(now);
      exploreRefs.boost.textContent = end ? `부스트 ×${D.SHOP.boostMult} · ${fmtLeft(end - now)} 남음` : '';
    }
    function claimExplore() {
      const r = E.claimExplore(state, Date.now(), rng);
      save();
      render();
      openPanel('got', () => gotPanel(r));
    }
    function gotPanel(r) {
      const grid = el('div', 'farm-got');
      const cell = (icon, n, label, hidden) => {
        const c = el('div', 'farm-got-cell' + (hidden ? ' is-hidden' : ''));
        c.title = label;
        c.append(img(icon, 'farm-icon'), el('strong', null, `×${fmtNum(n)}`), el('span', null, label));
        grid.append(c);
      };
      r.got.seed.forEach((n, t) => { if (n) cell('seed:' + t, n, `${TIER[t]} 씨앗`); });
      if (r.got.mat) cell('item:mat', r.got.mat, '자재');
      if (r.got.mat2) cell('item:mat2', r.got.mat2, '고급 자재');
      if (r.got.gear.length) cell('item:gear', r.got.gear.length, '장신구');
      if (r.got.box) cell('item:box', r.got.box, '보물 상자', true);
      if (r.got.relic) cell('item:relic', r.got.relic, '고대 유물', true);
      if (!grid.children.length) grid.append(el('p', 'farm-hint', '아직 쌓인 시간이 없어요.'));
      return [`탐험 ${r.hours}시간 · ${r.rolls}번`, grid, btn('확인', closePanel, false, 'landing-btn primary-btn farm-wide')];
    }
    function openBoxOne() {
      const id = E.openBox(state, rng);
      if (id) toast(`보물 상자 → ${BOX_TEXT[id]}`);
      earnedCache = null;
      commit();
    }
    function openRelicOne() {
      const g = E.openRelic(state, rng);
      if (g) toast(`고대 유물 → ${g.lines.map(lineText).join(' · ')}`);
      commit();
    }

    // ── 제작 ──
    function costView(st) {
      const c = el('span', 'farm-cost');
      const part = (icon, need, have, label) => {
        if (!need) return;
        const s = el('span', have < need ? 'is-short' : null);
        s.title = label;
        s.append(img(icon), fmtNum(need));
        c.append(s);
      };
      part('item:mat', st.mat, state.inv.mat, '자재');
      part('item:mat2', st.mat2, state.inv.mat2, '고급 자재');
      part('cur:money', st.money, state.money, '돈');
      return c;
    }
    function craftTab() {
      const parts = [seg([['build', '강화'], ['synth', '씨앗 합성']], ui.craftSeg, (s) => { ui.craftSeg = s; renderBody(); })];
      const have = el('div', 'farm-row farm-have');
      have.append(count('item:mat', state.inv.mat, '자재'), count('item:mat2', state.inv.mat2, '고급 자재'), count('cur:money', state.money, '돈'));
      parts.push(have);
      if (ui.craftSeg === 'build') {
        const per = rows('rows');
        // 아직 만들 게 있는 줄 먼저, 다 만든 줄은 뒤로
        const lines = [...D.CRAFT].sort((a, b) => !E.nextStep(state, a.id) - !E.nextStep(state, b.id));
        const [page, pages] = pageOf('craft', lines.length, per);
        const list = el('div', 'farm-list');
        for (const line of lines.slice(page * per, page * per + per)) {
          const lv = state.built[line.id];
          const st = E.nextStep(state, line.id);
          const can = E.canCraft(state, line.id);
          const row = el('div', 'farm-item farm-craft');
          row.dataset.line = line.id;
          const txt = el('div', 'farm-item-text');
          txt.append(el('strong', null, `${line.name} ${lv}/${line.steps.length}`),
            el('span', null, st ? st.desc : '다 만들었어요'));
          row.append(txt);
          if (st) {
            const side = el('div', 'farm-craft-side');
            side.append(costView(st), btn(can === 'requires' ? '합성기 먼저' : '만들기', () => {
              if (E.craft(state, line.id)) toast(`${line.name} ${state.built[line.id]} 완성`);
              commit();
            }, can !== 'ok'));
            row.append(side);
          }
          list.append(row);
        }
        parts.push(list, pager('craft', page, pages, renderBody));
      } else if (!state.built.synth) {
        parts.push(el('p', 'farm-hint farm-empty', '강화 › 씨앗 합성기를 먼저 만들어요.'));
      } else {
        const k = E.synthRatio(state);
        const list = el('div', 'farm-list');
        for (let t = 0; t < 3; t++) {
          const have = state.inv.seed[t];
          const max = Math.floor(have / k);
          const row = el('div', 'farm-item');
          row.dataset.synth = t;
          row.append(img('seed:' + t, 'farm-icon'));
          const txt = el('div', 'farm-item-text');
          txt.append(el('strong', null, `${TIER[t]} → ${TIER[t + 1]}`), el('span', null, `${k}개 → 1개 · 가진 것 ${fmtNum(have)}`));
          row.append(txt);
          const go = (times) => { const out = E.synthesize(state, t, times, rng); if (out) toast(`${TIER[t + 1]} 씨앗 +${out}`); commit(); };
          row.append(btn('1번', () => go(1), max < 1), btn(`최대${max > 1 ? ` ${max}` : ''}`, () => go(max), max < 2));
          list.append(row);
        }
        parts.push(list, el('p', 'farm-hint', `효율 증대를 만들면 비율이 ${D.SYNTH.base - 1} · ${D.SYNTH.base - 2} · ${D.SYNTH.base - 3}개로 줄어요.`));
      }
      return parts;
    }

    // ── 요리 ──
    function ingView(dish) {
      const s = el('span', 'farm-ings');
      for (const [id, n] of dish.ings) {
        const have = (state.inv.crop[id] || []).length;
        const i = el('span', have >= n ? null : 'is-short');
        i.title = `${D.CROP_BY_ID[id].name} ${have}/${n}`;
        i.append(img('crop:' + id), `${have}/${n}`);
        s.append(i);
      }
      return s;
    }
    function cookTab() {
      const tierSeg = seg(TIER.map((t, i) => [i, t]), ui.cookTier, (t) => { ui.cookTier = t; ui.page.cook = 0; renderBody(); });
      const toggle = button('farm-toggle' + (ui.cookReady ? ' is-on' : ''), '재료 있는 것만');
      toggle.setAttribute('aria-pressed', String(ui.cookReady));
      toggle.addEventListener('click', () => { ui.cookReady = !ui.cookReady; ui.page.cook = 0; renderBody(); });
      const codex = E.codexDishes(state.season);
      const all = D.DISHES.filter((d) => d.tier === ui.cookTier && (!ui.cookReady || E.bestPicks(state, d.id)));
      const per = rows('rows');
      const [page, pages] = pageOf('cook', all.length, per);
      const list = el('div', 'farm-list');
      for (const dish of all.slice(page * per, page * per + per)) {
        const row = button('farm-item farm-dish');
        row.dataset.dish = dish.id;
        row.append(img('dish:' + dish.id, 'farm-icon'));
        const txt = el('div', 'farm-item-text');
        const name = el('strong', null, dish.name);
        if (codex.includes(dish.id)) name.append(el('span', 'farm-badge', '도감'));
        txt.append(name, ingView(dish));
        row.append(txt);
        row.addEventListener('click', () => openCook(dish.id));
        list.append(row);
      }
      if (!all.length) list.append(el('p', 'farm-hint farm-empty', '재료가 다 있는 요리가 없어요.'));
      const top = el('div', 'farm-row');
      top.append(tierSeg, toggle);
      return [top, list, pager('cook', page, pages, renderBody)];
    }
    function openCook(dishId) {
      const dish = D.DISH_BY_ID[dishId];
      const sel = E.bestPicks(state, dishId) || Object.fromEntries(dish.ings.map(([id]) => [id, []]));
      let result = null;
      openPanel('cook', () => {
        const tier = TIER[dish.tier];
        if (result) return cookResult(dish, result);
        const box = el('div', 'farm-cook');
        const qs = [];
        for (const [id, n] of dish.ings) {
          const have = state.inv.crop[id] || [];
          const row = el('div', 'farm-cook-ing');
          const name = el('span', 'farm-cook-name');
          name.append(img('crop:' + id), `${D.CROP_BY_ID[id].name} ${sel[id].length}/${n}`);
          const chips = el('div', 'farm-chips');
          const order = have.map((q, i) => [q, i]).sort((a, b) => b[0] - a[0]).slice(0, rows('chips'));
          for (const [q, i] of order) {
            const on = sel[id].includes(i);
            const c = button('farm-chip' + (on ? ' is-on' : ''), String(q));
            c.addEventListener('click', () => {
              if (on) sel[id] = sel[id].filter((x) => x !== i);
              else sel[id] = [...sel[id], i].slice(-n);
              drawPanel();
            });
            chips.append(c);
          }
          if (!have.length) chips.append(el('span', 'farm-hint', '없음'));
          row.append(name, chips);
          box.append(row);
          for (const i of sel[id]) qs.push(have[i]);
        }
        const ready = dish.ings.every(([id, n]) => sel[id].length === n);
        const avg = qs.length ? qs.reduce((a, b) => a + b, 0) / qs.length : 0;
        const ch = E.starChances(avg, dish.tier);
        const odds = el('p', 'farm-odds', ready ? `평균 품질 ${avg.toFixed(1)} · 별 확률 ${ch.map((c) => Math.round(c * 100) + '%').join(' → ')}` : '재료를 골라 주세요');
        const go = btn('요리하기', () => {
          result = E.cook(state, dishId, sel, rng);
          save();
          render();
          drawPanel();
        }, !ready, 'landing-btn primary-btn farm-wide');
        const headRow = el('div', 'farm-cook-head');
        headRow.append(img('dish:' + dishId, 'farm-icon'), el('span', null, `${tier} 요리 · 원래 값 ${fmtNum(E.dishPrice(dishId))}돈`));
        return [dish.name, headRow, box, odds, go];
      });
      function cookResult(d, r) {
        const box = el('div', 'farm-result');
        box.dataset.stars = r.stars;
        const starEl = el('div', 'farm-stars');
        for (let k = 0; k < 3; k++) {
          const s = el('span', 'farm-star' + (k < r.stars ? ' is-on' : ''), k < r.stars ? '★' : '☆');
          s.style.animationDelay = `${k * 0.35}s`;
          starEl.append(s);
        }
        box.append(img('dish:' + d.id, 'farm-icon-lg'), starEl, el('strong', null, `${d.name} ${r.stars}성`));
        const actions = el('div', 'farm-row');
        actions.append(btn(`팔기 +${fmtNum(E.foodValue(d.id, r.stars))}돈`, () => { E.sellFood(state, d.id, r.stars); closePanel(); commit(); }));
        if (E.canSubmit(state, d.id, r.stars)) actions.append(btn('도감 제출', () => { E.submitCodex(state, d.id, r.stars); toast(`도감 등록 · ${d.name} ${stars(r.stars)}`); closePanel(); commit(); }));
        actions.append(btn('가방에 두기', closePanel));
        return [`${d.name} 완성`, box, actions];
      }
    }

    // ── 도감 ──
    function codexTab() {
      const ids = E.codexDishes(state.season);
      const sum = E.codexSummary(state);
      const top = el('p', 'farm-codex-sum', `${Number(state.season.slice(5))}월 도감 ${sum.done}/6 · ★${sum.stars}`);
      const grid = el('div', 'farm-codex');
      for (const id of ids) {
        const d = D.DISH_BY_ID[id];
        const cellEl = el('div', 'farm-codex-cell');
        cellEl.dataset.dish = id;
        const pic = img('dish:' + id, 'farm-icon-lg');
        pic.style.borderColor = S.TIER_COLORS[d.tier];
        const got = state.codex[id];
        cellEl.title = `${TIER[d.tier]} 요리 · ${got == null ? '미등록' : stars(got)}`;
        cellEl.append(pic, el('strong', null, d.name));
        // 셋째 줄: 더 높은 별로 낼 수 있으면 제출 버튼, 아니면 지금 기록
        const best = Math.max(-1, ...(state.inv.food[id] || []));
        if (best >= 0 && E.canSubmit(state, id, best)) {
          cellEl.append(btn(`제출 ${'★'.repeat(best) || '0성'}`, () => { E.submitCodex(state, id, best); toast(`도감 등록 · ${d.name} ${stars(best)}`); commit(); }));
        } else cellEl.append(el('span', 'farm-codex-stars', got == null ? '미등록' : stars(got)));
        grid.append(cellEl);
      }
      const past = history.slice(-3).reverse().map((h) => `${Number(h.season.slice(5))}월 ${h.done}/6 ★${h.stars}`).join(' · ');
      return [top, grid, el('p', 'farm-hint', '요리를 제출하면 등록돼요 (가방에서 빠져요). 별이 더 높으면 갱신.'),
        el('p', 'farm-hint', past ? `지난 시즌: ${past}` : '도감 기록은 시즌이 끝나도 남아요.')];
    }

    // ── 상점 ──
    const SHOP_ICON = { boost: 'icon:boost', ticket: 'item:ticket', mat: 'item:mat', mat2: 'item:mat2', tickets: 'item:ticket', seed1: 'seed:1', seed2: 'seed:2', gearBox: 'item:gear', gearBox2: 'item:gear' };
    function shopTab() {
      const today = todayStr();
      const cur = ui.shopSeg;
      const parts = [seg([['np', 'NP'], ['ap', 'AP'], ['sp', 'SP']], cur, (s) => { ui.shopSeg = s; renderBody(); })];
      const bal = cur === 'np' ? npNow() : state[cur];
      const balRow = el('div', 'farm-row');
      balRow.append(count('cur:' + cur, bal, cur.toUpperCase()), el('span', 'farm-hint', `매일 06:00에 바뀌어요 · ${untilNextReset().slice(0, 5)}`));
      parts.push(balRow);
      const items = cur === 'np' ? D.SHOP.np : E.shopOffers(today)[cur].map((id) => D.SHOP.apsp.find((x) => x.id === id));
      const list = el('div', 'farm-list');
      for (const it of items) {
        const price = cur === 'np' ? it.price : E.shopPrice(it, cur);
        const key = `${cur}:${it.id}`;
        const left = it.limit - E.boughtToday(state, key, today);
        const row = el('div', 'farm-item farm-shop-item');
        row.dataset.item = it.id;
        row.append(img(SHOP_ICON[it.id], 'farm-icon'));
        const txt = el('div', 'farm-item-text');
        txt.append(el('strong', null, it.name), el('span', null, `${it.desc} · 오늘 ${left}/${it.limit}`));
        row.append(txt);
        row.append(btn(`${fmtNum(price)} ${cur.toUpperCase()}`, () => {
          const r = cur === 'np' ? E.buyNp(state, it.id, today, npNow(), Date.now()) : E.buyShop(state, cur, it.id, today, rng);
          if (r === 'ok') toast(`${it.name} 샀어요`);
          commit();
        }, left < 1 || bal < price));
        list.append(row);
      }
      parts.push(list, el('p', 'farm-hint', cur === 'np' ? 'NP는 출석 · 데일리 결과 · 보물 상자로 모여요.'
        : `${cur.toUpperCase()}는 ${cur === 'sp' ? '씨앗' : '장신구'}를 분해해서 모아요 (가방). AP · SP 상점은 같은 상품에서 매일 2개씩.`));
      return parts;
    }

    // ── 판들 ──
    function npPanel() {
      const e = earned();
      const list = el('div', 'farm-list farm-np');
      const line = (label, val) => { const r = el('div', 'farm-np-row'); r.append(el('span', null, label), el('strong', null, val)); list.append(r); };
      line(`출석 ${e.attend}일`, `+${e.attend * D.NP.attend}`);
      line(`데일리 성공 ${e.solved}`, `+${e.solved * D.NP.solved}`);
      line(`데일리 실패 ${e.other}`, `+${e.other * D.NP.other}`);
      line('보물 상자', `+${state.bonus}`);
      line('상점에서 씀', `−${state.spent}`);
      line('지금', fmtNum(npNow()));
      return ['NP 내역', list, el('p', 'farm-hint', `출석 ${D.NP.attend} · 데일리 성공 ${D.NP.solved} · 실패 ${D.NP.other} (이번 시즌 기록에서 계산)`)];
    }
    function bagPanel() {
      const parts = [seg([['crop', '작물'], ['item', '씨앗·재료'], ['food', '음식'], ['gear', '장신구']], ui.bagSeg, (s) => { ui.bagSeg = s; drawPanel(); })];
      if (ui.bagSeg === 'crop') {
        const list = Object.entries(state.inv.crop).sort((a, b) => D.CROP_BY_ID[b[0]].tier - D.CROP_BY_ID[a[0]].tier || b[1].length - a[1].length);
        const per = rows('cols') * rows('panel-rows');
        const [page, pages] = pageOf('bagCrop', list.length, per);
        const grid = el('div', 'farm-grid');
        for (const [id, qs] of list.slice(page * per, page * per + per)) {
          const c = el('div', 'farm-cell');
          const pic = img('crop:' + id, 'farm-icon');
          pic.style.borderColor = S.TIER_COLORS[D.CROP_BY_ID[id].tier];
          c.title = `${D.CROP_BY_ID[id].name} · 품질 ${[...qs].sort((a, b) => b - a).join(' ')}`;
          c.append(pic, el('strong', null, `×${qs.length}`), el('span', null, `최고 ${Math.max(...qs)}`));
          grid.append(c);
        }
        if (!list.length) grid.append(el('p', 'farm-hint farm-empty', '작물이 없어요. 밭에서 수확해요.'));
        parts.push(grid, pager('bagCrop', page, pages, drawPanel));
      } else if (ui.bagSeg === 'item') {
        const list = el('div', 'farm-list');
        for (let t = 0; t < 4; t++) {
          const have = state.inv.seed[t];
          const row = el('div', 'farm-item');
          row.dataset.seed = t;
          row.append(img('seed:' + t, 'farm-icon'));
          const txt = el('div', 'farm-item-text');
          txt.append(el('strong', null, `${TIER[t]} 씨앗 ${fmtNum(have)}`), el('span', null, `분해하면 1개 ${D.DISMANTLE.seedSp[t]} SP`));
          row.append(txt);
          const sell = (n) => { const sp = E.dismantleSeeds(state, t, n); if (sp) toast(`${TIER[t]} 씨앗 분해 +${fmtNum(sp)} SP`); commit(); drawPanel(); };
          row.append(btn('분해', () => sell(1), !have), btn('전부', () => sell(have), have < 2));
          list.append(row);
        }
        const misc = el('div', 'farm-row');
        misc.append(count('item:mat', state.inv.mat, '자재'), count('item:mat2', state.inv.mat2, '고급 자재'), count('item:ticket', state.inv.ticket, '즉시 완료권'));
        const boxes = el('div', 'farm-row');
        boxes.append(count('item:box', state.inv.box, '보물 상자'), btn('열기', () => { openBoxOne(); drawPanel(); }, state.inv.box < 1),
          count('item:relic', state.inv.relic, '고대 유물'), btn('열기', () => { openRelicOne(); drawPanel(); }, state.inv.relic < 1));
        parts.push(list, misc, boxes);
      } else if (ui.bagSeg === 'food') {
        const list = [];
        for (const [id, arr] of Object.entries(state.inv.food)) {
          for (let st = 3; st >= 0; st--) { const n = arr.filter((x) => x === st).length; if (n) list.push([id, st, n]); }
        }
        list.sort((a, b) => E.foodValue(b[0], b[1]) - E.foodValue(a[0], a[1]));
        const per = rows('panel-rows');
        const [page, pages] = pageOf('bagFood', list.length, per);
        const box = el('div', 'farm-list');
        for (const [id, st, n] of list.slice(page * per, page * per + per)) {
          const row = el('div', 'farm-item');
          row.dataset.food = `${id}:${st}`;
          row.append(img('dish:' + id, 'farm-icon'));
          const txt = el('div', 'farm-item-text');
          txt.append(el('strong', null, `${D.DISH_BY_ID[id].name} ${stars(st)}`), el('span', null, `×${n} · 1개 ${fmtNum(E.foodValue(id, st))}돈`));
          row.append(txt);
          const sell = (k) => { let v = 0; for (let j = 0; j < k; j++) v += E.sellFood(state, id, st); toast(`팔았어요 +${fmtNum(v)}돈`); commit(); drawPanel(); };
          row.append(btn('팔기', () => sell(1)), btn('전부', () => sell(n), n < 2));
          box.append(row);
        }
        if (!list.length) box.append(el('p', 'farm-hint farm-empty', '음식이 없어요. 요리에서 만들어요.'));
        parts.push(box, pager('bagFood', page, pages, drawPanel));
      } else {
        parts.push(...gearList(false));
      }
      return ['가방', ...parts];
    }
    function lineText(l) {
      const o = E.OPT_BY_ID[l.opt];
      return `${o.name} +${l.v}${l.opt === 'treasure' ? '%p' : '%'}`;
    }
    /** 장신구 목록. picking = 넘친 장신구 고르기 */
    const picked = new Set();
    function gearList(picking) {
      const slots = E.equipSlots(state);
      const list = state.inv.gear
        .filter((g) => !picking || E.canDismantle(state, g))
        .sort((a, b) => (state.equip.includes(b.id) - state.equip.includes(a.id)) || Math.max(-1, ...b.lines.map((l) => l.tier)) - Math.max(-1, ...a.lines.map((l) => l.tier)) || b.lines.length - a.lines.length);
      const per = rows('panel-rows') - (picking ? 1 : 0);
      const key = picking ? 'pick' : 'gear';
      const [page, pages] = pageOf(key, list.length, per);
      const box = el('div', 'farm-list');
      for (const g of list.slice(page * per, page * per + per)) {
        const row = el('div', 'farm-item farm-gear');
        row.dataset.gear = g.id;
        const worn = state.equip.includes(g.id);
        const pic = img('item:gear', 'farm-icon');
        const top = Math.max(-1, ...g.lines.map((l) => l.tier));
        if (top >= 0) pic.style.borderColor = S.TIER_COLORS[top];
        row.append(pic);
        const txt = el('div', 'farm-item-text');
        txt.append(el('strong', null, (worn ? '착용 · ' : '') + (g.lines.length ? g.lines.map(lineText).join(' · ') : '효과 없음')),
          el('span', null, `${g.lines.map((l) => TIER[l.tier]).join(' · ') || '—'} · 분해 ${E.gearAp(g)} AP`));
        row.append(txt);
        if (picking) {
          const on = picked.has(g.id);
          row.classList.toggle('is-picked', on);
          row.append(btn(on ? '✓' : '고르기', () => { if (on) picked.delete(g.id); else picked.add(g.id); drawPanel(); }));
        } else {
          row.append(
            btn(worn ? '빼기' : '끼기', () => { if (worn) E.unequipGear(state, g.id); else if (!E.equipGear(state, g.id)) toast(`착용 칸이 ${slots}개예요`); commit(); drawPanel(); }),
            btn(g.lock ? '🔒' : '🔓', () => { E.toggleLock(state, g.id); commit(); drawPanel(); }, false, 'farm-btn farm-lock-btn'),
            btn('분해', () => { const ap = E.dismantleGear(state, [g.id]); toast(`분해 +${ap} AP`); commit(); drawPanel(); }, !E.canDismantle(state, g)),
          );
        }
        box.append(row);
      }
      if (!list.length) box.append(el('p', 'farm-hint farm-empty', picking ? '고를 수 있는 장신구가 없어요.' : '장신구가 없어요. 탐험에서 찾아요.'));
      const info = el('p', 'farm-hint', `착용 ${state.equip.length}/${slots} · 가방 ${state.inv.gear.length}/${D.GEAR.bag} · 같은 옵션은 더해져요`);
      return [info, box, pager(key, page, pages, drawPanel)];
    }
    function overflowPanel() {
      const over = E.gearOverflow(state);
      if (!over) { setTimeout(() => { panelForced = false; closePanel(); }); return ['', el('div')]; }
      for (const id of [...picked]) if (!state.inv.gear.some((g) => g.id === id)) picked.delete(id);
      const go = btn(`${picked.size}개 분해`, () => {
        const ap = E.dismantleGear(state, [...picked]);
        picked.clear();
        toast(`분해 +${ap} AP`);
        save();
        render();
        if (!E.gearOverflow(state)) { panelForced = false; closePanel(); } else drawPanel();
      }, picked.size < over, 'landing-btn primary-btn farm-wide');
      return [`가방이 넘쳤어요 · ${over}개 이상 골라 분해`, ...gearList(true), go];
    }
    function openNotice(ended) {
      queueMicrotask(() => openPanel('notice', () => [
        `${Number(ended.season.slice(5))}월 시즌 끝`,
        el('p', 'farm-notice', `도감 ${ended.done}/6 · ★${ended.stars}`),
        el('p', 'farm-hint', '새 시즌이 시작됐어요. 밭 · 가방 · 강화는 처음부터, 도감 기록은 남아요.'),
        btn('시작하기', closePanel, false, 'landing-btn primary-btn farm-wide'),
      ]));
    }

    // ── 그리기 ──
    const TAB_VIEW = { farm: farmTab, explore: exploreTab, craft: craftTab, cook: cookTab, codex: codexTab, shop: shopTab };
    function renderBody() {
      body.dataset.tab = ui.tab;
      body.replaceChildren(...TAB_VIEW[ui.tab]());
    }
    function render() {
      paintHead();
      paintTabs();
      renderBody();
    }
    function refresh() {
      sync();
      render();
      if (panelName) drawPanel();
      if (E.gearOverflow(state) > 0 && panelName !== 'overflow') openPanel('overflow', overflowPanel, true);
    }

    // 1초마다 — 농장 카드가 보일 때만. 모양이 바뀔 때만 다시 그리고, 아니면 글자만 고친다 (누르는 중인 버튼을 갈아 끼우지 않게)
    let visible = false;
    if ('IntersectionObserver' in window) {
      new IntersectionObserver((es) => { visible = es.some((e) => e.isIntersecting); }, { threshold: 0.5 }).observe(slide);
    } else visible = true;
    setInterval(() => {
      if (!visible || document.hidden || !state) return;
      const now = Date.now();
      if (ui.tab === 'farm') {
        if (farmSignature(now) !== farmSig) renderBody();
        else state.plots.forEach((p, i) => { if (p && farmLabels[i] && now < p.readyAt) farmLabels[i].textContent = fmtLeft(p.readyAt - now); });
      } else if (ui.tab === 'explore') {
        if (String(E.explorePending(state, now).rolls) !== exploreSig) renderBody();
        else paintExplore(now);
      }
    }, 1000);

    return {
      slide,
      refresh,
      show(name) { if (name === 'main' && panelName) closePanel(); },
      current: () => panelName || 'main',
    };
  }

  window.DailyFarm.build = build;
})();
