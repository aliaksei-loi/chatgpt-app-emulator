import { serve } from '@hono/node-server'
import { Hono } from 'hono'
import { createServer } from 'vite'
import { chat } from './chat.js'
import { config } from './config.js'
import { readResourceRaw, restoreCall, runTool, setWidgetState, snapshot } from './mcp.js'
import { defaultModel, modelOptions } from './model.js'
import { sandbox } from './sandbox.js'

const api = new Hono()

api.get('/api/state', async (c) =>
  c.json({
    ...(await snapshot()),
    sandboxOrigin: config.sandboxOrigin,
    provider: config.provider,
    model: defaultModel,
    models: modelOptions,
    locale: config.locale,
  }),
)

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
  const { messages, model } = await c.req.json()
  return chat(messages, model)
})

serve({ fetch: api.fetch, port: config.apiPort })
serve({ fetch: sandbox.fetch, port: config.sandboxPort })

const vite = await createServer({
  server: {
    port: config.uiPort,
    strictPort: true,
    proxy: { '/api': `http://localhost:${config.apiPort}` },
    watch: { ignored: ['**/fixtures/**', '**/src/server/**', '**/src/shim/**'] },
  },
})
await vite.listen()

console.log(`ChatGPT app emulator: ${config.uiOrigin}`)
console.log(`MCP server under test: ${config.serverUrl}`)
