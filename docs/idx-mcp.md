# Setup IDX MCP — Data Saham BEI

Panduan lengkap menyiapkan **IDX MCP**, sidecar yang menyajikan data saham
**Bursa Efek Indonesia (BEI)** ke agent Claude Code di dalam Lyramor.

Server sidecar-nya sudah **ikut ter-clone** di dalam repo ini di
[`sidecars/idx-mcp-server/`](../sidecars/idx-mcp-server/). Ia bersifat
**read-only**: hanya membaca database SQLite milik proyek pihak ketiga
**IDX-API ([NeaByteLab](https://github.com/NeaByteLab))**, dan tidak pernah
menulis atau memanggil jaringan IDX sendiri.

> Dokumen ini adalah versi yang **sudah dikoreksi**. Tutorial komunitas lama
> memuat empat kesalahan yang membuat setup gagal senyap; keempatnya
> ditandai `⚠️ KOREKSI` di bawah dan sudah diperbaiki di sini.

---

## Arsitektur

```
                (proses terpisah — di luar repo Lyramor)
  ┌─────────────────────────────────────────────────────────┐
  │  IDX-API (NeaByteLab), dijalankan dengan Deno            │
  │                                                          │
  │   deno task db:sync        → bikin SKEMA tabel (kosong)  │
  │   deno run -A SyncMcp.ts    → TARIK data dari BEI, isi   │
  │                              tabel                        │
  └───────────────────────────┬─────────────────────────────┘
                              │ menulis
                              ▼
              ~/idx-api/data/database.sqlite
                              │
                              │ dibaca READ-ONLY
                              ▼
  ┌─────────────────────────────────────────────────────────┐
  │  sidecars/idx-mcp-server  (Node, better-sqlite3)         │
  │  Express + MCP SDK, transport SSE, port 4002             │
  │                                                          │
  │  GET  /sse       → endpoint MCP (SSE)                    │
  │  POST /message   → channel balik MCP                     │
  │  GET  /health    → status + jumlah baris per tabel       │
  └───────────────────────────┬─────────────────────────────┘
                              │ http://localhost:4002/sse
                              ▼
  ┌─────────────────────────────────────────────────────────┐
  │  Claude Code (scope USER, ~/.claude.json)                │
  │  → SEMUA sesi claude, termasuk di dalam workspace        │
  │    Lyramor, otomatis melihat 8 tool saham BEI            │
  └─────────────────────────────────────────────────────────┘
```

Dua proses terpisah dengan tugas berbeda:

- **IDX-API (Deno)** = penulis data. Menarik data BEI dari endpoint publik dan
  mengisi `database.sqlite`.
- **idx-mcp-server (Node)** = pembaca data. Membuka SQLite tadi read-only dan
  menyajikannya sebagai tool MCP lewat SSE.

---

## Prasyarat

| Tool | Versi | Untuk |
|---|---|---|
| **Node.js** | 20+ | menjalankan sidecar MCP (`sidecars/idx-mcp-server`) |
| **Deno** | 2.5+ | menjalankan IDX-API (penarik data) |
| Toolchain build native | — | `better-sqlite3` dikompilasi native saat `npm install` (di Windows: Visual Studio Build Tools / `windows-build-tools`) |

---

## Step 1 — Install Deno

**Windows (PowerShell):**

```powershell
irm https://deno.land/install.ps1 | iex
```

**Linux / macOS:**

```bash
curl -fsSL https://deno.land/install.sh | sh
```

Tutup lalu buka lagi terminal, verifikasi:

```bash
deno --version    # pastikan 2.5 atau lebih baru
```

---

## Step 2 — Clone & sync IDX-API (sumber data)

IDX-API adalah proyek **terpisah** (bukan bagian repo Lyramor). Clone ke home
directory sebagai `idx-api` supaya cocok dengan path default sidecar
(`~/idx-api/data/database.sqlite`):

```bash
cd ~
git clone https://github.com/NeaByteLab/IDX-API.git idx-api
cd idx-api
```

Lalu jalankan **dua langkah, berurutan**:

```bash
# 2a. Bikin SKEMA — membuat tabel-tabel KOSONG. Belum ada data apa pun.
deno task db:sync

# 2b. ISI data — menarik data terbaru dari BEI dan mengisi tabel.
deno run -A SyncMcp.ts
```

> ⚠️ **KOREKSI #1 — urutan `db:sync` lalu `SyncMcp.ts` itu wajib.**
> `deno task db:sync` **hanya membuat tabel kosong** (skema). Data baru terisi
> setelah `deno run -A SyncMcp.ts` (atau cron). Kalau kamu berhenti setelah
> `db:sync` saja, database ada tapi setiap tabel **0 baris**, dan endpoint
> `/health` sidecar akan menunjukkan semua tabel bernilai `0`. Jadi urutan yang
> benar: **`db:sync` DULU (bikin skema) → LALU `SyncMcp.ts` (isi data)**.

Verifikasi file-nya ada:

```bash
ls -lh ~/idx-api/data/database.sqlite
```

---

## Step 3 — Jalankan server bundled (sidecar Node)

Server MCP-nya sudah ada di dalam repo Lyramor:

```bash
cd sidecars/idx-mcp-server
npm install     # better-sqlite3 dikompilasi native di sini
npm start       # jalan di http://localhost:4002/sse
```

Cek kesehatan sekaligus jumlah baris per tabel — ini pembeda antara "server
hidup" dan "server hidup TAPI database kosong":

```bash
curl http://localhost:4002/health
```

Contoh output sehat (semua tabel > 0):

```json
{
  "status": "ok",
  "db": "/home/kamu/idx-api/data/database.sqlite",
  "port": 4002,
  "tools": 8,
  "rows": {
    "stock_summary": 12873,
    "company_profile": 942,
    "financial_ratio": 921,
    "top_gainer": 20,
    "top_loser": 20,
    "index_list": 46
  }
}
```

Kalau semua angka `rows` bernilai `0`, lihat KOREKSI #1 — kamu belum menjalankan
`SyncMcp.ts`.

---

## Step 4 — Cron sync harian (opsional)

Data BEI diperbarui setiap hari perdagangan. BEI tutup sekitar **15:49 WIB**,
jadi jadwalkan `SyncMcp.ts` sesudah itu (mis. 16:00 WIB) agar database selalu
memuat close terbaru. Sidecar tidak perlu di-restart — ia baca fresh setiap
query.

**Linux / macOS (crontab, contoh 16:00 WIB = zona sistem Asia/Jakarta):**

```cron
0 16 * * 1-5  cd $HOME/idx-api && deno run -A SyncMcp.ts >> $HOME/idx-api/sync.log 2>&1
```

**Windows (Task Scheduler)** — buat Basic Task harian jam 16:00, action:

```
Program : deno
Argumen : run -A SyncMcp.ts
Start in: C:\Users\<kamu>\idx-api
```

---

## Step 5 — Registrasi ke Claude Code (scope USER)

> ⚠️ **KOREKSI #4 — JANGAN daftarkan lewat menu Settings → MCP di UI Lyramor.**
> Menu itu untuk MCP **sisi-server** internal Lyramor, bukan untuk menambah
> server SSE eksternal seperti ini. Cara yang benar: daftarkan langsung ke
> **Claude Code pada scope USER**. Dengan begitu **SEMUA sesi `claude`** —
> termasuk yang berjalan di dalam workspace Lyramor — otomatis melihat tool-nya
> tanpa konfigurasi per-workspace.

**Cara termudah — lewat CLI `claude`:**

```bash
claude mcp add idx-market-data http://localhost:4002/sse --transport sse --scope user
```

**Atau edit manual `~/.claude.json`:**

```json
{
  "mcpServers": {
    "idx-market-data": {
      "type": "sse",
      "url": "http://localhost:4002/sse"
    }
  }
}
```

Setelah itu buka sesi `claude` baru; jalankan `/mcp` untuk memastikan
`idx-market-data` terhubung dan 8 tool-nya muncul.

---

## Step 6 — Tes

Di dalam sesi Claude Code (atau di workspace Lyramor), coba prompt seperti:

> "Pakai tool IDX, ambil data terbaru saham **BBCA**: harga close, perubahan,
> volume, dan aliran dana asing. Lalu ambil rasio fundamentalnya (PER, PBV, ROE)
> dan riwayat 30 hari terakhir. Ringkas kondisi teknikal + fundamentalnya."

Agent akan memanggil `get_stock`, `get_financial_ratio`, dan `get_stock_history`
untuk BBCA lalu merangkumnya.

---

## Daftar 8 Tool

| Tool | Fungsi | Parameter |
|---|---|---|
| `get_stock` | Data saham BEI terbaru: OHLC, volume, value, frequency, aliran dana asing | `ticker` (mis. `BBCA`) |
| `get_stock_history` | Riwayat OHLC harian — untuk tren, support, resistance | `ticker`, `days` (1–365, default 30) |
| `get_financial_ratio` | Fundamental: PER, PBV, ROE, ROA, DER, NPM, EPS, book value, aset, laba | `ticker` |
| `get_top_gainers` | 20 saham dengan kenaikan terbesar periode terakhir | — |
| `get_top_losers` | 20 saham dengan penurunan terbesar periode terakhir | — |
| `search_stocks` | Cari saham berdasarkan kode atau nama perusahaan | `query` (mis. `bank`, `Telkom`) |
| `get_foreign_flow` | Beli/jual investor asing 30 hari perdagangan terakhir | `ticker` |
| `get_index` | Performa indeks BEI terkini: IHSG, LQ45, IDX30, dll. | — |

### Catatan skema (penting untuk debugging)

> ⚠️ **KOREKSI #2 — kolom SQLite pakai `snake_case`, BUKAN `camelCase`.**
> Nama kolom asli di database adalah `foreign_buy`, `foreign_sell`,
> `foreign_net`, `sub_sector`, `book_value`, dst. Query yang menyalin nama
> `camelCase` (`foreignBuy`, `subSector`, `bookValue`) langsung ke SQL akan
> gagal dengan error **`no such column`**. Server bundled sudah memakai nama
> `snake_case` asli di SQL lalu meng-`AS`-alias-kannya ke `camelCase` hanya
> untuk output. Kalau kamu menulis query SQLite manual ke database ini, pakai
> `snake_case`.

> ⚠️ **KOREKSI #3 — tabel `index_list` TIDAK punya kolom `period`.**
> `index_list` adalah **snapshot terkini** — satu baris per indeks, primary key
> `code`. Menulis `ORDER BY period` pada tabel ini = **error SQL**. Yang benar
> adalah `ORDER BY code`. (Bandingkan dengan `top_gainer` / `top_loser` yang
> memang punya `period`.)

Field tanggal (`date`, `period`) disimpan sebagai **epoch milidetik** di
database; server mengubahnya menjadi tanggal ISO (`YYYY-MM-DD`) di output agar
mudah dibaca model.

---

## Konfigurasi (env)

| Env | Default | Fungsi |
|---|---|---|
| `IDX_DB_PATH` | `~/idx-api/data/database.sqlite` | Lokasi file SQLite IDX-API |
| `PORT` | `4002` | Port SSE sidecar |

---

## Troubleshooting

**"Database tidak ditemukan" saat `npm start`.**
Sidecar keluar dengan pesan `[ERROR] Database tidak ditemukan: <path>`. Berarti
`~/idx-api/data/database.sqlite` belum ada. Jalankan Step 2 (clone IDX-API →
`deno task db:sync` → `deno run -A SyncMcp.ts`), atau set `IDX_DB_PATH` ke lokasi
file yang benar.

**Server hidup tapi semua tabel 0 baris (`/health` menunjukkan `rows` = 0).**
Database ada (skema terbentuk) tapi belum diisi. Kamu berhenti setelah
`deno task db:sync` saja. Jalankan pengisian datanya:

```bash
cd ~/idx-api && deno run -A SyncMcp.ts
```

(Lihat KOREKSI #1.) Tool akan mengembalikan hint yang sama saat dipanggil dalam
kondisi ini.

**Error `no such column`** saat query manual → kamu memakai `camelCase` di SQL.
Pakai `snake_case` (KOREKSI #2). Error `no such column: period` khusus di
`index_list` → tabel itu tak punya `period`, pakai `ORDER BY code` (KOREKSI #3).

**Port 4002 sudah dipakai.** Jalankan di port lain:

```bash
PORT=4003 npm start
```

Lalu sesuaikan URL registrasi Claude ke `http://localhost:4003/sse`.

**Agent tidak melihat tool IDX.** Pastikan (a) sidecar hidup (`curl
http://localhost:4002/health`), (b) registrasi ada di **scope USER**
`~/.claude.json` — bukan di UI Lyramor (KOREKSI #4), (c) kamu membuka sesi
`claude` **baru** setelah menambahkan config, dan (d) `/mcp` di dalam sesi
menampilkan `idx-market-data` sebagai `connected`.

---

## Kredit

Data berasal dari **IDX-API oleh [NeaByteLab](https://github.com/NeaByteLab)**,
yang menarik dari endpoint publik BEI (Bursa Efek Indonesia) — **tanpa API key**.
Sidecar `idx-mcp-server` di repo ini hanya membaca database yang dihasilkannya.
