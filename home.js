/**
 * home.js — 허브 맨 왼쪽 홈 카드 (#home).
 * 프로필(아바타 · 닉네임 · 전체 기록) + 오늘의 데일리 바로 시작 + 플레이 비율 + 최근 1주 활동을 한 카드에.
 * 모든 값은 각 게임이 남긴 localStorage 기록에서 계산한다 — 홈이 새로 저장하는 건 프로필(아바타·닉네임)뿐.
 * index.html의 인라인 스크립트가 게임 목록과 공용 함수를 넘겨 DailyHome.build(ctx)로 만든다.
 */
(function () {
  const PROFILE_KEY = 'daily-hub:profile';
  const AVATARS = ['🦊', '🐱', '🐻', '🐼', '🐧', '🐸', '🦉', '🐙', '🐰', '🦁', '🐳', '🌱'];
  const DEFAULT_PROFILE = { avatar: '🦊', name: '플레이어' };
  const NAME_MAX = 12;
  /** 모드 → 동그라미 글자 */
  const MODE_LETTER = { standard: 'S', extended: 'E', idiom: 'I' };
  const WEEKDAYS = ['일', '월', '화', '수', '목', '금', '토'];

  function loadProfile() {
    try {
      const p = JSON.parse(localStorage.getItem(PROFILE_KEY) || 'null');
      return { ...DEFAULT_PROFILE, ...(p && typeof p === 'object' ? p : {}) };
    } catch { return { ...DEFAULT_PROFILE }; }
  }
  function saveProfile(p) {
    try { localStorage.setItem(PROFILE_KEY, JSON.stringify(p)); } catch { /* 저장이 막혀도 화면은 바뀐다 */ }
  }

  /**
   * 네 게임 · 모든 모드의 데일리 기록을 모은다 (지난 퍼즐·자유 연습은 원래 기록되지 않는다).
   * 데일리 하나(게임 × 모드)를 끝낸 것 = 1판.
   */
  function collect(GAMES, readJSON, shiftDate, today) {
    const perGame = GAMES.map(() => 0);
    const perDay = new Map(); // 날짜 → 그날 끝낸 판 수
    let plays = 0;
    let wins = 0;
    GAMES.forEach((game, gi) => {
      for (const [mode] of game.modes) {
        const results = readJSON(game.statsKey(mode))?.results ?? {};
        for (const [date, r] of Object.entries(results)) {
          plays++;
          perGame[gi]++;
          if (r?.status === 'solved') wins++;
          perDay.set(date, (perDay.get(date) ?? 0) + 1);
        }
      }
    });
    const days = [...perDay.keys()].sort();

    // 연속 플레이: 하루에 하나라도 끝낸 날이 이어진 일수 (오늘 아직 안 했으면 어제부터 — 게임 연승과 같은 규칙)
    let streak = 0;
    let cursor = perDay.has(today) ? today : shiftDate(today, -1);
    while (perDay.has(cursor)) { streak++; cursor = shiftDate(cursor, -1); }
    let maxStreak = 0;
    let run = 0;
    let prev = null;
    for (const d of days) {
      run = prev && shiftDate(prev, 1) === d ? run + 1 : 1;
      maxStreak = Math.max(maxStreak, run);
      prev = d;
    }
    return {
      plays,
      winRate: plays ? Math.round((wins / plays) * 100) : 0,
      streak,
      maxStreak,
      since: days[0] ?? null,
      perGame,
      perDay,
    };
  }

  /** 그날 끝낸 판 수 → 색 단계 0~4 (데일리는 모두 9개) */
  function level(count, total) {
    if (!count) return 0;
    return Math.min(4, Math.ceil((count / total) * 4));
  }

  /**
   * @param ctx { GAMES, todayStr, shiftDate, untilNextReset, readJSON, openUrl, el, link, button, toggleDark, goToSlug, footer }
   * @returns {{ slide: HTMLElement, refresh: () => void }}
   */
  function build(ctx) {
    const { GAMES, todayStr, shiftDate, untilNextReset, readJSON, openUrl, el, link, button, toggleDark, goToSlug } = ctx;
    const totalDailies = GAMES.reduce((n, g) => n + g.dailies.length, 0);

    const slide = el('section', 'hub-slide');
    slide.id = 'home';
    slide.setAttribute('aria-label', '홈');
    const card = el('div', 'landing-card home-card');

    // ── 프로필 ──
    const brand = el('p', 'home-brand', '데일리 퍼즐');
    const profile = el('div', 'home-profile');
    const avatarBtn = button('home-avatar');
    avatarBtn.setAttribute('aria-label', '아바타 바꾸기');
    const nameBtn = button('home-name');
    nameBtn.setAttribute('aria-label', '닉네임 바꾸기');
    const nameText = el('span', 'home-name-text');
    nameBtn.append(nameText, el('span', 'home-name-edit', '✎'));
    const meta = el('p', 'home-meta');
    profile.append(avatarBtn, nameBtn, meta);

    // 아바타 고르기 — 카드 안에 뜨는 작은 판
    const picker = el('div', 'home-avatar-picker');
    picker.hidden = true;
    for (const a of AVATARS) {
      const b = button('home-avatar-option', a);
      b.addEventListener('click', () => {
        profileData.avatar = a;
        saveProfile(profileData);
        picker.hidden = true;
        paintProfile();
      });
      picker.append(b);
    }
    avatarBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      picker.hidden = !picker.hidden;
    });
    card.addEventListener('click', (e) => {
      if (!picker.hidden && !picker.contains(e.target)) picker.hidden = true;
    });

    // 닉네임 — 눌러서 그 자리에서 고친다 (Enter·바깥 누르기 = 저장, Esc = 취소)
    nameBtn.addEventListener('click', () => {
      const input = el('input', 'home-name-input');
      input.type = 'text';
      input.maxLength = NAME_MAX;
      input.value = profileData.name;
      input.setAttribute('aria-label', '닉네임');
      let done = false;
      const finish = (save) => {
        if (done) return;
        done = true;
        const v = input.value.trim().slice(0, NAME_MAX);
        if (save && v) {
          profileData.name = v;
          saveProfile(profileData);
        }
        input.replaceWith(nameBtn);
        paintProfile();
      };
      input.addEventListener('keydown', (e) => {
        e.stopPropagation(); // 방향키가 카드 넘기기로 가지 않게
        if (e.key === 'Enter') finish(true);
        else if (e.key === 'Escape') finish(false);
      });
      input.addEventListener('blur', () => finish(true));
      nameBtn.replaceWith(input);
      input.focus();
      input.select();
    });

    // 전체 기록
    const numbers = el('div', 'stats-numbers home-numbers');
    const num = (label) => {
      const box = el('div', 'stats-num');
      const strong = el('strong');
      box.append(strong, el('span', null, label));
      numbers.append(box);
      return strong;
    };
    const nPlays = num('판');
    const nWin = num('승률');
    const nStreak = num('연속');
    const nMax = num('최장');

    // ── 오늘의 데일리 — 게임 아이콘 + 모드 동그라미 (누르면 바로 시작) ──
    const shelf = el('div', 'home-shelf');
    const chips = []; // { a, game, daily }
    for (const game of GAMES) {
      const tile = el('div', 'home-tile');
      const icon = button('home-tile-icon', game.icon);
      icon.setAttribute('aria-label', `${game.title} 카드로`);
      icon.title = game.title;
      icon.addEventListener('click', () => goToSlug(game.slug));
      const row = el('div', 'home-chips');
      game.dailies.forEach((daily) => {
        const a = link(openUrl(game, daily.open), 'home-chip', MODE_LETTER[daily.mode] ?? daily.name[0]);
        chips.push({ a, game, daily });
        row.append(a);
      });
      tile.append(icon, row);
      shelf.append(tile);
    }

    // ── 플레이 비율 ──
    const ratioTitle = el('p', 'home-section-title', '플레이 비율');
    const ratioBar = el('div', 'home-ratio-bar');
    const ratioLegend = el('div', 'home-ratio-legend');
    const segs = GAMES.map((game, gi) => {
      const seg = el('span', `home-ratio-seg home-c${gi}`);
      ratioBar.append(seg);
      const item = el('span', 'home-ratio-item');
      const dot = el('i', `home-ratio-dot home-c${gi}`);
      const pct = el('span', 'home-ratio-pct');
      item.append(dot, game.icon, pct);
      item.title = game.title;
      ratioLegend.append(item);
      return { seg, pct };
    });

    // ── 최근 1주 ──
    const weekHead = el('div', 'home-week-head');
    weekHead.append(el('p', 'home-section-title', '최근 1주'));
    const weekScale = el('span', 'home-week-scale');
    weekScale.append('적음');
    for (let l = 0; l <= 4; l++) weekScale.append(el('i', `home-week-swatch home-lv${l}`));
    weekScale.append('많음');
    weekHead.append(weekScale);
    const week = el('div', 'home-week');
    const weekCells = [];
    for (let k = 0; k < 7; k++) {
      const col = el('div', 'home-week-col');
      const dow = el('span', 'home-week-dow');
      const cell = el('span', 'home-week-cell');
      col.append(dow, cell);
      week.append(col);
      weekCells.push({ dow, cell });
    }

    const mini = el('div', 'landing-mini-actions');
    const dark = button('landing-mini-btn', '다크 모드');
    dark.addEventListener('click', toggleDark);
    mini.append(dark);

    const stack = el('div', 'landing-stack home-stack');
    stack.append(numbers, shelf, ratioTitle, ratioBar, ratioLegend, weekHead, week, mini);
    card.append(brand, profile, picker, stack, ctx.footer());
    slide.append(card);

    let profileData = loadProfile();
    function paintProfile() {
      avatarBtn.textContent = profileData.avatar;
      nameText.textContent = profileData.name;
    }

    function paintMeta(stats) {
      meta.textContent = `${stats.since ? `${stats.since}부터` : '첫 기록을 남겨 보세요'} · 다음 퍼즐 ${untilNextReset().slice(0, 5)}`;
    }

    let last = null;
    function refresh() {
      const today = todayStr();
      const stats = collect(GAMES, readJSON, shiftDate, today);
      last = stats;
      paintProfile();
      paintMeta(stats);
      nPlays.textContent = stats.plays;
      nWin.textContent = `${stats.winRate}%`;
      nStreak.textContent = `${stats.streak}일`;
      nMax.textContent = `${stats.maxStreak}일`;

      for (const { a, game, daily } of chips) {
        const [text, status] = daily.status(today);
        a.dataset.status = status;
        a.setAttribute('aria-label', `${game.title} ${daily.name} — ${text}`);
        a.title = `${daily.name} · ${text}`;
      }

      // 플레이 비율 — 반올림 합이 100이 되도록 가장 큰 나머지 순으로 1씩 더한다
      const raw = stats.perGame.map((n) => (stats.plays ? (n / stats.plays) * 100 : 0));
      const pcts = raw.map(Math.floor);
      let left = stats.plays ? 100 - pcts.reduce((s, v) => s + v, 0) : 0;
      raw.map((v, i) => [v - Math.floor(v), i]).sort((x, y) => y[0] - x[0]).forEach(([, i]) => { if (left > 0) { pcts[i]++; left--; } });
      ratioBar.classList.toggle('is-empty', !stats.plays);
      segs.forEach(({ seg, pct }, i) => {
        seg.style.flexGrow = String(stats.perGame[i]);
        seg.hidden = !stats.perGame[i];
        pct.textContent = ` ${pcts[i]}%`;
      });

      weekCells.forEach(({ dow, cell }, k) => {
        const date = shiftDate(today, k - 6);
        const [y, m, d] = date.split('-').map(Number);
        dow.textContent = k === 6 ? '오늘' : WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
        const count = stats.perDay.get(date) ?? 0;
        cell.className = `home-week-cell home-lv${level(count, totalDailies)}${k === 6 ? ' is-today' : ''}`;
        cell.textContent = count ? String(count) : '';
        cell.title = `${date} · ${count}판`;
      });
    }

    // 다음 퍼즐까지 남은 시간 (분 단위로 충분)
    setInterval(() => { if (last && !document.hidden) paintMeta(last); }, 20000);

    return { slide, refresh };
  }

  window.DailyHome = { build };
})();
