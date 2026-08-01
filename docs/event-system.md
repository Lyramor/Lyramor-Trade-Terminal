# Panduan Event System

Siklus hidup asinkron Alice berjalan di atas bus pub-sub yang divalidasi schema. Timer cron, gateway
connector, dan webhook eksternal melakukan emit Event; Listener bereaksi terhadapnya dan boleh
melakukan emit Event turunan. **Baca ini sebelum menambahkan tipe Event baru, Listener,
atau Producer** — sistem ini punya sedikit struktur yang mudah terlewat, dan melewatkan langkah
secara diam-diam tetap jalan di dev tapi rusak dengan cara yang halus (validasi hilang, tak
terlihat di graph Flow, pemalsuan lewat webhook, dll.).

Kalau tab Flow di `/automation` sedang aktif, itu referensi visual terbaik untuk
apa yang sudah ada.

## Tiga primitif

**Event type** — sebuah bentuk payload bernama yang divalidasi oleh schema. Dideklarasikan di satu
tempat: [AgentEvents](../src/core/agent-event.ts) (metadata + schema TypeBox +
opsional `external: true`). Turunannya, `AgentEventMap`, memberimu penyempitan tipe penuh berbasis
discriminated-union TS di mana pun kamu memegang `EventLogEntry`.

**Listener** — reaktif. Berlangganan ke satu atau lebih tipe Event (atau `'*'` untuk
semua), menjalankan handler, dan opsional melakukan emit Event lanjutan. Mengelola siklus hidupnya
sendiri; mendaftar ke [ListenerRegistry](../src/core/listener-registry.ts).
Contoh kanonis: [cron-router](../src/task/cron/listener.ts).

**Producer (Pumper)** — sumber Event murni. Hanya melakukan emit, tidak pernah berlangganan.
Dideklarasikan terhadap registry yang sama. Contoh kanonis: [cron-engine](../src/task/cron/engine.ts)
(timer), [webhook-ingest](../src/connectors/web/web-plugin.ts) (HTTP),
[connectors](../src/core/connector-center.ts) (dipakai bersama oleh setiap connector
plugin — Web chat, Telegram, Discord/Slack/dll. di masa depan, semuanya melakukan emit
`message.received` / `message.sent` lewat satu Producer `connectors` milik ConnectorCenter
alih-alih mendeklarasikan miliknya sendiri).

Listener dan Producer **berbagi satu namespace nama** — sebuah nama tidak bisa menjadi keduanya.
Registry menegakkan ini saat deklarasi.

## Model mental

```
            ┌─────────────┐
 Producers ─┤             │─ event-in  → Listener ─ event-out
  (timers,  │  EventLog   │
   HTTP,    │  (pub-sub)  │
   sockets) │             │
            └─────────────┘
```

- EventLog adalah bus-nya — JSONL append-only, disebar (fan-out) ke para subscriber.
- Setiap Event punya `seq` + `ts` yang monoton.
- `ctx.emit` milik Listener mengisi otomatis `causedBy = parentEntry.seq` — kamu dapat
  rantai kausal secara gratis. Producer tidak punya parent, jadi emit-nya tidak punya
  `causedBy` kecuali pemanggil memberikannya secara eksplisit.
- Wildcard (`subscribes: '*'` / `emits: '*'`) dirender sebagai halo berarah
  di tampilan Flow alih-alih N edge konkret. Validasi schema saat runtime
  tetap berlaku.
- Tampilan Flow di `/automation` menyembunyikan node Event pada sisi di mana ia tidak punya
  edge konkret — Event input murni hanya muncul di kiri, output terminal
  hanya di kanan. Wildcard dihitung sebagai aura, bukan edge konkret,
  untuk keputusan ini.

## Berkas referensi (tetap buka saat bekerja di area ini)

