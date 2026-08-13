# Setup Lyramor + Hermes di VPS

Panduan self-host Lyramor Trade Terminal di VPS, plus memasang Hermes
sebagai agent CLI keenam. Ditulis dari kondisi mesin dev per 2026-08-13,
branch `automation`.

> **Jangan pernah menaruh nilai kredensial asli di file ini.** File ini
> ikut ter-commit dan repo-nya publik. Simpan rahasia di file yang cocok
> dengan pola `.env.*` (sudah ter-gitignore) atau langsung di VPS.

---

## 1. Ringkasan kredensial: apa yang ADA dan apa yang TIDAK

Ini bagian yang paling penting dibaca duluan, karena mengubah urutan
kerja kamu.

| Kredensial | Status di mesin dev | Bisa dipindah? |
|---|---|---|
| `fred` (data ekonomi FRED) | **Ada** | Ya, tinggal salin |
| `fmp` (Financial Modeling Prep) | **Ada** | Ya, tinggal salin |
| **Anthropic / OpenAI / AI provider apa pun** | **TIDAK ADA** | Harus bikin baru |
| Akun broker (`accounts.json`) | Ada, **tersegel AES-256-GCM** | Ya, tapi wajib bawa `sealing.key` |
| Password admin web (`auth.json`) | Ada, **scrypt hash** | Tidak bisa dibaca balik |

Tiga konsekuensi yang perlu diterima sebelum mulai:

1. **Tidak ada API key AI yang tersimpan.** Vault-nya benar-benar kosong
   (`data/config/ai-provider-manager.json` isinya
   `{"apiKeys":{},"credentials":{}}`). Selama ini Claude Code jalan lewat
   OAuth langganan, bukan lewat API key. Untuk Hermes harus dibuat key
   baru di <https://console.anthropic.com>.
2. **Password admin tidak bisa dipulihkan.** `auth.json` menyimpan scrypt
   hash, bukan passwordnya. Kalau lupa, hapus `auth.json` di VPS lalu
   daftar ulang saat pertama membuka UI.
3. **`sealing.key` adalah satu-satunya kunci kredensial broker.** Dia
   berada di `~/.openalice/sealing.key`, sengaja di LUAR folder `data/`,
   supaya backup `data/` saja tidak bisa dibuka. Menyalin `data/` tanpa
   file ini membuat semua akun broker jadi ciphertext yang tidak bisa
   dibuka lagi.

---

## 2. Prasyarat VPS

- Linux x86_64, RAM 4 GB minimum (build UI + turbo cukup rakus)
- Disk 15 GB bebas
- Docker + Docker Compose plugin
- Domain atau IP, plus reverse proxy kalau mau diakses dari luar

Kalau tidak mau pakai Docker, siapkan Node 22 dan pnpm 10.29.2, persis
seperti yang dipakai image-nya.

---

## 3. Jalur Docker (rekomendasi)

Repo ini sudah menyediakan `Dockerfile` dan `docker-compose.yml` yang
memang ditujukan untuk VPS self-hoster.

```bash
git clone https://github.com/Lyramor/Lyramor-Trade-Terminal.git
cd Lyramor-Trade-Terminal
git checkout automation
docker compose up -d --build
```

Build pertama lama, sekitar 10 sampai 20 menit, karena `turbo` membangun
packages, UI, dan UTA sekaligus.

Yang perlu diketahui soal image-nya:

- Volume `openalice-data` di-mount ke `/data`, dan itu satu-satunya
  tempat state bertahan lintas rebuild
- `OPENALICE_HOME=/data`, `AQ_LAUNCHER_ROOT=/data/workspaces`,
  `HOME=/data/home`
- Port yang dibuka hanya **47331** (web UI). Port MCP 47332 sengaja tidak
  diekspos karena hanya dipakai CLI di dalam container
- `claude` dan `codex` sudah terpasang global di image. **`hermes` belum**,
  lihat bagian 5

Autentikasi agent, sekali saja setelah container hidup:

```bash
docker exec -it openalice claude        # OAuth, tempel URL ke browser
docker exec -it openalice codex login   # kalau memang dipakai
```

---

## 4. Memindahkan data dari mesin lokal

Lakukan ini kalau mau membawa akun broker dan konfigurasi yang sudah ada.
Kalau mau mulai bersih, lewati saja.

Di mesin lokal, bungkus tiga hal sekaligus:

```bash
cd ~
tar czf openalice-migrate.tgz \
  .openalice/data \
  .openalice/sealing.key \
  .openalice/provider-keys.json
```

