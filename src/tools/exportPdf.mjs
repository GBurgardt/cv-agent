import fsp from 'fs/promises';
import path from 'path';
import puppeteer from 'puppeteer';

export async function exportResumePdf({ htmlPath, outputPdfPath }) {
  const absHtml = path.resolve(htmlPath);
  const absPdf = path.resolve(outputPdfPath);

  const htmlContent = await fsp.readFile(absHtml, 'utf8');
  await fsp.mkdir(path.dirname(absPdf), { recursive: true });

  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
  await page.emulateMediaType('print');
  await page.pdf({
    path: absPdf,
    format: 'A4',
    printBackground: true,
    margin: { top: '20mm', bottom: '20mm', left: '15mm', right: '15mm' },
  });
  await browser.close();

  return { ok: true, pdf_path: absPdf };
}