| Perihal | Berkas |
|---|---|
| Metadata + schema Event | [src/core/agent-event.ts](../src/core/agent-event.ts) |
| Grammar Listener (EventTypeSet, EmitSignature, ListenerContext) | [src/core/listener.ts](../src/core/listener.ts) |
| Tipe Producer | [src/core/producer.ts](../src/core/producer.ts) |
| Registry (register / declareProducer / start / stop) | [src/core/listener-registry.ts](../src/core/listener-registry.ts) |
| EventLog itu sendiri | [src/core/event-log.ts](../src/core/event-log.ts) |
| Listener referensi (subscribe → agent → emit done/error) | [src/task/task-router/listener.ts](../src/task/task-router/listener.ts) |
| Producer referensi (timer) | [src/task/cron/engine.ts](../src/task/cron/engine.ts) |
| Gerbang webhook ingest | [src/connectors/web/routes/events.ts](../src/connectors/web/routes/events.ts) + [webhook-auth.ts](../src/connectors/web/routes/webhook-auth.ts) |
| Visualisasi Flow | [ui/src/pages/AutomationFlowSection.tsx](../ui/src/pages/AutomationFlowSection.tsx) |
| UI dokumentasi webhook | [ui/src/pages/AutomationWebhookSection.tsx](../ui/src/pages/AutomationWebhookSection.tsx) |

## Resep: menambah tipe Event baru

1. **Interface payload** — tambahkan ke [agent-event.ts](../src/core/agent-event.ts)
   (bagian atas).
2. **AgentEventMap** — tambahkan baris `'name': YourPayload`.
3. **Schema TypeBox** — tambahkan `YourSchema = Type.Object({ ... })`.
4. **Metadata AgentEvents** — tambahkan entry dengan `schema`, opsional
   `external: true`, dan satu baris `description` (muncul di tooltip tab Flow
   dan di `/api/topology`).
5. **Tes** — tambahkan ke `expectedTypes` di [agent-event.spec.ts](../src/core/agent-event.spec.ts)
   dan tambahkan setidaknya satu kasus positif `validateEventPayload`.

Tidak ada hal lain yang diperlukan untuk Event yang murni internal — ia kini menjadi target valid
untuk `subscribes` atau `ctx.emit` Listener mana pun.

## Resep: menambah Listener baru

Salin pola task-router ([task-router/listener.ts](../src/task/task-router/listener.ts)):

```ts
const MY_EMITS = ['my.done', 'my.error'] as const  // `as const` is load-bearing — TS needs the literal tuple
type MyEmits = typeof MY_EMITS

export function createMyListener(opts: {
  registry: ListenerRegistry
  // ...other deps the handler needs
}): { listener: Listener<'my.trigger', MyEmits>; start(): Promise<void>; stop(): void } {
  const listener: Listener<'my.trigger', MyEmits> = {
    name: 'my-listener',
    subscribes: 'my.trigger',
    emits: MY_EMITS,
    async handle(entry, ctx) {
      // entry.payload is narrowed to MyTriggerPayload
      // ctx.emit only accepts 'my.done' | 'my.error', with matching payload types
      // causedBy auto-fills from entry.seq
      await ctx.emit('my.done', { ... })
    },
  }

  let registered = false
  return {
    listener,
    async start() { if (!registered) { opts.registry.register(listener); registered = true } },
    stop() { if (registered) { opts.registry.unregister(listener.name); registered = false } },
  }
}
```

Sambungkan di [main.ts](../src/main.ts): `const x = createMyListener({ registry: listenerRegistry, ... }); await x.start();`
**Urutan registrasi penting** — panggil `x.start()` **sebelum** `listenerRegistry.start()`,
atau daftarkan secara lazy setelahnya (registry menangani keduanya, tapi idiomnya adalah
register-lalu-start).

Tulis berkas spec yang mencerminkan [task-router/listener.spec.ts](../src/task/task-router/listener.spec.ts):
`EventLog` + `ListenerRegistry` asli, agentCenter / connectorCenter di-mock,
append Event yang dilanggan lalu pastikan Event turunan muncul.

