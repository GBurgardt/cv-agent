import 'dotenv/config';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { runCvAgent } from '../src/agent.mjs';

const argv = yargs(hideBin(process.argv))
  .usage('Usage: $0 --cv <path> [--out <path>] [--template <path>] [--model <id>]')
  .option('cv', {
    type: 'string',
    describe: 'Path to the source résumé PDF',
    demandOption: true,
  })
  .option('out', {
    type: 'string',
    describe: 'Path for the generated DOCX',
    default: './out/output.docx',
  })
  .option('template', {
    type: 'string',
    describe: 'Path to the DOCX template',
    default: './templates/test_template.docx',
  })
  .option('model', {
    type: 'string',
    describe: 'OpenAI model to use',
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
    console.log('\n✅ Done.');
    console.log(`→ DOCX output: ${result?.outputPath || argv.out}`);
  } catch (err) {
    console.error('❌ Error:', err.message);
    process.exit(1);
  }
})();
