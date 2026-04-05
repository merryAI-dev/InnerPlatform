let excelJsPromise: Promise<typeof import('exceljs')> | null = null;
let xlsxPromise: Promise<typeof import('xlsx')> | null = null;
let pdfJsPromise: Promise<typeof import('pdfjs-dist')> | null = null;
let pdfWorkerConfigured = false;

export function loadExcelJs(): Promise<typeof import('exceljs')> {
  excelJsPromise ??= import('exceljs');
  return excelJsPromise;
}

export function warmExcelJs(): void {
  void loadExcelJs();
}

export function loadXlsx(): Promise<typeof import('xlsx')> {
  xlsxPromise ??= import('xlsx');
  return xlsxPromise;
}

export function warmXlsx(): void {
  void loadXlsx();
}

export async function loadPdfJs(): Promise<typeof import('pdfjs-dist')> {
  pdfJsPromise ??= import('pdfjs-dist');
  const pdfjsLib = await pdfJsPromise;

  if (!pdfWorkerConfigured) {
    pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
      'pdfjs-dist/build/pdf.worker.min.mjs',
      import.meta.url,
    ).toString();
    pdfWorkerConfigured = true;
  }

  return pdfjsLib;
}

export function warmPdfJs(): void {
  void loadPdfJs();
}
