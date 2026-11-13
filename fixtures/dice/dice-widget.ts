import { App } from '@modelcontextprotocol/ext-apps'

type Roll = { sides?: number; value?: number }

const container = document.createElement('div')
container.style.cssText = 'font-family: system-ui; padding: 12px;'
const line = document.createElement('div')
line.style.cssText = 'font-size: 20px; margin-bottom: 8px;'
const output = document.createElement('span')
output.id = 'out'
output.textContent = '?'
line.append('Result: ', output)
const reroll = document.createElement('button')
reroll.id = 'reroll'
reroll.textContent = 'Re-roll'
reroll.disabled = true
const explain = document.createElement('button')
explain.id = 'explain'
explain.textContent = 'Ask about this roll'
explain.style.marginLeft = '6px'
container.append(line, reroll, explain)
document.body.append(container)

const app = new App({ name: 'Dice widget', version: '1.0.0' })
let latest: Roll = {}

function render(roll: Roll) {
  latest = { ...latest, ...roll }
  output.textContent = String(latest.value ?? '?')
}

app.ontoolinput = ({ arguments: input }) => render((input ?? {}) as Roll)
app.ontoolresult = (result) => render((result.structuredContent ?? {}) as Roll)

reroll.onclick = async () => {
  const next = await app.callServerTool({ name: 'roll_dice', arguments: { sides: latest.sides ?? 6 } })
  render((next.structuredContent ?? {}) as Roll)
}

explain.onclick = () =>
  app.sendMessage({ role: 'user', content: [{ type: 'text', text: `I rolled ${latest.value} on a ${latest.sides}-sided die. Is that lucky?` }] })

await app.connect()
reroll.disabled = false
