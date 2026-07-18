'use strict';
// =====================================================================
//  English Shadowing AI — サブスク版 メインアプリ
// =====================================================================

// ── State ──────────────────────────────────────────────────────────────
const state = {
  currentText:        '',
  words:              [],
  isPlaying:          false,
  isPaused:           false,
  isRepeating:        false,
  isRecording:        false,
  utterance:          null,
  mediaRecorder:      null,
  audioChunks:        [],
  recognition:        null,
  lastTranscript:     '',
  lastScore:          null,
  explainCache:       null,   // { text, translation, items }
  currentSavedId:     null,   // 履歴から読み込んだ保存テキストのID（解説の永続化先）
  // Dialogue
  dialogueMode:       false,
  dialogueSilentRole: 'B',
  dialogueFullPlay:   true,
  dialogueSegs:       [],
  dialogueStopped:    false,
  dialogueTimer:      null,
  _iosStop:           null,
};

// iOS 判定
const _isIOS = /iPhone|iPad|iPod/.test(navigator.userAgent) ||
  (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);

// ── DOM refs ──────────────────────────────────────────────────────────
const $ = id => document.getElementById(id);
const el = {
  navBtns:        document.querySelectorAll('.nav-btn'),
  tabs:           document.querySelectorAll('.tab-content'),
  inputTabs:      document.querySelectorAll('.input-tab'),
  inputPanels:    document.querySelectorAll('.input-panel'),
  // Generate
  themeInput:     $('theme-input'),
  generateBtn:    $('generate-btn'),
  genBtnNormal:   document.querySelector('#generate-btn .btn-normal'),
  genBtnLoading:  document.querySelector('#generate-btn .btn-loading'),
  styleSelect:    $('style-select'),
  suggestChips:   document.querySelectorAll('.suggest-chip'),
  genQuota:       $('gen-quota'),
  // Manual
  manualText:     $('manual-text'),
  saveManualBtn:  $('save-manual-btn'),
  // Display
  textDisplay:    $('text-display'),
  explainBtn:     $('explain-btn'),
  saveTextBtn:    $('save-text-btn'),
  // Dialogue
  dialogueCtrl:   $('dialogue-controls'),
  roleBtns:       document.querySelectorAll('.role-btn'),
  roleHint:       $('role-hint'),
  roleSelector:   $('role-selector'),
  playModeBtns:   document.querySelectorAll('.play-mode-btn'),
  // TTS
  playBtn:        $('play-btn'),
  stopBtn:        $('stop-btn'),
  repeatBtn:      $('repeat-btn'),
  speedSlider:    $('speed-slider'),
  speedValue:     $('speed-value'),
  voiceSelect:    $('voice-select'),
  // Recording
  recordBtn:      $('record-btn'),
  recordLabel:    $('record-label'),
  recStatus:      $('rec-status'),
  audioArea:      $('audio-playback-area'),
  recordedAudio:  $('recorded-audio'),
  scoreArea:      $('score-area'),
  ringFill:       $('ring-fill'),
  scoreNum:       $('score-num'),
  scoreMsg:       $('score-msg'),
  // History
  savedList:      $('saved-list'),
  clearAllBtn:    $('clear-all-btn'),
  // Explain modal
  explainModal:   $('explain-modal'),
  explainSource:  $('explain-source'),
  explainTrans:   $('explain-translation'),
  explainLoading: $('explain-loading'),
  explainList:    $('explain-list'),
  regenExplain:   $('regen-explain-btn'),
  // Review modal
  reviewModal:    $('review-modal'),
  reviewMeta:     $('review-meta'),
  reviewText:     $('review-text'),
  reviewPlayBtn:  $('review-play-btn'),
  reviewPractBtn: $('review-practice-btn'),
  reviewExplain:  $('review-explain-area'),
  // Close btns
  closeBtns:      document.querySelectorAll('.close-modal'),
};

// ── Toast ─────────────────────────────────────────────────────────────
window.showToast = function(msg, isError = false) {
  const t = $('toast');
  t.textContent = msg;
  t.classList.toggle('error-toast', isError);
  t.classList.add('show');
  setTimeout(() => t.classList.remove('show'), 2800);
};

// ── OpenAI TTS キャッシュ ─────────────────────────────────────────────
// key: "${voice}:${text}" → blob URL
const ttsCache = new Map();
let currentAudio   = null;   // 現在再生中の Audio オブジェクト
let ttsAbort       = null;   // AbortController（フェッチ中断用）

/** TTS音声をフェッチ（キャッシュあれば再利用） */
async function fetchTTS(text, voice) {
  const key = `${voice}:${text}`;
  if (ttsCache.has(key)) return ttsCache.get(key);

  const controller = new AbortController();
  ttsAbort = controller;

  const res = await fetch('/api/tts', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ text, voice }),
    signal: controller.signal,
  });
  if (!res.ok) {
    const d = await res.json().catch(() => ({}));
    throw new Error(d.error || 'TTS生成エラー');
  }
  const blob = await res.blob();
  const url  = URL.createObjectURL(blob);
  ttsCache.set(key, url);
  return url;
}

// ★ 単一の共有Audioインスタンス
//   iOS Safari は新規 Audio 生成のたびに user gesture 権限が失われるため、
//   ダイアログ連続再生で2文目以降が play() 拒否される。
//   同一インスタンスの src を入れ替えれば権限が継続する（shadowing-webで実証済み）。
let _sharedAudio = null;
function _getSharedAudio() {
  if (!_sharedAudio) {
    _sharedAudio = new Audio();
    _sharedAudio.preload = 'auto';
  }
  return _sharedAudio;
}

