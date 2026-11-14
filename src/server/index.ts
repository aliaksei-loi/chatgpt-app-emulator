import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { createServer } from 'vite'
import { chat } from './chat.js'
import { config } from './config.js'
import { examples, examplesState, leaveExample, startExample, stopExamples } from './examples.js'
import { readResourceRaw, restoreCall, runTool, setWidgetState, snapshot, useServer } from './mcp.js'
import { defaultModel, modelOptions } from './model.js'
import { sandbox } from './sandbox.js'

const LOOPBACK_HOSTS = ['localhost', '127.0.0.1']
const trustedHosts = new Set(LOOPBACK_HOSTS.flatMap((host) => [`${host}:${config.uiPort}`, `${host}:${config.apiPort}`]))
const trustedOrigins = new Set(LOOPBACK_HOSTS.map((host) => `http://${host}:${config.uiPort}`))

const api = new Hono()

api.use('/api/*', async (c, next) => {
  const origin = c.req.header('origin')
  const fromEmulator = trustedHosts.has(c.req.header('host') ?? '') && (!origin || trustedOrigins.has(origin))
  const jsonOrRead = c.req.method === 'GET' || (c.req.header('content-type') ?? '').startsWith('application/json')
  if (!fromEmulator || !jsonOrRead) return c.json({ error: 'Forbidden' }, 403)
  await next()
})

api.get('/api/state', async (c) =>
  c.json({
    ...(await snapshot()),
    sandboxOrigin: config.sandboxOrigin,
    provider: config.provider,
    model: defaultModel,
    models: modelOptions,
    examples: examplesState(),
    locale: config.locale,
  }),
)

api.post('/api/server', async (c) => {
  try {
    useServer((await c.req.json()).url)
    leaveExample()
    return c.json({ ok: true })
  } catch {
    return c.json({ error: 'Enter a full URL, for example http://localhost:8000/mcp' }, 400)
  }
})

api.post('/api/examples/start', async (c) => {
  const { id } = await c.req.json()
  if (!examples.some((example) => example.id === id)) return c.json({ error: 'Unknown example' }, 404)
  void startExample(id)
  return c.json({ ok: true })
})

api.post('/api/tools/call', async (c) => {
  const { name, args, callId } = await c.req.json()
  try {
    const record = await runTool(name, args, callId)
    return c.json({ callId: record.id, result: record.result })
  } catch (error) {
    return c.json({ error: String(error) }, 502)
  }
})

api.put('/api/calls/:id', async (c) => {
  const { toolName, input, result } = await c.req.json()
  await restoreCall(c.req.param('id'), toolName, input, result)
  return c.json({ ok: true })
})

api.post('/api/calls/:id/widget-state', async (c) => {
  setWidgetState(c.req.param('id'), (await c.req.json()).state)
  return c.json({ ok: true })
})

api.get('/api/resources/read', async (c) => c.json(await readResourceRaw(c.req.query('uri') ?? '')))

api.post('/api/chat', async (c) => {
  const { messages, model, context } = await c.req.json()
  return chat(messages, model, context)
})

serve({ fetch: api.fetch, port: config.apiPort, hostname: '127.0.0.1' })
serve({ fetch: sandbox.fetch, port: config.sandboxPort, hostname: '127.0.0.1' })

const vite = await createServer({
  server: {
    port: config.uiPort,
    strictPort: true,
    proxy: { '/api': `http://127.0.0.1:${config.apiPort}` },
    watch: { ignored: ['**/fixtures/**', '**/examples/**', '**/compare/**', '**/scripts/**', '**/src/server/**', '**/src/shim/**'] },
  },
})
await vite.listen()

for (const signal of ['SIGINT', 'SIGTERM'] as const) {
  process.on(signal, () => {
    stopExamples()
    process.exit(0)
  })
}

if (config.example) void startExample(config.example)

console.log(`ChatGPT app emulator: ${config.uiOrigin}`)
console.log(`MCP server under test: ${config.serverUrl}`)
