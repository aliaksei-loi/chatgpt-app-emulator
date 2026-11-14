import { prepareAllExamples } from '../src/server/examples.js'

await prepareAllExamples()
console.log('Examples are ready in examples/.cache')
