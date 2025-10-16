import 'dotenv/config';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { runCvAgent } from '../src/agent.mjs';

const argv = yargs(hideBin(process.argv))
  .usage('Usage: $0 --cv <path> [--out <path>] [--template <path>] [--model <id>]')
  .option('cv', {
    type: 'string',
    describe: 'Ruta al PDF del CV a procesar',
    demandOption: true,
  })
  .option('out', {
    type: 'string',
    describe: 'Ruta del PDF de salida',
    default: './out/output.pdf',
  })
  .option('template', {
    type: 'string',
    describe: 'Ruta del template HTML a utilizar',
    default: './templates/cloudx-cv-template.html',
  })
  .option('model', {
    type: 'string',
    describe: 'Modelo de OpenAI a utilizar',
    default: process.env.OPENAI_MODEL || 'gpt-5-codex',
  })
  .help()
  .alias('help', 'h')
  .argv;

(async () => {
  try {
    const result = await runCvAgent({
      cvPath: argv.cv,
      outPath: argv.out,
      templatePath: argv.template,
      model: argv.model,
    });
    console.log('\n✅ Listo.');
    console.log(`→ Salida: ${result?.outputPath || argv.out}`);
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
})();
