import fsp from 'fs/promises';
import path from 'path';
import puppeteer from 'puppeteer';

export async function previewResumeSnapshot({ htmlPath, imagePath, width, height }) {
  const absHtml = path.resolve(htmlPath);
  const absImage = imagePath
    ? path.resolve(imagePath)
    : path.join(path.dirname(absHtml), 'resume-preview.png');

  const htmlContent = await fsp.readFile(absHtml, 'utf8');

  const browser = await puppeteer.launch({ headless: 'new' });
  const page = await browser.newPage();
  if (width || height) {
    await page.setViewport({ width: width || 1280, height: height || 720 });
  }
  await page.setContent(htmlContent, { waitUntil: 'networkidle0' });
  await fsp.mkdir(path.dirname(absImage), { recursive: true });
  await page.screenshot({ path: absImage, fullPage: true });
  await browser.close();

  const buffer = await fsp.readFile(absImage);
  const base64 = buffer.toString('base64');

  return {
    ok: true,
    image_path: absImage,
    image_base64: base64,
  };
}
