import { readFileSync } from 'node:fs'
import { createServer } from 'node:http'
import { fileURLToPath } from 'node:url'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import { build } from 'esbuild'
import { z } from 'zod'

const DICE_URI = 'ui://widget/dice.html'
const COUNTER_URI = 'ui://widget/legacy-counter.html'
const port = Number(process.env.PORT ?? 8787)

const bundle = await build({
  entryPoints: [fileURLToPath(new URL('./dice-widget.ts', import.meta.url))],
  bundle: true,
  format: 'esm',
  platform: 'browser',
  write: false,
})
const diceScript = bundle.outputFiles[0].text.replace(/<\/script/gi, '<\\/script')
const diceHtml = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Dice widget</title></head><body><script type="module">${diceScript}</script></body></html>`
const counterHtml = readFileSync(new URL('./legacy-counter.html', import.meta.url), 'utf8')

const rollShape = { sides: z.number().int().min(2), value: z.number().int().min(1) }

function createApp() {
  const server = new McpServer(
    { name: 'Emulator fixture', version: '1.0.0' },
    { instructions: 'To show a dice roll, call roll_dice first, then render_dice_widget with its result.' },
  )

  server.registerResource('dice-widget', DICE_URI, {}, async () => ({
    contents: [{ uri: DICE_URI, mimeType: 'text/html;profile=mcp-app', text: diceHtml, _meta: { ui: { prefersBorder: true } } }],
  }))

  server.registerResource('legacy-counter', COUNTER_URI, {}, async () => ({
    contents: [
      { uri: COUNTER_URI, mimeType: 'text/html+skybridge', text: counterHtml, _meta: { 'openai/widgetPrefersBorder': true } },
    ],
  }))

  server.registerTool(
    'roll_dice',
    {
      title: 'Roll dice',
      description: 'Roll an N-sided die and return { sides, value }.',
      inputSchema: { sides: z.number().int().min(2) },
      outputSchema: rollShape,
      _meta: { 'openai/toolInvocation/invoking': 'Rolling…', 'openai/toolInvocation/invoked': 'Rolled.' },
    },
    async ({ sides }) => {
      const value = 1 + Math.floor(Math.random() * sides)
      return {
        structuredContent: { sides, value },
        content: [{ type: 'text', text: `Rolled ${value} on ${sides} sides.` }],
      }
    },
  )

  server.registerTool(
    'render_dice_widget',
    {
      title: 'Render dice widget',
      description: 'Render the dice widget from roll data. First call roll_dice, then pass its sides and value to this tool.',
      inputSchema: rollShape,
      outputSchema: rollShape,
      _meta: {
        ui: { resourceUri: DICE_URI },
        'openai/toolInvocation/invoking': 'Rendering…',
        'openai/toolInvocation/invoked': 'Rendered.',
      },
    },
    async ({ sides, value }) => ({
      structuredContent: { sides, value },
      content: [{ type: 'text', text: `Showing a ${sides}-sided roll: ${value}.` }],
    }),
  )

  server.registerTool(
    'show_counter',
    {
      title: 'Show counter',
      description: 'Show an interactive counter widget starting at the given number.',
      inputSchema: { start: z.number().int() },
      _meta: {
        'openai/outputTemplate': COUNTER_URI,
        'openai/widgetAccessible': true,
        'openai/toolInvocation/invoking': 'Counting…',
        'openai/toolInvocation/invoked': 'Counter ready.',
      },
    },
    async ({ start }) => ({
      structuredContent: { count: start },
      content: [{ type: 'text', text: `Counter starts at ${start}.` }],
      _meta: { widgetOnly: 'hidden from the model' },
    }),
  )

  return server
}

createServer(async (request, response) => {
  if (!request.url?.startsWith('/mcp')) {
    response.writeHead(404).end()
    return
  }
  const server = createApp()
  const transport = new StreamableHTTPServerTransport({ sessionIdGenerator: undefined })
  response.on('close', () => {
    transport.close()
    server.close()
  })
  await server.connect(transport)
  await transport.handleRequest(request, response)
}).listen(port, () => console.log(`Fixture MCP server: http://localhost:${port}/mcp`))