Kirim ke VPS lewat `scp`, lalu bongkar ke dalam volume:

```bash
scp openalice-migrate.tgz user@vps:/tmp/
ssh user@vps
docker cp /tmp/openalice-migrate.tgz openalice:/tmp/
docker exec -it openalice sh -c \
  'cd /tmp && tar xzf openalice-migrate.tgz && \
   cp -r .openalice/data/.        /data/ && \
   cp .openalice/sealing.key      /data/sealing.key && \
   mkdir -p /data/home/.openalice && \
   cp .openalice/provider-keys.json /data/home/.openalice/'
docker restart openalice
```

Pemetaan path di dalam container:

| Di lokal | Di container |
|---|---|
| `~/.openalice/data` | `/data` |
| `~/.openalice/sealing.key` | `/data/sealing.key` |
| `~/.openalice/provider-keys.json` | `/data/home/.openalice/provider-keys.json` |

Baris terakhir bukan salah ketik. `provider-keys.json` diresolusi lewat
`OPENALICE_GLOBAL_DIR ?? join(homedir(), '.openalice')`
(`src/core/config.ts:24`), dan `HOME` di container adalah `/data/home`.
Sedangkan `sealing.key` diharapkan bersebelahan dengan root
`OPENALICE_HOME`, yaitu `/data`. Dua file ini memang tinggal di tempat
yang berbeda.

**Hapus arsipnya setelah selesai**, di lokal maupun di VPS. Isinya
`sealing.key`.

```bash
rm ~/openalice-migrate.tgz
ssh user@vps 'rm /tmp/openalice-migrate.tgz'
docker exec openalice sh -c 'rm -rf /tmp/openalice-migrate.tgz /tmp/.openalice'
```

---

## 5. Memasang Hermes di container

Image bawaan hanya memasang `claude` dan `codex`. Adapter Hermes sudah
ada di kode (`src/workspaces/adapters/hermes.ts`, terdaftar di
`service.ts`), tapi binary-nya belum ikut terpasang, jadi agent-detect
tidak akan menemukannya.

Cara cepat untuk mencoba dulu:

```bash
docker exec -it openalice sh -c 'apt-get update && apt-get install -y pipx'
docker exec -it openalice pipx install hermes-agent
docker exec -it openalice hermes --version
```

Kalau sudah jalan, jadikan permanen dengan menambahkan blok ini ke tahap
runtime `Dockerfile`, tepat setelah blok `npm install -g` yang sudah ada:

```dockerfile
RUN apt-get update && apt-get install -y --no-install-recommends pipx \
    && rm -rf /var/lib/apt/lists/* \
    && PIPX_HOME=/opt/pipx PIPX_BIN_DIR=/usr/local/bin pipx install hermes-agent \
    && hermes --version
```

Lalu `docker compose up -d --build` lagi. Tanpa langkah ini, Hermes hilang
setiap kali image di-rebuild.

