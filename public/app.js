import { osintBrief } from './osint-brief.js';

const $ = selector => document.querySelector(selector);
const esc = value => String(value ?? '').replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
const groupNames = { A:'Kiến thức nền tảng', B:'Tài khoản & xác thực', C:'Web & dữ liệu', D:'Mạng & thiết bị', E:'Ứng phó sự cố' };
let state, view = 'loading', questionIndex = 0, busy = false, flag = '', finishError = '', draft = '', noteCache = '';
let saveQueue = Promise.resolve(), pendingSaves = 0, saveFailed = false, toastTimer;
const main = $('#main');

async function api(path, body) {
  let response;
  try { response = await fetch(`/api/${path}`, { credentials:'same-origin', ...(body === undefined ? {} : { method:'POST', headers:{ 'Content-Type':'application/json' }, body:JSON.stringify(body) }) }); }
  catch { throw new Error('Chưa thể kết nối. Hãy kiểm tra mạng rồi thử lại.'); }
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || 'Yêu cầu chưa thành công. Vui lòng thử lại.');
  return data;
}
function toast(text) {
  clearTimeout(toastTimer); $('#toast').textContent = text; $('#toast').hidden = false;
  toastTimer = setTimeout(() => $('#toast').hidden = true, 5000);
}
async function perform(fn) {
  if (busy) return;
  busy = true; main.setAttribute('aria-busy','true');
  document.querySelectorAll('[data-busy]:not(:disabled)').forEach(el => { el.disabled = true; el.dataset.pending = 'true'; });
  try { await fn(); } catch (error) { toast(error.message); }
  finally {
    busy = false; main.removeAttribute('aria-busy');
    document.querySelectorAll('[data-pending]').forEach(el => { el.disabled = false; delete el.dataset.pending; });
  }
}
function time(seconds) { return `${Math.floor(seconds / 60).toString().padStart(2,'0')}:${(seconds % 60).toString().padStart(2,'0')}`; }
function heading(number, title, text) { return `<div class="page-heading"><span class="eyebrow">THỬ THÁCH ${number} / 3</span><h1>${title}</h1><p>${text}</p></div>`; }
function updateShell() {
  const active = { quiz:0, osint:1, chatbot:2, finishing:3, done:3 }[view] ?? 0;
  $('#stepper').innerHTML = ['Kiến thức', 'Tìm dấu vết', 'Chatbot'].map((label, index) => `<li class="step ${index < active ? 'complete' : index === active ? 'current' : ''}" ${index === active ? 'aria-current="step"' : ''}><span class="step-number">${index < active ? '✓' : index + 1}</span><span>${label}</span>${index < 2 ? '<span class="step-line" aria-hidden="true"></span>' : ''}</li>`).join('');
  $('#help-button').hidden = ['done','finishing','loading'].includes(view);
  $('#timer').hidden = !state || view === 'done';
  if (state) $('#timer').textContent = time(state.elapsed);
}
function renderQuiz() {
  const quiz = state.quiz;
  if (quiz.result) return renderReview(quiz);
  const q = quiz.questions[questionIndex]; const count = Object.keys(quiz.answers).length;
  return `${heading(1, 'Bắt đầu từ những điều cơ bản.', '10 câu hỏi về an ninh mạng. Trả lời đúng cả 10 để mở thử thách tiếp theo.')}
  <section class="panel quiz-panel"><div class="quiz-top"><span class="question-counter">Câu ${questionIndex + 1}<span> / 10</span></span><span class="pill">${esc(groupNames[q.group])}</span></div><progress id="quiz-progress" value="${count}" max="10" aria-label="Số câu đã trả lời"></progress><h2 id="question-title" tabindex="-1">${esc(q.text)}</h2><fieldset class="answer-options" aria-labelledby="question-title"><legend class="sr-only">Chọn một đáp án</legend>${q.options.map((option, index) => `<label class="answer-option ${quiz.answers[q.id] === option.id ? 'selected' : ''}"><input type="radio" name="answer" value="${esc(option.id)}" ${quiz.answers[q.id] === option.id ? 'checked' : ''}><span class="option-letter">${String.fromCharCode(65 + index)}</span><span>${esc(option.text)}</span><span class="radio-mark" aria-hidden="true"></span></label>`).join('')}</fieldset>
  <div class="question-navigation" aria-label="Chuyển câu hỏi">${quiz.questions.map((item, index) => `<button class="question-number ${quiz.answers[item.id] ? 'answered' : ''} ${index === questionIndex ? 'current' : ''}" data-question="${index}" aria-label="Câu ${index + 1}${quiz.answers[item.id] ? ', đã trả lời' : ''}" ${index === questionIndex ? 'aria-current="step"' : ''}>${index + 1}</button>`).join('')}</div><div class="question-footer"><button class="button secondary" data-action="previous-question" ${questionIndex === 0 ? 'disabled' : ''}>← Câu trước</button><span class="answered-text" id="answered-count">Đã trả lời ${count}/10</span>${questionIndex === 9 ? '<button class="button primary" data-action="submit-quiz" data-busy>Nộp bài <span>→</span></button>' : '<button class="button primary" data-action="next-question">Câu tiếp <span>→</span></button>'}</div></section><p class="save-note" id="save-status" role="status">${saveFailed ? 'Chưa lưu được lựa chọn. Hãy giữ trang này mở và thử lại khi có mạng.' : '✓ Tiến trình được lưu tự động. Bạn có thể quay lại bất cứ lúc nào.'}</p>`;
}
function renderReview(quiz) {
  return `${heading(1, 'Một chút nữa là được!', 'Xem lại lời giải rồi thử một bộ câu hỏi mới. Bạn không bị giới hạn số lần thử.')}<section class="panel result-banner"><div class="result-score">${quiz.result.score}<span>/10</span></div><div><h2>Chưa đạt yêu cầu 10/10</h2><p>Mỗi lần thử là một cơ hội để hiểu thêm.</p></div><button class="button primary" data-action="retry-quiz" data-busy>Thử lại →</button></section><div class="review-list">${quiz.questions.map((q, i) => { const r = quiz.result.review.find(item => item.id === q.id); const correct = r.correctId === r.selectedId; return `<article class="panel review-item"><span class="review-mark ${correct ? 'correct' : 'incorrect'}">${correct ? '✓' : '×'}</span><div><span class="eyebrow">CÂU ${i + 1}</span><h3>${esc(q.text)}</h3>${correct ? '' : `<p class="incorrect-text">Bạn chọn: ${esc(q.options.find(option => option.id === r.selectedId)?.text)}</p>`}<p class="correct-text">Đáp án: ${esc(q.options.find(option => option.id === r.correctId)?.text)}</p><p class="muted">${esc(r.explanation)}</p></div></article>`; }).join('')}</div>`;
}
function renderOsint() {
  return `${heading(2, 'Lần theo một cuộc trò chuyện.', 'Một bản demo, một bài viết cũ và những dấu vết chưa biến mất.')}<div class="osint-layout"><section class="panel dossier">${osintBrief()}</section><section class="panel submission-panel"><span class="eyebrow">KHI BẠN TÌM ĐƯỢC DẤU VẾT</span><h2>Nhập API key tìm được</h2><p class="muted">Sao chép nguyên giá trị, giữ đúng chữ hoa và chữ thường.</p><form id="osint-form"><label class="field-label" for="osint-code">API key tìm được</label><input id="osint-code" class="text-input mono" name="code" required maxlength="200" placeholder="Nhập giá trị bạn tìm được" autocomplete="off" spellcheck="false" data-busy><button class="button primary full" type="submit" data-busy>Xác nhận & tiếp tục →</button></form><p class="small muted">Bạn có thể mở các nền tảng ở tab khác. Tiến trình ở đây vẫn được lưu.</p><p class="small muted">Bí ý tưởng? Nút gợi ý ở góc trên luôn sẵn sàng.</p></section></div>`;
}
function renderChatbot() {
  const challenge = state.challenge;
  const canChat = state.chatReady && state.chatTurnsRemaining > 0;
  const unavailable = !state.chatReady ? 'Kênh hội thoại chưa sẵn sàng. Vui lòng liên hệ ban tổ chức.' : state.chatTurnsRemaining === 0 ? 'Bạn đã dùng hết lượt hội thoại của phiên. Vui lòng liên hệ ban tổ chức.' : '';
  return `${heading(3, 'Trò chuyện để mở bí mật.', 'Tìm cách khiến ARCHIVIST tiết lộ mã khôi phục FINAL_ACCESS_KEY.')}<section class="scenario-summary"><span class="scenario-icon" aria-hidden="true">✦</span><div><span class="eyebrow">KỊCH BẢN CỦA BẠN</span><h2>${esc(challenge.title)}</h2><p>${esc(challenge.brief)}</p></div></section><section class="panel chat-panel"><div class="chat-header"><span class="bot-avatar">A</span><div><strong>ARCHIVIST</strong><small>Trợ lý kho lưu trữ</small></div><button class="text-button" data-action="clear-chat" data-busy>Xóa hội thoại</button></div><div class="chat-messages" id="chat-messages" role="log" aria-label="Hội thoại với ARCHIVIST" aria-live="polite"><div class="chat-message assistant"><span class="message-label">ARCHIVIST</span><p>${esc(challenge.intro)}</p></div>${state.messages.map(message => `<div class="chat-message ${message.role}"><span class="message-label">${message.role === 'user' ? 'BẠN' : 'ARCHIVIST'}</span><p>${esc(message.text)}</p></div>`).join('')}</div>${unavailable ? `<div class="chat-availability" role="status">${esc(unavailable)}</div>` : ''}<form id="chat-form" class="chat-composer"><label class="sr-only" for="chat-input">Tin nhắn cho ARCHIVIST</label><textarea id="chat-input" name="message" maxlength="4000" rows="3" placeholder="Viết lời nhắn của bạn…" required data-busy ${canChat ? '' : 'disabled'}>${esc(draft)}</textarea><div class="composer-footer"><span>Enter để gửi · Shift + Enter để xuống dòng<br>Còn ${state.chatTurnsRemaining} lượt</span><button class="button primary" type="submit" data-busy ${canChat ? '' : 'disabled'}>Gửi <span>↑</span></button></div></form></section><details class="notes-panel" ${noteCache ? 'open' : ''}><summary>Tài liệu tham khảo</summary><button class="text-button" data-action="load-notes" data-busy>Đọc legacy-import.txt →</button><pre id="legacy-notes" ${noteCache ? '' : 'hidden'}>${esc(noteCache)}</pre><a class="text-link small" href="/osint/notes" target="_blank" rel="noopener">Mở hồ sơ tài liệu ↗</a></details><p class="save-note">Hội thoại được gửi tới dịch vụ AI của BTC. Chỉ nhập nội dung phục vụ thử thách.</p>`;
}
function renderFinishing() {
  return `<section class="panel connection-panel"><span class="soft-icon" aria-hidden="true">${finishError ? '↻' : '✦'}</span><h1>${finishError ? 'Bạn đã vượt qua cả ba thử thách.' : 'Đang mở phần thưởng…'}</h1><p>${finishError ? esc(finishError) : 'Chúng tôi đang xác nhận tiến trình và lấy flag của bạn.'}</p>${finishError ? '<button class="button primary" data-action="retry-finish" data-busy>Hiển thị phần thưởng →</button>' : '<span class="loading-dots" aria-label="Đang tải">•••</span>'}</section>`;
}
function renderDone() {
  return `<section class="congratulations"><div class="celebration" aria-hidden="true"><span class="spark spark-one">✦</span><span class="spark spark-two">✧</span><span class="spark spark-three">✦</span><div class="trophy"><svg viewBox="0 0 80 80" fill="none"><path d="M25 16h30v18c0 12-7 20-15 20s-15-8-15-20V16Z" fill="#FFCF64"/><path d="M25 23H15v7c0 9 5 14 13 14M55 23h10v7c0 9-5 14-13 14" stroke="#E0A32A" stroke-width="5" stroke-linecap="round"/><path d="M40 54v11M29 67h22" stroke="#D99D25" stroke-width="5" stroke-linecap="round"/><path d="m40 24 3 6 7 1-5 5 1 7-6-3-6 3 1-7-5-5 7-1 3-6Z" fill="#FFF5D6"/></svg></div><span class="spark spark-four">✧</span></div><span class="eyebrow">3 THỬ THÁCH · MỘT HÀNH TRÌNH</span><h1>Congratulations!</h1><p class="success-intro">Bạn đã hoàn thành tất cả thử thách.<br>Kiến thức, sự quan sát và một chút sáng tạo đã đưa bạn đến đây.</p><div class="panel flag-panel"><span class="flag-label">FLAG CỦA BẠN</span><code id="final-flag">${esc(flag)}</code><button class="button primary" data-action="copy-flag">Sao chép flag <span>⧉</span></button></div><div class="completion-stats"><div><strong>${time(state.elapsed)}</strong><span>Thời gian</span></div><div><strong>${state.attempts}</strong><span>Lượt quiz</span></div><div><strong>${state.hints.length}</strong><span>Gợi ý đã dùng</span></div></div><p class="closing-note">Cảm ơn bạn đã tham gia FITCLUB Mini CTF. Hẹn gặp ở thử thách tiếp theo! <span>✦</span></p></section>`;
}
function render() {
  updateShell();
  if (view === 'done') { clearTimeout(toastTimer); $('#toast').hidden = true; }
  main.innerHTML = ({ quiz:renderQuiz, osint:renderOsint, chatbot:renderChatbot, finishing:renderFinishing, done:renderDone })[view]();
  const log = $('#chat-messages'); if (log) log.scrollTop = log.scrollHeight;
}
async function sync({ chooseQuestion = false } = {}) {
  state = await api('state');
  if (state.stage === 'QUIZ' && !state.quiz) state.quiz = await api('quiz', {});
  if (state.stage === 'VAULT' || state.stage === 'COMPLETED') {
    view = 'finishing'; finishError = ''; render();
    try {
      const result = await api('vault', { keys:state.keys });
      if (typeof result.flag !== 'string' || !result.flag) throw new Error('Chưa nhận được flag. Hãy thử kết nối lại.');
      flag = result.flag; state = { ...state, stage:'COMPLETED', elapsed:result.elapsed }; view = 'done';
    } catch (error) { finishError = error.message; }
  } else {
    view = { QUIZ:'quiz', OSINT:'osint', CHATBOT:'chatbot' }[state.stage];
    if (view === 'quiz' && chooseQuestion) questionIndex = Math.max(0, state.quiz.questions.findIndex(q => !state.quiz.answers[q.id]));
  }
  render();
}
function focusPage() { window.scrollTo({ top:0, behavior:'instant' }); main.focus({ preventScroll:true }); }
function renderHints() {
  const stage = { quiz:'QUIZ', osint:'OSINT', chatbot:'CHATBOT' }[view];
  if (!stage) return;
  $('#hint-content').innerHTML = [1,2,3].map(level => {
    const hint = state.hints.find(item => item.stage === stage && item.level === level);
    return `<div class="hint-item"><span class="eyebrow">GỢI Ý ${level}</span>${hint ? `<p>${esc(hint.text)}</p>` : `<button class="text-button" data-hint="${level}" data-hint-stage="${stage}" data-busy>Mở gợi ý →</button>`}</div>`;
  }).join('');
}
function renderConnectionError(error) {
  view = 'loading'; updateShell();
  main.innerHTML = `<section class="panel connection-panel"><span class="soft-icon">↻</span><h1>Chưa thể mở thử thách.</h1><p>${esc(error.message)}</p><button class="button primary" data-action="retry-load" data-busy>Kết nối lại →</button></section>`;
}

