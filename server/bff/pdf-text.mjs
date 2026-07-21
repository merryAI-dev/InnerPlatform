export function toPdfJsData(buffer) {
  return new Uint8Array(buffer);
}

export async function extractTextFromPdfBuffer(buffer) {
  const pdfjsLib = await import('pdfjs-dist/legacy/build/pdf.mjs');
  // Node.js Buffer extends Uint8Array, but pdfjs explicitly rejects Buffer.
  // Always create a plain Uint8Array copy before handing binary data to pdfjs.
  const data = toPdfJsData(buffer);
  const pdf = await pdfjsLib.getDocument({ data }).promise;

  const pages = [];
  for (let pageNumber = 1; pageNumber <= pdf.numPages; pageNumber += 1) {
    const page = await pdf.getPage(pageNumber);
    const textContent = await page.getTextContent();
    const pageText = textContent.items
      .filter((item) => item && typeof item === 'object' && 'str' in item)
      .map((item) => item.str)
      .join(' ')
      .trim();
    if (pageText) {
      pages.push(pageText);
    }
  }

  return pages.join('\n\n');
}