### Contekan grammar subscribe / emit

| Bentuk | Arti | Render di Flow |
|---|---|---|
| `subscribes: 'cron.fire'` | Tipe tunggal | Edge konkret dari node kolom kiri |
| `subscribes: ['cron.fire', 'task.requested'] as const` | Tuple terenumerasi | N edge konkret |
| `subscribes: '*'` | Semua Event | Aura sisi kiri (tanpa edge) |
| `emits` dihilangkan | Tidak melakukan emit apa pun (ctx.emit tak dapat dipakai) | Tanpa edge sisi kanan |
| `emits: ['my.done', 'my.error'] as const` | Tuple terenumerasi | N edge konkret |
| `emits: '*'` | Tipe apa pun yang terdaftar | Aura sisi kanan |

## Resep: menambah Producer baru

Producer **bukan** objek yang mengimplementasikan sebuah interface — ia adalah sebuah
deklarasi yang mengembalikan sebuah handle. Integrasikan ke modul mana pun yang memiliki
trigger eksternal (timer, route HTTP, handler bot).

```ts
// In the module that owns the external source
const producer = listenerRegistry.declareProducer({
  name: 'my-source',
  emits: ['my.event'] as const,  // narrow declaration = concrete Flow edges
})

// Replace any direct eventLog.append with:
await producer.emit('my.event', { ... })

// Lifecycle
producer.dispose()  // call from the owning module's shutdown
```

**Kasus khusus: menambah plugin Connector baru.** Kalau kamu menyambungkan Connector
baru (Discord, Slack, IMAP, dll.), **jangan** mendeklarasikan Producer
`message.received` / `message.sent` milikmu sendiri. Pump itu dimiliki oleh
ConnectorCenter sebagai satu Producer `connectors` yang dipakai bersama — plugin-mu
memanggil `ctx.connectorCenter.emitMessageReceived(...)` /
`ctx.connectorCenter.emitMessageSent(...)` pada titik-titik di mana ia mengamati
pesan masuk / keluar. Field `channel` pada payload membawa
atribusi sumber (`'web'` / `'telegram'` / ...). Ini menjaga graph Flow
tetap bersih (satu node Producer, bukan satu per connector) dan berarti connector baru
tidak harus menemukan ulang wiring siklus hidup setiap kali.

Saat memilih `emits`:

- **Utamakan tuple yang sempit.** Producer wildcard dirender sebagai aura, yang
  menyembunyikan *apa yang sebenarnya ia produksi* dari graph Flow. Webhook-ingest adalah
  pengecualian yang disengaja karena bentuk sebenarnya adalah "apa pun yang ada di allowlist
  eksternal"; bahkan begitu, deklarasinya tetap dijaga sempit
  (`['task.requested'] as const`) dan diperluas secara manual ketika tipe eksternal baru
  muncul.
- **Validasi runtime tetap berjalan.** Emit wildcard menolak tipe yang tidak terdaftar;
  emit yang sempit menolak apa pun yang tidak ada di tuple yang dideklarasikan.

## Resep: membuka Event ke HTTP (trigger eksternal)

Inilah langkah yang paling mudah dikerjakan setengah-setengah. Empat tempat yang harus diedit:

1. **Metadata Event** — set `external: true` pada Event di [AgentEvents](../src/core/agent-event.ts).
2. **Producer webhook-ingest** — perluas tuple di [web-plugin.ts](../src/connectors/web/web-plugin.ts):
   ```ts
   this.ingestProducer = ctx.listenerRegistry.declareProducer({
     name: 'webhook-ingest',
     emits: ['task.requested', 'my.external.event'] as const,  // ← add
   })
   ```
3. **Deklarasi tipe route** — tuple yang cocok di [events.ts](../src/connectors/web/routes/events.ts):
   ```ts
   ingestProducer: ProducerHandle<readonly ['task.requested', 'my.external.event']>
   ```
