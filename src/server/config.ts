const flag = (name: string) => {
  const index = process.argv.indexOf(`--${name}`)
  return index > -1 ? process.argv[index + 1] : undefined
}

const uiPort = Number(process.env.EMU_UI_PORT ?? 4310)
const apiPort = Number(process.env.EMU_API_PORT ?? 4311)
const sandboxPort = Number(process.env.EMU_SANDBOX_PORT ?? 4312)

export const config = {
  serverUrl: flag('server') ?? process.env.MCP_SERVER_URL ?? 'http://localhost:8787/mcp',
  provider: flag('provider') ?? process.env.EMU_PROVIDER ?? 'chatgpt',
  modelId: flag('model') ?? process.env.EMU_MODEL,
  example: flag('example') ?? process.env.EMU_EXAMPLE,
  uiPort,
  apiPort,
  sandboxPort,
  uiOrigin: `http://localhost:${uiPort}`,
  sandboxOrigin: `http://127.0.0.1:${sandboxPort}`,
  locale: process.env.EMU_LOCALE ?? 'en-US',
}