/** Audio を再生して終わるまで待つ Promise */
function playAudio(url, rate) {
  return new Promise((resolve, reject) => {
    const audio = _getSharedAudio();
    audio.src = url;
    audio.playbackRate = Math.max(0.5, Math.min(2.0, rate));
    currentAudio = audio;

    const cleanup = () => {
      audio.removeEventListener('ended', onEnded);
      audio.removeEventListener('error', onError);
    };
    const onEnded = () => { cleanup(); resolve(); };
    const onError = () => {
      cleanup();
      // 停止操作（stopSpeech が src='' にする）で発火する error は正常系として扱う
      if (state.dialogueStopped) { resolve(); return; }
      reject(new Error('audio error'));
    };
    audio.addEventListener('ended', onEnded, { once: true });
    audio.addEventListener('error', onError, { once: true });

    const p = audio.play();
    if (p && typeof p.catch === 'function') {
      p.catch(err => { cleanup(); reject(err); });
    }
  });
}

/** 単語数ベースの再生時間概算（無音待機用）
 *  metadata ロード用に別 Audio を作ると iOS で保留される事例があるため、
 *  実測ではなく概算を使う（平均英語音声 ~150wpm 基準 + バッファ700ms） */
function estimateDurationMs(text, rate) {
  const words = (text || '').trim().split(/\s+/).filter(Boolean).length || 1;
  return Math.max(1200, (words / (150 * rate)) * 60_000 + 700);
}

/** ボイスセレクトの値 */
function getTTSVoice() {
  return el.voiceSelect?.value || 'nova';
}

// ── Navigation ────────────────────────────────────────────────────────
el.navBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const tab = btn.dataset.tab;
    switchTab(tab);
  });
});

window.switchTab = function(tab) {
  el.navBtns.forEach(b => b.classList.toggle('active', b.dataset.tab === tab));
  el.tabs.forEach(t => t.classList.remove('active'));
  const target = document.getElementById(`tab-${tab}`);
  if (target) target.classList.add('active');
  if (tab === 'history') renderSaved();
  if (window.onTabSwitch && window.onTabSwitch[tab]) window.onTabSwitch[tab]();
};

// ── Input tabs ────────────────────────────────────────────────────────
el.inputTabs.forEach(tab => {
  tab.addEventListener('click', () => {
    const type = tab.dataset.input;
    el.inputTabs.forEach(t => t.classList.remove('active'));
    el.inputPanels.forEach(p => p.classList.remove('active'));
    tab.classList.add('active');
    document.getElementById(`input-${type}`).classList.add('active');
  });
});

// ── Suggest chips ─────────────────────────────────────────────────────
el.suggestChips.forEach(chip => {
  chip.addEventListener('click', () => {
    el.themeInput.value = chip.textContent;
    el.themeInput.focus();
  });
});

// ── Speed slider ──────────────────────────────────────────────────────
el.speedSlider.addEventListener('input', () => {
  el.speedValue.textContent = parseFloat(el.speedSlider.value).toFixed(1);
});

// =====================================================================
//  AI テキスト生成
// =====================================================================
el.generateBtn.addEventListener('click', generateText);
el.themeInput.addEventListener('keydown', e => { if (e.key === 'Enter') generateText(); });

async function generateText() {
  const theme = el.themeInput.value.trim();
  if (!theme) { shake(el.themeInput); return; }

  setGenState(true);
  setCurrentText('');

  let accumulated = '';
  try {
    const resp = await fetch('/api/generate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ theme, style: el.styleSelect?.value || 'dialogue' }),
    });

    if (!resp.ok) {
      let body = {};
      try { body = await resp.json(); } catch {}
      if (body.error === 'SUBSCRIPTION_REQUIRED') {
        el.textDisplay.innerHTML = `<div class="error-apikey"><p>💳 サブスクリプションが必要です</p><p class="error-sub">「プラン」タブで申し込んでください。</p><button class="btn-primary" onclick="switchTab('subscription')">プランを見る</button></div>`;
        setControlsEnabled(false);
        return;
      }
      if (body.error === 'QUOTA_EXCEEDED') {
        el.textDisplay.innerHTML = `<div class="error-apikey"><p>📊 今月の生成件数上限に達しました</p><p class="error-sub">来月の更新をお待ちください。</p></div>`;
        setControlsEnabled(false);
        return;
      }
      throw new Error(body.error || `サーバーエラー (${resp.status})`);
    }

    const reader = resp.body.getReader();
    const dec    = new TextDecoder();

    outer: while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      const chunk = dec.decode(value, { stream: true });
      for (const line of chunk.split('\n')) {
        if (!line.startsWith('data: ')) continue;
        const payload = line.slice(6).trim();
        if (payload === '[DONE]') break outer;
        let parsed;
        try { parsed = JSON.parse(payload); } catch { continue; }
        if (parsed.error) throw new Error(parsed.error);
        if (parsed.done) {
          // クォータ更新
          if (window.subState && window.subState.sub) {
            window.subState.sub.gen_used = parsed.gen_used;
            if (el.genQuota) el.genQuota.textContent = `今月 ${parsed.gen_used} / ${parsed.gen_max} 件`;
          }
        }
        if (parsed.text) { accumulated += parsed.text; renderStreaming(accumulated); }
      }
    }

    if (!accumulated.trim()) throw new Error('テキストが生成されませんでした。テーマを変えてお試しください。');
    setCurrentText(accumulated);
  } catch (err) {
    console.error('[generate]', err.message);
    el.textDisplay.innerHTML = `<div class="error-apikey"><p>⚠️ 生成エラー</p><p class="error-sub">${escHtml(err.message)}</p></div>`;
    setControlsEnabled(false);
  } finally {
    setGenState(false);
  }
}

