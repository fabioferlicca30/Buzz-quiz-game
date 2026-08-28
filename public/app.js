(() => {
  const socket = io();

  // ---- Stato locale --------------------------------------------------
  let myId = null;
  let myNickname = '';
  let currentRoomCode = null;
  let isHost = false;
  let createSettings = { visibility: 'private', mode: 'rush', difficulty: 'misto' };
  let newQuestionState = { difficulty: 'facile', correct: 0 };
  let playersById = new Map(); // id -> nickname (aggiornata da lobby/scoreboard)
  let currentEligibleIds = null;
  let currentPhase = 'phase1';
  let answered = false;
  let timerInterval = null;
  let hostBubbleTimeout = null;
  let talkingTimeout = null;
  let eliminationRoster = new Map(); // id -> { nickname, out }

  // ---- Helpers UI ------------------------------------------------------
  function showScreen(id) {
    document.querySelectorAll('.screen').forEach((s) => s.classList.remove('active'));
    document.getElementById(id).classList.add('active');
  }

  function setError(id, msg) {
    const el = document.getElementById(id);
    if (el) el.textContent = msg || '';
  }

  // ---- Presentatore: pupazzetto parlante --------------------------------
  const MASCOT_MOUTHS = {
    neutral: 'M40 76 q20 10 40 0 q-20 18 -40 0 Z',
    happy: 'M36 74 q24 22 48 0 q-24 30 -48 0 Z',
    evil: 'M38 80 q10 -8 20 -3 q14 5 24 9 q-18 16 -44 -6 Z',
    laugh: 'M34 72 q26 28 52 0 q-26 34 -52 0 Z',
    shock: 'M52 76 a8 8 0 1 0 16 0 a8 8 0 1 0 -16 0 Z',
    hype: 'M36 74 q24 20 48 0 q-24 26 -48 0 Z',
    celebrate: 'M34 72 q26 26 52 0 q-26 32 -52 0 Z',
  };
  const MASCOT_BROWS = {
    neutral: { l: 'M32 40 q10 -10 22 -2', r: 'M66 38 q12 -8 22 2' },
    happy: { l: 'M30 36 q12 -14 24 -4', r: 'M66 32 q14 -12 24 4' },
    evil: { l: 'M30 44 q12 4 24 -6', r: 'M66 38 q12 -10 24 6' },
    laugh: { l: 'M30 38 q12 -10 24 -2', r: 'M66 36 q12 -8 24 2' },
    shock: { l: 'M28 32 q14 -16 26 -6', r: 'M66 26 q14 -14 26 6' },
    hype: { l: 'M30 36 q12 -14 24 -4', r: 'M66 32 q14 -12 24 4' },
    celebrate: { l: 'M30 34 q12 -15 24 -5', r: 'M66 30 q14 -13 24 5' },
  };
  const MOOD_KEYS = Object.keys(MASCOT_MOUTHS);

  function setMascotMood(mood) {
    const mascot = document.getElementById('mascot');
    const mouth = document.getElementById('mascot-mouth');
    const browL = mascot.querySelector('.eyebrow-l');
    const browR = mascot.querySelector('.eyebrow-r');
    const useMood = MOOD_KEYS.includes(mood) ? mood : 'neutral';
    MOOD_KEYS.forEach((m) => mascot.classList.remove('mood-' + m));
    mascot.classList.add('mood-' + useMood);
    if (mouth) mouth.setAttribute('d', MASCOT_MOUTHS[useMood]);
    if (browL) browL.setAttribute('d', MASCOT_BROWS[useMood].l);
    if (browR) browR.setAttribute('d', MASCOT_BROWS[useMood].r);
  }

  function showHostLine(data) {
    const text = typeof data === 'string' ? data : (data && data.text) || '';
    const mood = (data && typeof data === 'object' && data.mood) || 'neutral';
    if (!text) return;
    const bubble = document.getElementById('host-bubble');
    const textEl = document.getElementById('host-text');
    const mascot = document.getElementById('mascot');
    textEl.textContent = text;
    setMascotMood(mood);
    bubble.classList.remove('hidden');
    mascot.classList.add('talking');

    clearTimeout(hostBubbleTimeout);
    clearTimeout(talkingTimeout);
    const talkMs = Math.max(1200, Math.min(4500, text.length * 55));
    talkingTimeout = setTimeout(() => mascot.classList.remove('talking'), talkMs);
    hostBubbleTimeout = setTimeout(() => bubble.classList.add('hidden'), 5200);

    if (mood === 'celebrate') spawnConfetti(60);
  }

  // ---- Coriandoli ---------------------------------------------------
  function spawnConfetti(count) {
    count = count || 40;
    const layer = document.getElementById('confetti-layer');
    if (!layer) return;
    const colors = ['#ffd400', '#0072ce', '#ff6a00', '#00a651', '#e4032e'];
    for (let i = 0; i < count; i++) {
      const el = document.createElement('div');
      el.className = 'confetti-piece';
      el.style.left = Math.random() * 100 + 'vw';
      el.style.background = colors[Math.floor(Math.random() * colors.length)];
      el.style.animationDuration = (2 + Math.random() * 1.5) + 's';
      el.style.animationDelay = (Math.random() * 0.6) + 's';
      layer.appendChild(el);
      setTimeout(() => el.remove(), 4200);
    }
  }

  function toast(msg) {
    let el = document.getElementById('toast');
    if (!el) {
      el = document.createElement('div');
      el.id = 'toast';
      el.style.position = 'fixed';
      el.style.bottom = '20px';
      el.style.left = '50%';
      el.style.transform = 'translateX(-50%)';
      el.style.background = '#262852';
      el.style.color = '#fff';
      el.style.padding = '10px 18px';
      el.style.borderRadius = '10px';
      el.style.zIndex = '200';
      el.style.fontSize = '0.85rem';
      el.style.maxWidth = '90%';
      el.style.textAlign = 'center';
      document.body.appendChild(el);
    }
    el.textContent = msg;
    el.style.display = 'block';
    clearTimeout(el._hideTimeout);
    el._hideTimeout = setTimeout(() => { el.style.display = 'none'; }, 4000);
  }

  function requireNickname() {
    const val = document.getElementById('input-nickname').value.trim();
    if (!val) {
      setError('home-error', 'Inserisci prima il tuo nome');
      showScreen('screen-home');
      return null;
    }
    myNickname = val;
    return val;
  }

  // ---- Caricamento categorie -------------------------------------------
  function loadCategories() {
    fetch('/api/categories')
      .then((r) => r.json())
      .then((data) => {
        const select = document.getElementById('select-category');
        const datalist = document.getElementById('nq-category-list');
        select.innerHTML = '<option value="tutte">Tutte</option>';
        datalist.innerHTML = '';
        data.categories.forEach((c) => {
          const opt = document.createElement('option');
          opt.value = c;
          opt.textContent = c;
          select.appendChild(opt);
          const dopt = document.createElement('option');
          dopt.value = c;
          datalist.appendChild(dopt);
        });
      })
      .catch(() => {});
  }

  // ---- Segmented controls generiche ------------------------------------
  function wireSegmented(containerId, onChange) {
    const container = document.getElementById(containerId);
    container.querySelectorAll('.seg-btn').forEach((btn) => {
      btn.addEventListener('click', () => {
        container.querySelectorAll('.seg-btn').forEach((b) => b.classList.remove('active'));
        btn.classList.add('active');
        onChange(btn.dataset.value);
      });
    });
  }

  wireSegmented('opt-visibility', (v) => (createSettings.visibility = v));
  wireSegmented('opt-mode', (v) => (createSettings.mode = v));
  wireSegmented('opt-difficulty', (v) => (createSettings.difficulty = v));
  wireSegmented('nq-difficulty', (v) => (newQuestionState.difficulty = v));
  wireSegmented('nq-correct', (v) => (newQuestionState.correct = parseInt(v, 10)));

  // ---- Navigazione -------------------------------------------------------
  document.getElementById('btn-goto-create').addEventListener('click', () => {
    if (!requireNickname()) return;
    setError('create-error', '');
    showScreen('screen-create');
  });
  document.getElementById('btn-create-back').addEventListener('click', () => showScreen('screen-home'));

  document.getElementById('btn-goto-public').addEventListener('click', () => {
    if (!requireNickname()) return;
    showScreen('screen-public');
    refreshPublicList();
  });
  document.getElementById('btn-public-back').addEventListener('click', () => showScreen('screen-home'));

  document.getElementById('btn-goto-join').addEventListener('click', () => {
    if (!requireNickname()) return;
    setError('join-error', '');
    showScreen('screen-join');
  });
  document.getElementById('btn-join-back').addEventListener('click', () => showScreen('screen-home'));

  document.getElementById('btn-goto-newquestion').addEventListener('click', () => {
    setError('nq-error', '');
    document.getElementById('nq-success').textContent = '';
    showScreen('screen-newquestion');
  });
  document.getElementById('btn-nq-back').addEventListener('click', () => showScreen('screen-home'));

  // ---- Creazione partita ---------------------------------------------
  document.getElementById('btn-create-confirm').addEventListener('click', () => {
    const category = document.getElementById('select-category').value;
    socket.emit(
      'lobby:create',
      { nickname: myNickname, visibility: createSettings.visibility, mode: createSettings.mode, difficulty: createSettings.difficulty, category },
      (res) => {
        if (res.error) return setError('create-error', res.error);
        currentRoomCode = res.code;
        isHost = true;
        renderLobby(res.summary);
        showScreen('screen-lobby');
      }
    );
  });

  // ---- Unione con codice ------------------------------------------------
  document.getElementById('btn-join-confirm').addEventListener('click', () => {
    const code = document.getElementById('input-code').value.trim().toUpperCase();
    if (!code) return setError('join-error', 'Inserisci un codice valido');
    socket.emit('lobby:join', { code, nickname: myNickname }, (res) => {
      if (res.error) return setError('join-error', res.error);
      currentRoomCode = res.code;
      isHost = false;
      renderLobby(res.summary);
      showScreen('screen-lobby');
    });
  });

  // ---- Partite pubbliche --------------------------------------------
  function refreshPublicList() {
    socket.emit('lobby:list', (res) => renderPublicList(res.lobbies || []));
  }

  function renderPublicList(lobbies) {
    const el = document.getElementById('public-list');
    if (!lobbies.length) {
      el.innerHTML = '<p class="muted">Nessuna partita pubblica al momento. Creane una tu!</p>';
      return;
    }
    el.innerHTML = '';
    lobbies.forEach((l) => {
      const div = document.createElement('div');
      div.className = 'lobby-item';
      div.innerHTML = `<div><strong>${l.players} giocatori</strong><br/><span class="muted">${l.mode === 'rush' ? 'Rush' : 'Classica'} · ${l.difficulty} · ${l.category}</span></div>`;
      const btn = document.createElement('button');
      btn.textContent = 'Unisciti';
      btn.addEventListener('click', () => {
        socket.emit('lobby:join', { code: l.code, nickname: myNickname }, (res) => {
          if (res.error) return toast(res.error);
          currentRoomCode = res.code;
          isHost = false;
          renderLobby(res.summary);
          showScreen('screen-lobby');
        });
      });
      div.appendChild(btn);
      el.appendChild(div);
    });
  }

  socket.on('lobby:publicList', (lobbies) => {
    if (document.getElementById('screen-public').classList.contains('active')) {
      renderPublicList(lobbies);
    }
  });

  // ---- Creazione domanda ------------------------------------------------
  document.getElementById('btn-nq-submit').addEventListener('click', () => {
    const category = document.getElementById('nq-category').value.trim();
    const text = document.getElementById('nq-text').value.trim();
    const answers = [0, 1, 2, 3].map((i) => document.getElementById('nq-a' + i).value.trim());
    if (!category || !text || answers.some((a) => !a)) {
      return setError('nq-error', 'Compila tutti i campi');
    }
    fetch('/api/questions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ category, difficulty: newQuestionState.difficulty, text, answers, correctIndex: newQuestionState.correct }),
    })
      .then((r) => r.json().then((data) => ({ ok: r.ok, data })))
      .then(({ ok, data }) => {
        if (!ok) return setError('nq-error', data.error || 'Errore');
        setError('nq-error', '');
        document.getElementById('nq-success').textContent = 'Domanda salvata, grazie!';
        document.getElementById('nq-text').value = '';
        [0, 1, 2, 3].forEach((i) => (document.getElementById('nq-a' + i).value = ''));
        loadCategories();
      })
      .catch(() => setError('nq-error', 'Errore di connessione'));
  });

  // ---- Lobby --------------------------------------------------------
  function renderLobby(summary) {
    const codeWrap = document.getElementById('lobby-code-wrap');
    if (summary.visibility === 'private') {
      codeWrap.classList.remove('hidden');
      document.getElementById('lobby-code').textContent = summary.code;
    } else {
      codeWrap.classList.add('hidden');
    }
    const modeLabel = summary.mode === 'rush' ? 'Rush (velocità)' : 'Classica (10s, punti fissi)';
    document.getElementById('lobby-settings').textContent =
      `${summary.visibility === 'public' ? 'Partita aperta' : 'Partita chiusa'} · ${modeLabel} · Livello: ${summary.difficulty} · Categoria: ${summary.category}`;

    const list = document.getElementById('lobby-players');
    list.innerHTML = '';
    summary.players.forEach((p) => {
      const li = document.createElement('li');
      li.innerHTML = `<span>${p.nickname}${p.connected ? '' : ' (disconnesso)'}</span>${p.isHost ? '<span class="host-tag">HOST</span>' : ''}`;
      list.appendChild(li);
    });

    const startBtn = document.getElementById('btn-start-game');
    const waitMsg = document.getElementById('lobby-wait-msg');
    if (isHost) {
      startBtn.classList.remove('hidden');
      waitMsg.classList.add('hidden');
    } else {
      startBtn.classList.add('hidden');
      waitMsg.classList.remove('hidden');
    }
  }

  socket.on('lobby:update', (summary) => {
    if (summary.code !== currentRoomCode) return;
    renderLobby(summary);
  });

  document.getElementById('btn-start-game').addEventListener('click', () => {
    socket.emit('lobby:start', (res) => {
      if (res.error) setError('lobby-error', res.error);
      else setError('lobby-error', '');
    });
  });

  // ---- Presentatore -------------------------------------------------
  socket.on('host:say', (data) => showHostLine(data));

  // ---- Domande / gameplay --------------------------------------------
  function stopTimer() {
    if (timerInterval) clearInterval(timerInterval);
    timerInterval = null;
    const fill = document.getElementById('timer-fill');
    fill.classList.remove('urgent');
  }

  function startTimer(durationMs) {
    stopTimer();
    const endTs = Date.now() + durationMs;
    const fill = document.getElementById('timer-fill');
    fill.style.width = '100%';
    timerInterval = setInterval(() => {
      const remaining = Math.max(0, endTs - Date.now());
      const pct = (remaining / durationMs) * 100;
      fill.style.width = pct + '%';
      fill.classList.toggle('urgent', remaining > 0 && remaining <= 3000);
      if (remaining <= 0) stopTimer();
    }, 100);
  }

  socket.on('game:question', (q) => {
    showScreen('screen-game');
    answered = false;
    currentEligibleIds = q.eligibleIds;
    currentPhase = q.phase;

    document.getElementById('game-match-label').textContent = `Partita ${q.matchNumber || 1}`;
    if (q.phase === 'elimination') {
      document.getElementById('game-phase-label').textContent = 'Eliminazione';
      document.getElementById('game-progress').textContent = `Round ${q.index + 1} · ${q.remainingCount || (currentEligibleIds ? currentEligibleIds.length : '?')} in gara`;
    } else {
      document.getElementById('game-phase-label').textContent = 'Fase 1';
      document.getElementById('game-progress').textContent = `Domanda ${q.index + 1}/${q.total}`;
    }
    document.getElementById('game-category').textContent = `${q.category} · ${q.difficulty}`;
    document.getElementById('question-text').textContent = q.text;

    const spectatorBanner = document.getElementById('spectator-banner');
    const iAmEligible = !currentEligibleIds || currentEligibleIds.includes(myId);

    if (!iAmEligible) {
      spectatorBanner.classList.remove('hidden');
    } else {
      spectatorBanner.classList.add('hidden');
    }

    const miniScoreboard = document.getElementById('mini-scoreboard');
    const elimChips = document.getElementById('elimination-chips');
    if (q.phase === 'elimination') {
      miniScoreboard.classList.add('hidden');
      elimChips.classList.remove('hidden');
      renderEliminationChips();
    } else {
      miniScoreboard.classList.remove('hidden');
      elimChips.classList.add('hidden');
    }

    const buttons = document.querySelectorAll('.answer-btn');
    buttons.forEach((btn, i) => {
      btn.querySelector('.answer-label-text').textContent = q.answers[i];
      btn.classList.remove('correct', 'wrong-pick', 'selected');
      btn.disabled = !iAmEligible;
      btn.classList.toggle('waiting', iAmEligible);
    });

    startTimer(q.timeLimitMs);
  });

  document.querySelectorAll('.answer-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      if (answered) return;
      const iAmEligible = !currentEligibleIds || currentEligibleIds.includes(myId);
      if (!iAmEligible) return;
      answered = true;
      const idx = parseInt(btn.dataset.idx, 10);
      socket.emit('game:answer', { answerIndex: idx });
      document.querySelectorAll('.answer-btn').forEach((b) => { b.disabled = true; b.classList.remove('waiting'); });
      btn.classList.add('selected');
    });
  });

  function renderMiniScoreboard(scoreboard) {
    scoreboard.forEach((p) => playersById.set(p.id, p.nickname));
    const el = document.getElementById('mini-scoreboard');
    el.innerHTML = '';
    scoreboard.forEach((p, i) => {
      const row = document.createElement('div');
      row.className = 'row' + (p.id === myId ? ' me' : '');
      row.innerHTML = `<span>${i + 1}. ${p.nickname}${p.eliminated ? ' ❌' : ''}</span><span>${p.score} pt</span>`;
      el.appendChild(row);
    });
  }

  socket.on('game:questionResult', (data) => {
    stopTimer();
    const buttons = document.querySelectorAll('.answer-btn');
    buttons.forEach((btn) => btn.classList.remove('waiting'));
    buttons.forEach((btn, i) => {
      if (i === data.correctIndex) btn.classList.add('correct');
    });
    const mine = data.results.find((r) => r.id === myId);
    if (mine && mine.answerIndex !== null && mine.answerIndex !== data.correctIndex) {
      buttons[mine.answerIndex].classList.add('wrong-pick');
    }
    if (data.scoreboard) renderMiniScoreboard(data.scoreboard);
  });

  // ---- Fine fase 1 -----------------------------------------------------
  socket.on('phase1:end', (data) => {
    showScreen('screen-phase1end');
    const list = document.getElementById('phase1-standings');
    list.innerHTML = '';
    data.standings.forEach((p) => {
      playersById.set(p.id, p.nickname);
      const li = document.createElement('li');
      const qualified = data.qualifiers.includes(p.id);
      li.innerHTML = `${p.nickname} — ${p.score} pt ${qualified ? '✅ passa alla fase a eliminazione' : '❌ eliminato'}`;
      list.appendChild(li);
    });
  });

  // ---- Fase a eliminazione (ad oltranza) --------------------------------
  socket.on('elimination:start', (data) => {
    eliminationRoster = new Map();
    (data.qualifiers || []).forEach((q) => eliminationRoster.set(q.id, { nickname: q.nickname, out: false }));
    const list = document.getElementById('elimination-qualifiers');
    list.innerHTML = '';
    eliminationRoster.forEach((p) => {
      const li = document.createElement('li');
      li.textContent = p.nickname;
      list.appendChild(li);
    });
    showScreen('screen-elimination-intro');
  });

  socket.on('elimination:status', (data) => {
    const eliminatedIds = new Set((data.eliminatedNow || []).map((p) => p.id));
    eliminationRoster.forEach((p, id) => {
      if (eliminatedIds.has(id)) p.out = true;
    });
    renderEliminationChips(eliminatedIds);
  });

  function renderEliminationChips(justEliminatedIds) {
    justEliminatedIds = justEliminatedIds || new Set();
    const el = document.getElementById('elimination-chips');
    el.innerHTML = '';
    eliminationRoster.forEach((p, id) => {
      const span = document.createElement('span');
      span.className = 'elim-chip' + (p.out ? ' out' : '') + (justEliminatedIds.has(id) ? ' out-now' : '');
      span.textContent = p.nickname;
      el.appendChild(span);
    });
  }

  // ---- Finale -----------------------------------------------------------
  function renderPodium(standings) {
    const el = document.getElementById('podium');
    el.innerHTML = '';
    const medals = ['🥇', '🥈', '🥉'];
    for (let i = 0; i < Math.min(3, standings.length); i++) {
      const p = standings[i];
      const div = document.createElement('div');
      div.className = `step step-${i + 1}`;
      div.innerHTML = `<span class="medal">${medals[i]}</span><span class="name">${p.nickname}</span>`;
      el.appendChild(div);
    }
  }

  socket.on('game:final', (data) => {
    showScreen('screen-final');
    document.getElementById('final-winner').textContent = data.championName ? `${data.championName} 🎉` : 'Nessun vincitore';

    renderPodium(data.standings);

    const list = document.getElementById('final-standings');
    list.innerHTML = '';
    data.standings.forEach((p) => {
      const li = document.createElement('li');
      const bonus = p.sessionPointsAwarded ? ` (+${p.sessionPointsAwarded} pt sessione)` : '';
      li.textContent = `${p.nickname} — ${p.score} pt partita${bonus}`;
      list.appendChild(li);
    });

    const sessionList = document.getElementById('session-standings');
    sessionList.innerHTML = '';
    (data.sessionBoard || []).forEach((p, i) => {
      const li = document.createElement('li');
      if (i === 0) li.className = 'top';
      li.innerHTML = `<span>${i + 1}. ${p.nickname}</span><span>${p.sessionScore} pt</span>`;
      sessionList.appendChild(li);
    });

    const playAgainBtn = document.getElementById('btn-play-again');
    const waitMsg = document.getElementById('final-wait-msg');
    if (isHost) {
      playAgainBtn.classList.remove('hidden');
      waitMsg.classList.add('hidden');
    } else {
      playAgainBtn.classList.add('hidden');
      waitMsg.classList.remove('hidden');
    }

    spawnConfetti(70);
  });

  document.getElementById('btn-play-again').addEventListener('click', () => {
    socket.emit('match:next', (res) => {
      if (res && res.error) toast(res.error);
    });
  });
  document.getElementById('btn-exit-session').addEventListener('click', () => location.reload());

  socket.on('error', (data) => toast(data.message || 'Errore'));

  socket.on('connect', () => {
    myId = socket.id;
  });

  loadCategories();
})();