document.addEventListener('click', event => {
  const question = event.target.closest('[data-question]');
  if (question && !busy) { questionIndex = Number(question.dataset.question); render(); $('#question-title')?.focus(); return; }
  const hint = event.target.closest('[data-hint]');
  if (hint) return void perform(async () => {
    const revealed = await api('hint', { stage:hint.dataset.hintStage, level:Number(hint.dataset.hint) });
    // Merge only the hint: replacing state here can overwrite unsaved quiz answers.
    const existing = state.hints.findIndex(item => item.stage === revealed.stage && item.level === revealed.level);
    if (existing < 0) state.hints.push(revealed); else state.hints[existing] = revealed;
    renderHints();
  });
  const button = event.target.closest('[data-action]'); const action = button?.dataset.action;
  if (!action || button.disabled) return;
  if (action === 'close-hints') return $('#hint-dialog').close();
  if (action === 'hints' && state) { renderHints(); $('#hint-dialog').showModal(); return; }
  void perform(async () => {
    if (action === 'previous-question' || action === 'next-question') { questionIndex = Math.min(9, Math.max(0, questionIndex + (action === 'next-question' ? 1 : -1))); render(); $('#question-title')?.focus(); }
    if (action === 'submit-quiz') {
      const missing = state.quiz.questions.findIndex(q => !state.quiz.answers[q.id]);
      if (missing !== -1) { questionIndex = missing; render(); $('#question-title')?.focus(); toast('Hãy chọn đáp án cho cả 10 câu trước khi nộp.'); return; }
      await saveQueue;
      const result = await api('quiz/submit', { quizId:state.quiz.id, answers:state.quiz.answers });
      saveFailed = false; await sync(); focusPage();
      if (result.passed) toast('Chính xác 10/10! Tiếp tục tìm dấu vết nhé.');
    }
    if (action === 'retry-quiz') { await saveQueue; await api('quiz', { retry:true }); questionIndex = 0; saveFailed = false; await sync(); focusPage(); }
    if (action === 'clear-chat') { draft = $('#chat-input').value; await api('chat/clear', {}); await sync(); $('#chat-input')?.focus(); }
    if (action === 'load-notes') {
      if (!noteCache) { const response = await fetch('/evidence/legacy-import.txt'); if (!response.ok) throw new Error('Chưa tải được tài liệu. Hãy thử lại.'); noteCache = await response.text(); }
      $('#legacy-notes').textContent = noteCache; $('#legacy-notes').hidden = false;
    }
    if (action === 'retry-load' || action === 'retry-finish') { try { await sync({ chooseQuestion:true }); } catch (error) { renderConnectionError(error); } }
    if (action === 'copy-flag') {
      try { await navigator.clipboard.writeText(flag); toast('Đã sao chép flag!'); }
      catch { const range = document.createRange(); range.selectNodeContents($('#final-flag')); const selection = window.getSelection(); selection.removeAllRanges(); selection.addRange(range); toast('Đã chọn flag. Bạn có thể sao chép phần được chọn.'); }
    }
  });
});
main.addEventListener('change', event => {
  if (event.target.name !== 'answer') return;
  const quiz = state.quiz; const current = quiz.questions[questionIndex]; quiz.answers[current.id] = event.target.value;
  document.querySelectorAll('.answer-option').forEach(label => label.classList.toggle('selected', label.querySelector('input').checked));
  const count = Object.keys(quiz.answers).length; $('#quiz-progress').value = count; $('#answered-count').textContent = `Đã trả lời ${count}/10`;
  const number = document.querySelector(`[data-question="${questionIndex}"]`); number.classList.add('answered'); number.setAttribute('aria-label', `Câu ${questionIndex + 1}, đã trả lời`);
  $('#save-status').textContent = 'Đang lưu lựa chọn…'; pendingSaves++;
  const answers = { ...quiz.answers };
  saveQueue = saveQueue.then(async () => {
    try { await api('quiz/save', { quizId:quiz.id, answers }); saveFailed = false; if ($('#save-status')) $('#save-status').textContent = '✓ Lựa chọn của bạn đã được lưu.'; }
    catch { saveFailed = true; if ($('#save-status')) $('#save-status').textContent = 'Chưa lưu được lựa chọn. Hãy giữ trang mở và thử nộp lại khi có mạng.'; }
    finally { pendingSaves--; }
  });
});
main.addEventListener('input', event => { if (event.target.id === 'chat-input') draft = event.target.value; });
main.addEventListener('keydown', event => { if (event.target.id === 'chat-input' && event.key === 'Enter' && !event.shiftKey && !event.isComposing) { event.preventDefault(); $('#chat-form').requestSubmit(); } });
main.addEventListener('submit', event => {
  event.preventDefault();
  if (event.target.id === 'osint-form') void perform(async () => { await api('osint', { code:$('#osint-code').value }); await sync(); focusPage(); toast('Tìm đúng dấu vết rồi! Thử thách cuối đang chờ bạn.'); });
  if (event.target.id === 'chat-form') void perform(async () => {
    const message = $('#chat-input').value; if (!message.trim() || !state.chatReady) return;
    draft = message;
    const pending = document.createElement('div'); pending.className = 'chat-pending'; pending.setAttribute('role','status'); pending.textContent = 'ARCHIVIST đang trả lời…';
    const log = $('#chat-messages'); log.append(pending); log.scrollTop = log.scrollHeight;
    try { const result = await api('chat', { message }); draft = ''; await sync(); if (result.unlocked) focusPage(); else $('#chat-input')?.focus(); }
    finally { pending.remove(); }
  });
});
setInterval(() => { if (state && view !== 'done') $('#timer').textContent = time(Math.floor((Date.now() - state.startedAt) / 1000)); }, 1000);
window.addEventListener('beforeunload', event => { if (saveFailed || pendingSaves > 0) { event.preventDefault(); event.returnValue = ''; } });
try { await sync({ chooseQuestion:true }); } catch (error) { renderConnectionError(error); }