function setGenState(on) {
  el.generateBtn.disabled = on;
  el.genBtnNormal.classList.toggle('hidden', on);
  el.genBtnLoading.classList.toggle('hidden', !on);
  if (on) {
    el.textDisplay.classList.add('generating');
    el.textDisplay.innerHTML = '<p class="placeholder-text">✨ 生成中…</p>';
  } else {
    el.textDisplay.classList.remove('generating');
  }
}

// ── Manual input ──────────────────────────────────────────────────────
el.saveManualBtn.addEventListener('click', () => {
  const t = el.manualText.value.trim();
  if (!t) { shake(el.manualText); return; }
  setCurrentText(t);
  el.manualText.value = '';
});

// =====================================================================
//  テキスト表示
// =====================================================================
function setCurrentText(text) {
  state.currentText = text;
  state.explainCache = null;
  state.currentSavedId = null; // 履歴から読み込む場合は呼出側が直後に再セットする
  if (!text) {
    el.textDisplay.innerHTML = '<p class="placeholder-text">上でテキストを生成または入力してください</p>';
    setControlsEnabled(false);
    el.dialogueCtrl.classList.add('hidden');
    state.dialogueMode = false;
    return;
  }

  const parsed = parseDialogue(text);
  state.dialogueMode = parsed.isDialogue;
  state.dialogueSegs = parsed.segs;

  if (parsed.isDialogue) {
    state.dialogueFullPlay = true;
    el.dialogueCtrl.classList.remove('hidden');
    el.playModeBtns.forEach(b => b.classList.toggle('active', b.dataset.mode === 'full'));
    el.roleSelector.classList.add('hidden');
    el.textDisplay.innerHTML = buildDialogueHTML(text, parsed.segs, state.dialogueSilentRole, true);
    updateRoleHint();
  } else {
    el.dialogueCtrl.classList.add('hidden');
    el.textDisplay.innerHTML = buildWordSpans(text);
  }

  state.words = Array.from(el.textDisplay.querySelectorAll('.word'));
  setControlsEnabled(true);
  el.saveTextBtn.textContent = '📌 保存';
  el.audioArea.classList.add('hidden');
  el.scoreArea.classList.add('hidden');
  state.lastScore      = null;
  state.lastTranscript = '';
}

function renderStreaming(text) {
  el.textDisplay.innerHTML = buildWordSpans(text);
  state.words = Array.from(el.textDisplay.querySelectorAll('.word'));
}

function buildWordSpans(text) {
  let html = '', i = 0;
  while (i < text.length) {
    if (/\S/.test(text[i])) {
      const start = i;
      while (i < text.length && /\S/.test(text[i])) i++;
      html += `<span class="word" data-start="${start}" data-end="${i}">${escHtml(text.slice(start, i))}</span>`;
    } else {
      html += text[i] === '\n' ? '<br>' : escHtml(text[i]);
      i++;
    }
  }
  return html;
}

function buildWordSpansAt(text, startOff, length) {
  let html = '', i = startOff;
  const end = startOff + length;
  while (i < end) {
    if (/\S/.test(text[i])) {
      const ws = i;
      while (i < end && /\S/.test(text[i])) i++;
      html += `<span class="word" data-start="${ws}" data-end="${i}">${escHtml(text.slice(ws, i))}</span>`;
    } else {
      html += text[i] === '\n' ? '<br>' : escHtml(text[i]);
      i++;
    }
  }
  return html;
}

function setControlsEnabled(on) {
  [el.playBtn, el.stopBtn, el.repeatBtn, el.recordBtn, el.saveTextBtn, el.explainBtn]
    .forEach(b => { if (b) b.disabled = !on; });
}

// =====================================================================
//  ダイアログモード
// =====================================================================
function parseDialogue(text) {
  const lines = text.split('\n');
  let offset = 0;
  const segs = [];
  // 話者マーカー: 行頭または空白の後の A / B。
  // AI生成テキストの揺れに耐性を持たせる:
  //   行頭スペース・**太字**・全角コロン(：)・コロン前後の空白・同一行に複数話者
  const MARK = /(^|\s)\*{0,2}([AB])\*{0,2}\s*[:：]\*{0,2}\s*/g;
  // 「A:」だけの行の後に本文が続く形式に対応するため、直近の話者を保持する。
  // マーカー出現前の行はナレーション(N)扱い。
  let currentRole = 'N';
  for (const raw of lines) {
    MARK.lastIndex = 0;
    const marks = [];
    let m;
    while ((m = MARK.exec(raw)) !== null) {
      marks.push({ role: m[2], markStart: m.index + m[1].length, textStart: m.index + m[0].length });
    }
    if (!marks.length) {
      // マーカー無し行: 直近の話者に帰属（マーカー単独行の続きの本文）
      if (raw.trim()) segs.push({ role: currentRole, text: raw, textOffset: offset });
    } else {
      // 最初のマーカーより前のテキストは直前の話者に帰属
      const head = raw.slice(0, marks[0].markStart);
      if (head.trim()) segs.push({ role: currentRole, text: head, textOffset: offset });
      for (let i = 0; i < marks.length; i++) {
        const start = marks[i].textStart;
        const end   = i + 1 < marks.length ? marks[i + 1].markStart : raw.length;
        const t     = raw.slice(start, end);
        currentRole = marks[i].role;  // 本文が次行の場合はここで話者だけ切り替わる
        if (t.trim()) segs.push({ role: currentRole, text: t, textOffset: offset + start });
      }
    }
    offset += raw.length + 1;
  }
  return { isDialogue: segs.some(s=>s.role==='A') && segs.some(s=>s.role==='B'), segs };
}

