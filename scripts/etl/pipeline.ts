/**
 * 5-Step ETL Pipeline Orchestrator
 * discover → mapSchemas → extract → validate → load
 */
import { discover, type SheetManifest } from './agents/01-discover.js';
import { mapSchemas } from './agents/02-map-schema.js';
import { mapSchemasStatic, type SheetMapping } from './agents/02-map-schema-static.js';
import { extractData, type ExtractionResult } from './agents/03-extract.js';
import { validateData, type ValidationReport } from './agents/04-validate.js';
import { loadToFirestore, type LoadResult } from './agents/05-load.js';

export interface PipelineInput {
  files: string[];          // Excel 파일 경로 목록
  commit?: boolean;         // Firestore 실제 적재 여부
  useLLM?: boolean;         // LLM 검증 사용 여부
  orgId?: string;           // Firestore orgId
  steps?: number[];         // 실행할 단계 (default: [1,2,3,4,5])
  allowSheetErrorsOnCommit?: boolean; // true면 에러가 있어도 시트 단위 적재 허용
}

export interface PipelineOutput {
  manifests: SheetManifest[];
  mappings: SheetMapping[];
  extractions: ExtractionResult[];
  validations: ValidationReport[];
  loads: LoadResult[];
  duration: number;         // ms
}

export async function runPipeline(input: PipelineInput): Promise<PipelineOutput> {
  const start = Date.now();
  const steps = input.steps || [1, 2, 3, 4, 5];
  const output: PipelineOutput = {
    manifests: [],
    mappings: [],
    extractions: [],
    validations: [],
    loads: [],
    duration: 0,
  };

  // ── Step 1: Discover ──
  if (steps.includes(1)) {
    console.log('\n' + '═'.repeat(60));
    console.log('  Step 1/5: Sheet Discovery');
    console.log('═'.repeat(60));

    for (const file of input.files) {
      const manifest = await discover(file);
      output.manifests.push(manifest);
    }

    const total = output.manifests.reduce((s, m) => s + m.summary.totalSheets, 0);
    const mappable = output.manifests.reduce((s, m) => s + m.summary.mappableSheets, 0);
    console.log(`\n✅ Step 1 complete: ${total} sheets discovered, ${mappable} mappable`);
  }

  if (!steps.includes(2)) {
    output.duration = Date.now() - start;
    return output;
  }

  // ── Step 2: Schema Mapping ──
  console.log('\n' + '═'.repeat(60));
  console.log(`  Step 2/5: Schema Mapping (${input.useLLM ? 'Claude LLM' : 'Static Rules'})`);
  console.log('═'.repeat(60));

  output.mappings = input.useLLM
    ? await mapSchemas(output.manifests)
    : await mapSchemasStatic(output.manifests);

  const active = output.mappings.filter(m => !m.skipped);
  console.log(`\n✅ Step 2 complete: ${active.length} sheets mapped, ${output.mappings.length - active.length} skipped`);

  if (!steps.includes(3)) {
    output.duration = Date.now() - start;
    return output;
  }

  // ── Step 3: Data Extraction ──
  console.log('\n' + '═'.repeat(60));
  console.log('  Step 3/5: Data Extraction');
  console.log('═'.repeat(60));

  // Group mappings by source file
  for (const file of input.files) {
    const fileName = file.split('/').pop() || file;
    const fileMappings = output.mappings.filter(m => {
      // Match mappings to files via manifest sheet names
      const manifest = output.manifests.find(man => man.fileName === fileName);
      return manifest?.sheets.some(s => s.name === m.sheetName);
    });

    if (fileMappings.length === 0) continue;
    const results = await extractData(file, fileMappings);
    output.extractions.push(...results);
  }

  const totalRecords = output.extractions.reduce((s, e) => s + e.records.length, 0);
  console.log(`\n✅ Step 3 complete: ${totalRecords} records extracted from ${output.extractions.length} sheets`);

  if (!steps.includes(4)) {
    output.duration = Date.now() - start;
    return output;
  }

  // ── Step 4: Validation ──
  console.log('\n' + '═'.repeat(60));
  console.log('  Step 4/5: Data Validation');
  console.log('═'.repeat(60));

  output.validations = await validateData(output.extractions, { useLLM: input.useLLM });

  const cleanRecords = output.validations.reduce((s, v) => s + v.cleanedRecords.length, 0);
  const totalIssues = output.validations.reduce((s, v) => s + v.issues.length, 0);
  console.log(`\n✅ Step 4 complete: ${cleanRecords} clean records, ${totalIssues} issues found`);

  if (!steps.includes(5)) {
    output.duration = Date.now() - start;
    return output;
  }

  // ── Step 5: Load ──
  console.log('\n' + '═'.repeat(60));
  console.log(`  Step 5/5: Firestore Load (${input.commit ? '🔴 LIVE' : '🟢 DRY-RUN'})`);
  console.log('═'.repeat(60));

  output.loads = await loadToFirestore(output.validations, {
    commit: input.commit,
    orgId: input.orgId,
    allowSheetErrorsOnCommit: input.allowSheetErrorsOnCommit,
  });

  const totalWritten = output.loads.reduce((s, l) => s + l.documentsWritten, 0);
  console.log(`\n✅ Step 5 complete: ${totalWritten} documents ${input.commit ? 'written to Firestore' : 'saved as dry-run JSON'}`);

  output.duration = Date.now() - start;
  return output;
}

/**
 * Print final summary
 */
export function printSummary(output: PipelineOutput): void {
  console.log('\n' + '═'.repeat(60));
  console.log('  📊 PIPELINE SUMMARY');
  console.log('═'.repeat(60));

  console.log(`\n⏱  Duration: ${(output.duration / 1000).toFixed(1)}s`);

  if (output.manifests.length > 0) {
    console.log('\n📋 Discovery:');
    for (const m of output.manifests) {
      console.log(`  ${m.fileName}: ${m.summary.totalSheets} sheets (${m.summary.mappableSheets} mappable, ${m.summary.skippedSheets} skipped, ${m.summary.totalMergedCells} merged cells)`);
    }
  }

  if (output.mappings.length > 0) {
    console.log('\n🗺️  Schema Mappings:');
    for (const m of output.mappings) {
      if (m.skipped) continue;
      const highConf = m.columnMappings.filter(c => c.confidence >= 0.8).length;
      console.log(`  ${m.sheetName} → ${m.targetCollection} (${m.columnMappings.length} cols, ${highConf} high-conf)`);
    }
  }

  if (output.extractions.length > 0) {
    console.log('\n📥 Extractions:');
    for (const e of output.extractions) {
      console.log(`  ${e.sheetName} → ${e.targetCollection}: ${e.records.length} records (${e.errors.length} errors)`);
    }
  }

  if (output.validations.length > 0) {
    console.log('\n✅ Validations:');
    for (const v of output.validations) {
      console.log(`  ${v.sheetName}: ${v.stats.outputRecords}/${v.stats.inputRecords} clean (${v.stats.errors} errors, ${v.stats.warnings} warnings)`);
    }
  }

  if (output.loads.length > 0) {
    console.log('\n📤 Loads:');
    for (const l of output.loads) {
      const dest = l.dryRunPath || 'Firestore';
      console.log(`  ${l.collection} [${l.sheetName}]: ${l.documentsWritten} docs → ${dest}`);
    }
  }

  console.log('\n' + '═'.repeat(60));
}
