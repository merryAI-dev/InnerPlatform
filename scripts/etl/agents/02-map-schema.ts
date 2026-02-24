/**
 * Step 2: Schema Mapping Agent
 * LLM이 한국어 헤더를 해석하여 Firestore 필드에 매핑
 */
import { askClaudeJSON } from '../llm/claude.js';
import { schemaToPromptText } from '../config/firestore-schema.js';
import type { SheetManifest } from './01-discover.js';

export interface ColumnMapping {
  excelColumn: string;      // 원본 헤더명
  firestoreField: string;   // 매핑될 Firestore 필드
  transform?: string;       // 적용할 정규화 (normalizeDate, normalizeAmount, etc.)
  confidence: number;       // 0~1 매핑 확신도
  note?: string;            // 매핑 근거/불확실성 메모
}

export interface SheetMapping {
  sheetName: string;
  targetCollection: string;
  columnMappings: ColumnMapping[];
  skipped: boolean;
  skipReason?: string;
}

export async function mapSchemas(manifests: SheetManifest[]): Promise<SheetMapping[]> {
  const allMappings: SheetMapping[] = [];
  const schemaText = schemaToPromptText();

  for (const manifest of manifests) {
    for (const sheet of manifest.sheets) {
      // Skip non-mappable sheets
      if (sheet.profile?.skip) {
        allMappings.push({
          sheetName: sheet.name,
          targetCollection: '',
          columnMappings: [],
          skipped: true,
          skipReason: sheet.profile.hint || 'Marked as skip in profile',
        });
        continue;
      }

      if (!sheet.profile?.targetCollection) {
        allMappings.push({
          sheetName: sheet.name,
          targetCollection: '',
          columnMappings: [],
          skipped: true,
          skipReason: 'No target collection defined',
        });
        continue;
      }

      console.log(`\n🤖 [Schema Mapping] ${sheet.name} → ${sheet.profile.targetCollection}`);

      const prompt = buildMappingPrompt(sheet, schemaText);

      try {
        const result = await askClaudeJSON<{ mappings: ColumnMapping[] }>(prompt, {
          system: 'You are a data engineer specializing in Korean business management systems. Map Excel column headers to Firestore field names. Respond ONLY with valid JSON.',
          maxTokens: 2048,
        });

        allMappings.push({
          sheetName: sheet.name,
          targetCollection: sheet.profile.targetCollection,
          columnMappings: result.mappings || [],
          skipped: false,
        });

        const highConf = (result.mappings || []).filter(m => m.confidence >= 0.8).length;
        const lowConf = (result.mappings || []).filter(m => m.confidence < 0.5).length;
        console.log(`  → ${result.mappings?.length || 0} columns mapped (${highConf} high-conf, ${lowConf} low-conf)`);
      } catch (err) {
        console.error(`  ❌ Schema mapping failed for ${sheet.name}:`, (err as Error).message);
        allMappings.push({
          sheetName: sheet.name,
          targetCollection: sheet.profile.targetCollection,
          columnMappings: [],
          skipped: false,
        });
      }
    }
  }

  return allMappings;
}

function buildMappingPrompt(
  sheet: SheetManifest['sheets'][0],
  schemaText: string,
): string {
  const headerSample = sheet.headerRows.map((row, i) =>
    `Header Row ${i + 1}: ${JSON.stringify(row.filter(Boolean).slice(0, 15))}`
  ).join('\n');

  const dataSample = sheet.sampleRows.map((row, i) =>
    `Data Row ${i + 1}: ${JSON.stringify(row.filter(Boolean).slice(0, 15))}`
  ).join('\n');

  return `## Task
Map the Korean Excel column headers to Firestore fields for the "${sheet.profile?.targetCollection}" collection.

## Sheet Info
- Name: ${sheet.name}
- Size: ${sheet.rowCount} rows × ${sheet.colCount} columns
- Merged cells: ${sheet.mergedCellCount}
${sheet.profile?.hint ? `- Hint: ${sheet.profile.hint}` : ''}

## Excel Headers
${headerSample}

## Sample Data
${dataSample}

## Target Firestore Schema
${schemaText}

## Instructions
1. Map each non-empty Excel header to the most appropriate Firestore field
2. Set "transform" to one of: normalizeDate, normalizeAmount, normalizePercent, normalizePaymentMethod, normalizeProjectStatus, normalizeProjectType, normalizeSettlementType, normalizeAccountType, normalizeString, or null
3. Set "confidence" (0-1) for each mapping
4. Skip columns that are purely formatting or empty
5. For unmappable columns, set firestoreField to "unmapped" with a note

## Response Format
\`\`\`json
{
  "mappings": [
    {
      "excelColumn": "사업명",
      "firestoreField": "name",
      "transform": "normalizeString",
      "confidence": 0.95,
      "note": "Direct match to project name"
    }
  ]
}
\`\`\``;
}