function buildDialogueHTML(text, segs, silentRole, fullPlay = false) {
  return segs.map((seg, idx) => {
    const silent  = !fullPlay && seg.role === silentRole;
    const roleTag = (seg.role === 'A' || seg.role === 'B')
      ? `<span class="role-tag role-${seg.role}">${seg.role}</span>` : '';
    const words = buildWordSpansAt(text, seg.textOffset, seg.text.length);
    return `<div class="dl-line${silent?' dl-silent':''}" data-role="${seg.role}" data-idx="${idx}">${roleTag}${words}</div>`;
  }).join('');
}

el.playModeBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const mode = btn.dataset.mode;
    state.dialogueFullPlay = (mode === 'full');
    el.playModeBtns.forEach(b => b.classList.toggle('active', b.dataset.mode === mode));
    el.roleSelector.classList.toggle('hidden', state.dialogueFullPlay);
    // 練習モードに入った時、現在の担当ロールボタンをハイライト（未選択に見える問題の防止）
    if (!state.dialogueFullPlay) {
      el.roleBtns.forEach(b => {
        b.classList.remove('active-A', 'active-B');
        if (b.dataset.role === state.dialogueSilentRole)
          b.classList.add(`active-${state.dialogueSilentRole}`);
      });
    }
    if (state.dialogueMode && state.currentText) {
      stopSpeech();
      el.textDisplay.innerHTML = buildDialogueHTML(
        state.currentText, state.dialogueSegs, state.dialogueSilentRole, state.dialogueFullPlay);
      state.words = Array.from(el.textDisplay.querySelectorAll('.word'));
      updateRoleHint();
    }
  });
});

el.roleBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    state.dialogueSilentRole = btn.dataset.role;
    el.roleBtns.forEach(b => {
      b.classList.remove('active-A', 'active-B');
      if (b.dataset.role === state.dialogueSilentRole) {
        b.classList.add(`active-${state.dialogueSilentRole}`);
      }
    });
    if (state.dialogueMode && state.currentText) {
      stopSpeech();
      el.textDisplay.innerHTML = buildDialogueHTML(
        state.currentText, state.dialogueSegs, state.dialogueSilentRole, state.dialogueFullPlay);
      state.words = Array.from(el.textDisplay.querySelectorAll('.word'));
      updateRoleHint();
    }
  });
});

function updateRoleHint() {
  if (!el.roleHint) return;
  if (state.dialogueFullPlay) {
    el.roleHint.classList.add('hidden');
    return;
  }
  el.roleHint.classList.remove('hidden');
  const mine    = state.dialogueSilentRole;
  const partner = mine === 'A' ? 'B' : 'A';
  el.roleHint.textContent = `${mine} があなたのパートです。${mine} は無音になるので声に出して読みましょう（${partner} は再生されます）`;
}

// =====================================================================
//  音声再生（OpenAI TTS）
// =====================================================================
el.playBtn.addEventListener('click', () => {
  if (state.isPaused) {
    resumeSpeech();
  } else if (state.isPlaying) {
    pauseSpeech();
  } else {
    startSpeech();
  }
});
el.stopBtn.addEventListener('click', stopSpeech);
el.repeatBtn.addEventListener('click', () => {
  state.isRepeating = !state.isRepeating;
  el.repeatBtn.classList.toggle('active', state.isRepeating);
});

function setPlayBtnLoading(on) {
  el.playBtn.disabled = on;
  el.playBtn.textContent = on ? '⏳ 読み込み中…' : '▶ 再生';
}

function startSpeech() {
  if (!state.currentText) return;
  stopSpeech();
  state.dialogueStopped = false;

  if (state.dialogueMode) {
    startDialogueSpeech();
    return;
  }

  // モノローグ
  (async () => {
    const rate  = parseFloat(el.speedSlider.value);
    const voice = getTTSVoice();
    setPlayBtnLoading(true);
    try {
      const url = await fetchTTS(state.currentText, voice);
      if (state.dialogueStopped) return;
      state.isPlaying = true;
      el.playBtn.disabled = false;
      el.playBtn.textContent = '⏸ 一時停止';
      await playAudio(url, rate);
      if (!state.dialogueStopped) {
        state.isPlaying = false;
        el.playBtn.textContent = '▶ 再生';
        if (state.isRepeating) setTimeout(startSpeech, 600);
      }
    } catch (err) {
      if (err.name === 'AbortError' || state.dialogueStopped) return; // 停止操作は正常系
      console.error('[TTS]', err.message);
      showToast('音声エラー: ' + err.message, true);
      state.isPlaying = false;
      el.playBtn.disabled = false;
      el.playBtn.textContent = '▶ 再生';
    }
  })();
}

