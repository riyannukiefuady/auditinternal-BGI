/**
 * Dashboard Audit Internal – PT. Borneo Group Indonesia
 * Backend Node.js (pengganti Kode.gs): basis data berkas JSON, unggah bukti ke folder uploads,
 * pengingat WhatsApp harian (Fonnte), dan ekspor Excel bulanan (opsional dikirim lewat surel).
 */
require('dotenv').config();
const express = require('express'), fs = require('fs'), path = require('path'), cron = require('node-cron'), XLSX = require('xlsx');

const PORT = +process.env.PORT || 3000, HOST = process.env.HOST || '0.0.0.0';
// Pada hosting, arahkan DATA_DIR ke persistent disk (contoh Render: /var/data).
const DATA_ROOT = process.env.DATA_DIR || __dirname;
const DATA = path.join(DATA_ROOT, 'data'), UP = path.join(DATA_ROOT, 'uploads'), EXP = path.join(DATA_ROOT, 'exports'), DB = path.join(DATA, 'db.json');
[DATA, UP, EXP].forEach(d => fs.mkdirSync(d, { recursive: true }));

const load = () => { try { return JSON.parse(fs.readFileSync(DB, 'utf8')); } catch { return null; } };
const save = o => { const t = DB + '.tmp'; fs.writeFileSync(t, JSON.stringify(o)); fs.renameSync(t, DB); };

