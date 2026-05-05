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
  // Dialogue
  dialogueMode:       false,
  dialogueSilentRole: 'B',
  dialogueFullPlay:   true,
  dialogueSegs:       [],
  dialogueStopped:    false,
  dialogueTimer:      null,
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

// ── Voices ────────────────────────────────────────────────────────────
let voices = [];
function loadVoices() {
  voices = speechSynthesis.getVoices();
  const eng = voices.filter(v => v.lang.startsWith('en'));
  el.voiceSelect.innerHTML = '';
  if (!eng.length) { el.voiceSelect.innerHTML = '<option value="">デフォルト</option>'; return; }
  eng.forEach((v, i) => {
    const o = document.createElement('option');
    o.value = i; o.textContent = `${v.name} (${v.lang})`;
    el.voiceSelect.appendChild(o);
  });
  const samIdx  = eng.findIndex(v => v.name === 'Samantha');
  const enUSIdx = eng.findIndex(v => v.lang === 'en-US');
  el.voiceSelect.value = samIdx >= 0 ? samIdx : enUSIdx >= 0 ? enUSIdx : 0;
}
speechSynthesis.addEventListener('voiceschanged', loadVoices);
loadVoices();
function getVoice() {
  const eng = voices.filter(v => v.lang.startsWith('en'));
  return eng[parseInt(el.voiceSelect.value)] || null;
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
  for (const raw of lines) {
    const mA = raw.match(/^A:\s*([\s\S]*)/);
    const mB = raw.match(/^B:\s*([\s\S]*)/);
    if      (mA) segs.push({ role: 'A', text: mA[1], textOffset: offset + raw.indexOf(mA[1]) });
    else if (mB) segs.push({ role: 'B', text: mB[1], textOffset: offset + raw.indexOf(mB[1]) });
    else if (raw.trim()) segs.push({ role: 'N', text: raw, textOffset: offset });
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
  const opposite = state.dialogueSilentRole === 'A' ? 'B' : 'A';
  el.roleHint.textContent = `あなたは ${opposite} のパートを練習します（${state.dialogueSilentRole} は無音）`;
}

// =====================================================================
//  音声合成（TTS）
// =====================================================================
el.playBtn.addEventListener('click', () => {
  if (state.isPlaying) {
    if (speechSynthesis.paused) resumeSpeech();
    else pauseSpeech();
  } else {
    startSpeech();
  }
});
el.stopBtn.addEventListener('click', stopSpeech);
el.repeatBtn.addEventListener('click', () => {
  state.isRepeating = !state.isRepeating;
  el.repeatBtn.classList.toggle('active', state.isRepeating);
});

function startSpeech() {
  if (!state.currentText) return;
  stopSpeech();
  state.isPlaying = true;
  state.dialogueStopped = false;
  el.playBtn.textContent = '⏸ 一時停止';

  if (state.dialogueMode) {
    startDialogueSpeech();
    return;
  }

  const utt = new SpeechSynthesisUtterance(state.currentText);
  utt.rate = parseFloat(el.speedSlider.value);
  utt.lang = 'en-US';
  const voice = getVoice();
  if (voice) utt.voice = voice;
  state.utterance = utt;

  utt.addEventListener('boundary', evt => {
    if (evt.name !== 'word') return;
    state.words.forEach(w => w.classList.remove('hl-word'));
    const idx = evt.charIndex;
    const hit = state.words.find(w =>
      parseInt(w.dataset.start) <= idx && idx < parseInt(w.dataset.end));
    if (hit) hit.classList.add('hl-word');
  });
  utt.addEventListener('end', () => {
    state.words.forEach(w => w.classList.remove('hl-word'));
    state.isPlaying = false;
    el.playBtn.textContent = '▶ 再生';
    if (state.isRepeating) setTimeout(startSpeech, 600);
  });

  try {
    if (speechSynthesis.paused) speechSynthesis.resume();
    speechSynthesis.speak(utt);
  } catch(e) {
    console.warn('[TTS] speak failed:', e);
    state.isPlaying = false;
    el.playBtn.textContent = '▶ 再生';
  }
}

function startDialogueSpeech() {
  const segs = state.dialogueSegs;
  const rate  = parseFloat(el.speedSlider.value);
  const voice = getVoice();

  if (state.dialogueFullPlay) {
    // ── 全体読み上げ: iOS 対応のため同期的にキューイング ──────────
    const playSegs = segs.filter(s => s.text.trim());
    if (!playSegs.length) { state.isPlaying = false; el.playBtn.textContent = '▶ 再生'; return; }

    if (speechSynthesis.paused) speechSynthesis.resume();

    playSegs.forEach((seg, qi) => {
      const origIdx = segs.indexOf(seg);
      const utt = new SpeechSynthesisUtterance(seg.text);
      utt.rate = rate; utt.lang = 'en-US';
      if (voice) utt.voice = voice;

      utt.addEventListener('start', () => {
        // ライン強調
        document.querySelectorAll('.dl-line').forEach(l => l.classList.remove('hl-line'));
        const line = document.querySelector(`.dl-line[data-idx="${origIdx}"]`);
        if (line) line.classList.add('hl-line');
      });
      utt.addEventListener('boundary', evt => {
        if (evt.name !== 'word') return;
        state.words.forEach(w => w.classList.remove('hl-word'));
        const absIdx = seg.textOffset + evt.charIndex;
        const hit = state.words.find(w =>
          parseInt(w.dataset.start) <= absIdx && absIdx < parseInt(w.dataset.end));
        if (hit) hit.classList.add('hl-word');
      });
      utt.addEventListener('end', () => {
        document.querySelectorAll('.dl-line').forEach(l => l.classList.remove('hl-line'));
        state.words.forEach(w => w.classList.remove('hl-word'));
      });

      if (qi === playSegs.length - 1) {
        utt.addEventListener('end', () => {
          if (!state.dialogueStopped) {
            state.isPlaying = false;
            el.playBtn.textContent = '▶ 再生';
            if (state.isRepeating) setTimeout(startDialogueSpeech, 800);
          }
        });
      }
      speechSynthesis.speak(utt);
    });
    return;
  }

  // ── 役割練習: 担当行のみ読み上げ、無音行にポーズ ──────────────
  (async () => {
    for (let i = 0; i < segs.length; i++) {
      if (state.dialogueStopped) break;
      const seg = segs[i];
      if (!seg.text.trim()) continue;

      document.querySelectorAll('.dl-line').forEach(l => l.classList.remove('hl-line'));
      const line = document.querySelector(`.dl-line[data-idx="${i}"]`);
      if (line) line.classList.add('hl-line');

      if (seg.role === state.dialogueSilentRole) {
        // 無音: テキスト長に応じたポーズ
        const silenceSec = Math.max(1, seg.text.length * 0.06 / rate);
        await new Promise(r => {
          const t = setTimeout(r, silenceSec * 1000);
          state.dialogueTimer = t;
        });
      } else {
        const utt = new SpeechSynthesisUtterance(seg.text);
        utt.rate = rate; utt.lang = 'en-US';
        if (voice) utt.voice = voice;

        utt.addEventListener('boundary', evt => {
          if (evt.name !== 'word') return;
          state.words.forEach(w => w.classList.remove('hl-word'));
          const absIdx = seg.textOffset + evt.charIndex;
          const hit = state.words.find(w =>
            parseInt(w.dataset.start) <= absIdx && absIdx < parseInt(w.dataset.end));
          if (hit) hit.classList.add('hl-word');
        });

        await new Promise(resolve => {
          utt.addEventListener('end', resolve, { once: true });
          utt.addEventListener('error', resolve, { once: true });
          speechSynthesis.speak(utt);
        });
        state.words.forEach(w => w.classList.remove('hl-word'));
      }
    }

    document.querySelectorAll('.dl-line').forEach(l => l.classList.remove('hl-line'));
    if (!state.dialogueStopped) {
      state.isPlaying = false;
      el.playBtn.textContent = '▶ 再生';
      if (state.isRepeating) setTimeout(startDialogueSpeech, 800);
    }
  })();
}

function pauseSpeech() {
  speechSynthesis.pause();
  state.isPlaying = false;
  state.isPaused  = true;
  el.playBtn.textContent = '▶ 再生';
}

function resumeSpeech() {
  speechSynthesis.resume();
  state.isPlaying = true;
  state.isPaused  = false;
  el.playBtn.textContent = '⏸ 一時停止';
}

function stopSpeech() {
  state.dialogueStopped = true;
  if (state.dialogueTimer) { clearTimeout(state.dialogueTimer); state.dialogueTimer = null; }
  speechSynthesis.cancel();
  state.isPlaying = false;
  state.isPaused  = false;
  el.playBtn.textContent = '▶ 再生';
  state.words.forEach(w => { w.classList.remove('hl-word'); w.classList.remove('hl-line'); });
  document.querySelectorAll('.dl-line').forEach(l => l.classList.remove('hl-line'));
}

// =====================================================================
//  録音・採点
// =====================================================================
el.recordBtn.addEventListener('click', toggleRecord);

function toggleRecord() {
  if (state.isRecording) stopRecording();
  else startRecording();
}

async function startRecording() {
  let stream;
  try { stream = await navigator.mediaDevices.getUserMedia({ audio: true }); }
  catch {
    showToast('マイクの使用が許可されていません', true);
    return;
  }

  state.isRecording = true;
  state.audioChunks = [];
  el.recordBtn.classList.add('recording');
  el.recordBtn.textContent = '⏹ 停止';
  el.recStatus.textContent = '🔴 録音中…';
  el.audioArea.classList.add('hidden');
  el.scoreArea.classList.add('hidden');

  const mimeType = MediaRecorder.isTypeSupported('audio/webm') ? 'audio/webm' : 'audio/mp4';
  state.mediaRecorder = new MediaRecorder(stream, { mimeType });
  state.mediaRecorder.ondataavailable = e => { if (e.data.size > 0) state.audioChunks.push(e.data); };
  state.mediaRecorder.onstop = () => { stream.getTracks().forEach(t => t.stop()); finishRecording(); };
  state.mediaRecorder.start(100);
}

function stopRecording() {
  if (state.mediaRecorder && state.isRecording) {
    state.mediaRecorder.stop();
    state.isRecording = false;
    el.recordBtn.classList.remove('recording');
    el.recordBtn.textContent = '🎤 録音';
    el.recStatus.textContent = '';
  }
}

function finishRecording() {
  const blob = new Blob(state.audioChunks, { type: state.mediaRecorder.mimeType });
  const url  = URL.createObjectURL(blob);
  el.recordedAudio.src = url;
  el.audioArea.classList.remove('hidden');

  // 簡易採点（SpeechRecognition）
  if ('webkitSpeechRecognition' in window || 'SpeechRecognition' in window) {
    scoreWithSpeechRecognition(blob);
  }
}

function scoreWithSpeechRecognition(blob) {
  const SR = window.webkitSpeechRecognition || window.SpeechRecognition;
  const rec = new SR();
  rec.lang = 'en-US';
  rec.continuous = false;
  rec.interimResults = false;

  const url = URL.createObjectURL(blob);
  const audio = new Audio(url);
  rec.start();
  audio.play().catch(() => {});

  rec.onresult = evt => {
    const transcript = evt.results[0][0].transcript.toLowerCase();
    const score = calcScore(state.currentText, transcript);
    showScore(score, transcript);
  };
  rec.onerror = () => {};
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

    el.reviewPlayBtn.onclick = () => {
      const utt = new SpeechSynthesisUtterance(item.text);
      utt.rate = parseFloat(el.speedSlider.value); utt.lang = 'en-US';
      const v = getVoice(); if (v) utt.voice = v;
      speechSynthesis.cancel();
      speechSynthesis.speak(utt);
    };
    el.reviewPractBtn.onclick = () => {
      setCurrentText(item.text);
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
