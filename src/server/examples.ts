import { execFile, spawn, type ChildProcess } from 'node:child_process'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { promisify } from 'node:util'
import { useServer } from './mcp.js'

const run = promisify(execFile)

const projectRoot = fileURLToPath(new URL('../..', import.meta.url))
const cacheDir = join(projectRoot, 'examples', '.cache')
const officialDir = join(cacheDir, 'openai-apps-sdk-examples')
const todoDir = join(cacheDir, 'quickstart-todo')

const OFFICIAL_REPO = 'https://github.com/openai/openai-apps-sdk-examples.git'
const OFFICIAL_COMMIT = '18cc38e78a968712c357bacdc3c79fead5bfc6b4'
const TODO_DOC = 'https://developers.openai.com/plugins/build/app-quickstart.md'
const EXAMPLE_PORT = 8000
const EXAMPLE_ORIGIN = `http://localhost:${EXAMPLE_PORT}`
const STARTUP_LIMIT_MS = 180_000
const LONG_OUTPUT = 32 * 1024 * 1024

type Launch = { command: string; args: string[]; cwd: string; env?: Record<string, string> }

type Example = {
  id: string
  title: string
  description: string
  runtime: 'node' | 'python' | 'remote'
  source: 'local' | 'official' | 'docs' | 'remote'
  url?: string
  launch?: Launch
  prompts: string[]
}

type ActiveExample = {
  id: string | null
  status: 'idle' | 'preparing' | 'starting' | 'running' | 'failed'
  message?: string
}

const onExamplePort = { PORT: String(EXAMPLE_PORT) }

const officialNode = (folder: string, script = 'start'): Launch => ({
  command: 'pnpm',
  args: [script],
  cwd: join(officialDir, folder),
  env: onExamplePort,
})

const officialPython = (folder: string): Launch => ({
  command: 'uv',
  args: ['run', '--with-requirements', `${folder}/requirements.txt`, '--with', 'mcp<2', 'uvicorn', `${folder}.main:app`, '--port', String(EXAMPLE_PORT)],
  cwd: officialDir,
})

const assetsLaunch: Launch = { command: 'pnpm', args: ['run', 'serve'], cwd: officialDir }