// ===== Pengguna, kata sandi, dan hak akses =====
const crypto = require('crypto'), USR = path.join(DATA, 'users.json'), ROLES = ['Admin', 'Auditor', 'Auditee', 'Pimpinan'];
const loadU = () => { try { return JSON.parse(fs.readFileSync(USR, 'utf8')); } catch { return []; } };
const saveU = a => { const t = USR + '.tmp'; fs.writeFileSync(t, JSON.stringify(a, null, 1)); fs.renameSync(t, USR); };
const hash = (p, s = crypto.randomBytes(16).toString('hex')) => s + ':' + crypto.scryptSync(p, s, 64).toString('hex');
const cek = (p, h) => { const [s, x] = String(h).split(':'); return !!x && crypto.timingSafeEqual(crypto.scryptSync(p, s, 64), Buffer.from(x, 'hex')); };
if (!loadU().length) {
  const pw = process.env.ADMIN_PASSWORD || crypto.randomBytes(6).toString('base64url');
  saveU([{ id: 'U-001', u: 'admin', nama: 'Administrator', role: 'Admin', nm: 'Auditor Internal', aktif: 'Aktif', pw: hash(pw) }]);
  console.log(`\nAkun awal dibuat. User ID: admin | Kata sandi: ${pw}\nSegera ganti kata sandi setelah masuk.\n`);
}
const pub = ({ pw, ...r }) => r;
const need = (c, ...r) => { if (!r.includes(c.user.role)) throw new Error('Tidak berwenang'); };
const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10), hoi = () => iso(new Date());
const geser = (s, n, bln) => { const d = new Date(s + 'T00:00'); bln ? d.setMonth(d.getMonth() + n) : d.setDate(d.getDate() + n); return iso(d); };
/** Tugas berulang yang sudah Selesai kembali Belum dengan tenggat periode berikutnya (dilakukan di server). */
function roll(d) { let ch = 0; const T = hoi(); (d.tasks || []).forEach(t => { if (t.status == 'Selesai' && t.due < T) { t.mulai = t.due; while (t.due < T) t.due = t.frek == 'Bulanan' ? geser(t.due, 1, 1) : geser(t.due, t.frek == 'Harian' ? 1 : 7); t.status = 'Belum'; ch = 1; } }); return ch; }
/** Status temuan mengikuti progres tindak lanjut (aturan sama dengan di dashboard). */
function sy(f, d) {
  const a = (d.actions || []).filter(x => x.fid == f.id); if (!a.length || f.status == 'Ditutup') return;
  const all = a.every(x => +x.prog >= 100), any = a.some(x => +x.prog > 0);
  f.status = all ? (a.every(x => x.verif == 'Sesuai') ? 'Selesai' : 'Menunggu Verifikasi') : (any || f.status != 'Baru') ? 'Dalam Tindak Lanjut' : 'Baru';
  f.tutup = ['Selesai', 'Ditutup'].includes(f.status) ? (f.tutup || hoi()) : '';
}
// Pemilik data: tugas -> pic, temuan -> aud, tindak lanjut -> aud pada temuan terkait
const OWN = (c, r, d) => c == 'tasks' ? r.pic : c == 'findings' ? r.aud : ((d.findings || []).find(f => f.id == r.fid) || {}).aud;
const tulis = (u, c, r, d) => u.role == 'Admin' || (u.role == 'Auditor' && !!u.nm && OWN(c, r, d) == u.nm);
const nr = r => JSON.stringify(Object.entries(r).filter(([k, v]) => v !== '' && v != null).sort(([a], [b]) => a < b ? -1 : 1));
/** Data yang boleh dilihat tiap peran. */
function lihat(d, u) {
  if (u.role == 'Admin') return d;
  const lpw = a => { const { pw, ...r } = a; return r; };
  const o = { ...d, team: u.role == 'Auditor' ? d.team : (d.team || []).map(({ wa, ...t }) => t) };
  if (u.role != 'Auditor') o.actions = (d.actions || []).map(lpw);
  if (u.role == 'Auditee') {
    o.actions = o.actions.filter(a => a.pic == u.nm);
    const ids = new Set(o.actions.map(a => a.fid)), ai = new Set(o.actions.map(a => a.id));
    o.findings = (d.findings || []).filter(f => ids.has(f.id)); o.tasks = []; o.hist = []; o.logs = (d.logs || []).filter(l => ai.has(l.a));
  }
  return o;
}
/** Menggabungkan data kiriman dashboard ke data tersimpan hanya untuk bagian yang diizinkan. */
function gabung(old, inc, u) {
  const n = { ditolak: 0 };
  if (u.role == 'Pimpinan') return { d: old, n };
  if (u.role == 'Admin') { const { users, ...x } = inc; return { d: { ...old, ...x }, n }; }
  const aud = u.role == 'Auditor', d = JSON.parse(JSON.stringify(old)), V = lihat(old, u), ubah = new Set(), own = new Set((V.actions || []).map(a => a.id));
  for (const c of aud ? ['tasks', 'findings', 'actions'] : ['actions']) {
    const L = d[c] || (d[c] = []), I = inc[c] || [];
    for (const r of I) {
      const s = L.find(x => x.id == r.id), v = (V[c] || []).find(x => x.id == r.id);
      if (!s) { if (aud) { if (tulis(u, c, r, d)) L.push(r); else n.ditolak++; } continue; }
      if (!v || nr(r) == nr(v)) continue;
      if (aud) { if (tulis(u, c, s, d) && tulis(u, c, r, d)) L[L.indexOf(s)] = r; else n.ditolak++; }
      else if (s.pic == u.nm) { ['prog', 'selesai', 'bukti'].forEach(k => s[k] = r[k]); ubah.add(s.fid); }
    }
    if (aud) for (const v of V[c] || []) if (!I.some(r => r.id == v.id)) { const s = L.find(x => x.id == v.id); if (s && tulis(u, c, s, d)) L.splice(L.indexOf(s), 1); else n.ditolak++; }
  }
  const key = l => [l.t, l.a, l.x].join('|'), ada = new Set((d.logs || []).map(key)), bolehLog = l => { if (!aud) return own.has(l.a); const a = (d.actions || []).find(x => x.id == l.a); return !!a && tulis(u, 'actions', a, d); };
  d.logs = d.logs || [];
  (inc.logs || []).forEach(l => { if (!ada.has(key(l)) && bolehLog(l)) { d.logs.push(l); ada.add(key(l)); } });
  if (aud && Array.isArray(inc.hist)) d.hist = inc.hist;
  ubah.forEach(id => { const f = (d.findings || []).find(x => x.id == id); if (f) sy(f, d); });
  return { d, n };
}

