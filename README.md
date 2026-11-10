# Dashboard Audit Internal BGI — Paket Online

Paket ini disiapkan untuk deployment sebagai aplikasi **Node.js + Express** di Render.
GitHub menyimpan source code; Render menjalankan backend dan menyediakan URL online.

## Mengapa bukan GitHub Pages?
Aplikasi ini memakai login server, API `/api/*`, penyimpanan JSON, unggah bukti, dan proses terjadwal. GitHub Pages hanya melayani file statis sehingga tidak dapat menjalankan fitur backend tersebut.

## Struktur penting
- `server.js` — backend Express (sudah disesuaikan untuk hosting dan persistent disk).
- `public/index.html` — dashboard.
- `views/login.html` — halaman login.
- `render.yaml` — konfigurasi deployment Render.
- `.env.example` — contoh environment variable.

## Deploy melalui GitHub + Render
1. Ekstrak ZIP ini di komputer.
2. Buat repository baru di GitHub, misalnya `audit-borneo`.
3. Upload seluruh isi folder ini ke root repository (pastikan `package.json`, `server.js`, dan `render.yaml` berada di root).
4. Buka https://render.com dan login menggunakan GitHub.
5. Pilih **New → Blueprint** (atau hubungkan repository yang berisi `render.yaml`).
6. Pilih repository `audit-borneo`, lalu jalankan deployment.
7. Saat diminta nilai `ADMIN_PASSWORD`, masukkan kata sandi admin awal yang kuat (minimal 12 karakter; simpan dengan aman). Jangan masukkan kata sandi ke file atau repository.
8. Tunggu status deployment **Live**, lalu buka URL `https://...onrender.com`.

`render.yaml` menyiapkan persistent disk `/var/data` untuk database JSON, akun pengguna, dan bukti upload. Konfigurasi disk pada paket ini menggunakan Render Starter dan persistent disk berbayar. Jangan menghapus disk atau mengganti `DATA_DIR` setelah aplikasi berisi data.

## Login awal
- User ID awal: `admin`
- Kata sandi awal: nilai `ADMIN_PASSWORD` yang kamu masukkan di Render.
- Jika variabel itu tidak diisi saat pertama kali aplikasi membuat akun, server menghasilkan kata sandi acak dan menampilkannya di log deployment.

Segera login, ganti kata sandi, lalu buat akun pengguna sesuai peran. Jangan membagikan akun admin kepada seluruh tim.

## Environment variable opsional
Tambahkan melalui Render → Environment:
- `FONNTE_TOKEN`: token Fonnte untuk pengingat WhatsApp.
- `JAM_KIRIM`: jam pengingat (default 7, zona `Asia/Jakarta`).
- `SMTP_HOST`, `SMTP_PORT`, `SMTP_USER`, `SMTP_PASS`, `EMAIL_TO`: konfigurasi email ekspor bulanan.

Token dan kata sandi hanya disimpan sebagai Environment Variables/Secrets di hosting, bukan di GitHub.

## Catatan penting sebelum dipakai operasional
1. **Backup:** database aplikasi berupa file JSON. Buat backup rutin dari `/var/data` sebelum perubahan besar. Persistent disk bukan pengganti backup.
2. **Sesi login:** sesi saat ini disimpan di memori server. Setelah server restart atau redeploy, pengguna mungkin perlu login kembali.
3. **Satu instance:** rancangan ini untuk satu instance server. Jangan menjalankan beberapa instance sekaligus karena sesi dan file JSON belum memakai database bersama.
4. **Uji akses:** uji setiap peran (Admin, Auditor, Auditee, Pimpinan), input/edit data, upload bukti, ekspor Excel, dan pengingat sebelum digunakan sungguhan.
5. **Keamanan:** gunakan HTTPS dari hosting, kata sandi kuat, batasi akun, dan jangan memasukkan data rahasia ke repository publik.
6. **WhatsApp dan email:** tidak aktif sampai token/SMTP dikonfigurasi. Pastikan kebijakan pengiriman dan jadwal sudah disetujui.

## Menjalankan lokal
Memerlukan Node.js 18 atau lebih baru:
```bash
npm install
# salin .env.example menjadi .env, lalu isi ADMIN_PASSWORD
npm start
```
Buka http://localhost:3000

## Batasan
Paket ini menyiapkan konfigurasi deployment, bukan migrasi ke database SQL. Untuk penggunaan multi-user skala besar dan data keuangan/audit yang kritis, rencanakan migrasi ke PostgreSQL serta backup dan pemulihan teruji.