export const examples: Example[] = [
  {
    id: 'fixture',
    title: 'Emulator fixture',
    description: 'A dice widget on the MCP Apps bridge and a counter on window.openai.',
    runtime: 'node',
    source: 'local',
    launch: { command: 'pnpm', args: ['exec', 'tsx', 'fixtures/dice/server.ts'], cwd: projectRoot, env: onExamplePort },
    prompts: ['Roll a 20-sided die and show it in the dice widget', 'Show a counter starting at 3'],
  },
  {
    id: 'quickstart-dice',
    title: 'Quickstart: roll dice',
    description: 'The public server from the plugins quickstart. Tools only, no UI.',
    runtime: 'remote',
    source: 'remote',
    url: 'https://tinymcp.dev/api/moldy-aloof-zettabyte/mcp',
    prompts: ['Roll one 20-sided die'],
  },
  {
    id: 'quickstart-todo',
    title: 'Quickstart: to-do',
    description: 'The to-do app from the MCP server and UI quickstart.',
    runtime: 'node',
    source: 'docs',
    launch: { command: 'node', args: ['--experimental-strip-types', 'server.ts'], cwd: todoDir, env: onExamplePort },
    prompts: ['Add a new task to read my book'],
  },
  {
    id: 'basics',
    title: 'MCP app basics',
    description: 'Eleven small widgets, one per host bridge feature.',
    runtime: 'node',
    source: 'official',
    launch: officialNode('mcp_app_basics_node'),
    prompts: ['Show the host theming demo', 'Use the streaming tool input demo to write a short story'],
  },
  {
    id: 'pizzaz',
    title: 'Pizzaz',
    description: 'Map, carousel, albums, list and shop widgets on window.openai.',
    runtime: 'node',
    source: 'official',
    launch: officialNode('pizzaz_server_node'),
    prompts: ['Show me a pizza map for pepperoni', 'Show me the best pizza list'],
  },
  {
    id: 'kitchen-sink',
    title: 'Kitchen sink',
    description: 'One widget that exercises the whole window.openai surface.',
    runtime: 'node',
    source: 'official',
    launch: officialNode('kitchen_sink_server_node'),
    prompts: ['Show the kitchen sink widget with the message "Hello from the emulator"'],
  },
  {
    id: 'cards',
    title: 'Cards Against AI',
    description: 'A multi-step game with a declared CSP and a live state stream.',
    runtime: 'node',
    source: 'official',
    launch: { ...officialNode('cards_against_ai_server_node', 'start:server'), env: { ...onExamplePort, BASE_URL: EXAMPLE_ORIGIN } },
    prompts: ['Start a game of Cards Against AI with me and two CPU players'],
  },
  {
    id: 'solar-system',
    title: 'Solar system',
    description: 'A 3D scene with client-side routing. Needs uv.',
    runtime: 'python',
    source: 'official',
    launch: officialPython('solar-system_server_python'),
    prompts: ['Show me Saturn in the solar system'],
  },
  {
    id: 'shopping-cart',
    title: 'Shopping cart',
    description: 'Widget state carried across turns with widgetSessionId. Needs uv.',
    runtime: 'python',
    source: 'official',
    launch: officialPython('shopping_cart_python'),
    prompts: ['Add 2 apples and a loaf of bread to my cart', 'Also add a dozen eggs to the same cart'],
  },
  {
    id: 'pizzaz-python',
    title: 'Pizzaz (Python)',
    description: 'The Pizzaz widgets served by the Python SDK. Needs uv.',
    runtime: 'python',
    source: 'official',
    launch: officialPython('pizzaz_server_python'),
    prompts: ['Show me a pizza carousel for mushroom'],
  },
]

let active: ActiveExample = { id: null, status: 'idle' }
let attempt = 0
let assets: ChildProcess | undefined
let server: ChildProcess | undefined
let serverOutput: string[] = []
let officialReady: Promise<void> | undefined
let todoReady: Promise<void> | undefined
const failedToSpawn = new WeakSet<ChildProcess>()

const hasStopped = (child: ChildProcess | undefined) => !child || child.exitCode !== null || failedToSpawn.has(child)

async function prepareOfficial() {
  if (existsSync(join(officialDir, 'assets', 'pizzaz.html'))) return
  mkdirSync(cacheDir, { recursive: true })
  if (!existsSync(join(officialDir, '.git'))) await run('git', ['clone', OFFICIAL_REPO, officialDir], { maxBuffer: LONG_OUTPUT })
  await run('git', ['-C', officialDir, 'checkout', '--quiet', OFFICIAL_COMMIT])
  await run('pnpm', ['install'], { cwd: officialDir, maxBuffer: LONG_OUTPUT })
  await run('pnpm', ['run', 'build'], { cwd: officialDir, maxBuffer: LONG_OUTPUT })
}

async function prepareTodo() {
  if (existsSync(join(todoDir, 'node_modules'))) return
  const markdown = await (await fetch(TODO_DOC)).text()
  const blocks = [...markdown.matchAll(/```(\w+)\n([\s\S]*?)```/g)]
  const widget = blocks.find((block) => block[1] === 'html')?.[2]
  const serverSource = blocks.find((block) => block[1] === 'typescript')?.[2]
  if (!widget || !serverSource) throw new Error('The quickstart page no longer contains the expected code blocks.')
  mkdirSync(join(todoDir, 'public'), { recursive: true })
  writeFileSync(join(todoDir, 'public', 'todo-widget.html'), widget)
  writeFileSync(join(todoDir, 'server.ts'), serverSource)
  writeFileSync(
    join(todoDir, 'package.json'),
    JSON.stringify(
      { type: 'module', dependencies: { '@modelcontextprotocol/sdk': '^1.20.2', '@modelcontextprotocol/ext-apps': '^1.0.1', zod: '^3.25.76' } },
      null,
      2,
    ),
  )
  await run('pnpm', ['install'], { cwd: todoDir, maxBuffer: LONG_OUTPUT })
}

