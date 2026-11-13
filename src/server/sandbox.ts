import { readFileSync } from 'node:fs'
import { Hono } from 'hono'
import { config } from './config.js'
import { getCall, readWidget } from './mcp.js'

const shim = readFileSync(new URL('../shim/openai-shim.js', import.meta.url), 'utf8')

type DeclaredCsp = { connect: string[]; resource: string[]; frame: string[] }

function declaredCsp(meta: Record<string, unknown>): DeclaredCsp {
  const standard = (meta.ui as { csp?: Record<string, string[]> } | undefined)?.csp
  const legacy = meta['openai/widgetCSP'] as Record<string, string[]> | undefined
  return {
    connect: standard?.connectDomains ?? legacy?.connect_domains ?? [],
    resource: standard?.resourceDomains ?? legacy?.resource_domains ?? [],
    frame: standard?.frameDomains ?? legacy?.frame_domains ?? [],
  }
}

const isWildcard = (origin: string) => origin.includes('*')

function cspHeader(declared: DeclaredCsp) {
  const connect = declared.connect.filter((origin) => !isWildcard(origin)).join(' ')
  const resource = declared.resource.filter((origin) => !isWildcard(origin)).join(' ')
  const frame = declared.frame.filter((origin) => !isWildcard(origin))
  return [
    "default-src 'none'",
    `script-src 'self' 'unsafe-inline' blob: ${resource}`,
    `style-src 'self' 'unsafe-inline' ${resource}`,
    `img-src 'self' data: blob: ${resource}`,
    `font-src 'self' data: ${resource}`,
    `media-src 'self' data: blob: ${resource}`,
    `connect-src 'self' ${connect}`,
    `frame-src ${frame.length ? frame.join(' ') : "'none'"}`,
    "object-src 'none'",
    "base-uri 'self'",
    `frame-ancestors ${config.uiOrigin}`,
  ].join('; ')
}

const inlineJson = (value: unknown) => JSON.stringify(value).replace(/</g, '\\u003c')

function inject(html: string, boot: unknown) {
  const scripts = `<script>window.__EMU_BOOT__=${inlineJson(boot)}</script><script>${shim}</script>`
  const anchor = html.match(/<head[^>]*>/i) ?? html.match(/<html[^>]*>/i) ?? html.match(/<!doctype[^>]*>/i)
  if (!anchor || anchor.index === undefined) return scripts + html
  const at = anchor.index + anchor[0].length
  return html.slice(0, at) + scripts + html.slice(at)
}

export const sandbox = new Hono()

sandbox.get('/widget/:callId', async (c) => {
  const record = getCall(c.req.param('callId'))
  if (!record?.resourceUri) return c.text('Unknown widget call', 404)
  const widget = await readWidget(record.resourceUri)
  const declared = declaredCsp(widget.meta)
  const displayMode = c.req.query('displayMode') ?? 'inline'
  const boot = {
    callId: record.id,
    droppedCspOrigins: [...declared.connect, ...declared.resource, ...declared.frame].filter(isWildcard),
    globals: {
      toolInput: record.input ?? {},
      toolOutput: record.result.structuredContent ?? null,
      toolResponseMetadata: record.result._meta ?? null,
      widgetState: record.widgetState ?? null,
      theme: c.req.query('theme') ?? 'light',
      displayMode,
      locale: c.req.query('locale') ?? config.locale,
      maxHeight: Number(c.req.query('maxHeight') ?? 480),
      safeArea: { insets: { top: 0, bottom: 0, left: 0, right: 0 } },
      userAgent: { device: { type: 'desktop' }, capabilities: { hover: true, touch: false } },
      view: { mode: displayMode },
    },
  }
  return c.html(inject(widget.html, boot), 200, {
    'Content-Security-Policy': cspHeader(declared),
    'Cache-Control': 'no-store',
  })
})