// Fungsi yang dipanggil dashboard; c = { user, req } dibuat server, bukan dari klien
const api = {
  apiLoad: c => {
    const d = load();
    if (!d) return c.user.role == 'Admin' ? null : { tasks: [], findings: [], actions: [], logs: [], hist: [], team: [] };
    if (roll(d)) save(d);
    return lihat(d, c.user);
  },
  apiSave: (c, json) => {
    if (typeof json != 'string' || json === 'null') return { ditolak: 0 };
    const inc = JSON.parse(json), old = load();
    if (!old) { if (c.user.role == 'Admin') { const { users, ...x } = inc; save(x); } return { ditolak: 0 }; }
    const { d, n } = gabung(old, inc, c.user); save(d); return n;
  },
  uploadBukti: (c, nama, mime, b64) => {
    need(c, 'Admin', 'Auditor', 'Auditee');
    const ext = path.extname(String(nama)).toLowerCase();
    if (!['.pdf', '.png', '.jpg', '.jpeg', '.gif', '.webp', '.doc', '.docx', '.xls', '.xlsx', '.csv', '.txt'].includes(ext)) throw new Error('Jenis berkas tidak diizinkan');
    const aman = String(nama).replace(/[^\w.\-]+/g, '_').slice(-80), nm = new Date().toISOString().slice(0, 16).replace(/\D/g, '') + '-' + aman;
    fs.writeFileSync(path.join(UP, nm), Buffer.from(String(b64), 'base64'));
    return `${c.req.protocol}://${c.req.get('host')}/uploads/${encodeURIComponent(nm)}`;
  },
  usersList: c => { need(c, 'Admin'); return loadU().map(pub); },
  usersSave: (c, json) => {
    need(c, 'Admin');
    const o = JSON.parse(json), a = loadU(), i = a.findIndex(x => x.id == o.id), ada = i >= 0;
    if (!/^[\w.\-]{3,30}$/.test(o.u || '')) return { err: 'User ID 3-30 karakter (huruf, angka, titik, strip, garis bawah).' };
    if (a.some((x, j) => j != i && x.u.toLowerCase() == o.u.toLowerCase())) return { err: 'User ID sudah dipakai.' };
    if (!ROLES.includes(o.role)) return { err: 'Peran tidak valid.' };
    if ((!ada || o.pw) && String(o.pw || '').length < 8) return { err: 'Kata sandi minimal 8 karakter.' };
    const baru = { id: ada ? o.id : 'U-' + String(Math.max(0, ...a.map(x => +x.id.split('-')[1])) + 1).padStart(3, '0'), u: o.u, nama: o.nama || o.u, role: o.role, nm: o.nm || '', aktif: o.aktif == 'Nonaktif' ? 'Nonaktif' : 'Aktif', pw: o.pw ? hash(o.pw) : a[i].pw };
    const b = ada ? a.map((x, j) => j == i ? baru : x) : [...a, baru];
    if (!b.some(x => x.role == 'Admin' && x.aktif == 'Aktif')) return { err: 'Harus ada minimal satu Admin aktif.' };
    saveU(b); return { ok: 1 };
  },
  gantiSandi: (c, a, b) => {
    const us = loadU(), x = us.find(z => z.id == c.user.id);
    if (!cek(String(a || ''), x.pw)) return { err: 'Kata sandi saat ini salah.' };
    if (String(b || '').length < 8) return { err: 'Kata sandi baru minimal 8 karakter.' };
    x.pw = hash(b); saveU(us); return { ok: 1 };
  }
};

