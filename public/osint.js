import { osintBrief } from './osint-brief.js';

const main = document.querySelector('#evidence-main');
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
async function load() {
  if (location.pathname === '/osint/notes') {
    const response = await fetch('/evidence/legacy-import.txt');
    if (!response.ok) throw new Error('Chưa thể mở tài liệu.');
    main.innerHTML = `<span class="eyebrow">TÀI LIỆU THAM KHẢO</span><h1>Ghi chú ARCHIVIST</h1><p>Tài liệu dành cho thử thách chatbot.</p><pre>${esc(await response.text())}</pre><a href="/">← Trở lại thử thách</a>`;
    return;
  }
  main.innerHTML = `<h1>Lần theo một cuộc trò chuyện.</h1><section class="panel dossier">${osintBrief()}</section><p><a href="/">← Trở lại thử thách</a></p>`;
}
load().catch(error => { main.textContent = error.message; });
