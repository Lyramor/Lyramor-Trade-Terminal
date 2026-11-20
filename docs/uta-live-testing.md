# UTA Live Testing — katalog scenario yang di-bootstrap sendiri

Panduan ini ada karena lima ronde dogfood (2026-06-12) memunculkan ~20 bug
nyata yang **tidak akan pernah tertangkap oleh unit test maupun sesi UI
manual** — bug-bug ini hanya muncul di jalur pemakaian nyata, lewat agent
surface, terhadap perilaku venue yang sesungguhnya. Contoh spesiesnya:
contract search yang mengembalikan "not tradeable" palsu (akibat drift bentuk
SDK), TP/SL terlampir yang ditampilkan oleh ledger tetapi tidak pernah
diterima exchange, order id 19 digit yang diam-diam terpotong oleh float
sehingga setiap cancel-by-id berikutnya meleset, serta `getOrders` yang crash
hanya pada jalur split-process.

**Metodenya**: sebuah sesi AI menelusuri workflow trading NYATA secara
end-to-end pada demo account, eksklusif melalui agent surface (`alice-uta`
CLI), memperbaiki apa pun yang ia temui dan menambahkan satu regression spec
per perbaikan. Jalankan setelah perubahan apa pun pada trading path, dan
sebagai acceptance gate untuk integrasi broker baru.

## Aturan dasar

- **Hanya demo/paper account.** Verifikasi `mode` pada konfigurasi account
  sebelum mulai. Tidak pernah pakai dana riil.
- **Hanya agent surface** — jalankan semuanya lewat `alice-uta` (dan `alice`
  untuk data pra-trade). HTTP routes dan UI diuji oleh manusia; jalur CLI/
  tool inilah tempat bug khusus-agent bersembunyi. Pengecualian: `wallet/push`
  lewat HTTP menggantikan "user menekan approve" (push di level tool sengaja
  menolak — tembok itu adalah fitur, jangan diakali lewat tools).
- **Jangan pernah mempercayai ledger di atas venue.** Setelah order apa pun
  yang penting (terutama yang bersifat conditional), verifikasi di sisi
  exchange — sebuah probe script via `createBroker()` + raw ccxt call adalah
  sah (dan sekaligus berperan sebagai "external actor" untuk observation
  test). Bug TP/SL-yang-tak-pernah-ada tampak sempurna di git.
- **ccxt adalah SDK, bukan semantic layer.** Call yang identik berperilaku
  berbeda per venue (listing open-order bybit yang tak ber-scope diam-diam
  menyembunyikan spot; okx menolak `reduceOnly` pada spot; conditional order
  berada di namespace API terpisah). Apa pun yang bekerja di satu venue masih
  UNVERIFIED di venue berikutnya sampai diuji di sana.
- **Tinggalkan account dalam keadaan flat.** Jual kembali fill, batalkan
  hanger, `git reject` staging yang tersesat. Akhiri dengan: 0 open order per
  account, `git status` bersih, kuantitas posisi kembali ke baseline pra-sesi.
- **Price band**: venue menolak limit yang terlalu jauh dari market (okx
  51138/…, bybit 170193/170194). Untuk order yang marketable gunakan quote
  ±0.3%; untuk hanger gunakan harga dalam yang masih diizinkan band (~15-30%
  jauhnya berhasil pada demo okx/bybit). Re-quote tepat sebelum push — band
  bergerak mengikuti market.
- Setiap bug yang ditemukan: perbaiki di tempat jika dalam scope, jika tidak
  ke Linear (`TODO from AI Code`). Setiap perbaikan mendapat satu regression
  spec sebelum ronde dilanjutkan.

## Setup

```bash
export OPENALICE_MCP_URL=http://127.0.0.1:47332/mcp
export AQ_WS_ID=<any live workspace id>     # from ~/.openalice/workspaces/workspaces.json
BIN=src/workspaces/cli/bin/alice-uta
node $BIN                                    # discover groups/verbs
node $BIN order place --help                 # flags come from the manifest
# "user approves": curl -s -X POST http://127.0.0.1:47333/api/trading/uta/<id>/wallet/push
```

Probe script (external order, pengecekan venue mentah) hidup sebagai file
`.mts` sekali pakai di bawah `data/` (gitignored), dijalankan dengan
`NODE_OPTIONS='--conditions=openalice-source' npx tsx data/<file>.mts`,
mengimpor `readUTAsConfig` + `createBroker` lewat path absolut/relatif. Hapus
setelah dipakai.