> Cek dulu metode instalasi resmi Hermes yang berlaku saat kamu setup
> (<https://hermes-agent.nousresearch.com/docs>). Nama paket dan cara
> pasangnya bisa berubah, dan blok di atas mengasumsikan distribusi lewat
> pipx.

---

## 6. Menyambungkan Hermes ke Claude

Hermes **bukan** Claude Code. Dia agent CLI dengan model loop dan
toolsystem sendiri, yang kebetulan bisa memakai model Claude.

Yang lebih penting untuk setup: **Hermes tidak menerima credential
injection dari Lyramor.** Injeksi hanya jalan untuk adapter yang punya
`writeAiConfig` (`src/workspaces/credential-injection.ts:166`), dan
adapter Hermes sengaja tidak punya itu. Jadi API key yang tersimpan di
Settings › AI Provider **tidak akan sampai ke Hermes**. Hermes harus
dikonfigurasi sendiri, sekali, dan itu berlaku global untuk semua
workspace.

Dua jalur autentikasi:

| Jalur | Syarat | Biaya |
|---|---|---|
| `ANTHROPIC_API_KEY` | tidak ada | bayar per token, harga API standar |
| OAuth Claude Max | wajib plan Max **dan** Usage credits aktif | pakai kredit tambahan, jatah Max tidak terpakai |

Claude Pro tidak bisa memakai jalur OAuth sama sekali.

Jalur API key, paling lurus. Tulis config provider-nya:

```bash
docker exec -it openalice sh -c \
  'mkdir -p /data/home/.hermes && cat > /data/home/.hermes/config.yaml <<EOF
model:
  provider: "anthropic"
  default: "claude-sonnet-4-6"
EOF'
```

Lalu suplai key-nya lewat env file supaya bertahan lintas restart.
Tambahkan ke `docker-compose.yml`:

```yaml
services:
  openalice:
    env_file:
      - .env.vps
```

Dan buat `.env.vps` di sebelah `docker-compose.yml` pada VPS (pola
`.env.*` sudah ter-gitignore, jadi tidak akan ikut ter-commit):

```
ANTHROPIC_API_KEY=isi-key-kamu-di-sini
```

Alternatif interaktif kalau lebih suka wizard:

```bash
docker exec -it openalice hermes setup
docker exec -it openalice hermes model
```

---

## 7. Keamanan: baca sebelum membuka port

Image ini mengatur `OPENALICE_BIND_HOST=0.0.0.0`, dan compose memetakan
`47331:47331`. Artinya begitu container hidup di VPS, **UI-nya terbuka ke
internet**. Ini terminal trading yang memegang kredensial broker, jadi
jangan dibiarkan begitu saja.

Pilih salah satu.

**Opsi paling aman, tanpa membuka port sama sekali.** Ubah pemetaan port
di `docker-compose.yml` menjadi loopback:

```yaml
ports:
  - "127.0.0.1:47331:47331"
```

Lalu akses dari laptop lewat SSH tunnel:

```bash
ssh -L 47331:127.0.0.1:47331 user@vps
```

Buka `http://localhost:47331` di browser lokal.

**Opsi kedua, reverse proxy dengan TLS.** Tetap ikat ke loopback seperti
di atas, lalu taruh Caddy atau Nginx di depannya dengan sertifikat Let's
Encrypt. Jangan menyajikan UI ini lewat HTTP polos, karena token admin
lewat di sana.

Hal lain yang wajib:

- Aktifkan firewall, hanya izinkan port 22 dan 443
- `allowAiTrading` saat ini `false` di `data/config/agent.json`. Biarkan
  begitu sampai benar-benar yakin, dan pastikan broker yang terhubung
  adalah akun demo dulu
- Jangan menyalin `sealing.key` lewat kanal yang tidak terenkripsi

---

## 8. Verifikasi

```bash
# Container hidup dan tidak restart-loop
docker compose ps
docker compose logs -f --tail=100 openalice

# Guardian menghidupkan dua proses
docker exec openalice sh -c 'ps aux | grep -E "main.js|uta.js" | grep -v grep'

# Web UI menjawab
curl -sS -o /dev/null -w '%{http_code}\n' http://127.0.0.1:47331

# Hermes terdeteksi
docker exec openalice hermes --version

# Hermes bisa memanggil model
docker exec -it openalice hermes chat -q "balas dengan satu kata: oke" -Q
```

Perintah terakhir juga memverifikasi jalur session id. Hermes mencetak
`session_id: <id>` ke **stderr**, dan sejak commit `edec330` runner
headless Lyramor ikut memindai stderr untuk adapter yang menyalakan
`headlessSessionIdOnStderr`. Kalau id-nya muncul, run headless bisa
dibuka lagi sebagai sesi interaktif.

Terakhir, buka UI dan buat workspace baru. Hermes harus muncul sebagai
pilihan agent dengan prefix nama `h`.

---

## 9. Kalau ada yang gagal

| Gejala | Kemungkinan sebab |
|---|---|
| Akun broker kosong padahal `data/` sudah disalin | `sealing.key` tidak ikut, atau salah lokasi |
| Hermes tidak muncul di daftar agent | binary tidak ada di PATH, cek `docker exec openalice which hermes` |
| Hermes jalan tapi menolak menjawab | provider belum diset, cek `/data/home/.hermes/config.yaml` |
| Diminta daftar ulang admin | `auth.json` tidak ikut tersalin, memang tidak bisa dipulihkan |
| Build mati saat `turbo run build` | RAM kurang, tambah swap 2 GB |
| `pnpm install` gagal soal `dugite` | `dugite` wajib ada di `pnpm.onlyBuiltDependencies`, postinstall-nya menarik git per-platform |

---

## Referensi kode

- `Dockerfile`, `docker-compose.yml` — jalur self-host
- `src/workspaces/adapters/hermes.ts` — adapter Hermes lengkap dengan catatan lapangan
- `src/workspaces/credential-injection.ts:166` — alasan Hermes tidak dapat injeksi
- `src/core/config.ts:24` — resolusi `provider-keys.json`
- `scripts/guardian/prod.mjs` — supervisor yang jadi CMD container
