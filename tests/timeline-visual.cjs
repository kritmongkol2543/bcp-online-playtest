const { chromium } = require('playwright');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { pathToFileURL } = require('node:url');

const widths = [375, 430, 643, 768, 1024, 1280, 1920];
const fixture = pathToFileURL(path.join(__dirname, 'timeline-fixture.html')).href;
const output = path.join(__dirname, 'screenshots');
fs.mkdirSync(output, { recursive: true });

(async () => {
  const browser = await chromium.launch({ headless: true });
  try {
    for (const width of widths) {
      const page = await browser.newPage({ viewport: { width, height: 800 }, deviceScaleFactor: 1 });
      await page.goto(fixture, { waitUntil: 'load' });
      await page.locator('.placed-card').first().waitFor();
      const d = await page.evaluate(() => {
        const rect = selector => {
          const r = document.querySelector(selector).getBoundingClientRect();
          return { top:r.top, bottom:r.bottom, left:r.left, right:r.right, width:r.width, height:r.height };
        };
        const zone = document.querySelector('#HO .site-dropzone');
        const lastCard = document.querySelector('#HO .placed-card:last-child');
        const controls = document.querySelector('#HO .placed-card .placed-controls');
        return {
          viewport:innerWidth,
          scrollWidth:document.documentElement.scrollWidth,
          ho:rect('#HO'),
          ppd:rect('#PPD'),
          nkl:rect('#NKL'),
          zone:rect('#HO .site-dropzone'),
          zoneOverflow:getComputedStyle(zone).overflowY,
          zoneScrollHeight:zone.scrollHeight,
          zoneClientHeight:zone.clientHeight,
          lastCard:rect('#HO .placed-card:last-child'),
          firstCard:rect('#HO .placed-card'),
          controls:rect('#HO .placed-card .placed-controls'),
          count:document.querySelectorAll('#HO .placed-card').length
        };
      });
      assert.equal(d.count, 5, 'five action rows must render');
      assert.ok(d.ho.bottom <= d.ppd.top+2, `HO overlaps PPD at ${width}px: ${JSON.stringify(d)}`);
      assert.ok(d.ppd.bottom <= d.nkl.top+2, `PPD overlaps NKL at ${width}px: ${JSON.stringify(d)}`);
      assert.ok(d.scrollWidth <= width+2, `horizontal document overflow at ${width}px: ${JSON.stringify(d)}`);
      assert.ok(d.controls.top >= d.firstCard.top-1 && d.controls.bottom <= d.firstCard.bottom+1,
        `toolbar must remain inside same action card row at ${width}px: ${JSON.stringify(d)}`);
      assert.ok(d.lastCard.right <= d.zone.right+2 && d.lastCard.left >= d.zone.left-2,
        `cards exceed timeline width at ${width}px: ${JSON.stringify(d)}`);
      if (d.lastCard.bottom > d.zone.bottom+2) {
        assert.ok(d.zoneScrollHeight > d.zoneClientHeight && d.zoneOverflow !== 'visible',
          `overflow must scroll/clamp inside HO rather than paint over PPD at ${width}px`);
      }
      await page.screenshot({path:path.join(output, `timeline-${width}.png`), fullPage:true});
      console.log(`PASS ${width}px | HO bottom ${d.ho.bottom.toFixed(1)} <= PPD top ${d.ppd.top.toFixed(1)} | toolbar in row | no horizontal overflow`);
      await page.close();
    }
    console.log('TIMELINE UI VISUAL REGRESSION: PASS');
  } finally {
    await browser.close();
  }
})().catch(e => {console.error(e);process.exit(1)});