## Katalog scenario

Jalankan S1–S12 untuk perubahan pada trading path; jalankan SEMUANYA per venue
untuk integrasi broker baru. Setiap scenario menyebut kelas bug yang ia jaga.

**S1 — Read-state agreement.** `account info`, `account portfolio`,
`/equity`: unrealizedPnL di level account harus sama dengan jumlah posisi;
baris portfolio harus membawa `secType` + `aliceId` (spot vs perp dengan
symbol yang sama harus dapat dibedakan DAN dapat ditindaklanjuti). *Menjaga:
drift agregasi PnL, baris yang ambigu.*

**S2 — Simple lifecycle.** Limit yang marketable (quote×1.003) → fill muncul
sebagai commit `[sync]` dalam ~15 detik dengan execution price+qty → `order
trades` menampilkannya → jual kembali. *Menjaga: fill-awareness, kehilangan
execution data.*

**S3 — Hanger stability.** Limit order dalam, biarkan ≥3 lintasan poller
(~40 detik): harus tetap `Submitted`, tanpa transisi semu, tanpa ledakan biaya
per lintasan (mode listing) → cancel, verifikasi `cancelled` tercatat.
*Menjaga: false positive absence-as-terminal, churn poller.*

**S4 — Amendment.** Hanger → `order modify` (price DAN qty) → `order list`
harus menampilkan nilai baru dengan orderId string presisi-penuh yang SAMA →
cancel. *Menjaga: kuirk editOrder per venue, pemotongan id.*

**S5 — Attached TP/SL.** `order place … --takeProfit '{"price":…}'
--stopLoss '{"price":…}'`. Pada venue ccxt TANPA override `placeOrderWithTpSl`
yang terverifikasi, ini harus MENOLAK secara lantang (jangan pernah memasang
naked entry). Pada venue yang terverifikasi: setelah fill, pastikan KEDUA leg
protektif ada di exchange — termasuk namespace trigger/algo — sebelum
menyebutnya bekerja. Pada venue native-bracket (Alpaca): hasil push harus
membawa id `legs`, dan setelah entry terisi `order list` harus menampilkan
KEDUA leg sebagai order yang ter-track. Leg SL yang ditahan tidak pernah muncul
di listing open-order venue (Alpaca menahannya selagi TP bekerja) — saat
place adalah SATU-SATUNYA momen Alice bisa tahu leg itu ada, jadi diff listing
venue TIDAK dapat memulihkan leg yang terlewat. *Menjaga: kegagalan posisi
tak-terlindungi yang senyap (okx, ledger berbohong terlindungi) dan
cerminannya, naked ledger (alpaca, ledger buta terhadap perlindungan nyata) —
keduanya fatal bagi "percaya pada log".*

**S6 — Standalone stop.** `STP` dengan trigger jauh → diterima → ter-track
sebagai `submitted` lintas lintasan meski algo order tak terlihat oleh listing
biasa (absence-confirm harus menemukannya lewat fallback `{stop:true}`, BUKAN
salah men-terminal-kannya) → cancel lewat Alice. *Menjaga: pemetaan tipe
conditional order, tracking algo-namespace.*

**S7 — External order observation.** Pasang order via probe script broker
langsung (git tak pernah melihatnya) → commit `[observed]` dalam cadence
observasi (`trading.json observeExternalOrdersEvery`; turunkan ke `1m` untuk
test via `PUT /api/config/trading`, kembalikan setelahnya) → pending takeover →
cancel lewat Alice. *Menjaga: lubang naratif, kebutaan namespace listing
(pelajaran defaultType bybit).*

**S8 — Restart survival.** Dengan sebuah hanger pending: restart UTA (`touch
services/uta/src/main.ts` di bawah tsx watch) → setelah recovery order masih
ter-track, dapat di-sync dan di-cancel (localSymbol yang dipersist harus
membangun ulang cache id→symbol broker). *Menjaga: ketergantungan pada cache
in-memory.*

**S9 — Partial close.** `position close --qty <half>` pada posisi SPOT (harus
TIDAK mengirim reduceOnly) dan, jika ada posisi perp, pada perp tersebut
(harus mengirimnya) → fill tercatat, sisa qty benar. *Menjaga: parameter
derivatif yang bocor ke spot.*

