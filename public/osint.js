const main = document.querySelector('#evidence-main');
const esc = value => String(value).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' })[c]);
async function load() {
  if (location.pathname === '/osint/notes') {
    const response = await fetch('/evidence/legacy-import.txt');
    if (!response.ok) throw new Error('Chưa thể mở tài liệu.');
    main.innerHTML = `<span class="eyebrow">TÀI LIỆU THAM KHẢO</span><h1>Ghi chú ARCHIVIST</h1><p>Tài liệu dành cho thử thách chatbot.</p><pre>${esc(await response.text())}</pre><a href="/">← Trở lại thử thách</a>`;
    return;
  }
  const response = await fetch('/api/state');
  if (!response.ok) throw new Error('Chưa thể mở repository.');
  const { repositoryUrl } = await response.json();
  main.innerHTML = `<span class="eyebrow">FITCLUB / PROJECT</span><h1>Dấu vết trong lịch sử.</h1><p>Cấu hình cục bộ đã được dọn khỏi project hiện tại. Hãy xem các commit công khai để tìm lại API key từng được lưu.</p>${repositoryUrl ? `<a class="button primary" href="${esc(repositoryUrl)}" target="_blank" rel="noopener noreferrer">Mở repository GitHub ↗</a>` : '<p>Repository chưa được cấu hình. Vui lòng liên hệ ban tổ chức.</p>'}<p><a href="/">← Trở lại thử thách</a></p>`;
}
load().catch(error => { main.textContent = error.message; });