4. **Dokumentasi admin** — tambahkan entry ke `EXTERNAL_DOCS` di
   [AutomationWebhookSection.tsx](../ui/src/pages/AutomationWebhookSection.tsx)
   dengan `summary`, `fields`, `example`, dan opsional `notes`. Tab Webhook
   merender ini secara otomatis untuk tipe apa pun yang dilaporkan API topology sebagai
   `external: true`; tanpa entry ia jatuh ke kartu minimal.

Auth, `isExternalEventType`, dan validasi schema sudah ditangani oleh
route `/api/events/ingest`. Setelah empat langkah di atas selesai, pemanggil
melakukan:

```bash
curl -X POST http://localhost:3002/api/events/ingest \
  -H 'Authorization: Bearer <token>' \
  -H 'Content-Type: application/json' \
  -d '{"type":"my.external.event","payload":{...}}'
```

Lihat juga: [konfigurasi auth webhook](../data/config/webhook.json) (di-seed kosong —
harus menambahkan token sebelum `/ingest` mau menerima apa pun; jika tidak, ia
menolak secara default dengan 503).

## Jebakan umum

- **Memanggil `eventLog.append` langsung dari kode baru.** Jalan saat runtime tapi
  Event muncul di graph Flow tanpa Producer — terlihat yatim
  dan tak terlihat oleh introspeksi. Deklarasikan Producer sebagai gantinya.
- **Lupa `as const` pada tuple emits.** Tanpanya, TS melebar ke
  `string[]` dan `ctx.emit` kehilangan batasan tipenya; kamu akan melihat error runtime
  alih-alih error kompilasi.
- **Tabrakan nama antara Listener dan Producer.** Registry melempar saat
  deklarasi dengan `"already registered as a listener"` /
  `"already registered as a producer"`. Pilih nama lain.
- **Lupa memperbarui `expectedTypes` di `agent-event.spec.ts`** — kamu akan
  mendapat satu tes gagal dengan diff yang jelas, tapi ini kelalaian yang umum.
- **Emit wildcard ≠ bypass.** `emits: '*'` tetap memvalidasi bahwa tipe ada
  di `AgentEvents` saat runtime. Melakukan emit tipe yang tidak terdaftar akan melempar.
- **Emit Producer tidak mengisi otomatis `causedBy`.** Producer tidak punya Event
  parent; kalau pemanggil ingin menyalurkan kausalitas, ia memberikannya secara eksplisit
  lewat `opts.causedBy`.
- **Membuka ke HTTP tanpa memperluas Producer webhook-ingest.** Gerbang
  route (`isExternalEventType`) akan lolos, tapi `ingestProducer.emit(type, ...)`
  yang bertype sempit akan melempar karena tipe tidak ada di
  tuple yang dideklarasikannya. TS tidak akan menangkap ini kecuali kamu juga memperbarui
  tipe `ingestProducer: ProducerHandle<...>` di `events.ts`.
- **`dispose()` bocor.** Producer yang di-dispose saat modul shutdown membebaskan
  namanya di registry. Melupakannya berarti init berikutnya gagal dengan
  tabrakan — kebanyakan hanya terlihat di test suite yang menyalakan/mematikan.

## Debugging / observabilitas

- **Tab Flow** di `/automation` — graph langsung. Berdenyut saat Event terpicu.
- **`GET /api/topology`** — JSON mentah berisi tipe Event + listener + producer.
  Berguna saat graph Flow terlihat salah: pastikan registry benar-benar tahu
  tentang hal baru milikmu.
- **`GET /api/events/stream`** — SSE setiap Event, mentah.
- **`GET /api/events/recent?type=foo&limit=N`** — ring-buffer di memori.
- **Listener `event-metrics`** — listener wildcard yang melacak hitungan per-tipe +
  timestamp last-seen; lihat [src/task/metrics/](../src/task/metrics/).