**S10 — Notional entry.** `order place --orderType MKT --cashQty 30` → fill
qty ≈ cash/price dan trade value ≈ cash. *Menjaga: semantik amount-vs-cost
(market-buy bybit), drift konversi.*

**S11 — Error ergonomics.** Sengaja: format aliceId yang salah, `--source`
yang tak dikenal, limit price di luar batas, modify atas id yang tak ada.
Setiap error harus dapat ditindaklanjuti oleh agent: sebutkan format yang
diharapkan / daftar account yang tersedia / bawa pesan venue itu sendiri
(bukan sekadar HTTP code telanjang). *Menjaga: error yang menelantarkan
agent.*

**S12 — Staging undo.** Stage → `git reject --reason …` → status bersih,
history menunjukkan `user-rejected` beserta alasannya; satu langkah
`--commitMessage` berakhir di `awaitingApproval` dan ditolak dengan bersih
pula. *Menjaga: jalan buntu pada approval-flow.*

## Checklist acceptance broker baru (di luar S1–S12)

- `getOpenOrders` harus MELIHAT open order nyata yang Anda pasang —
  empty-tanpa-error adalah mode kegagalan senyap (bybit mengembalikan [] untuk
  spot di bawah defaultType 'swap'). Sapu setiap market type yang
  diperdagangkan account; throw pada listing yang parsial.
- Order id round-trip sebagai STRING secara end-to-end (place → list → modify
  → cancel → history).
- Fees: venue dengan fee in-kind (beli ETH, fee dalam ETH) harus menampilkan
  dust sebagai trade `reconcile`, bukan merusak cost basis.
- Conditional order: di mana mereka berada (namespace regular vs trigger)?
  Dokumentasikan di file override venue `exchanges/<name>.ts` — file itu
  adalah rumah kanonik bagi setiap kuirk yang Anda temukan.
- Bracket/attached order: jika venue membuat child order, `placeOrder` harus
  mengembalikan id mereka via `PlaceOrderResult.legs` agar ledger men-track-nya
  sejak lahir. Verifikasi bahwa leg yang DISEMBUNYIKAN venue dari listing
  open-order-nya (held stop Alpaca) tetap muncul di `order list` dan ter-sync.
- Identitas amendment: apakah modify mempertahankan order id atau mencetak
  yang baru (replaceOrder Alpaca melakukannya)? Setelah modify, id BARU harus
  ter-track dan id LAMA harus resolve — tanpa ghost pending.
- Pesan error dari venue harus sampai ke user (jangan ada response body yang
  ditelan — pelajaran opaque-422 Alpaca; selimut "informational" >=2000 IBKR
  yang menelan error nyata 10xxx).
- Hub/leaf: jika search venue mengembalikan baris directory (lihat S13),
  hubungkan lewat grammar nativeKey + expandContract alih-alih membiarkannya
  salah-resolve atau lenyap.

**S13 — Hub/leaf identity (venue dengan hasil search bergaya directory).**
Search harus mengklasifikasikan baris: LEAF membawa aliceId yang tradeable;
DIRECTORY (penerbit bond, family FX) ditandai `expandable: true` dan aliceId
mereka harus MENOLAK quote/trade dengan pesan yang mengarah ke `contract
expand`. Expand tiap jenis hub: family FX → pair konkret (otomatis, saat
search); penerbit bond → bond individual; underlying + expiry → option
contract konkret; underlying tanpa expiry → grid parameter option. Setiap leaf
yang keluar harus round-trip: aliceId → quote (atau error entitlement yang
LANTANG) → place/track/cancel. *Menjaga: salah-resolve symbol-key-mengasumsikan-STK,
baris directory yang mati sebagai noise search yang tak teralamatkan.*