function startDialogueSpeech() {
  const segs  = state.dialogueSegs;
  const rate  = parseFloat(el.speedSlider.value);
  const voice = getTTSVoice();

  (async () => {
    // ── 全セグメントの音声を並列プリフェッチ ──────────────────────
    setPlayBtnLoading(true);
    const urls = {};
    try {
      await Promise.all(
        segs.map(async (seg, i) => {
          if (!seg.text.trim()) return;
          urls[i] = await fetchTTS(seg.text, voice);
        })
      );
    } catch (err) {
      if (err.name === 'AbortError') return;
      showToast('音声読み込みエラー: ' + err.message, true);
      state.isPlaying = false;
      el.playBtn.disabled = false;
      el.playBtn.textContent = '▶ 再生';
      return;
    }

    if (state.dialogueStopped) return;
    state.isPlaying = true;
    el.playBtn.disabled = false;
    el.playBtn.textContent = '⏸ 一時停止';

    function highlightLine(idx) {
      document.querySelectorAll('.dl-line').forEach(l => l.classList.remove('hl-line'));
      const line = document.querySelector(`.dl-line[data-idx="${idx}"]`);
      if (line) {
        line.classList.add('hl-line');
        line.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
      }
    }
    function clearLine() {
      document.querySelectorAll('.dl-line').forEach(l => l.classList.remove('hl-line'));
    }

    // ── 全体読み上げモード ──────────────────────────────────────
    if (state.dialogueFullPlay) {
      for (let i = 0; i < segs.length; i++) {
        if (state.dialogueStopped) break;
        const seg = segs[i];
        if (!seg.text.trim() || !urls[i]) continue;
        highlightLine(i);
        try {
          await playAudio(urls[i], rate);
        } catch (err) {
          console.warn('[dialogue] play failed at line', i, err.message);
          await new Promise(r => {
            const t = setTimeout(r, estimateDurationMs(seg.text, rate));
            state.dialogueTimer = t;
          });
        }
        clearLine();
      }
    } else {
      // ── 役割練習モード ────────────────────────────────────────
      // 無音パート: 相手セグメントの実際の再生時間分だけ間を空ける
      for (let i = 0; i < segs.length; i++) {
        if (state.dialogueStopped) break;
        const seg = segs[i];
        if (!seg.text.trim()) continue;
        highlightLine(i);

        if (seg.role === state.dialogueSilentRole) {
          // 自分のパート: 単語数ベースで無音待機
          await new Promise(r => {
            const t = setTimeout(r, estimateDurationMs(seg.text, rate));
            state.dialogueTimer = t;
          });
        } else {
          try {
            await playAudio(urls[i], rate);
          } catch (err) {
            console.warn('[dialogue] play failed at line', i, err.message);
            // 再生失敗時も推定時間ぶん待つ（瞬間スキップ防止）
            await new Promise(r => {
              const t = setTimeout(r, estimateDurationMs(seg.text, rate));
              state.dialogueTimer = t;
            });
          }
        }
        clearLine();
      }
    }

    if (!state.dialogueStopped) {
      state.isPlaying = false;
      el.playBtn.textContent = '▶ 再生';
      if (state.isRepeating) setTimeout(startDialogueSpeech, 800);
    }
  })();
}

function pauseSpeech() {
  if (currentAudio && !currentAudio.paused) {
    currentAudio.pause();
    state.isPlaying = false;
    state.isPaused  = true;
    el.playBtn.textContent = '▶ 再生';
  }
}

function resumeSpeech() {
  if (currentAudio && currentAudio.paused) {
    currentAudio.play().catch(() => {});
    state.isPlaying = true;
    state.isPaused  = false;
    el.playBtn.textContent = '⏸ 一時停止';
  }
}

function stopSpeech() {
  state.dialogueStopped = true;
  if (ttsAbort)          { ttsAbort.abort(); ttsAbort = null; }
  if (state.dialogueTimer) { clearTimeout(state.dialogueTimer); state.dialogueTimer = null; }
  if (currentAudio)      { currentAudio.pause(); currentAudio.src = ''; currentAudio = null; }
  state.isPlaying = false;
  state.isPaused  = false;
  el.playBtn.disabled   = false;
  el.playBtn.textContent = '▶ 再生';
  document.querySelectorAll('.dl-line').forEach(l => l.classList.remove('hl-line'));
}

// =====================================================================
//  録音・採点（OpenAI Whisper API）
// =====================================================================

// 採点機能フラグ: false の間は録音のみ動作（Whisper API呼出なし＝コストゼロ）
// サブスク有効ユーザーのみ採点API（/api/score）を呼べる
const SCORING_ENABLED = true;

