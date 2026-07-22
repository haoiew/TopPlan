import { chromium } from '@playwright/test';

const action = process.argv[2];
const workspaceRoot = process.env.TOPPLAN_TEST_WORKSPACE?.replaceAll('\\', '/');
if (!['enable', 'disable'].includes(action)) {
  throw new Error('Usage: node scripts/clickthrough-smoke-driver.mjs <enable|disable>');
}
if (!workspaceRoot) {
  throw new Error('TOPPLAN_TEST_WORKSPACE is required');
}

const browser = await chromium.connectOverCDP('http://127.0.0.1:9223');
const context = browser.contexts()[0];

async function currentPages() {
  return context.pages().filter((page) => !page.isClosed());
}

async function waitForPage(predicate, message) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const page = (await currentPages()).find(predicate);
    if (page) return page;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

async function waitForPageCount(predicate, count, message) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const pages = (await currentPages()).filter(predicate);
    if (pages.length === count) return pages;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error(message);
}

const main = await waitForPage(
  (page) => !page.url().includes('topplanMode='),
  'TopPlan main WebView was not found',
);

let minis = (await currentPages()).filter((page) => page.url().includes('topplanMode=mini&'));
if (action === 'enable' && minis.length === 0) {
  const files = await main.evaluate(async (root) => {
    const internals = window.__TAURI_INTERNALS__;
    const settings = await internals.invoke('get_settings');
    const first = await internals.invoke('create_markdown_file', {
      workspaceRoot: root,
      name: 'clickthrough-left.md',
      content: '##### Left click-through smoke test\n\n- [ ] 1. Probe\n',
    });
    const second = await internals.invoke('create_markdown_file', {
      workspaceRoot: root,
      name: 'clickthrough-right.md',
      content: '##### Right click-through smoke test\n\n- [ ] 1. Probe\n',
    });
    await internals.invoke('save_settings', {
      settings: {
        ...settings,
        workspaceRoot: root,
        activeFilePath: second.path,
      },
    });
    await internals.invoke('open_mini_note_pair', { paths: [first.path, second.path] });
    return [first, second];
  }, workspaceRoot);
  minis = await waitForPageCount(
    (page) => page.url().includes('topplanMode=mini&'),
    2,
    `Two mini-note WebViews were not created for ${files.map((file) => file.path).join(', ')}`,
  );
}

if (minis.length === 0) {
  throw new Error('Mini-note WebViews were not found');
}

if (action === 'enable') {
  const button = minis[0].locator('.mini-click-through');
  if ((await button.getAttribute('aria-pressed')) !== 'true') {
    await button.click({ force: true });
  }
  for (const mini of minis) {
    await mini.waitForFunction(() => document.querySelector('.mini-click-through')?.getAttribute('aria-pressed') === 'true');
  }
  const controls = await waitForPageCount(
    (page) => page.url().includes('topplanMode=mini-control'),
    minis.length,
    'A click-through control WebView was not created for every mini note',
  );
  const regularGeometry = await minis[0].evaluate(() => {
    const buttonRect = document.querySelector('.mini-click-through').getBoundingClientRect();
    return {
      centerX: window.screenX + buttonRect.left + buttonRect.width / 2,
      centerY: window.screenY + buttonRect.top + buttonRect.height / 2,
    };
  });
  const firstMiniLabel = await minis[0].evaluate(() => window.__TAURI_INTERNALS__.metadata.currentWindow.label);
  const matchingControl = controls.find((page) => {
    const encodedParent = new URL(page.url()).searchParams.get('parent');
    return encodedParent && Buffer.from(encodedParent, 'base64url').toString('utf8') === firstMiniLabel;
  });
  if (!matchingControl) {
    throw new Error(`Matching click-through control was not found for ${firstMiniLabel}`);
  }
  const controlGeometry = await matchingControl.evaluate(() => ({
    centerX: window.screenX + window.outerWidth / 2,
    centerY: window.screenY + window.outerHeight / 2,
  }));
  if (Math.abs(regularGeometry.centerX - controlGeometry.centerX) > 1 || Math.abs(regularGeometry.centerY - controlGeometry.centerY) > 1) {
    throw new Error(`Click-through icon centers differ: ${JSON.stringify({ regularGeometry, controlGeometry })}`);
  }
} else {
  const control = await waitForPage(
    (page) => page.url().includes('topplanMode=mini-control'),
    'Click-through control WebView was not found',
  );
  await control.locator('.mini-through-control').click({ force: true });
  for (const mini of minis) {
    await mini.waitForFunction(() => document.querySelector('.mini-click-through')?.getAttribute('aria-pressed') === 'false');
  }
  for (let attempt = 0; attempt < 100; attempt += 1) {
    if (!(await currentPages()).some((page) => page.url().includes('topplanMode=mini-control'))) break;
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
}

console.log(JSON.stringify({
  action,
  pressed: await Promise.all(minis.map((mini) => mini.locator('.mini-click-through').getAttribute('aria-pressed'))),
  pages: (await currentPages()).map((page) => page.url()),
}));

await browser.close();
