import fs from 'node:fs/promises';
import path from 'node:path';
import {
  buildQaFeedbackMemoryFromCsv,
  renderQaFeedbackMemoryMarkdown,
} from '../src/app/platform/qa-feedback-memory';

interface ScriptOptions {
  csvPath: string;
  jsonOut: string;
  mdOut: string;
  sourceLabel: string;
}

function parseArgs(argv: string[]): ScriptOptions {
  const positional = argv.filter((arg) => !arg.startsWith('--'));
  if (positional.length === 0) {
    throw new Error(
      'Usage: npx tsx scripts/ingest_qa_feedback_tracker.ts <feedback.csv> [jsonOut] [mdOut]',
    );
  }

  const csvPath = path.resolve(positional[0]);
  const jsonOut = path.resolve(
    positional[1] || path.join(process.cwd(), 'docs', 'operations', 'qa-feedback-memory.json'),
  );
  const mdOut = path.resolve(
    positional[2] || path.join(process.cwd(), 'docs', 'operations', 'qa-feedback-memory.md'),
  );

  return {
    csvPath,
    jsonOut,
    mdOut,
    sourceLabel: path.basename(csvPath),
  };
}

async function main(): Promise<void> {
  const options = parseArgs(process.argv.slice(2));
  const csvText = await fs.readFile(options.csvPath, 'utf-8');
  const memory = buildQaFeedbackMemoryFromCsv(csvText, options.sourceLabel);

  await fs.mkdir(path.dirname(options.jsonOut), { recursive: true });
  await fs.mkdir(path.dirname(options.mdOut), { recursive: true });
  await Promise.all([
    fs.writeFile(options.jsonOut, JSON.stringify(memory, null, 2), 'utf-8'),
    fs.writeFile(options.mdOut, renderQaFeedbackMemoryMarkdown(memory), 'utf-8'),
  ]);

  // eslint-disable-next-line no-console
  console.log(
    JSON.stringify(
      {
        csvPath: options.csvPath,
        jsonOut: options.jsonOut,
        mdOut: options.mdOut,
        entryCount: memory.totalEntries,
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  // eslint-disable-next-line no-console
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
