import fs from 'fs';
import fsp from 'fs/promises';
import path from 'path';
import puppeteer from 'puppeteer';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

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

  const upload = await openai.files.create({
    file: fs.createReadStream(absImage),
    purpose: 'vision',
  });

  return {
    ok: true,
    image_path: absImage,
    image_file_id: upload.id,
  };
}
