/**
 * Step 1: Sheet Discovery Agent
 * Excel 파일의 모든 시트 구조를 파싱하여 SheetManifest 생성
 * LLM 미사용 — 순수 파싱
 */
import { discoverSheets, type SheetInfo } from '../parsers/excel-reader.js';
import { findSheetProfile, SHEET_PROFILES } from '../config/sheet-profiles.js';

export interface SheetManifest {
  fileName: string;
  sheets: (SheetInfo & {
    profile?: {
      targetCollection: string;
      skip: boolean;
      hint?: string;
    };
  })[];
  summary: {
    totalSheets: number;
    mappableSheets: number;
    skippedSheets: number;
    totalMergedCells: number;
  };
}

export async function discover(filePath: string): Promise<SheetManifest> {
  const fileName = filePath.split('/').pop() || filePath;
  console.log(`\n📋 [Discover] Scanning: ${fileName}`);

  // Build overrides map from sheet profiles
  const overrides = new Map<string, { headerRowCount?: number; headerStartRow?: number; dataStartRow?: number }>();
  // We'll populate overrides once we know sheet names (2-pass: quick scan then full)
  // For now, build a lookup by scanning profile patterns
  const sheets = await discoverSheets(filePath, {
    overrides: undefined, // first pass to get names
  });

  // If any sheets match profiles with overrides, re-scan those
  const needsRescan: string[] = [];
  for (const s of sheets) {
    const profile = findSheetProfile(s.name);
    if (profile && (profile.headerRowCount != null || profile.dataStartRow != null || profile.headerStartRow != null)) {
      overrides.set(s.name, {
        headerRowCount: profile.headerRowCount,
        headerStartRow: profile.headerStartRow,
        dataStartRow: profile.dataStartRow,
      });
      needsRescan.push(s.name);
    }
  }

  // Re-discover with overrides if needed
  let finalSheets: SheetInfo[];
  if (overrides.size > 0) {
    finalSheets = await discoverSheets(filePath, { overrides });
  } else {
    finalSheets = sheets;
  }

  let mappable = 0;
  let skipped = 0;
  let totalMerged = 0;

  const enriched = finalSheets.map(sheet => {
    const profile = findSheetProfile(sheet.name);
    totalMerged += sheet.mergedCellCount;

    if (profile?.skip) {
      skipped++;
      console.log(`  ⏭  [${sheet.name}] — skip (${profile.hint || 'not needed'})`);
    } else if (profile) {
      mappable++;
      console.log(`  ✅ [${sheet.name}] → ${profile.targetCollection} (${sheet.rowCount}r × ${sheet.colCount}c, ${sheet.mergedCellCount} merged, hdr:${sheet.headerRowCount})`);
    } else {
      console.log(`  ❓ [${sheet.name}] — no profile (${sheet.rowCount}r × ${sheet.colCount}c)`);
    }

    return {
      ...sheet,
      ...(profile ? {
        profile: {
          targetCollection: profile.targetCollection,
          skip: profile.skip || false,
          hint: profile.hint,
        },
      } : {}),
    };
  });

  const manifest: SheetManifest = {
    fileName,
    sheets: enriched,
    summary: {
      totalSheets: finalSheets.length,
      mappableSheets: mappable,
      skippedSheets: skipped,
      totalMergedCells: totalMerged,
    },
  };

  console.log(`\n📊 Summary: ${manifest.summary.totalSheets} sheets, ${mappable} mappable, ${skipped} skipped, ${totalMerged} merged cells`);

  return manifest;
}