// iOS 用: Float32Array PCM バッファ群 → WAV ArrayBuffer
function _pcmToWAV(bufs, sr) {
  const total = bufs.reduce((n, b) => n + b.length, 0);
  const ab = new ArrayBuffer(44 + total * 2);
  const dv = new DataView(ab);
  const ws = (o, s) => { for (let i = 0; i < s.length; i++) dv.setUint8(o + i, s.charCodeAt(i)); };
  ws(0,'RIFF'); dv.setUint32(4, 36 + total*2, true); ws(8,'WAVE');
  ws(12,'fmt '); dv.setUint32(16,16,true); dv.setUint16(20,1,true); dv.setUint16(22,1,true);
  dv.setUint32(24,sr,true); dv.setUint32(28,sr*2,true); dv.setUint16(32,2,true); dv.setUint16(34,16,true);
  ws(36,'data'); dv.setUint32(40,total*2,true);
  let off = 44;
  for (const b of bufs) {
    for (let i = 0; i < b.length; i++, off += 2) {
      const s = Math.max(-1, Math.min(1, b[i]));
      dv.setInt16(off, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
  }
  return ab;
}

// 録音完了後: 新しい <audio> 要素を生成して差し替え + 再生エリアを表示
function _showAudio(blob) {
  const url   = URL.createObjectURL(blob);
  const fresh = document.createElement('audio');
  fresh.id = 'recorded-audio'; fresh.controls = true; fresh.src = url;
  const old = el.recordedAudio;
  if (old?.src?.startsWith('blob:')) try { URL.revokeObjectURL(old.src); } catch {}
  if (old?.parentNode) old.replaceWith(fresh); else el.audioArea.appendChild(fresh);
  el.recordedAudio = fresh;
  el.audioArea.classList.remove('hidden');
}

el.recordBtn.addEventListener('click', toggleRecord);

function toggleRecord() {
  if (state.isRecording) stopRecording();
  else startRecording();
}

async function startRecording() {
  if (!state.currentText) return;
  stopSpeech();

  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch {
    showToast('マイクの使用が許可されていません', true);
    return;
  }

  state.isRecording    = true;
  state.lastTranscript = '';
  state.lastScore      = null;
  state.audioChunks    = [];
  el.recordBtn.classList.add('recording');
  el.recordBtn.textContent = '⏹ 停止';
  el.recStatus.textContent = '🔴 録音中…';
  el.audioArea.classList.add('hidden');
  el.scoreArea.classList.add('hidden');

  // ── iOS: Web Audio API → WAV ─────────────────────────────────────
  if (_isIOS) {
    try {
      const ctx    = new (window.AudioContext || window.webkitAudioContext)();
      await ctx.resume().catch(() => {});
      const source = ctx.createMediaStreamSource(stream);
      const proc   = ctx.createScriptProcessor(4096, 1, 1);
      const sink   = ctx.createGain();
      sink.gain.value = 0;
      const bufs = [];
      proc.onaudioprocess = e => {
        if (state.isRecording) bufs.push(new Float32Array(e.inputBuffer.getChannelData(0)));
      };
      source.connect(proc); proc.connect(sink); sink.connect(ctx.destination);
      state._iosStop = () => {
        try { proc.disconnect(); source.disconnect(); sink.disconnect(); } catch {}
        ctx.close().catch(() => {});
        stream.getTracks().forEach(t => t.stop());
        if (!bufs.length) return;
        const blob = new Blob([_pcmToWAV(bufs, ctx.sampleRate)], { type: 'audio/wav' });
        _finishRecording(blob);
      };
    } catch (e) {
      showToast('録音エラー: ' + e.message, true);
      stream.getTracks().forEach(t => t.stop());
      state.isRecording = false;
      el.recordBtn.classList.remove('recording');
      el.recordBtn.textContent = '🎤 録音';
      el.recStatus.textContent = '';
      return;
    }
    return;
  }

  // ── MediaRecorder（非iOS）──────────────────────────────────────────
  const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
  state.mediaRecorder = new MediaRecorder(stream, { mimeType });
  state.mediaRecorder.ondataavailable = e => { if (e.data.size > 0) state.audioChunks.push(e.data); };
  state.mediaRecorder.onstop = () => { stream.getTracks().forEach(t => t.stop()); finishRecording(); };
  state.mediaRecorder.start(100);
}

function stopRecording() {
  if (!state.isRecording) return;
  state.isRecording = false;
  el.recordBtn.classList.remove('recording');
  el.recordBtn.textContent = '🎤 録音';
  el.recStatus.textContent = '';

  if (state.recognition) { try { state.recognition.stop(); } catch {} state.recognition = null; }

  // iOS path: _iosStop が設定されていれば呼び出し
  if (state._iosStop) {
    const fn = state._iosStop; state._iosStop = null; fn();
    return;
  }

  // MediaRecorder path
  if (state.mediaRecorder?.state !== 'inactive') try { state.mediaRecorder.stop(); } catch {}
}

function finishRecording() {
  const blob = new Blob(state.audioChunks, { type: state.mediaRecorder?.mimeType || 'audio/webm' });
  _finishRecording(blob);
}

// 録音完了後: 表示 → (有効なら) Whisper採点
async function _finishRecording(blob) {
  _showAudio(blob);
  if (SCORING_ENABLED) await scoreWithWhisper(blob);
}

async function scoreWithWhisper(blob) {
  if (!blob || !state.currentText) return;

  // スコアエリアにローディング表示
  el.scoreArea.classList.remove('hidden');
  el.scoreNum.textContent = '…';
  el.scoreMsg.textContent = '採点中...';
  const circ = 2 * Math.PI * 25;
  if (el.ringFill) el.ringFill.style.strokeDashoffset = circ;

  try {
    const base64 = await new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload  = () => resolve(reader.result.split(',')[1]);
      reader.onerror = reject;
      reader.readAsDataURL(blob);
    });
    const mimeType = blob.type || 'audio/webm';
    const resp = await fetch('/api/score', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ audio: base64, mimeType, reference: state.currentText }),
    });
    if (resp.status === 401) {
      el.scoreNum.textContent = '?';
      el.scoreMsg.textContent = 'ログインが必要です';
      return;
    }
    if (resp.status === 403) {
      el.scoreNum.textContent = '?';
      el.scoreMsg.textContent = '採点機能はサブスク会員限定です';
      return;
    }
    if (!resp.ok) {
      const err = await resp.json().catch(() => ({}));
      throw new Error(err.error || `HTTP ${resp.status}`);
    }
    const { score, transcript } = await resp.json();
    showScore(score, transcript);
  } catch (err) {
    console.warn('[scoreWithWhisper]', err.message, 'blob size=', blob.size, 'type=', blob.type);
    el.scoreNum.textContent = '?';
    el.scoreMsg.textContent = '採点失敗: ' + (err.message || '通信エラー') + '（再録音してください）';
  }
}

