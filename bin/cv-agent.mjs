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
  describe: 'Ruta del DOCX de salida',
  default: './out/output.docx',
})
  .option('template', {
    type: 'string',
    describe: 'Ruta del template DOCX a utilizar',
    default: './templates/test_template.docx',
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
    console.log(`→ Salida DOCX: ${result?.outputPath || argv.out}`);
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
})();
