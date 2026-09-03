(() => {
  const socket = io();

  // ---- Stato locale --------------------------------------------------
  let myId = null;
  let myNickname = '';
  let currentRoomCode = null;
  let isHost = false;
  let createSettings = { visibility: 'private', mode: 'rush', difficulty: 'misto', hostMode: 'family', categories: [] };
  let newQuestionState = { difficulty: 'facile', correct: 0 };
  let playersById = new Map(); // id -> nickname (aggiornata da lobby/scoreboard)
  let currentEligibleIds = null;
  let currentPhase = 'phase1';
  let answered = false;
  let timerInterval = null;
  let hostBubbleTimeout = null;
  let talkingTimeout = null;
  let eliminationRoster = new Map(); // id -> { nickname, out }
  let lastScoreboardOrder = []; // id in ordine di classifica dell'ultimo render, per l'animazione dei sorpassi
  let iAmReady = false;
  let iHaveLeftMatch = false;
  let inBrainfight = false; // siamo nella fase finale "brainfighting"?
  let bfCanAnswer = false; // sono io il giocatore che si è prenotato in questo momento?

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
    // In modalità "spotlight" (pausa tra una domanda e l'altra) il fumetto resta visibile
    // finché non si passa alla domanda successiva (gestito altrove), non sparisce da solo.
    if (!bubble.classList.contains('spotlight')) {
      hostBubbleTimeout = setTimeout(() => bubble.classList.add('hidden'), 5200);
    }

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

  // ---- Caricamento categorie (selezione multipla a chip) ----------------
  function loadCategories() {
    fetch('/api/categories')
      .then((r) => r.json())
      .then((data) => {
        const niche = new Set(data.nicheCategories || []);
        const picker = document.getElementById('category-picker');
        const tuttaChip = document.getElementById('cat-chip-tutte');
        const datalist = document.getElementById('nq-category-list');

        // Rimuove eventuali chip di categoria da un caricamento precedente, tenendo "Tutte".
        picker.querySelectorAll('.cat-chip:not(#cat-chip-tutte)').forEach((el) => el.remove());
        datalist.innerHTML = '';

        data.categories.forEach((c) => {
          const chip = document.createElement('button');
          chip.type = 'button';
          chip.className = 'cat-chip' + (niche.has(c) ? ' niche' : '');
          chip.dataset.value = c;
          chip.textContent = niche.has(c) ? `${c} 🔧` : c;
          chip.addEventListener('click', () => toggleCategoryChip(chip));
          picker.appendChild(chip);

          const dopt = document.createElement('option');
          dopt.value = c;
          datalist.appendChild(dopt);
        });

        tuttaChip.addEventListener('click', () => {
          createSettings.categories = [];
          picker.querySelectorAll('.cat-chip').forEach((el) => el.classList.remove('active'));
          tuttaChip.classList.add('active');
        });
      })
      .catch(() => {});
  }

  function toggleCategoryChip(chip) {
    const tuttaChip = document.getElementById('cat-chip-tutte');
    const value = chip.dataset.value;
    const idx = createSettings.categories.indexOf(value);
    if (idx >= 0) {
      createSettings.categories.splice(idx, 1);
      chip.classList.remove('active');
    } else {
      createSettings.categories.push(value);
      chip.classList.add('active');
    }
    // "Tutte" è attiva solo quando nessuna categoria specifica è selezionata.
    tuttaChip.classList.toggle('active', createSettings.categories.length === 0);
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
  wireSegmented('opt-hostmode', (v) => {
    createSettings.hostMode = v;
    document.getElementById('hostmode-warning').style.display = v === 'unfiltered' ? 'block' : 'none';
  });
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
  function enterRoom() {
    document.getElementById('exit-menu-wrap').classList.remove('hidden');
  }

  document.getElementById('btn-create-confirm').addEventListener('click', () => {
    socket.emit(
      'lobby:create',
      { nickname: myNickname, visibility: createSettings.visibility, mode: createSettings.mode, difficulty: createSettings.difficulty, categories: createSettings.categories, hostMode: createSettings.hostMode },
      (res) => {
        if (res.error) return setError('create-error', res.error);
        currentRoomCode = res.code;
        isHost = true;
        enterRoom();
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
      enterRoom();
      renderLobby(res.summary);
      showScreen('screen-lobby');
    });
  });

  // ---- Partite pubbliche --------------------------------------------
  function formatCategories(categories) {
    if (!categories || categories.length === 0) return 'Tutte';
    return categories.join(' + ');
  }

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
      div.innerHTML = `<div><strong>${l.players} giocatori</strong><br/><span class="muted">${l.mode === 'rush' ? 'Rush' : l.mode === 'brainfight' ? 'Brainfighting 🧠' : 'Classica'} · ${l.difficulty} · ${formatCategories(l.categories)}</span></div>`;
      const btn = document.createElement('button');
      btn.textContent = 'Unisciti';
      btn.addEventListener('click', () => {
        socket.emit('lobby:join', { code: l.code, nickname: myNickname }, (res) => {
          if (res.error) return toast(res.error);
          currentRoomCode = res.code;
          isHost = false;
          enterRoom();
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
    const modeLabel = summary.mode === 'rush' ? 'Rush (velocità)' : summary.mode === 'brainfight' ? 'Solo Brainfighting 🧠' : 'Classica (10s, punti fissi)';
    const hostModeLabel = summary.hostMode === 'unfiltered' ? 'Sboccato 🔞' : 'Family friendly';
    document.getElementById('lobby-settings').textContent =
      `${summary.visibility === 'public' ? 'Partita aperta' : 'Partita chiusa'} · ${modeLabel} · Livello: ${summary.difficulty} · Categorie: ${formatCategories(summary.categories)} · Presentatore: ${hostModeLabel}`;

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

  function hideResultPause() {
    document.getElementById('host-bubble').classList.remove('spotlight');
    document.getElementById('ready-panel').classList.add('hidden');
    document.getElementById('screen-game').classList.remove('with-ready-panel');
    iAmReady = false;
  }

  socket.on('game:question', (q) => {
    showScreen('screen-game');
    answered = false;
    currentEligibleIds = q.eligibleIds;
    currentPhase = q.phase;

    // Se arriva una domanda "normale", non siamo (più) nel brainfighting: ripristina l'interfaccia.
    inBrainfight = false;
    bfCanAnswer = false;
    document.getElementById('buzz-wrap').classList.add('hidden');
    document.querySelector('.answers-grid').style.display = '';
    document.getElementById('brainfight-scores').classList.add('hidden');
    document.getElementById('grid-wrap').classList.add('hidden');
    document.getElementById('mini-scoreboard').classList.remove('hidden');
    document.querySelectorAll('.answer-btn').forEach((b) => { b.classList.remove('fume'); b.style.display = ''; });

    // Fine della pausa: si torna al presentatore in formato compatto e si nasconde "Pronto".
    hideResultPause();

    if (q.phase === 'phase1' && q.index === 0) {
      lastScoreboardOrder = []; // nuova partita: nessuna animazione di sorpasso sulla prima domanda
      iHaveLeftMatch = false; // nuova partita: si riparte tutti dentro, anche chi era uscito prima
    }

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
      if (inBrainfight) {
        if (!bfCanAnswer) return;
        answered = true;
        bfCanAnswer = false;
        const idx = parseInt(btn.dataset.idx, 10);
        socket.emit('game:brainfightAnswer', { answerIndex: idx });
        document.querySelectorAll('.answer-btn').forEach((b) => { b.disabled = true; b.classList.remove('waiting'); });
        btn.classList.add('selected');
        return;
      }
      const iAmEligible = !currentEligibleIds || currentEligibleIds.includes(myId);
      if (!iAmEligible) return;
      answered = true;
      const idx = parseInt(btn.dataset.idx, 10);
      socket.emit('game:answer', { answerIndex: idx });
      document.querySelectorAll('.answer-btn').forEach((b) => { b.disabled = true; b.classList.remove('waiting'); });
      btn.classList.add('selected');
    });
  });

  // ---- Sfida a griglia 2x2 ---------------------------------------------
  let gridSuggestions = [];
  let gridActiveCell = null;
  let gridFilled = new Set();

  function normalizeStr(s) {
    return s.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '').replace(/[^a-z0-9 ]/g, '').trim();
  }

  function closeGridInput() {
    gridActiveCell = null;
    document.getElementById('grid-input-wrap').classList.add('hidden');
    document.getElementById('grid-input').value = '';
    document.getElementById('grid-suggestions').innerHTML = '';
  }

  function renderGridSuggestions() {
    const q = normalizeStr(document.getElementById('grid-input').value);
    const box = document.getElementById('grid-suggestions');
    box.innerHTML = '';
    if (!q) return;
    const matches = gridSuggestions.filter((n) => normalizeStr(n).includes(q)).slice(0, 8);
    matches.forEach((name) => {
      const div = document.createElement('div');
      div.className = 'grid-suggestion';
      div.textContent = name;
      // Serve cliccare il suggerimento per confermare: nessun inserimento "alla cieca".
      div.addEventListener('click', () => submitGridCell(name));
      box.appendChild(div);
    });
  }

  function submitGridCell(name) {
    if (gridActiveCell === null) return;
    const cellIndex = gridActiveCell;
    socket.emit('grid:answer', { cellIndex, answer: name }, (res) => {
      if (!res || res.error) return toast(res && res.error ? res.error : 'Errore');
      const cellEl = document.getElementById('grid-cell-' + cellIndex);
      if (res.ok) {
        cellEl.textContent = res.canonical;
        cellEl.classList.add('filled');
        gridFilled.add(cellIndex);
        closeGridInput();
        document.getElementById('grid-status').textContent = `${gridFilled.size}/4 caselle completate`;
      } else {
        cellEl.classList.add('shake');
        setTimeout(() => cellEl.classList.remove('shake'), 400);
        toast(res.reason === 'duplicato' ? 'Nome già usato in questa griglia' : 'Non valido per questa casella');
      }
    });
  }

  document.querySelectorAll('.grid-cell').forEach((cell) => {
    cell.addEventListener('click', () => {
      const idx = parseInt(cell.dataset.cell, 10);
      if (gridFilled.has(idx)) return;
      gridActiveCell = idx;
      const rowLabel = document.getElementById('grid-row-' + Math.floor(idx / 2)).textContent;
      const colLabel = document.getElementById('grid-col-' + (idx % 2)).textContent;
      document.getElementById('grid-input-label').textContent = `${rowLabel}  ×  ${colLabel}`;
      document.getElementById('grid-input-wrap').classList.remove('hidden');
      document.getElementById('grid-input').value = '';
      document.getElementById('grid-suggestions').innerHTML = '';
      document.getElementById('grid-input').focus();
    });
  });

  document.getElementById('grid-input').addEventListener('input', renderGridSuggestions);
  document.getElementById('grid-cancel').addEventListener('click', closeGridInput);

  socket.on('grid:start', (data) => {
    showScreen('screen-game');
    hideResultPause();
    inBrainfight = true;
    gridSuggestions = data.suggestions || [];
    gridFilled = new Set();
    closeGridInput();

    document.getElementById('game-phase-label').textContent = 'Griglia';
    document.getElementById('game-category').textContent = data.category;
    document.getElementById('game-progress').textContent = 'Completa tutte e 4 le caselle!';
    document.getElementById('question-text').textContent = 'Chi completa per primo la griglia guadagna il punto';
    document.getElementById('spectator-banner').classList.add('hidden');
    document.getElementById('buzz-wrap').classList.add('hidden');
    document.querySelector('.answers-grid').style.display = 'none';
    document.getElementById('mini-scoreboard').classList.add('hidden');
    document.getElementById('elimination-chips').classList.add('hidden');
    document.getElementById('grid-wrap').classList.remove('hidden');

    data.rows.forEach((label, i) => (document.getElementById('grid-row-' + i).textContent = label));
    data.cols.forEach((label, i) => (document.getElementById('grid-col-' + i).textContent = label));
    [0, 1, 2, 3].forEach((i) => {
      const c = document.getElementById('grid-cell-' + i);
      c.textContent = '+';
      c.classList.remove('filled');
    });
    document.getElementById('grid-status').textContent = '0/4 caselle completate';

    renderBrainfightScores(data.scores);
    startTimer(data.timeLimitMs);
  });

  socket.on('grid:end', (data) => {
    stopTimer();
    closeGridInput();
    document.getElementById('grid-wrap').classList.add('hidden');
    renderBrainfightScores(data.scores);
    document.getElementById('question-text').textContent = data.nickname
      ? `${data.nickname} ha completato la griglia!`
      : 'Tempo scaduto: nessuno ha completato la griglia';

    document.getElementById('host-bubble').classList.add('spotlight');
    document.getElementById('ready-panel').classList.remove('hidden');
    iAmReady = false;
    const btnReady = document.getElementById('btn-ready');
    btnReady.disabled = false;
    btnReady.textContent = 'Pronto! ✅';
  });

  // ---- Calcolatrice della fase brainfighting ----------------------------
  // Valutatore sicuro (niente eval): tokenizza e applica shunting-yard.
  function safeEvaluate(expr) {
    const tokens = expr.match(/\d+\.?\d*|[+\-*/()]/g);
    if (!tokens) return null;
    const prec = { '+': 1, '-': 1, '*': 2, '/': 2 };
    const output = [];
    const ops = [];
    for (const t of tokens) {
      if (/^\d/.test(t)) {
        output.push(parseFloat(t));
      } else if (t === '(') {
        ops.push(t);
      } else if (t === ')') {
        while (ops.length && ops[ops.length - 1] !== '(') output.push(ops.pop());
        if (!ops.length) return null;
        ops.pop();
      } else {
        while (ops.length && ops[ops.length - 1] !== '(' && prec[ops[ops.length - 1]] >= prec[t]) {
          output.push(ops.pop());
        }
        ops.push(t);
      }
    }
    while (ops.length) {
      const op = ops.pop();
      if (op === '(') return null;
      output.push(op);
    }
    const stack = [];
    for (const tok of output) {
      if (typeof tok === 'number') {
        stack.push(tok);
      } else {
        const b = stack.pop();
        const a = stack.pop();
        if (a === undefined || b === undefined) return null;
        if (tok === '+') stack.push(a + b);
        else if (tok === '-') stack.push(a - b);
        else if (tok === '*') stack.push(a * b);
        else if (tok === '/') { if (b === 0) return null; stack.push(a / b); }
      }
    }
    if (stack.length !== 1 || !isFinite(stack[0])) return null;
    return Math.round(stack[0] * 1e6) / 1e6;
  }

  let calcExpr = '';
  function updateCalcDisplay() {
    document.getElementById('calc-display').textContent = calcExpr || '0';
  }
  document.querySelectorAll('.calc-key').forEach((key) => {
    key.addEventListener('click', () => {
      const v = key.dataset.calc;
      if (v === 'C') calcExpr = '';
      else if (v === '←') calcExpr = calcExpr.slice(0, -1);
      else if (v === '=') {
        const result = safeEvaluate(calcExpr);
        calcExpr = result === null ? '' : String(result);
      } else {
        calcExpr += v;
      }
      updateCalcDisplay();
    });
  });

  document.getElementById('btn-buzz').addEventListener('click', () => {
    const btn = document.getElementById('btn-buzz');
    if (btn.disabled) return;
    btn.disabled = true;
    document.getElementById('buzz-status').textContent = 'Prenotazione inviata...';
    socket.emit('game:buzz');
  });

  function renderBrainfightScores(scores) {
    const el = document.getElementById('brainfight-scores');
    el.classList.remove('hidden');
    el.innerHTML = '';
    scores.forEach((p) => {
      playersById.set(p.id, p.nickname);
      const div = document.createElement('div');
      div.className = 'bf-score' + (p.id === myId ? ' me' : '');
      const dots = '●'.repeat(p.score) + '○'.repeat(Math.max(0, 3 - p.score));
      div.innerHTML = `${p.nickname}<span class="bf-dots">${dots}</span>`;
      el.appendChild(div);
    });
  }

  socket.on('brainfight:start', (data) => {
    inBrainfight = true;
    toast('Fase finale: brainfighting! Calcoli a mente, vince chi arriva a 3 punti.');
    renderBrainfightScores(data.participants.map((p) => ({ id: p.id, nickname: p.nickname, score: 0 })));
  });

  socket.on('brainfight:waitBuzz', (data) => {
    showScreen('screen-game');
    hideResultPause();
    document.getElementById('grid-wrap').classList.add('hidden');
    answered = false;
    bfCanAnswer = false;
    document.getElementById('game-phase-label').textContent = 'Brainfighting';
    document.getElementById('game-progress').textContent = `${data.optionsRemaining} opzioni possibili`;
    document.getElementById('game-category').textContent = `${data.category} · ${data.difficulty}`;
    document.getElementById('question-text').textContent = data.text;
    document.getElementById('spectator-banner').classList.add('hidden');
    document.getElementById('mini-scoreboard').classList.add('hidden');
    document.getElementById('elimination-chips').classList.add('hidden');

    const iCanBuzz = data.eligibleIds.includes(myId);
    const buzzWrap = document.getElementById('buzz-wrap');
    buzzWrap.classList.remove('hidden');
    document.querySelector('.answers-grid').style.display = 'none';
    const btnBuzz = document.getElementById('btn-buzz');
    btnBuzz.disabled = !iCanBuzz;
    document.getElementById('buzz-status').textContent = iCanBuzz
      ? 'Premi per prenotarti a rispondere'
      : 'Non puoi prenotarti su questo problema: hai già sbagliato qui.';

    // La calcolatrice compare solo nei problemi che richiedono calcoli.
    const calcWrap = document.getElementById('calc-wrap');
    calcWrap.classList.toggle('hidden', !data.needsCalculator);
    if (data.needsCalculator) { calcExpr = ''; updateCalcDisplay(); }

    renderBrainfightScores(data.scores);
    startTimer(data.timeLimitMs);
  });

  socket.on('brainfight:buzzed', (data) => {
    stopTimer();
    document.getElementById('buzz-wrap').classList.add('hidden');
    const grid = document.querySelector('.answers-grid');
    grid.style.display = '';
    bfCanAnswer = data.playerId === myId;
    answered = false;

    const buttons = document.querySelectorAll('.answer-btn');
    buttons.forEach((btn, i) => {
      const label = btn.querySelector('.answer-label-text');
      if (i < data.answers.length) {
        label.textContent = data.answers[i];
        btn.style.display = '';
      } else {
        btn.style.display = 'none';
      }
      btn.classList.remove('correct', 'wrong-pick', 'selected', 'fume');
      btn.disabled = !bfCanAnswer;
      btn.classList.toggle('waiting', bfCanAnswer);
      if (!bfCanAnswer) btn.classList.add('fume');
    });

    document.getElementById('game-progress').textContent = bfCanAnswer
      ? 'Tocca a te: scegli, hai pochi secondi!'
      : `${data.nickname} si è prenotato/a...`;

    // Countdown breve: dopo il buzz si hanno solo pochi secondi per rispondere.
    if (data.answerTimeMs) startTimer(data.answerTimeMs);
  });

  socket.on('brainfight:result', (data) => {
    const buttons = document.querySelectorAll('.answer-btn');
    buttons.forEach((btn) => {
      const text = btn.querySelector('.answer-label-text').textContent;
      btn.classList.remove('fume');
      btn.disabled = true;
      if (data.correct && text === data.correctText) btn.classList.add('correct');
      if (!data.correct && text === data.pickedText) btn.classList.add('wrong-pick');
    });
    renderBrainfightScores(data.scores);

    // Il presentatore commenta; dopo la sua battuta arriverà un nuovo brainfight:waitBuzz
    // (stesso problema con un'opzione in meno, o uno nuovo) oppure game:final se c'è un vincitore.
    document.getElementById('host-bubble').classList.add('spotlight');
    document.getElementById('ready-panel').classList.remove('hidden');
    iAmReady = false;
    const btnReady = document.getElementById('btn-ready');
    btnReady.disabled = false;
    btnReady.textContent = 'Pronto! ✅';
  });

  function renderMiniScoreboard(scoreboard, deltas) {
    scoreboard.forEach((p) => playersById.set(p.id, p.nickname));
    const el = document.getElementById('mini-scoreboard');

    // FLIP: cattura la posizione attuale di ogni riga prima di ridisegnare, per poter animare
    // lo spostamento verso la nuova posizione (sorpassi in classifica).
    const firstRects = new Map();
    el.querySelectorAll('.row').forEach((row) => {
      firstRects.set(row.dataset.playerId, row.getBoundingClientRect());
    });
    const oldOrder = lastScoreboardOrder;

    el.innerHTML = '';
    scoreboard.forEach((p, i) => {
      const oldRank = oldOrder.indexOf(p.id);
      const row = document.createElement('div');
      row.dataset.playerId = p.id;
      let arrow = '';
      let moveClass = '';
      if (oldRank !== -1 && oldRank !== i) {
        if (oldRank > i) {
          arrow = '<span class="rank-arrow rank-up">▲</span>';
          moveClass = ' rank-improved';
        } else {
          arrow = '<span class="rank-arrow rank-down">▼</span>';
          moveClass = ' rank-worsened';
        }
      }
      row.className = 'row' + (p.id === myId ? ' me' : '') + moveClass;
      // Punti guadagnati (o persi) proprio in questa domanda, così si vede subito il perché
      // del movimento in classifica invece del solo totale.
      let deltaHtml = '';
      if (deltas && Object.prototype.hasOwnProperty.call(deltas, p.id)) {
        const d = deltas[p.id];
        const txt = d > 0 ? `+${d}` : String(d);
        deltaHtml = `<span class="pts-delta${d === 0 ? ' zero' : ''}">${txt}</span>`;
      }
      row.innerHTML = `<span>${i + 1}. ${arrow}${p.nickname}${p.eliminated ? ' ❌' : ''}${p.leftMatch ? ' 🚪' : ''}</span><span>${p.score} pt${deltaHtml}</span>`;
      el.appendChild(row);
    });

    // FLIP: applica la vecchia posizione e la anima verso quella nuova (appena calcolata).
    el.querySelectorAll('.row').forEach((row) => {
      const first = firstRects.get(row.dataset.playerId);
      if (!first) return;
      const last = row.getBoundingClientRect();
      const deltaY = first.top - last.top;
      if (deltaY) {
        row.style.transition = 'none';
        row.style.transform = `translateY(${deltaY}px)`;
        requestAnimationFrame(() => {
          row.style.transition = 'transform 0.5s ease';
          row.style.transform = '';
        });
      }
    });

    lastScoreboardOrder = scoreboard.map((p) => p.id);
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
    // Punti guadagnati da ciascuno in QUESTA domanda, per mostrarli accanto al totale.
    const deltas = {};
    (data.results || []).forEach((r) => { deltas[r.id] = r.points; });
    if (data.scoreboard) renderMiniScoreboard(data.scoreboard, deltas);

    // Il presentatore passa in primo piano per la pausa, con il pulsante "Pronto".
    document.getElementById('host-bubble').classList.add('spotlight');
    document.getElementById('screen-game').classList.add('with-ready-panel');
    const readyPanel = document.getElementById('ready-panel');
    readyPanel.classList.remove('hidden');
    iAmReady = false;
    const btnReady = document.getElementById('btn-ready');
    btnReady.disabled = false;
    btnReady.textContent = 'Pronto! ✅';
  });

  document.getElementById('btn-ready').addEventListener('click', () => {
    if (iAmReady) return;
    iAmReady = true;
    socket.emit('game:ready');
    const btn = document.getElementById('btn-ready');
    btn.disabled = true;
    btn.textContent = 'In attesa degli altri...';
  });

  socket.on('game:readyStatus', (data) => {
    document.getElementById('ready-count').textContent = data.ready;
    document.getElementById('ready-total').textContent = data.total;
  });

  // ---- Menu di uscita: dalla partita (resti in sessione) o dalla sessione intera --------
  document.getElementById('btn-exit-toggle').addEventListener('click', () => {
    document.getElementById('exit-menu').classList.toggle('hidden');
  });
  document.getElementById('btn-exit-cancel').addEventListener('click', () => {
    document.getElementById('exit-menu').classList.add('hidden');
  });
  document.getElementById('btn-leave-match').addEventListener('click', () => {
    document.getElementById('exit-menu').classList.add('hidden');
    if (iHaveLeftMatch) return toast('Hai già abbandonato questa partita.');
    if (!confirm('Abbandonare questa partita? Resterai nella sessione per la prossima.')) return;
    socket.emit('match:leave', (res) => {
      if (res && res.error) return toast(res.error);
      iHaveLeftMatch = true;
      toast('Hai abbandonato questa partita. Resti nella sessione.');
    });
  });
  document.getElementById('btn-leave-session').addEventListener('click', () => {
    document.getElementById('exit-menu').classList.add('hidden');
    if (!confirm('Uscire dalla sessione? Non potrai rientrare in questa stanza.')) return;
    socket.emit('session:leave');
    location.reload();
  });

  // ---- Fine fase 1 -----------------------------------------------------
  socket.on('phase1:end', (data) => {
    hideResultPause();
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
    hideResultPause();
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
    hideResultPause();
    inBrainfight = false;
    bfCanAnswer = false;
    document.getElementById('buzz-wrap').classList.add('hidden');
    document.getElementById('brainfight-scores').classList.add('hidden');
    document.getElementById('grid-wrap').classList.add('hidden');
    document.querySelector('.answers-grid').style.display = '';
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

    // Statistiche della serata: i "premi" calcolati sull'intera sessione.
    const awardsWrap = document.getElementById('session-awards-wrap');
    const awardsEl = document.getElementById('session-awards');
    const awards = data.sessionAwards || [];
    awardsEl.innerHTML = '';
    if (awards.length === 0) {
      awardsWrap.classList.add('hidden');
    } else {
      awardsWrap.classList.remove('hidden');
      awards.forEach((a) => {
        const card = document.createElement('div');
        card.className = 'stat-card';
        card.innerHTML = `<div class="stat-title">${a.title}</div><div class="stat-value">${a.nickname}</div><div class="stat-detail">${a.detail}</div>`;
        awardsEl.appendChild(card);
      });
    }

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
    const previousId = myId;
    myId = socket.id;

    // Riconnessione: se eravamo già in una partita e la connessione è caduta, proviamo a
    // riprendere il posto invece di restare tagliati fuori. Il server riconosce il giocatore
    // dal nickname e gli restituisce punteggio e stato esattamente come li aveva lasciati.
    if (previousId && previousId !== socket.id && currentRoomCode && myNickname) {
      socket.emit('lobby:reconnect', { code: currentRoomCode, nickname: myNickname }, (res) => {
        if (res && res.ok) {
          toast('Riconnesso alla partita ✅');
          if (res.state !== 'lobby') showScreen('screen-game');
        } else {
          toast((res && res.error) || 'Non è stato possibile rientrare nella partita');
        }
      });
    }
  });

  socket.on('disconnect', () => {
    toast('Connessione persa, sto provando a rientrare...');
  });

  loadCategories();
})();