function calcScore(original, spoken) {
  const normalize = s => s.toLowerCase().replace(/[^a-z0-9 ]/g, '').split(/\s+/).filter(Boolean);
  const origWords   = normalize(original);
  const spokenWords = normalize(spoken);
  if (!origWords.length) return 0;
  let matches = 0;
  const spokenSet = new Map();
  spokenWords.forEach(w => spokenSet.set(w, (spokenSet.get(w) || 0) + 1));
  origWords.forEach(w => { if ((spokenSet.get(w) || 0) > 0) { matches++; spokenSet.set(w, spokenSet.get(w) - 1); } });
  return Math.round((matches / origWords.length) * 100);
}

function showScore(score, transcript) {
  el.scoreArea.classList.remove('hidden');
  el.scoreNum.textContent = score;
  const circ = 2 * Math.PI * 25;
  el.ringFill.style.strokeDashoffset = circ * (1 - score / 100);
  const msgs = score >= 90 ? '🌟 素晴らしい！' : score >= 70 ? '👍 いい感じ！' : score >= 50 ? '💪 もう少し！' : '📚 練習を続けよう';
  el.scoreMsg.textContent = msgs;
  state.lastScore = score;
  state.lastTranscript = transcript;
}

// =====================================================================
//  フレーズ解説
// =====================================================================
el.explainBtn.addEventListener('click', openExplain);
el.regenExplain && el.regenExplain.addEventListener('click', () => {
  state.explainCache = null;
  openExplain();
});

async function openExplain() {
  if (!state.currentText) return;
  el.explainModal.classList.remove('hidden');

  // キャッシュヒット
  if (state.explainCache && state.explainCache.text === state.currentText) {
    if (el.regenExplain) el.regenExplain.classList.remove('hidden');
    renderExplainContent(state.explainCache.translation, state.explainCache.items);
    return;
  }

  // ロード中表示
  el.explainLoading.classList.remove('hidden');
  el.explainTrans.classList.add('hidden');
  el.explainList.innerHTML = '';
  el.explainSource.textContent = state.currentText.slice(0, 80) + (state.currentText.length > 80 ? '…' : '');
  el.explainSource.classList.remove('hidden');
  if (el.regenExplain) el.regenExplain.classList.add('hidden');

  try {
    const res = await fetch('/api/explain', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ text: state.currentText }),
    });
    if (!res.ok) { const d = await res.json(); throw new Error(d.error || 'エラー'); }
    const { translation, items } = await res.json();
    state.explainCache = { text: state.currentText, translation, items };
    renderExplainContent(translation, items);
    if (el.regenExplain) el.regenExplain.classList.remove('hidden');
    // 保存済みテキストなら解説をDBにも永続化（次回はAPI呼出なしで即表示）
    if (state.currentSavedId) {
      fetch(`/api/saved/${state.currentSavedId}`, {
        method: 'PATCH', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ translation, items }),
      }).catch(() => {}); // 失敗してもセッションキャッシュは有効なので握りつぶす
    }
  } catch (err) {
    el.explainLoading.classList.add('hidden');
    el.explainList.innerHTML = `<p style="color:#ef4444">エラー: ${escHtml(err.message)}</p>`;
  }
}

function renderExplainContent(translation, items) {
  el.explainLoading.classList.add('hidden');
  if (translation) {
    el.explainTrans.textContent = translation;
    el.explainTrans.classList.remove('hidden');
  } else {
    el.explainTrans.classList.add('hidden');
  }
  el.explainList.innerHTML = (items || []).map(item => `
    <div class="explain-item">
      <div>
        <span class="explain-phrase">${escHtml(item.phrase)}</span>
        <span class="explain-reading">${escHtml(item.reading || '')}</span>
      </div>
      <div class="explain-meaning">${escHtml(item.meaning || '')}</div>
      ${item.note ? `<div class="explain-note">${escHtml(item.note)}</div>` : ''}
    </div>`).join('');
}

// =====================================================================
//  保存テキスト（サーバー側）
// =====================================================================
el.saveTextBtn.addEventListener('click', saveText);

async function saveText() {
  if (!state.currentText) return;
  try {
    const body = { text: state.currentText, theme: el.themeInput?.value?.trim() || '' };
    if (state.explainCache && state.explainCache.text === state.currentText) {
      body.translation = state.explainCache.translation;
      body.items = state.explainCache.items;
    }
    const res = await fetch('/api/saved', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    });
    if (!res.ok) { const d = await res.json(); throw new Error(d.error); }
    const data = await res.json();
    if (data.id) state.currentSavedId = data.id; // 以後の解説（再）生成をこの保存行に永続化
    el.saveTextBtn.textContent = '✅ 保存済み';
    el.saveTextBtn.disabled = true;
    showToast('✅ テキストを保存しました');
  } catch (err) {
    showToast(err.message, true);
  }
}

