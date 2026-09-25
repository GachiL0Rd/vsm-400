import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const url = process.env.GAME_URL ?? 'http://127.0.0.1:5173/';
const browser = await chromium.launch({ headless: true });
const errors = [];

try {
  await mkdir('artifacts', { recursive: true });
  for (const viewport of [{ width: 1440, height: 900 }, { width: 430, height: 850 }]) {
    const page = await browser.newPage({ viewport, deviceScaleFactor: 1 });
    page.on('pageerror', (error) => errors.push(error.message));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });
    await page.goto(url);
    await page.getByText('Связь есть').waitFor({ timeout: 10000 });
    await page.screenshot({ path: `artifacts/start-${viewport.width}.png`, fullPage: true });
    if (viewport.width < 760) {
      await page.getByRole('button', { name: 'Подойти к огнетушителю' }).click();
      await page.getByRole('button', { name: 'Взять огнетушитель' }).waitFor({ timeout: 15000 });
      await page.getByRole('button', { name: 'Взять огнетушитель' }).click();
      await page.getByText('В руках · не подготовлен').waitFor();
      await page.screenshot({ path: 'artifacts/narrow-interaction.png', fullPage: true });
    }
    console.log(`${viewport.width}: ${await page.title()} / ${await page.locator('canvas').count()} canvas`);
    await page.close();
  }
  if (errors.length > 0) throw new Error(errors.join('\n'));
} finally {
  await browser.close();
}