const app = express();
app.disable('x-powered-by');
// Diperlukan agar Express mengenali HTTPS di balik reverse proxy hosting.
app.set('trust proxy', 1);
// Health check hosting; tidak membuka data aplikasi.
app.get('/healthz', (req, res) => res.status(200).send('ok'));
app.use(express.json({ limit: '30mb' }));
const sess = new Map(), gagal = new Map(), TTL = 8 * 3600e3;
const ck = req => Object.fromEntries((req.headers.cookie || '').split(';').map(c => c.trim().split('=')).filter(x => x.length == 2));
// Semua permintaan wajib login, kecuali halaman dan API login
app.use((req, res, next) => {
  res.setHeader('X-Frame-Options', 'DENY');
  const s = sess.get(ck(req).sid);
  if (s && s.exp > Date.now()) { const u = loadU().find(x => x.u == s.u && x.aktif == 'Aktif'); if (u) { req.user = u; return next(); } }
  if (req.path == '/login' || req.path == '/api/login') return next();
  req.path.startsWith('/api/') ? res.status(401).json({ error: 'login' }) : res.redirect('/login');
});
app.get('/login', (q, r) => r.sendFile(path.join(__dirname, 'views', 'login.html')));
app.post('/api/login', (req, res) => {
  const { u, pw } = req.body || {}, k = req.ip + '|' + String(u).toLowerCase(), g = gagal.get(k) || { n: 0, t: 0 };
  if (g.t > Date.now()) return res.status(429).json({ err: 'Terlalu banyak percobaan. Coba lagi beberapa menit lagi.' });
  const x = loadU().find(a => a.u.toLowerCase() == String(u || '').toLowerCase() && a.aktif == 'Aktif');
  if (!x || !cek(String(pw || ''), x.pw)) { g.n++; if (g.n >= 5) { g.t = Date.now() + 5 * 60e3; g.n = 0; } gagal.set(k, g); return res.status(401).json({ err: 'User ID atau kata sandi salah.' }); }
  gagal.delete(k);
  const t = crypto.randomBytes(24).toString('hex'); sess.set(t, { u: x.u, exp: Date.now() + TTL });
  res.setHeader('Set-Cookie', `sid=${t}; HttpOnly; SameSite=Strict; Path=/; Max-Age=${TTL / 1000}${req.secure ? '; Secure' : ''}`);
  res.json({ ok: 1 });
});
app.post('/api/logout', (req, res) => { sess.delete(ck(req).sid); res.setHeader('Set-Cookie', 'sid=; Max-Age=0; Path=/'); res.json({}); });
app.get(['/', '/index.html'], (req, res) => {
  const me = JSON.stringify({ u: req.user.u, nama: req.user.nama, role: req.user.role, nm: req.user.nm }).replace(/</g, '\\u003c');
  res.type('html').send(fs.readFileSync(path.join(__dirname, 'public', 'index.html'), 'utf8').replace('<!--ME-->', `<script>window.ME=${me}</script>`));
});
app.use('/uploads', (q, r, n) => { r.setHeader('Content-Security-Policy', 'sandbox'); r.setHeader('X-Content-Type-Options', 'nosniff'); n(); }, express.static(UP));
app.get('/lib/xlsx.full.min.js', (q, r) => r.sendFile(path.join(__dirname, 'node_modules/xlsx/dist/xlsx.full.min.js')));
app.use(express.static(path.join(__dirname, 'public')));
app.post('/api/:fn', (req, res) => {
  const f = Object.hasOwn(api, req.params.fn) && api[req.params.fn];
  if (!f || !Array.isArray(req.body)) return res.sendStatus(404);
  try { res.json({ v: f({ user: req.user, req }, ...req.body) ?? null }); }
  catch (e) { console.error(e.message); res.status(e.message == 'Tidak berwenang' ? 403 : 500).json({ error: e.message }); }
});

