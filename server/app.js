import { createServer } from 'node:http';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { Game, fail } from './game.js';
import { legacyNotes } from './evidence.js';

const staticFiles = {
  '/': ['index.html', 'text/html'],
  '/app.js': ['app.js', 'text/javascript'],
  '/styles.css': ['styles.css', 'text/css'],
  '/osint.js': ['osint.js', 'text/javascript'],
  '/osint-brief.js': ['osint-brief.js', 'text/javascript'],
  '/favicon.svg': ['favicon.svg', 'image/svg+xml'],
  '/hisc-logo.png': ['hisc-logo.png', 'image/png']
};
for (const route of ['/osint', '/osint/notes']) staticFiles[route] = ['osint.html', 'text/html'];

export function createApp(options = {}) {
  const game = new Game(options);
  const limits = new Map();
  function json(res, status, value) { res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8' }); res.end(JSON.stringify(value)); }
  function rate(id, route, res) {
    const now = Date.now(); const key = `${id}:${route}`; let item = limits.get(key);
    if (!item || now - item.start >= 60000) item = { start: now, count: 0 };
    limits.set(key, item); item.count++;
    if (limits.size > 1000) for (const [k, v] of limits) if (now - v.start >= 60000) limits.delete(k);
    if (item.count > 10) { res.setHeader('Retry-After', Math.ceil((60000 - (now - item.start)) / 1000)); fail('Bạn thao tác quá nhanh. Vui lòng chờ một phút rồi thử lại.', 429); }
  }
  async function body(req) {
    if (!req.headers['content-type']?.startsWith('application/json')) fail('Yêu cầu cần dữ liệu JSON.', 415);
    const chunks = []; let size = 0;
    for await (const chunk of req) { size += chunk.length; if (size > 24000) fail('Dữ liệu gửi lên quá lớn.', 413); chunks.push(chunk); }
    // Decode once: a network packet may end in the middle of a Vietnamese character.
    let data; try { data = JSON.parse(Buffer.concat(chunks).toString('utf8')); } catch { fail('Dữ liệu JSON không hợp lệ.'); }
    if (!data || typeof data !== 'object' || Array.isArray(data)) fail('Dữ liệu gửi lên phải là một đối tượng.');
    return data;
  }
  const server = createServer(async (req, res) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Security-Policy', "default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self' data:; connect-src 'self'; frame-ancestors 'none'; base-uri 'none'; form-action 'self'");
    try {
      const url = new URL(req.url, 'http://localhost'); const path = url.pathname;
      if (path.startsWith('/api/')) {
        if (!['GET', 'POST'].includes(req.method)) fail('Phương thức không được hỗ trợ.', 405);
        if (req.method === 'POST') {
          const expected = process.env.PUBLIC_ORIGIN || `${req.socket.encrypted ? 'https' : 'http'}://${req.headers.host}`;
          if (req.headers['sec-fetch-site'] === 'cross-site' || (req.headers.origin && req.headers.origin !== expected)) fail('Nguồn yêu cầu không hợp lệ.', 403);
        }
        let sid = req.headers.cookie?.split(';').map(c => c.trim()).find(c => c.startsWith('fitclub_session='))?.slice('fitclub_session='.length);
        if (!game.hasSession(sid)) {
          sid = game.createSession();
          res.setHeader('Set-Cookie', `fitclub_session=${sid}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${process.env.COOKIE_SECURE === 'true' ? '; Secure' : ''}`);
        }
        if (req.method === 'GET' && path === '/api/state') return json(res, 200, game.state(sid));
        if (req.method !== 'POST') fail('Không tìm thấy API.', 404);
        const data = await body(req);
        if (path === '/api/osint' || path === '/api/chat') rate(sid, path, res);
        let result;
        switch (path) {
          case '/api/quiz': result = game.quiz(sid, data.retry === true); break;
          case '/api/quiz/save': result = game.saveAnswers(sid, data.quizId, data.answers); break;
          case '/api/quiz/submit': result = game.submitQuiz(sid, data.quizId, data.answers); break;
          case '/api/osint': result = game.osint(sid, data.code); break;
          case '/api/chat': result = await game.chat(sid, data.message); break;
          case '/api/chat/clear': result = game.clearChat(sid); break;
          case '/api/hint': result = game.hint(sid, data.stage, data.level); break;
          case '/api/vault': result = game.unlock(sid, data.keys); break;
          default: fail('Không tìm thấy API.', 404);
        }
        return json(res, 200, result);
      }
      if (req.method !== 'GET' && req.method !== 'HEAD') fail('Phương thức không được hỗ trợ.', 405);
      const evidence = {
        '/evidence/legacy-import.txt': legacyNotes
      };
      if (evidence[path]) {
        res.writeHead(200, { 'Content-Type': 'text/plain; charset=utf-8', ...(url.searchParams.has('download') ? { 'Content-Disposition': `attachment; filename="${path.split('/').pop()}"` } : {}) });
        return res.end(req.method === 'HEAD' ? undefined : evidence[path]);
      }
      const file = staticFiles[path];
      if (!file) { res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' }); return res.end('404 — Không tìm thấy tài liệu.'); }
      const content = await readFile(fileURLToPath(new URL(`../public/${file[0]}`, import.meta.url)));
      res.writeHead(200, { 'Content-Type': `${file[1]}; charset=utf-8` }); res.end(req.method === 'HEAD' ? undefined : content);
    } catch (error) {
      if (res.headersSent) return res.end();
      if (!error.status) console.error(error);
      json(res, error.status || 500, { error: error.status ? error.message : 'Hệ thống gặp lỗi. Vui lòng thử lại.' });
    }
  });
  return { server, game };
}