async function renderSaved() {
  if (!window.authState?.user || !window.subState?.active) {
    el.savedList.innerHTML = '';
    return;
  }
  try {
    const res = await fetch('/api/saved');
    if (!res.ok) { el.savedList.innerHTML = '<p class="empty-msg">読み込みエラー</p>'; return; }
    const list = await res.json();
    if (!list.length) {
      el.savedList.innerHTML = '<p class="empty-msg">保存済みのテキストはありません</p>';
      return;
    }
    el.savedList.innerHTML = list.map(item => {
      const date = new Date(item.created_at).toLocaleDateString('ja-JP');
      return `
        <div class="saved-item" data-id="${item.id}">
          <div class="saved-item-main" onclick="openReview(${item.id})">
            ${item.theme ? `<div class="saved-item-theme">${escHtml(item.theme)}</div>` : ''}
            <div class="saved-item-text">${escHtml(item.text.slice(0, 60))}…</div>
            <div class="saved-item-meta">${date}</div>
          </div>
          <button class="btn-del" onclick="deleteSavedItem(${item.id}, event)">🗑</button>
        </div>`;
    }).join('');
  } catch {
    el.savedList.innerHTML = '<p class="empty-msg">読み込みに失敗しました</p>';
  }
}

window.deleteSavedItem = async function(id, evt) {
  evt.stopPropagation();
  if (!confirm('このテキストを削除しますか？')) return;
  try {
    await fetch(`/api/saved/${id}`, { method: 'DELETE' });
    renderSaved();
    showToast('削除しました');
  } catch {
    showToast('削除に失敗しました', true);
  }
};

el.clearAllBtn.addEventListener('click', async () => {
  if (!confirm('保存済みテキストをすべて削除しますか？')) return;
  try {
    const res = await fetch('/api/saved');
    const list = await res.json();
    await Promise.all(list.map(item => fetch(`/api/saved/${item.id}`, { method: 'DELETE' })));
    renderSaved();
    showToast('すべて削除しました');
  } catch {
    showToast('削除に失敗しました', true);
  }
});

// ── レビューモーダル ──────────────────────────────────────────────────
window.openReview = async function(id) {
  el.reviewModal.classList.remove('hidden');
  el.reviewExplain.innerHTML = '';
  el.reviewMeta.textContent = '';
  el.reviewText.textContent = '読み込み中…';

  try {
    const res = await fetch(`/api/saved/${id}`);
    if (!res.ok) throw new Error('読み込みに失敗しました');
    const item = await res.json();

    el.reviewMeta.textContent = new Date(item.created_at).toLocaleDateString('ja-JP') +
      (item.theme ? `　テーマ: ${item.theme}` : '');
    el.reviewText.textContent = item.text;

    el.reviewPlayBtn.onclick = async () => {
      el.reviewPlayBtn.disabled = true;
      el.reviewPlayBtn.textContent = '⏳ …';
      try {
        const url = await fetchTTS(item.text, getTTSVoice());
        stopSpeech(); // 進行中の再生を正常停止（保留中のplayAudio Promiseも静かに解決させる）
        const audio = new Audio(url);
        audio.playbackRate = parseFloat(el.speedSlider.value);
        currentAudio = audio;
        audio.addEventListener('ended', () => { currentAudio = null; });
        await audio.play();
      } catch (err) {
        if (err.name !== 'AbortError') showToast('音声エラー: ' + err.message, true);
      } finally {
        el.reviewPlayBtn.disabled = false;
        el.reviewPlayBtn.textContent = '▶ 読み上げ';
      }
    };
    el.reviewPractBtn.onclick = () => {
      setCurrentText(item.text);
      // 保存済み解説をキャッシュに復元（解説ボタンでAPIを呼ばず即表示・再生成は可能）
      state.currentSavedId = item.id;
      if (item.translation || (item.items && item.items.length)) {
        state.explainCache = {
          text: item.text,
          translation: item.translation || '',
          items: item.items || [],
        };
      }
      el.reviewModal.classList.add('hidden');
      switchTab('practice');
    };

    // 保存済み解説があれば表示
    if (item.translation || (item.items && item.items.length)) {
      const html = [];
      if (item.translation) html.push(`<div class="explain-translation">${escHtml(item.translation)}</div>`);
      if (item.items) {
        html.push(...item.items.map(it => `
          <div class="explain-item">
            <div><span class="explain-phrase">${escHtml(it.phrase)}</span>
            <span class="explain-reading">${escHtml(it.reading||'')}</span></div>
            <div class="explain-meaning">${escHtml(it.meaning||'')}</div>
            ${it.note ? `<div class="explain-note">${escHtml(it.note)}</div>` : ''}
          </div>`));
      }
      el.reviewExplain.innerHTML = html.join('');
    }
  } catch (err) {
    el.reviewText.textContent = err.message;
  }
};

// ── モーダルを閉じる ──────────────────────────────────────────────────
el.closeBtns.forEach(btn => {
  btn.addEventListener('click', () => {
    const modalId = btn.dataset.modal;
    if (modalId) document.getElementById(modalId).classList.add('hidden');
    else { el.explainModal.classList.add('hidden'); el.reviewModal.classList.add('hidden'); }
    speechSynthesis.cancel();
  });
});
el.explainModal.addEventListener('click', e => {
  if (e.target === el.explainModal) el.explainModal.classList.add('hidden');
});
el.reviewModal.addEventListener('click', e => {
  if (e.target === el.reviewModal) el.reviewModal.classList.add('hidden');
});

// ── 認証変化フック ────────────────────────────────────────────────────
window.onAuthChangedHooks.push((user) => {
  if (!user) {
    // ログアウト: 現在テキストをリセット
    setCurrentText('');
  }
});

// =====================================================================
//  ユーティリティ
// =====================================================================
function escHtml(s) {
  return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;');
}
function shake(el) {
  el.classList.add('shake');
  el.addEventListener('animationend', () => el.classList.remove('shake'), { once: true });
}