const sel = t => Math.round((new Date(t + 'T00:00:00') - new Date(new Date().toDateString())) / 864e5);
async function wa(no, pesan) {
  const t = process.env.FONNTE_TOKEN, n = String(no || '').replace(/\D/g, '');
  if (!t || !n) return;
  await fetch('https://api.fonnte.com/send', { method: 'POST', headers: { Authorization: t }, body: new URLSearchParams({ target: n, message: pesan, countryCode: '62' }) })
    .catch(e => console.error('WhatsApp gagal:', e.message));
}

/** Harian: ringkasan ke tiap auditor + pengingat ke PIC tindak lanjut (H-3, H-1, hari H, lalu tiap 3 hari bila terlambat). */
async function pengingatHarian() {
  const d = load(); if (!d) return;
  const tg = d.tasks || [], tl = d.actions || [], fi = d.findings || [];
  for (const a of (d.team || []).filter(a => a.on !== 'Nonaktif' && a.wa)) {
    const it = [];
    tg.filter(t => t.pic == a.n && t.status != 'Selesai').forEach(t => it.push([sel(t.due), t.id + ' ' + t.nama]));
    tl.filter(x => +x.prog < 100 && (fi.find(f => f.id == x.fid) || {}).aud == a.n).forEach(x => it.push([sel(x.due), x.id + ' ' + x.rencana]));
    const p = it.filter(i => i[0] <= 3).sort((x, y) => x[0] - y[0]);
    if (p.length) await wa(a.wa, `*Pengingat Audit – ${a.n}*\n` + p.map(i => '- ' + i[1] + (i[0] < 0 ? ` (terlambat ${-i[0]} hari)` : i[0] == 0 ? ' (hari ini)' : ` (H-${i[0]})`)).join('\n'));
  }
  for (const x of tl.filter(x => x.pw && +x.prog < 100)) {
    const s = sel(x.due);
    if ([3, 1, 0].includes(s) || (s < 0 && (-s) % 3 == 0))
      await wa(x.pw, `Yth. ${x.pic}, mohon tindak lanjut ${x.id} (${x.rencana}) tenggat ${x.due}, progres ${x.prog}%. Terima kasih. – Audit Internal PT. Borneo Group Indonesia`);
  }
}

/** Bulanan: ekspor seluruh basis data ke Excel di folder exports; dikirim lewat surel bila SMTP diisi. */
async function eksporBulanan() {
  const d = load(); if (!d) return;
  const wb = XLSX.utils.book_new(), n = 'Audit-Borneo-' + new Date().toISOString().slice(0, 7);
  [['Tugas', 'tasks'], ['Temuan', 'findings'], ['TindakLanjut', 'actions'], ['Log', 'logs'], ['RiwayatSelesai', 'hist'], ['Tim', 'team']]
    .forEach(([s, k]) => XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(d[k] || []), s));
  const f = path.join(EXP, n + '.xlsx'); XLSX.writeFile(wb, f); console.log('Ekspor tersimpan:', f);
  if (process.env.SMTP_HOST && process.env.EMAIL_TO)
    await require('nodemailer').createTransport({ host: process.env.SMTP_HOST, port: +process.env.SMTP_PORT || 587, auth: { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS } })
      .sendMail({ from: process.env.SMTP_USER, to: process.env.EMAIL_TO, subject: n, text: 'Terlampir ekspor otomatis basis data audit.', attachments: [{ path: f }] });
}

const cmd = process.argv[2];
if (cmd == 'pengingat') pengingatHarian().then(() => process.exit());
else if (cmd == 'ekspor') eksporBulanan().then(() => process.exit());
else {
  const tz = { timezone: process.env.TZ || 'Asia/Jakarta' };
  cron.schedule(`0 ${+process.env.JAM_KIRIM || 7} * * *`, pengingatHarian, tz);
  cron.schedule('0 6 1 * *', eksporBulanan, tz);
  app.listen(PORT, HOST, () => console.log(`Dashboard Audit berjalan di http://${HOST == '0.0.0.0' ? 'localhost' : HOST}:${PORT}`));
}
if (require.main !== module) module.exports = { gabung, lihat, roll, api };
