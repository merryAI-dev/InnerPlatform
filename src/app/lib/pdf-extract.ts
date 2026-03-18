/**
 * Client-side PDF text extraction using pdfjs-dist (Mozilla PDF.js).
 * Dynamically imported to avoid bundling ~2.5MB when unused.
 */
export async function extractTextFromPdf(source: File | Blob | ArrayBuffer | Uint8Array): Promise<string> {
  const pdfjsLib = await import('pdfjs-dist');

  pdfjsLib.GlobalWorkerOptions.workerSrc = new URL(
    'pdfjs-dist/build/pdf.worker.min.mjs',
    import.meta.url,
  ).toString();

  const arrayBuffer = source instanceof ArrayBuffer
    ? source
    : source instanceof Uint8Array
      ? source.buffer.slice(source.byteOffset, source.byteOffset + source.byteLength)
      : await source.arrayBuffer();
  const pdf = await pdfjsLib.getDocument({ data: arrayBuffer }).promise;

  const pages: string[] = [];
  for (let i = 1; i <= pdf.numPages; i++) {
    const page = await pdf.getPage(i);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .filter((item): item is { str: string } => 'str' in item)
      .map(item => item.str)
      .join(' ');
    if (pageText.trim()) {
      pages.push(pageText.trim());
    }
  }

  return pages.join('\n\n');
}
