# Setup TradingView MCP — Data Publik (37 Tools)

Panduan menyiapkan **`tradingview-mcp-server`** oleh
**[atilaahmettaner](https://github.com/atilaahmettaner/tradingview-mcp)** — sebuah
MCP berbasis Python yang menyajikan **37 tool** market data, indikator teknikal,
screener, backtesting, dan sentimen ke agent Claude Code di dalam Lyramor.

**Tidak butuh akun TradingView maupun API key.** Server ini menarik **data
publik** dari sisi server. Lisensi MIT.

---

## Bedakan dari `tv-mcp` (CDP 9333)

Lyramor punya **dua** opsi integrasi TradingView yang berbeda total. Keduanya
bisa dipakai bersamaan:

| | **`tv-mcp`** (sudah dipakai launcher) | **`tradingview-mcp-server`** (dokumen ini) |
|---|---|---|
| Cara kerja | Mengendalikan **aplikasi TradingView Desktop** via **CDP (Chrome DevTools Protocol)** di port **9333** | Menarik **data publik** dari sisi server — **tanpa** login/scrape akun |
| Butuh akun TradingView? | Ya (aplikasi desktop yang login) | **Tidak** |
| Untuk apa | Buka simbol, ganti timeframe, baca kondisi chart yang sedang tampil | Market data, 30+ indikator TA, screener, backtest, sentimen, berita |
| Runtime | Node (`tv-mcp` di `~/tv-mcp`) | Python (`uvx`) |

Singkatnya: `tv-mcp` = **otomasi chart yang sedang kamu lihat**;
`tradingview-mcp-server` = **sumber data & analitik publik**. Pakai keduanya
kalau perlu.

---

## Prasyarat

| Tool | Versi | Catatan |
|---|---|---|
| **Python** | 3.10 – 3.13 | **BUKAN 3.14** — belum ada wheel yang kompatibel |
| **uv / uvx** | terbaru | manajer paket/runner Python yang menjalankan server |

**Install `uv` (menyertakan `uvx`):**

**Windows (PowerShell):**

```powershell
irm https://astral.sh/uv/install.ps1 | iex
```

**Linux / macOS:**

```bash
curl -LsSf https://astral.sh/uv/install.sh | sh
```

Tutup lalu buka lagi terminal, verifikasi:

```bash
uvx --version
```

---

## Registrasi ke Claude Code (scope USER)

Daftarkan di **scope USER** (`~/.claude.json`) supaya **setiap sesi `claude`** —
termasuk yang berjalan di dalam workspace Lyramor — otomatis melihat tool-nya.

> **Windows: WAJIB pin Python 3.13** lewat `--python 3.13`. Tanpa pin, `uvx`
> bisa memilih Python 3.14 (belum ada wheel) dan gagal saat first launch (lihat
> Troubleshooting).

```json
{
  "mcpServers": {
    "tradingview": {
      "command": "uvx",
      "args": ["--python", "3.13", "--from", "tradingview-mcp-server", "tradingview-mcp"]
    }
  }
}
```

Alternatif lewat CLI:

```bash
claude mcp add tradingview --scope user -- uvx --python 3.13 --from tradingview-mcp-server tradingview-mcp
```

Buka sesi `claude` baru, jalankan `/mcp` untuk memastikan `tradingview`
terhubung.

### Opsional — berita & sentimen

Beberapa tool berita/sentimen memakai penyedia data eksternal. Set env
`MARKETAUX_API_TOKEN` (dari [marketaux.com](https://www.marketaux.com), tier
gratis tersedia) untuk mengaktifkannya. **Tanpa token ini, tool lain tetap
berjalan normal** — hanya sebagian tool berita yang tidak aktif.

```json
{
  "mcpServers": {
    "tradingview": {
      "command": "uvx",
      "args": ["--python", "3.13", "--from", "tradingview-mcp-server", "tradingview-mcp"],
      "env": { "MARKETAUX_API_TOKEN": "token-kamu" }
    }
  }
}
```

---

## Kategori 37 Tool (ringkas)

- **Market data real-time** — harga real-time via Yahoo, quote lintas-bursa
  (Binance, KuCoin, NASDAQ, dan lainnya).
- **Analisis teknikal inti** — 23+ indikator (RSI, MACD, Bollinger Bands, EMA/SMA,
  Stochastic, ADX, ATR, dll.), plus 30+ indikator secara total.
- **Multi-timeframe** — analisis satu simbol di beberapa timeframe sekaligus.
- **Screener global** — saring saham/kripto lintas bursa berdasarkan kriteria
  teknikal & fundamental.
- **Backtesting** — 9 strategi bawaan plus **walk-forward analysis** untuk menguji
  ketahanan strategi di luar sampel.
- **Sentimen Reddit** — ukur sentimen komunitas terhadap sebuah simbol.
- **Berita finansial** — headline & berita pasar (sebagian butuh
  `MARKETAUX_API_TOKEN`, lihat di atas).

---

## Troubleshooting (Windows)

**Error `-32001 Request timed out` saat first launch.**
Hampir selalu karena `uvx` memilih **Python 3.14** (belum ada wheel) atau
membangun dari source yang lama. Perbaiki dengan **pin Python 3.13** (sudah ada
di config `args` di atas), atau pre-install lebih dulu supaya launch pertama
tidak menunggu kompilasi:

```powershell
uv tool install --python 3.13 tradingview-mcp-server
```

Setelah terpasang, first launch di sesi `claude` berikutnya langsung siap.

**`/mcp` menampilkan `tradingview` gagal / disconnected.**
Cek `uvx --version` jalan, pastikan `--python 3.13` ada di `args`, lalu buka sesi
`claude` baru (config MCP dibaca saat sesi dimulai).

---

## Disclaimer

- **Bukan nasihat finansial.** Seluruh data, sinyal, indikator, dan hasil
  backtest hanya untuk tujuan informasi/riset. Keputusan trading sepenuhnya
  tanggung jawab kamu.
- **Proyek independen.** `tradingview-mcp-server` adalah proyek open-source pihak
  ketiga (lisensi MIT) dan **tidak berafiliasi dengan, tidak didukung oleh, dan
  bukan produk dari TradingView Inc.** Nama "TradingView" adalah merek dagang
  pemiliknya masing-masing.

## Kredit

MCP oleh **[atilaahmettaner](https://github.com/atilaahmettaner/tradingview-mcp)**
(lisensi MIT).
