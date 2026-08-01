# IDX MCP Server (data saham BEI)

Sidecar MCP kecil yang menyajikan **8 tool data saham Bursa Efek Indonesia (BEI)**
lewat SSE di port **4002**, supaya sesi agent (Claude Code, dll.) di dalam Lyramor
bisa membaca harga, fundamental, aliran dana asing, top gainer/loser, dan indeks
BEI.

Server ini **read-only**: ia hanya membaca database SQLite milik **IDX-API
([NeaByteLab](https://github.com/NeaByteLab))** — ia tidak pernah menulis dan
tidak pernah memanggil jaringan IDX sendiri.

## Prasyarat: sumber data (IDX-API)

Sidecar ini butuh file SQLite yang diisi oleh proyek IDX-API (terpisah, di luar
repo Lyramor). Secara default server mencari database di:

```
~/idx-api/data/database.sqlite
```

Siapkan datanya lewat IDX-API (`deno task db:sync` lalu `deno run -A SyncMcp.ts`),
atau arahkan ke lokasi lain via env `IDX_DB_PATH`.

## Menjalankan

```bash
cd sidecars/idx-mcp-server
npm install          # (better-sqlite3 butuh build native — pastikan toolchain ada)
npm start            # jalan di http://localhost:4002/sse
```

Cek kesehatan + jumlah baris per tabel: `http://localhost:4002/health`.

## Konfigurasi (env)

| Env | Default | Fungsi |
|-----|---------|--------|
| `IDX_DB_PATH` | `~/idx-api/data/database.sqlite` | Lokasi file SQLite IDX-API |
| `PORT` | `4002` | Port SSE |

## Mendaftarkan ke Claude Code

Daftarkan sebagai MCP server di scope USER (`~/.claude.json`) supaya setiap sesi
`claude` — termasuk yang jalan di dalam workspace Lyramor — melihat tool-nya.
Endpoint SSE: `http://localhost:4002/sse`.

## Tool yang tersedia

`get_stock`, `get_stock_history`, `get_financial_ratio`, `get_top_gainers`,
`get_top_losers`, `search_stocks`, `get_foreign_flow`, `get_index`.
