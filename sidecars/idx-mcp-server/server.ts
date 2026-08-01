/**
 * MCP server untuk data saham BEI (IDX), dibaca Lyramor/OpenAlice lewat SSE.
 *
 * Sumber data: database SQLite milik IDX-API (NeaByteLab), dibuka READ-ONLY.
 * Isi database-nya diperbarui terpisah (lihat ~/idx-api/SyncMcp.ts) — server ini
 * tidak pernah menulis dan tidak pernah memanggil jaringan IDX sendiri.
 *
 * CATATAN PENTING soal skema: nama kolom di SQLite adalah snake_case
 * (`foreign_buy`, `sub_sector`, `book_value`), BUKAN camelCase seperti nama
 * properti drizzle. Query di bawah memakai nama SQL yang asli lalu meng-alias-kan
 * ke camelCase untuk output. Menyalin camelCase langsung ke SQL = "no such column".
 */
import express from 'express'
import Database from 'better-sqlite3'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { SSEServerTransport } from '@modelcontextprotocol/sdk/server/sse.js'
import { z } from 'zod'
import { homedir } from 'node:os'
import { existsSync } from 'node:fs'
import { join } from 'node:path'

const IDX_DB = process.env.IDX_DB_PATH ?? join(homedir(), 'idx-api', 'data', 'database.sqlite')
const PORT = Number(process.env.PORT ?? 4002)

if (!existsSync(IDX_DB)) {
  console.error(`[ERROR] Database tidak ditemukan: ${IDX_DB}`)
  console.error(`Jalankan dulu: cd ~/idx-api && deno task db:sync && deno run -A SyncMcp.ts`)
  process.exit(1)
}

const db = new Database(IDX_DB, { readonly: true, fileMustExist: true })
const app = express()

/** `date`/`period` disimpan sebagai epoch MILIDETIK — ubah agar terbaca model. */
function isoDate(ms: unknown): string | null {
  if (typeof ms !== 'number' || !Number.isFinite(ms)) return null
  const d = new Date(ms)
  return Number.isNaN(d.getTime()) ? null : d.toISOString().slice(0, 10)
}

/** Ganti field epoch jadi tanggal ISO di setiap baris hasil query. */
function humanizeDates<T extends Record<string, unknown>>(rows: T[], fields: string[]): T[] {
  return rows.map((row) => {
    const out: Record<string, unknown> = { ...row }
    for (const f of fields) {
      if (f in out) out[f] = isoDate(out[f]) ?? out[f]
    }
    return out as T
  })
}

const text = (s: string) => ({ content: [{ type: 'text' as const, text: s }] })
const json = (v: unknown) => text(JSON.stringify(v, null, 2))

/** Baris nol bukan error — bedakan "tidak ada emiten itu" dari "DB belum di-sync". */
function emptyHint(what: string): string {
  const n = (db.prepare('SELECT COUNT(*) AS n FROM stock_summary').get() as { n: number }).n
  if (n === 0) {
    return `Tidak ada data untuk ${what}. Database IDX masih KOSONG — jalankan: cd ~/idx-api && deno run -A SyncMcp.ts`
  }
  return `Tidak ada data untuk ${what}.`
}