function prepare(example: Example) {
  if (example.source === 'official') {
    officialReady ??= prepareOfficial().catch((error) => {
      officialReady = undefined
      throw error
    })
    return officialReady
  }
  if (example.source === 'docs') {
    todoReady ??= prepareTodo().catch((error) => {
      todoReady = undefined
      throw error
    })
    return todoReady
  }
  return Promise.resolve()
}

export const prepareAllExamples = () => Promise.all([prepareOfficial(), prepareTodo()])

function launch(spec: Launch) {
  const child = spawn(spec.command, spec.args, {
    cwd: spec.cwd,
    env: { ...process.env, ...spec.env },
    detached: true,
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  const keep = (chunk: Buffer | string) => {
    serverOutput = [...serverOutput, ...String(chunk).split('\n').filter(Boolean)].slice(-12)
  }
  child.stdout?.on('data', keep)
  child.stderr?.on('data', keep)
  child.on('error', (error) => {
    failedToSpawn.add(child)
    keep(error.message.includes('ENOENT') ? `${spec.command} is not installed.` : error.message)
  })
  return child
}

function stop(child: ChildProcess | undefined) {
  if (!child?.pid || hasStopped(child)) return
  try {
    process.kill(-child.pid, 'SIGTERM')
  } catch {
    child.kill('SIGTERM')
  }
}

const isReachable = (url: string) =>
  fetch(url).then(
    async (response) => {
      await response.body?.cancel()
      return true
    },
    () => false,
  )

async function waitUntilUp(url: string, child: ChildProcess | undefined) {
  const deadline = Date.now() + STARTUP_LIMIT_MS
  while (Date.now() < deadline) {
    if (child && hasStopped(child)) throw new Error(serverOutput.slice(-4).join('\n') || 'The example exited during startup.')
    if (await isReachable(url)) return
    await new Promise((resolve) => setTimeout(resolve, 500))
  }
  throw new Error('The example did not start within three minutes.')
}

const describeFailure = (error: unknown) => {
  const stderr = (error as { stderr?: string }).stderr?.trim().split('\n').slice(-4).join('\n')
  return stderr || (error instanceof Error ? error.message : String(error))
}

export async function startExample(id: string) {
  const example = examples.find((candidate) => candidate.id === id)
  if (!example) return
  const current = ++attempt
  stop(server)
  server = undefined
  serverOutput = []
  active = { id, status: 'preparing' }
  try {
    await prepare(example)
    if (current !== attempt) return
    active = { id, status: 'starting' }
    const url = example.url ?? `${EXAMPLE_ORIGIN}/mcp`
    if (example.launch) {
      await new Promise((resolve) => setTimeout(resolve, 400))
      if (await isReachable(url)) throw new Error(`Port ${EXAMPLE_PORT} is in use. Stop the process that holds it and try again.`)
      if (example.source === 'official' && hasStopped(assets)) assets = launch(assetsLaunch)
      server = launch(example.launch)
    }
    await waitUntilUp(url, server)
    if (current !== attempt) return
    useServer(url)
    active = { id, status: 'running' }
  } catch (error) {
    if (current !== attempt) return
    stop(server)
    active = { id, status: 'failed', message: describeFailure(error) }
  }
}

export function leaveExample() {
  attempt += 1
  stop(server)
  server = undefined
  active = { id: null, status: 'idle' }
}

export function stopExamples() {
  stop(server)
  stop(assets)
}

export const examplesState = () => ({
  list: examples.map(({ id, title, description, runtime, prompts }) => ({ id, title, description, runtime, prompts })),
  active,
})
