# Struktur Proyek

Lyramor adalah monorepo pnpm dengan orkestrasi build Turborepo.

```
packages/
├── ibkr/                      # @traderalice/ibkr — port TypeScript dari IBKR TWS API
└── opentypebb/                # @traderalice/opentypebb — port TS dari platform OpenBB
ui/                            # Frontend React (Vite, 13 halaman)
src/
├── main.ts                    # Composition root — merangkai semuanya menjadi satu
├── core/
│   ├── agent-center.ts        # Orkestrasi AI level atas, memiliki ProviderRouter
│   ├── ai-provider-manager.ts # GenerateRouter + StreamableResult + AskOptions
│   ├── tool-center.ts         # Registry tool terpusat (ekspor Vercel + MCP)
│   ├── mcp-export.ts          # Layer ekspor MCP bersama dengan coercion tipe
│   ├── session.ts             # Session store JSONL + konverter format
│   ├── compaction.ts          # Meringkas otomatis context window yang panjang
│   ├── config.ts              # Loader config tervalidasi Zod
│   ├── event-log.ts           # Event log JSONL append-only
│   ├── connector-center.ts    # ConnectorCenter — pengiriman push + pelacakan last-interacted
│   ├── async-channel.ts       # AsyncChannel untuk streaming event provider ke SSE
│   ├── tool-call-log.ts       # Logging pemanggilan tool
│   ├── media.ts               # Ekstraksi MediaAttachment
│   ├── media-store.ts         # Persistensi file media
│   └── types.ts               # Interface Plugin, EngineContext
├── ai-providers/
│   ├── vercel-ai-sdk/         # Wrapper ToolLoopAgent dari Vercel AI SDK
│   ├── agent-sdk/             # Backend Claude (@anthropic-ai/claude-agent-sdk, OAuth + API key)
│   └── mock/                  # Provider mock (testing)
├── domain/
│   ├── trading/               # Trading multi-account terpadu, guard pipeline, commit ala git
│   │   ├── account-manager.ts # Lifecycle UTA (init, reconnect, enable/disable) + registry
│   │   ├── git-persistence.ts # Load/save git state
│   │   ├── brokers/
│   │   │   ├── registry.ts    # Registrasi mandiri broker (configSchema + configFields + fromConfig)
│   │   │   ├── alpaca/        # Alpaca (ekuitas US)
│   │   │   ├── ccxt/          # CCXT (100+ exchange crypto)
│   │   │   ├── ibkr/          # Interactive Brokers (TWS/Gateway)
│   │   │   └── mock/          # Broker test in-memory
│   │   ├── git/               # Engine Trading-as-Git (stage → commit → push)
│   │   ├── guards/            # Pemeriksaan keamanan pra-eksekusi (ukuran posisi, cooldown, whitelist)
│   │   └── snapshot/          # Penangkapan state account periodik + event-driven, equity curve
│   ├── market-data/           # Layer data terstruktur (opentypebb in-process + OpenBB API remote)
│   │   ├── equity/            # Data ekuitas + SymbolIndex (cache lokal SEC/TMX)
│   │   ├── crypto/            # Layer data crypto
│   │   ├── currency/          # Layer data currency/forex
│   │   ├── commodity/         # Layer data komoditas (EIA, harga spot)
│   │   ├── economy/           # Layer data makro ekonomi
│   │   └── client/            # Klien backend data (opentypebb SDK, openbb-api)
│   ├── analysis/              # Indikator, analisis teknikal
│   ├── news/                  # Kolektor RSS + pencarian arsip
│   ├── brain/                 # State kognitif (memori, emosi)
│   └── thinking/              # Evaluator ekspresi yang aman
├── tool/                      # Definisi tool AI — jembatan tipis dari domain ke ToolCenter
│   ├── trading.ts             # Tool trading (mendelegasikan ke domain/trading)
│   ├── equity.ts              # Tool fundamental ekuitas
│   ├── market.ts              # Tool pencarian simbol
│   ├── analysis.ts            # Tool perhitungan indikator
│   ├── news.ts                # Tool arsip berita
│   ├── thinking.ts            # Tool penalaran
│   └── session.ts             # Tool kesadaran session
├── server/
│   ├── mcp.ts                 # Server protokol MCP
│   └── opentypebb.ts          # HTTP API kompatibel OpenBB tertanam (opsional)
├── connectors/
│   ├── web/                   # Web UI (Hono, streaming SSE, sub-channel)
│   ├── telegram/              # Bot Telegram (grammY, autentikasi magic link, panel /trading)
│   ├── mcp-ask/               # Konektor MCP Ask (percakapan agent eksternal)
│   └── mock/                  # Konektor mock (testing)
└── task/
    ├── cron/                  # Penjadwalan cron (engine, listener, tool AI)
    └── heartbeat/             # Heartbeat periodik dengan protokol respons terstruktur
data/
├── config/                    # File konfigurasi JSON
├── sessions/                  # Riwayat percakapan JSONL (web/, telegram/, cron/)
├── brain/                     # Prompt override persona + heartbeat oleh user
├── cache/                     # Cache respons API
├── trading/                   # Riwayat commit trading + snapshot (per-account)
├── news-collector/            # Arsip berita persisten (JSONL)
├── cron/                      # Definisi cron job (jobs.json)
├── event-log/                 # Event log persisten (events.jsonl)
├── tool-calls/                # Log pemanggilan tool
└── media/                     # Lampiran yang diunggah
default/                       # Default pabrik (persona, heartbeat, skills)
docs/                          # Dokumentasi
```
