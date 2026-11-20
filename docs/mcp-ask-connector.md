# MCP Ask Connector

Agent eksternal dapat berkomunikasi dengan Alice melalui MCP server khusus, tanpa mereduksi Alice menjadi sekadar penyedia tool pasif.

## Filosofi Desain

1. **Alice tetap otonom** — Agent eksternal berbicara *kepada* Alice, bukan *melalui* dirinya. Alice mempertahankan penalaran, memori, dan pengambilan keputusannya sendiri. Pemanggil adalah mitra percakapan lain, bukan dalang yang mengendalikan.
2. **Terisolasi dari tool MCP** — Connector Ask berjalan pada port terpisah dari MCP server utama (yang mengekspos tool internal). Hal ini mencegah pemanggilan melingkar: AI provider milik Alice tidak pernah menemukan tool ini karena tool tersebut tidak terdaftar di ToolCenter.
3. **Pemanggil memiliki identitas session, Alice memiliki penyimpanan** — Pemanggil menentukan session mana yang digunakan dan kapan memulai yang baru. Alice menyimpan riwayat percakapan, menangani kompaksi (compaction), dan menjaga konteks antar giliran.
4. **Pola connector** — Connector Ask adalah connector kelas satu, identik secara arsitektur dengan Telegram dan Web. Ia mendaftar ke ConnectorRegistry, mencatat interaksi melalui `touchInteraction()`, dan ikut serta dalam routing pengiriman.

## Arsitektur

```
External Agent
    │
    │  MCP protocol (Streamable HTTP)
    │  Port: askMcpPort (e.g. 3003)
    ▼
┌──────────────────────┐
│  MCP Ask Connector   │  ← Separate from main MCP server
│                      │
│  Tools:              │
│  - askWithSession    │  → engine.askWithSession()
│  - listSessions      │  → glob session files
│  - getSessionHistory │  → session.readActive()
└──────────┬───────────┘
           │
           ▼
┌──────────────────────┐
│  Engine / AgentCenter │  ← Same AI pipeline as Telegram/Web
│  ProviderRouter       │
│  Session Store        │
└──────────────────────┘
```

**Pemisahan dari MCP utama:**

| Server | Port | Tujuan | Terdaftar di ToolCenter? |
|--------|------|---------|---------------------------|
| Main MCP (`McpPlugin`) | `mcpPort` | Mengekspos tool internal (trading, analysis, market) | Ya |
| Ask MCP (`McpAskPlugin`) | `askMcpPort` | Mengekspos kemampuan percakapan | Tidak |

Karena tool Ask tidak ada di ToolCenter, AI provider milik Alice (Vercel AI SDK atau Claude Code) tidak dapat melihatnya. Ini secara struktural mencegah pemanggilan melingkar.

## Tools

### `askWithSession`

Mengirim pesan ke Alice dan menerima respons dalam session yang persisten.

**Parameter:**

| Nama | Tipe | Wajib | Deskripsi |
|------|------|----------|-------------|
| `message` | string | ya | Pesan yang dikirim ke Alice |
| `sessionId` | string | ya | Pengenal session, dikelola oleh pemanggil |

**Mengembalikan:**

```json
{
  "text": "Alice's response...",
  "sessionId": "the-session-id"
}
```

**Perilaku:**
- Membuat session baru saat sebuah `sessionId` pertama kali digunakan, melanjutkan pada panggilan berikutnya
- Mengalirkan melalui `engine.askWithSession()` — pipeline yang sama dengan yang digunakan oleh Telegram dan Web
- Riwayat session disimpan sebagai JSONL di `data/sessions/mcp-ask__{sessionId}.jsonl`
- Kompaksi otomatis diterapkan saat konteks membesar

### `listSessions`

Menampilkan daftar semua session yang dibuat melalui connector Ask.

**Parameter:** tidak ada

**Mengembalikan:**

```json
{
  "sessions": [
    { "sessionId": "trading-analysis" },
    { "sessionId": "portfolio-review" }
  ]
}
```

### `getSessionHistory`

Membaca riwayat percakapan untuk session tertentu.

**Parameter:**

| Nama | Tipe | Wajib | Deskripsi |
|------|------|----------|-------------|
| `sessionId` | string | ya | Pengenal session |
| `limit` | number | tidak | Jumlah maksimum pesan yang dikembalikan (default: 50) |

**Mengembalikan:**

```json
{
  "messages": [
    { "role": "user", "text": "What's the current BTC outlook?" },
    { "role": "assistant", "text": "Based on recent analysis..." }
  ]
}
```

## Konfigurasi

Aktifkan dan tetapkan port di `data/config/connectors.json`:

```json
{
  "mcpAsk": {
    "enabled": true,
    "port": 3003
  }
}
```

Saat `enabled` bernilai `false` atau `port` dihilangkan, connector Ask tidak dijalankan. Anda juga dapat mengaktifkannya melalui Web UI di bawah menu **Connectors**.

## Manajemen Session

Session dikelola oleh pemanggil (identitas) dan dikelola oleh Alice (penyimpanan):

- **Pemanggil menyediakan `sessionId`** — Bisa berupa string apa pun. Gunakan nama yang bermakna (mis. `"daily-review"`, `"risk-check"`) atau UUID yang dibangkitkan.
- **Alice menyimpan ke disk** — Setiap session adalah file JSONL di `data/sessions/mcp-ask__{sessionId}.jsonl`, mengikuti format yang sama dengan session Telegram dan Web.
- **Kompaksi diterapkan** — Session yang panjang secara otomatis dipadatkan (diringkas) agar tetap berada dalam batas konteks.
- **Tanpa kedaluwarsa** — Session bertahan tanpa batas waktu. Pemanggil yang menentukan kapan memulai dari awal dengan menggunakan `sessionId` baru.

## Inventaris File

```
src/
  connectors/
    mcp-ask/
      mcp-ask-plugin.ts    # MCP server, tool registration, session management
      index.ts              # Public export
data/
  sessions/
    mcp-ask__*.jsonl        # Per-session conversation history
```

## Contoh: Integrasi Agent Eksternal

Agent orkestrasi dapat menggunakan connector Ask untuk mendelegasikan keputusan trading kepada Alice:

```
User → Orchestrator: "Should I buy more ETH?"
         │
         │  askWithSession({ message: "The user is asking about ETH. Current price is $3,200. What's your view?", sessionId: "user-123" })
         ▼
       Alice: "Based on the 4h RSI at 42 and declining volume, I'd wait for a pullback to $3,050 support..."
         │
         ▼
Orchestrator → User: "Alice suggests waiting for $3,050 support before adding. RSI is at 42 with declining volume."
```

Alice memproses pertanyaan menggunakan seluruh perangkat toolnya (market data, indikator, konteks posisi, memori) dan merespons sebagai agent otonom — bukan sebagai fungsi yang mengembalikan nilai.
