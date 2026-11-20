# Menjalankan OpenTypeBB dengan Lyramor

OpenTypeBB adalah port TypeScript-native dari [OpenBB Platform](https://github.com/OpenBB-finance/OpenBB) — infrastruktur data finansial open-source. Ia dikemas sebagai package internal (`@traderalice/opentypebb`) di dalam Lyramor, memberi Anda akses ke data equity, crypto, currency, commodity, economy, dan news tanpa perlu menjalankan sidecar Python atau berurusan dengan `uv`.

Tutorial ini memandu Anda menjalankan Lyramor dengan OpenTypeBB sebagai data backend.

---

## Prasyarat

| Kebutuhan | Versi |
|-------------|---------|
| [Node.js](https://nodejs.org/) | 22+ |
| [pnpm](https://pnpm.io/) | 10+ |
| [Claude Code CLI](https://docs.anthropic.com/en/docs/claude-code) | terbaru (terpasang & terautentikasi) |

Hanya itu. Tanpa Python, tanpa `uv`, tanpa Docker.

---

## 1. Clone & Install

```bash
git clone https://github.com/TraderAlice/OpenAlice.git
cd OpenAlice
pnpm install
pnpm build
```

`pnpm install` me-resolve workspace monorepo — package `@traderalice/opentypebb` di bawah `packages/opentypebb/` di-link secara otomatis.

## 2. Menjalankan Dev Server

```bash
pnpm dev
```

Buka [http://localhost:3002](http://localhost:3002) dan mulai mengobrol. Tidak perlu API key atau konfigurasi tambahan — setup default menggunakan Claude Code sebagai AI backend dengan login Anda yang sudah ada, dan OpenTypeBB sebagai mesin data melalui mode in-process SDK.

> Untuk hot-reload frontend selama pengembangan, jalankan `pnpm dev:ui` (port 5173) di terminal terpisah.

## 3. Memverifikasi OpenTypeBB Aktif

OpenTypeBB adalah data backend **default**. Anda tidak perlu mengonfigurasi apa pun — ia sudah aktif.

Di balik layar, Lyramor membaca `data/config/market-data.json`. Jika file tersebut belum ada, ia akan fallback ke default berikut:

```json
{
  "enabled": true,
  "backend": "typebb-sdk",
  "providers": {
    "equity": "yfinance",
    "crypto": "yfinance",
    "currency": "yfinance"
  },
  "providerKeys": {},
  "apiServer": {
    "enabled": false,
    "port": 6901
  }
}
```

Pengaturan utama:

- **`backend: "typebb-sdk"`** — Ini adalah mode in-process. `QueryExecutor` milik OpenTypeBB berjalan langsung di dalam proses Node.js — tanpa HTTP, tanpa sidecar. Ini adalah default.
- **`backend: "openbb-api"`** — Beralih ke pengiriman HTTP request ke server API eksternal yang kompatibel dengan OpenBB. Kemungkinan besar Anda tidak menginginkan ini.
- **`providers`** — Provider data mana yang digunakan per asset class. `yfinance` langsung bekerja tanpa API key.

## 4. Data Provider yang Tersedia

OpenTypeBB hadir dengan 14 provider:

| Provider | Mencakup | API Key? |
|----------|--------|----------|
| **yfinance** | Equity, crypto, currency, news | Tidak |
| **fmp** | Fundamental equity, news, discovery | Wajib |
| **intrinio** | Data options | Wajib |
| **eia** | Energi (petroleum, gas alam, listrik) | Wajib |
| **econdb** | Data ekonomi global | Opsional (rate limit lebih tinggi) |
| **federal_reserve** | FRED, FOMC, payrolls, PCE, Michigan, dll. | Opsional (rate limit lebih tinggi) |
| **bls** | Data ketenagakerjaan Bureau of Labor Statistics | Opsional (rate limit lebih tinggi) |
| **deribit** | Derivatif crypto | Tidak |
| **cboe** | Data indeks | Tidak |
| **multpl** | Multiple S&P 500 (PE, earnings yield) | Tidak |
| **oecd** | GDP, indikator ekonomi | Tidak |
| **imf** | Perdagangan internasional, CPI, balance of payments | Tidak |
| **ecb** | Balance of payments Eropa | Tidak |
| **stub** | Test/placeholder | Tidak |

**Sebagian besar fitur bekerja tanpa API key** — `yfinance` mencakup kuotasi equity, harga crypto, kurs forex, dan berita perusahaan. `federal_reserve`, `bls`, dan `econdb` juga bekerja tanpa key namun dengan rate limit yang lebih ketat. Hanya `fmp`, `intrinio`, dan `eia` yang benar-benar mewajibkan key.

## 5. Menambahkan API Key (Opsional)

Untuk membuka provider tambahan (FMP, EIA, Intrinio, dll.), buat atau edit `data/config/market-data.json`:

```json
{
  "providerKeys": {
    "fmp": "your_fmp_api_key_here",
    "eia": "your_eia_api_key_here"
  }
}
```

Atau atur melalui Web UI: buka [http://localhost:3002](http://localhost:3002), pergi ke panel config, dan edit bagian OpenBB. Perubahan langsung berlaku — tidak perlu restart.

Nama key dipetakan ke field credential OpenBB secara otomatis:
`fmp` → `fmp_api_key`, `eia` → `eia_api_key`, `fred` → `fred_api_key`, dll.

## 6. Apa yang Bisa Anda Lakukan?

Setelah berjalan, Alice memiliki akses ke serangkaian tool market data yang kaya, ditenagai oleh OpenTypeBB:

### Market Search
Minta Alice mencari simbol apa pun di equity, crypto, dan forex:
> "Search for Tesla stock"
> "Find crypto pairs with SOL"

### Data Equity
- Kuotasi harga dan OHLCV historis
- Profil perusahaan dan laporan keuangan
- Estimasi analis dan kalender earnings
- Insider trading dan kepemilikan institusional
- Market movers (top gainers, losers, paling aktif)

### Crypto & Forex
- Data harga real-time
- OHLCV historis dengan interval yang dapat dikonfigurasi

### Analisis Teknikal
Kalkulator indikator bawaan dengan ekspresi formula:
> "Calculate RSI(14) for AAPL on the daily chart"
> "Show me the 50-day and 200-day SMA crossover for BTC/USD"

Menggunakan sintaks seperti `SMA(CLOSE('AAPL', '1d'), 50)`, `RSI(CLOSE('BTC/USD', '1d'), 14)`, dll.

### Economy & Makro
- Data GDP (OECD, IMF)
- Seri ekonomi FRED (suku bunga, inflasi, ketenagakerjaan)
- PCE, CPI, nonfarm payrolls, dokumen FOMC
- Sentimen konsumen University of Michigan
- Survei outlook manufaktur Fed

### Komoditas
- Data petroleum & gas alam EIA
- Harga spot komoditas

### News
- Berita spesifik per perusahaan
- Berita pasar dunia
- Pengumpulan RSS di latar belakang dengan arsip yang dapat dicari

## 7. Menjalankan OpenTypeBB sebagai Standalone HTTP Server

Jika Anda ingin menggunakan OpenTypeBB secara independen — misalnya, untuk menghubungkannya ke [OpenBB Workspace](https://pro.openbb.co) atau tool lain — Anda dapat menjalankannya sebagai standalone API server:

```bash
# From the repo root:
cd packages/opentypebb

# Set your API key (optional — yfinance works without one)
export FMP_API_KEY=your_key_here

# Run the server
npx tsx src/server.ts
```

Server akan berjalan pada port 6901 (dapat dikonfigurasi via `OPENTYPEBB_PORT`):
```
Built widgets.json with 88 widgets
OpenTypeBB listening on http://localhost:6901
```

### Endpoint API

Server mengekspos endpoint REST yang kompatibel dengan OpenBB:

```bash
# Health check
curl http://localhost:6901/api/v1/health

# Get a stock quote
curl "http://localhost:6901/api/v1/equity/price/quote?symbol=AAPL&provider=yfinance"

# Get historical data
curl "http://localhost:6901/api/v1/equity/price/historical?symbol=MSFT&provider=yfinance&start_date=2024-01-01"

# Get crypto price
curl "http://localhost:6901/api/v1/crypto/price/historical?symbol=BTC-USD&provider=yfinance"

# Get world news (requires FMP key)
curl "http://localhost:6901/api/v1/news/world?provider=fmp&limit=5"

# GDP data from OECD
curl "http://localhost:6901/api/v1/economy/gdp/nominal?provider=oecd&country=united_states"

# Pass credentials per-request
curl -H 'X-OpenBB-Credentials: {"fmp_api_key": "your_key"}' \
  "http://localhost:6901/api/v1/equity/fundamental/income?symbol=AAPL&provider=fmp"

# Discover available widgets (for OpenBB Workspace)
curl http://localhost:6901/widgets.json
```

### Mode Embedded Server

Anda juga dapat menjalankan API server tertanam (embedded) di dalam Lyramor (berdampingan dengan agent). Edit `data/config/market-data.json`:

```json
{
  "apiServer": {
    "enabled": true,
    "port": 6901
  }
}
```

Kemudian `pnpm dev` akan menjalankan baik Alice maupun OpenTypeBB HTTP API.

## 8. Menggunakan OpenTypeBB sebagai Library

Anda juga dapat meng-import OpenTypeBB secara langsung di proyek TypeScript Anda sendiri:

```typescript
import { createExecutor } from '@traderalice/opentypebb'

const executor = createExecutor()

// Get a stock quote (yfinance — no API key needed)
const quotes = await executor.execute('yfinance', 'EquityQuote', {
  symbol: 'AAPL',
}, {})

console.log(quotes)

// Get historical crypto data
const btcHistory = await executor.execute('yfinance', 'CryptoHistorical', {
  symbol: 'BTC-USD',
  start_date: '2024-01-01',
}, {})

// With an FMP API key
const income = await executor.execute('fmp', 'IncomeStatement', {
  symbol: 'AAPL',
  period: 'annual',
}, {
  fmp_api_key: 'your_key_here',
})
```

## 9. Sekilas Arsitektur

```
Lyramor
├── packages/opentypebb/          # The OpenTypeBB library
│   ├── src/
│   │   ├── index.ts              # Library entry point
│   │   ├── server.ts             # Standalone HTTP server
│   │   ├── core/                 # Registry, executor, router, REST API
│   │   ├── providers/            # 14 data providers (yfinance, fmp, oecd, ...)
│   │   └── extensions/           # 9 domain routers (equity, crypto, economy, ...)
│   └── package.json
│
├── src/openbb/
│   ├── sdk/                      # In-process SDK clients (equity, crypto, ...)
│   │   ├── executor.ts           # Singleton QueryExecutor
│   │   ├── base-client.ts        # Base class for SDK clients
│   │   └── *-client.ts           # Domain-specific SDK clients
│   ├── equity/                   # Equity data layer + SymbolIndex
│   ├── crypto/                   # Crypto data layer
│   ├── currency/                 # Currency/forex data layer
│   ├── commodity/                # Commodity data layer
│   ├── economy/                  # Economy data layer
│   ├── news/                     # News data layer
│   └── credential-map.ts         # Config key → OpenBB credential mapping
│
├── src/extension/
│   ├── analysis-kit/             # Technical indicator calculator
│   ├── equity/                   # Equity research tools
│   ├── market/                   # Unified symbol search
│   └── news/                     # News tools
│
└── data/config/market-data.json       # Runtime configuration
```

**Alur data (mode SDK):**
```
Alice asks for AAPL quote
  → ToolCenter dispatches to equity extension
    → SDKEquityClient.getQuote()
      → QueryExecutor.execute('yfinance', 'EquityQuote', { symbol: 'AAPL' })
        → YFinanceFetcher hits Yahoo Finance API
          → Returns structured data
```

Tanpa HTTP. Tanpa Python. Tanpa sidecar. Murni TypeScript dari hulu ke hilir.

---

## TL;DR

```bash
git clone https://github.com/TraderAlice/OpenAlice.git
cd OpenAlice
pnpm install && pnpm build
pnpm dev
# Open http://localhost:3002 and ask Alice about any stock, crypto, or macro data
```

Semuanya bekerja langsung tanpa konfigurasi. OpenTypeBB adalah data backend default, `yfinance` adalah provider default, dan keduanya tidak memerlukan API key. Tambahkan key ke `data/config/market-data.json` saat Anda ingin membuka lebih banyak provider.
