/**
 * Test script: Parse specific sheets and dump sample data for manual comparison
 */
import { parseSheet } from './parsers/excel-reader.js';
import { findSheetProfile } from './config/sheet-profiles.js';

function getOverrides(sheetName: string) {
  const p = findSheetProfile(sheetName);
  return p ? { headerRowCount: p.headerRowCount, headerStartRow: p.headerStartRow, dataStartRow: p.dataStartRow } : {};
}

const DASHBOARD = './[2026] 사업관리 통합 대시보드-2.xlsx';
const EXPENSE = './[복사용] 사업명_2026_사업비 관리 시트 (공통양식) .xlsx';

async function main() {
  // ── Test 1: 전체 재직자명단 (simplest — no merged cells) ──
  console.log('\n' + '='.repeat(60));
  console.log('TEST 1: 전체 재직자명단의 사본 (members)');
  console.log('='.repeat(60));
  const members = await parseSheet(DASHBOARD, '전체 재직자명단의 사본', getOverrides('전체 재직자명단의 사본'));
  console.log('Headers:', members.headers);
  console.log('Total rows:', members.rows.length);
  console.log('\nFirst 5 records:');
  members.rows.slice(0, 5).forEach((r, i) => console.log(`  [${i + 1}]`, JSON.stringify(r)));

  // ── Test 2: 1-1. 사업확보 현황판 (projects — merged cells) ──
  console.log('\n' + '='.repeat(60));
  console.log('TEST 2: 1-1. 26년 사업확보 현황판 (projects)');
  console.log('='.repeat(60));
  const prospects = await parseSheet(DASHBOARD, '1-1. 26년 사업확보 현황판', getOverrides('1-1. 26년 사업확보 현황판'));
  console.log('Headers:', prospects.headers.slice(0, 20));
  console.log('Total rows:', prospects.rows.length);
  console.log('\nFirst 3 records:');
  prospects.rows.slice(0, 3).forEach((r, i) => {
    const keys = Object.keys(r).filter(k => r[k] != null && String(r[k]).trim() !== '');
    const sample: Record<string, unknown> = {};
    keys.slice(0, 10).forEach(k => { sample[k] = r[k]; });
    console.log(`  [${i + 1}]`, JSON.stringify(sample));
  });

  // ── Test 3: 100-2.참여율(e-나라) (participationEntries) ──
  console.log('\n' + '='.repeat(60));
  console.log('TEST 3: 100-2.참여율(e-나라) (participationEntries)');
  console.log('='.repeat(60));
  const eNara = await parseSheet(DASHBOARD, '100-2.참여율(e-나라)', getOverrides('100-2.참여율(e-나라)'));
  console.log('Headers:', eNara.headers.slice(0, 15));
  console.log('Total rows:', eNara.rows.length);
  console.log('\nFirst 3 records:');
  eNara.rows.slice(0, 3).forEach((r, i) => {
    const keys = Object.keys(r).filter(k => r[k] != null && String(r[k]).trim() !== '');
    const sample: Record<string, unknown> = {};
    keys.slice(0, 10).forEach(k => { sample[k] = r[k]; });
    console.log(`  [${i + 1}]`, JSON.stringify(sample));
  });

  // ── Test 4: 예산총괄시트 (expense file — budget) ──
  console.log('\n' + '='.repeat(60));
  console.log('TEST 4: 예산총괄시트 (project budget)');
  console.log('='.repeat(60));
  const budget = await parseSheet(EXPENSE, '예산총괄시트', getOverrides('예산총괄시트'));
  console.log('Headers:', budget.headers.slice(0, 20));
  console.log('Total rows:', budget.rows.length);
  console.log('\nFirst 3 records:');
  budget.rows.slice(0, 3).forEach((r, i) => {
    const keys = Object.keys(r).filter(k => r[k] != null && String(r[k]).trim() !== '');
    const sample: Record<string, unknown> = {};
    keys.slice(0, 10).forEach(k => { sample[k] = r[k]; });
    console.log(`  [${i + 1}]`, JSON.stringify(sample));
  });

  // ── Test 5: 사용내역 (transactions — expense file) ──
  console.log('\n' + '='.repeat(60));
  console.log('TEST 5: 사용내역 (transactions)');
  console.log('='.repeat(60));
  const txns = await parseSheet(EXPENSE, '사용내역(통장내역기준취소내역,불인정포함)', getOverrides('사용내역(통장내역기준취소내역,불인정포함)'));
  console.log('Headers:', txns.headers.slice(0, 20));
  console.log('Total rows:', txns.rows.length);
  console.log('\nFirst 3 records:');
  txns.rows.slice(0, 3).forEach((r, i) => {
    const keys = Object.keys(r).filter(k => r[k] != null && String(r[k]).trim() !== '');
    const sample: Record<string, unknown> = {};
    keys.slice(0, 10).forEach(k => { sample[k] = r[k]; });
    console.log(`  [${i + 1}]`, JSON.stringify(sample));
  });

  // ── Test 6: 통장내역 (bank — smaller, good for comparison) ──
  console.log('\n' + '='.repeat(60));
  console.log('TEST 6: 통장내역 (bank transactions)');
  console.log('='.repeat(60));
  const bank = await parseSheet(EXPENSE, '통장내역(MYSC법인계좌e나라도움제외)', getOverrides('통장내역(MYSC법인계좌e나라도움제외)'));
  console.log('Headers:', bank.headers);
  console.log('Total rows:', bank.rows.length);
  console.log('\nFirst 5 records:');
  bank.rows.slice(0, 5).forEach((r, i) => {
    const keys = Object.keys(r).filter(k => r[k] != null && String(r[k]).trim() !== '');
    const sample: Record<string, unknown> = {};
    keys.forEach(k => { sample[k] = r[k]; });
    console.log(`  [${i + 1}]`, JSON.stringify(sample));
  });

  // ── Test 7: cashflow (most complex — 68 cols, 63 merged) ──
  console.log('\n' + '='.repeat(60));
  console.log('TEST 7: cashflow(사용내역 연동) — 68 cols, 63 merged cells');
  console.log('='.repeat(60));
  const cf = await parseSheet(EXPENSE, 'cashflow(사용내역 연동)', getOverrides('cashflow(사용내역 연동)'));
  console.log('Headers (first 20):', cf.headers.slice(0, 20));
  console.log('Headers (20-40):', cf.headers.slice(20, 40));
  console.log('Total headers:', cf.headers.length);
  console.log('Total rows:', cf.rows.length);
  console.log('\nFirst 2 records (first 10 non-null fields):');
  cf.rows.slice(0, 2).forEach((r, i) => {
    const keys = Object.keys(r).filter(k => r[k] != null && String(r[k]).trim() !== '');
    const sample: Record<string, unknown> = {};
    keys.slice(0, 10).forEach(k => { sample[k] = r[k]; });
    console.log(`  [${i + 1}]`, JSON.stringify(sample));
  });
}

main().catch(console.error);
