// End-to-end proof: real MCP client over SSE, calling every tool the way Claude will.
import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { SSEClientTransport } from '@modelcontextprotocol/sdk/client/sse.js'

const client = new Client({ name: 'smoke', version: '1.0.0' }, { capabilities: {} })
await client.connect(new SSEClientTransport(new URL('http://localhost:4002/sse')))

const tools = await client.listTools()
console.log('TOOLS:', tools.tools.map((t) => t.name).join(', '))

const calls = [
  ['search_stocks', { query: 'bank' }],
  ['get_stock', { ticker: 'BBCA' }],
  ['get_stock_history', { ticker: 'BBCA', days: 3 }],
  ['get_financial_ratio', { ticker: 'BBCA' }],
  ['get_foreign_flow', { ticker: 'BBCA' }],
  ['get_top_gainers', {}],
  ['get_top_losers', {}],
  ['get_index', {}],
]

let pass = 0
let fail = 0
for (const [name, args] of calls) {
  try {
    const r = await client.callTool({ name, arguments: args })
    const body = r.content?.[0]?.text ?? ''
    const oneline = body.replace(/\s+/g, ' ').slice(0, 150)
    // A tool that "succeeds" while returning our not-found/empty text is a FAIL
    // for smoke purposes — it means the query or the data is wrong.
    const looksEmpty = /Tidak ada data|tidak tersedia|tidak ditemukan|masih KOSONG/i.test(body)
    if (looksEmpty) {
      fail++
      console.log(`[EMPTY] ${name}: ${oneline}`)
    } else {
      pass++
      console.log(`[ok]    ${name}: ${oneline}`)
    }
  } catch (err) {
    fail++
    console.log(`[ERROR] ${name}: ${err instanceof Error ? err.message : String(err)}`)
  }
}
console.log(`\npass=${pass} fail=${fail}`)
await client.close()
process.exit(fail > 0 ? 1 : 0)
