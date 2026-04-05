import type {
  TextItem,
  TextMarkedContent,
} from 'pdfjs-dist/types/src/display/api';
import { loadPdfJs } from '../platform/lazy-heavy-modules';

/**
 * Client-side PDF text extraction using pdfjs-dist (Mozilla PDF.js).
 * Dynamically imported to avoid bundling ~2.5MB when unused.
 */
export async function extractTextFromPdf(source: File | Blob | ArrayBuffer | Uint8Array): Promise<string> {
  const pdfjsLib = await loadPdfJs();

  const data = source instanceof Uint8Array
    ? source
    : source instanceof ArrayBuffer
      ? new Uint8Array(source)
      : new Uint8Array(await source.arrayBuffer());
  const pdf = await pdfjsLib.getDocument({ data }).promise;

  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .filter((item: TextItem | TextMarkedContent): item is TextItem => 'str' in item)
      .map((item) => item.str)
      .join(' ');
    if (pageText.trim()) {
      pages.push(pageText.trim());
    }
  }

  return pages.join('\n\n');
}