**S14 — Tanda & unit posisi derivatif (matriks empat-kombo).** Buka keempat
kombo option yang diizinkan venue (long/short × call/put; entry deep-ITM terisi
buta berdasar intrinsic, short terisi dengan menjual di bawah fair). Untuk
SETIAP leg verifikasi di SETIAP surface (tool portfolio, UI, simulator):
`side` benar; `avgCost` dan `marketPrice` dalam unit yang SAMA (averageCost
venue sering kali sudah di-bake dengan multiplier — IBKR melaporkan 103 untuk
option yang dibeli pada 1.03); tanda `unrealizedPnL` cocok dengan realita
untuk side tersebut; account equity bergerak ke arah yang benar. Lalu jalankan
`sim price-change` pada symbol UNDERLYING: baris derivatif harus dikecualikan
secara lantang, tidak pernah di-re-mark dengan harga saham (tabrakan symbol
menghasilkan "pergerakan" +23,000% dan PnL yang terbalik tanda — laporan
komunitas "arah option terbalik"). *Menjaga: cost basis dengan unit yang tak
cocok, re-marking akibat tabrakan symbol, inversi tanda pada surface
recompute.*

## Scoreboard sejauh ini

Ronde 1–5 (2026-06-12, demo okx + bybit + alpaca): ~20 bug ditemukan dan
diperbaiki di PR #325–#333 — kelumpuhan fill-awareness, cost-basis pada harga
yang salah, false negative search, TP/SL tak-terlindungi, pemotongan id,
reduceOnly pada spot, crash getOrders, dan kawan-kawannya. Ronde 5 (sapuan
bybit) menemukan nol bug produk baru — perbaikan kuirk-venue tergeneralisasi.
Itulah sinyal bahwa katalog mulai konvergen; jaga agar tetap demikian.

Ronde 6 (2026-06-12, market-open alpaca): 3 bug. CLI gateway diam-diam
membuang flag yang tak dikenal (typo `--quantity` men-stage order LMT tanpa
quantity yang commit dengan bersih) → strictObject + gate required-field
per-orderType saat stage. Leg TP/SL bracket tak ter-track sejak lahir — ledger
buta terhadap perlindungan nyata di exchange, dan leg SL yang ditahan tak
dapat dipulihkan dari listing → `PlaceOrderResult.legs` di-track lewat ledger.
Ditambah baris log sync-commit kini mengatribusikan symbol per-update
(sebelumnya `unknown`). S2/S3/S4/S5/S6 semua hijau setelah perbaikan; perilaku
cancel leg OCO (cancel satu → venue membunuh keduanya) terverifikasi dan
ter-sync dengan setia.

Ronde 7 (2026-06-12, run acceptance pertama IBKR paper): 5 temuan, 2 sudah
terlokalisasi dengan membaca adapter SEBELUM connect (lakukan ini untuk setiap
broker baru). (1) `placeOrder(_tpsl)` diam-diam mengabaikan TP/SL — spesies
naked-entry okx, dipagari dengan penolakan lantang sebelum test (native bracket
= parent/child + `legs`, batch ANG-103). (2) `getOpenOrders` tak terhubung
meski bridge primitive sudah ada — wire-up 5 baris; CATATAN reqOpenOrders hanya
melihat order milik clientId INI, order manual dari TWS-UI butuh
reqAllOpenOrders + identitas permId (ditunda). (3) Quote by-conId → TWS error
321: reqMktData tak mau me-resolve conId telanjang meski wire membawanya —
perkaya via reqContractDetails sekali + cache. (4) Semantik delta
account-cache: TWS mem-push DELTA posisi di antara penanda accountDownloadEnd;
cache swap-on-end menampilkan sell yang sudah terisi seolah masih dipegang
selama beberapa menit, update zero-qty (closed) dibuang seluruhnya, dan update
berulang menggandakan baris — upsert-by-conId ke live cache + pending.
Ditemukan oleh restart S8 lalu cross-check kebenaran venue dengan probe
ber-clientId independen. (5) `decodeContractProto` memiliki body `if
(cp.secType !== undefined)` yang KOSONG — assignment yang hilang; setiap baris
portfolio melanggar kontrak baris IBKR-superset dengan secType ''.
Fakta venue IBKR: modify mempertahankan orderId yang SAMA (assert kebalikan
dari Alpaca); stop berada di `PreSubmitted` (bukan terminal); quote paper butuh
delayed data — full-protobuf REQ_MARKET_DATA_TYPE(3) + REQ_MKT_DATA tetap
mendapat 10089 (pertanyaan entitlement diparkir, price oracle = quote AAPL
Alpaca sementara itu); buku multi-currency (HKD+USD) menjumlah secara buta di
layer BROKER (getAccount + aggregateAccountFromPositions) — angka live untuk
ANG-101. S2/S4/S6/S8/S9/S11/S12 hijau; restart survival termasuk reconnect TWS
terverifikasi.