function buildMcpServer(): McpServer {
  const server = new McpServer({ name: 'idx-market-data', version: '1.0.0' })

  server.tool(
    'get_stock',
    'Ambil data saham BEI terbaru: harga OHLC, volume, dan aliran dana asing.',
    { ticker: z.string().describe('Kode saham BEI, contoh: BBCA, BBRI, TLKM, GOTO') },
    async ({ ticker }) => {
      const row = db.prepare(`
        SELECT code, name, date, open, high, low, close, previous, change,
               volume, value, frequency,
               foreign_buy AS foreignBuy, foreign_sell AS foreignSell, foreign_net AS foreignNet
        FROM stock_summary WHERE code = ? ORDER BY date DESC LIMIT 1
      `).get(ticker.toUpperCase()) as Record<string, unknown> | undefined
      if (!row) return text(emptyHint(`saham ${ticker}`) + ' Coba search_stocks untuk cari kodenya.')
      return json(humanizeDates([row], ['date'])[0])
    },
  )

  server.tool(
    'get_stock_history',
    'Riwayat harga OHLC harian sebuah saham BEI — untuk analisis tren, support, dan resistance.',
    {
      ticker: z.string().describe('Kode saham BEI'),
      days: z.number().int().min(1).max(365).default(30).describe('Jumlah hari perdagangan ke belakang'),
    },
    async ({ ticker, days }) => {
      const rows = db.prepare(`
        SELECT date, open, high, low, close, volume, change
        FROM stock_summary WHERE code = ? ORDER BY date DESC LIMIT ?
      `).all(ticker.toUpperCase(), days) as Record<string, unknown>[]
      if (!rows.length) return text(emptyHint(`riwayat harga ${ticker}`))
      return json(humanizeDates(rows, ['date']))
    },
  )

  server.tool(
    'get_financial_ratio',
    'Data fundamental saham BEI: PER, PBV, ROE, ROA, DER, NPM, EPS, book value, aset, dan laba.',
    { ticker: z.string().describe('Kode saham BEI') },
    async ({ ticker }) => {
      const row = db.prepare(`
        SELECT code, name, sector, sub_sector AS subSector, industry, period,
               per, pbv, der, roa, roe, npm, eps, book_value AS bookValue,
               assets, liabilities, equity, sales, profit, ebt
        FROM financial_ratio WHERE code = ? ORDER BY period DESC LIMIT 1
      `).get(ticker.toUpperCase()) as Record<string, unknown> | undefined
      if (!row) return text(`Data fundamental ${ticker} tidak tersedia.`)
      return json(humanizeDates([row], ['period'])[0])
    },
  )

  server.tool(
    'get_top_gainers',
    '20 saham BEI dengan kenaikan harga terbesar pada periode terakhir yang tersedia.',
    {},
    async () => {
      const rows = db.prepare(`
        SELECT code, name, previous, close, change, percentage, period
        FROM top_gainer ORDER BY period DESC, percentage DESC LIMIT 20
      `).all() as Record<string, unknown>[]
      if (!rows.length) return text(emptyHint('top gainers'))
      return json(humanizeDates(rows, ['period']))
    },
  )

  server.tool(
    'get_top_losers',
    '20 saham BEI dengan penurunan harga terbesar pada periode terakhir yang tersedia.',
    {},
    async () => {
      const rows = db.prepare(`
        SELECT code, name, previous, close, change, percentage, period
        FROM top_loser ORDER BY period DESC, percentage ASC LIMIT 20
      `).all() as Record<string, unknown>[]
      if (!rows.length) return text(emptyHint('top losers'))
      return json(humanizeDates(rows, ['period']))
    },
  )

  server.tool(
    'search_stocks',
    'Cari saham BEI berdasarkan kode atau nama perusahaan.',
    { query: z.string().describe('Kata kunci, contoh: bank, BBCA, Telkom, Astra') },
    async ({ query }) => {
      const q = `%${query.toUpperCase()}%`
      const rows = db.prepare(`
        SELECT code, name FROM company_profile
        WHERE UPPER(code) LIKE ? OR UPPER(name) LIKE ? ORDER BY code LIMIT 20
      `).all(q, q) as Record<string, unknown>[]
      if (!rows.length) return text(`Tidak ada saham yang cocok dengan "${query}".`)
      return json(rows)
    },
  )

  server.tool(
    'get_foreign_flow',
    'Aktivitas beli/jual investor asing pada sebuah saham BEI (30 hari perdagangan terakhir).',
    { ticker: z.string().describe('Kode saham BEI') },
    async ({ ticker }) => {
      const rows = db.prepare(`
        SELECT date, close,
               foreign_buy AS foreignBuy, foreign_sell AS foreignSell, foreign_net AS foreignNet
        FROM stock_summary WHERE code = ? ORDER BY date DESC LIMIT 30
      `).all(ticker.toUpperCase()) as Record<string, unknown>[]
      if (!rows.length) return text(emptyHint(`foreign flow ${ticker}`))
      return json(humanizeDates(rows, ['date']))
    },
  )

  server.tool(
    'get_index',
    'Performa indeks BEI terkini: IHSG, LQ45, IDX30, dan indeks lainnya.',
    {},
    async () => {
      // index_list TIDAK punya kolom `period` — ia snapshot terkini, satu baris
      // per indeks (primary key `code`). ORDER BY period di sini = error SQL.
      const rows = db.prepare(`
        SELECT code, close, change, percent, current FROM index_list ORDER BY code LIMIT 50
      `).all() as Record<string, unknown>[]
      if (!rows.length) return text(emptyHint('indeks BEI'))
      return json(rows)
    },
  )

  return server
}

// SSE: satu transport per koneksi, disimpan agar POST /message bisa menemukannya.
const transports = new Map<string, SSEServerTransport>()

app.get('/sse', async (_req, res) => {
  const transport = new SSEServerTransport('/message', res)
  transports.set(transport.sessionId, transport)
  res.on('close', () => transports.delete(transport.sessionId))
  const server = buildMcpServer()
  await server.connect(transport)
})

app.post('/message', async (req, res) => {
  const sessionId = req.query.sessionId as string
  const transport = transports.get(sessionId)
  if (!transport) {
    res.status(404).json({ error: 'Session not found' })
    return
  }
  // JANGAN pasang express.json() di sini: handlePostMessage membaca raw stream
  // sendiri, dan body yang sudah ter-parse akan membuatnya menggantung.
  await transport.handlePostMessage(req, res)
})

app.get('/health', (_req, res) => {
  const count = (t: string) =>
    (db.prepare(`SELECT COUNT(*) AS n FROM ${t}`).get() as { n: number }).n
  res.json({
    status: 'ok',
    db: IDX_DB,
    port: PORT,
    tools: 8,
    // Baris per tabel: pembeda antara "server hidup" dan "server hidup TAPI
    // database masih kosong" — kegagalan paling mungkin di setup ini.
    rows: {
      stock_summary: count('stock_summary'),
      company_profile: count('company_profile'),
      financial_ratio: count('financial_ratio'),
      top_gainer: count('top_gainer'),
      top_loser: count('top_loser'),
      index_list: count('index_list'),
    },
  })
})

app.listen(PORT, () => {
  console.log(`IDX MCP Server jalan di port ${PORT}`)
  console.log(`Database  : ${IDX_DB}`)
  console.log(`Health    : http://localhost:${PORT}/health`)
  console.log(`MCP (SSE) : http://localhost:${PORT}/sse`)
})
