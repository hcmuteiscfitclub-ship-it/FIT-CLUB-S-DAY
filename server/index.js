import { createApp } from './app.js';

const port = Number(process.env.PORT || 3000);
const host = process.env.HOST || '127.0.0.1';
const app = createApp({ dbPath: process.env.DB_PATH || 'data/fitclub.sqlite' });
app.server.listen(port, host, () => console.log(`FITCLUB CTF → http://${host === '0.0.0.0' ? 'localhost' : host}:${app.server.address().port}`));
app.server.on('error', error => { console.error(error.message); app.game.close(); process.exitCode = 1; });
let stopping = false;
function shutdown() { if (stopping) return; stopping = true; app.server.close(() => { app.game.close(); }); }
process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
