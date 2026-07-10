import { expect, test } from '@playwright/test';

const TOPPLAN_TEST_URL = process.env.TOPPLAN_TEST_URL ?? 'http://127.0.0.1:1430/';

const markdown = [
  '## 一、今日已做',
  '- [ ] 1.;',
  '- [ ] 2.;',
  '',
  '## 二、今日计划',
  '- [ ] 1. 2024、 2025年普通工况跑起来；',
  '  - [ ] swn输入文件制作；',
  '  - [ ] 服务器文件构建；',
  '- [ ] 2. 台风筛选和需求提交；',
  '',
  '3.',
  '',
].join('\n');

async function loadFixture(page, value = markdown) {
  await page.goto(TOPPLAN_TEST_URL);
  await page.waitForFunction(() => window.__TOPPLAN_TEST__);
  await page.evaluate(async (nextValue) => window.__TOPPLAN_TEST__.setDocument(nextValue), value);
  await page.waitForSelector('.rich-editor-host .ProseMirror');
  await page.waitForTimeout(250);
}

async function snapshot(page) {
  return page.evaluate(() => ({
    content: window.__TOPPLAN_TEST__.getContent(),
    debug: window.__TOPPLAN_TEST__.getRichDebugSnapshot(),
  }));
}

async function clickTaskButton(page) {
  await page.click('button[title="插入任务框"]');
  await page.waitForTimeout(300);
}

async function clickBlockLeft(page, block) {
  await page.mouse.click(80, (block.top + block.bottom) / 2);
  await page.waitForTimeout(80);
}

test('task button toggles the clicked marker line, not the line above', async ({ page }) => {
  await loadFixture(page);
  const before = await snapshot(page);
  const line3Block = before.debug.blocks.find((block) => block.line === 11);
  expect(line3Block, JSON.stringify(before, null, 2)).toBeTruthy();

  await clickBlockLeft(page, line3Block);
  await clickTaskButton(page);

  const after = await snapshot(page);
  const lines = after.content.split('\n');
  expect(lines[9]).toBe('');
  expect(lines[10]).toBe('- [ ] 3.');
  expect(lines[11]).toBe('');
});

test('task button toggles the clicked source line inside a multi-line rich paragraph', async ({ page }) => {
  await loadFixture(page, ['第一行', '第二行', '第三行'].join('\n'));
  const before = await snapshot(page);
  const paragraph = before.debug.blocks.find((block) => block.line === 1);
  expect(paragraph, JSON.stringify(before, null, 2)).toBeTruthy();

  const lineHeight = (paragraph.bottom - paragraph.top) / 3;
  await page.mouse.click(paragraph.left + 60, paragraph.top + lineHeight * 2.5);
  await page.waitForTimeout(80);

  const selected = await snapshot(page);
  expect(selected.debug.selectedSourceLine).toBe(3);
  await clickTaskButton(page);

  const after = await snapshot(page);
  expect(after.content.split('\n')).toEqual(['第一行', '第二行', '- [ ] 第三行']);
});

test('task button stays on typed text after multiple blank paragraphs', async ({ page }) => {
  const listDocument = [
    '## 今日计划',
    '- [ ] 1.',
    '- [ ] 2.',
    '- [ ] 3.',
  ].join('\n');
  await loadFixture(page, listDocument);

  await page.locator('.rich-editor-host .ProseMirror').click();
  await page.keyboard.press('Control+End');
  for (let index = 0; index < 4; index += 1) {
    await page.keyboard.press('Enter');
  }
  await page.keyboard.type('11');
  await page.waitForTimeout(150);

  for (let index = 0; index < 4; index += 1) {
    await clickTaskButton(page);
    const after = await snapshot(page);
    const lines = after.content.split('\n');
    const expectedLine = index % 2 === 0 ? '- [ ] 11' : '11';
    expect(lines).toContain(expectedLine);
    expect(lines.some((line) => /^\s*[-*+]\s+\[[ xX]\]\s*$/.test(line))).toBe(false);
  }
});

test('task button accounts for visual-indent metadata before the selected line', async ({ page }) => {
  const indentedDocument = [
    '##### 今日计划',
    '- [ ] 第一项',
    '<!-- topplan-indent:2 -->',
    '- [ ] 缩进项',
    '',
    '',
    '11',
  ].join('\n');
  await loadFixture(page, indentedDocument);

  const before = await snapshot(page);
  const target = before.debug.blocks.find((block) => block.text === '11');
  expect(target, JSON.stringify(before, null, 2)).toBeTruthy();
  await page.mouse.click(target.left + 20, (target.top + target.bottom) / 2);
  await page.waitForTimeout(80);
  await clickTaskButton(page);

  const after = await snapshot(page);
  expect(after.content.split('\n')).toEqual([
    '##### 今日计划',
    '- [ ] 第一项',
    '<!-- topplan-indent:2 -->',
    '- [ ] 缩进项',
    '',
    '',
    '- [ ] 11',
  ]);
});

test('empty task row toggles in place without consuming neighbouring rows', async ({ page }) => {
  const emptyTaskDocument = [
    '##### 今日计划',
    '- [ ] 3.',
    '- [ ] ',
    '- [ ] ',
    '- [ ] ',
    '- [ ] 11',
  ].join('\n');
  await loadFixture(page, emptyTaskDocument);

  const before = await snapshot(page);
  const emptyTaskBlocks = before.debug.blocks.filter((block) => block.text === '' && !block.blank);
  const target = emptyTaskBlocks[1];
  expect(target, JSON.stringify(before, null, 2)).toBeTruthy();
  await page.mouse.click(target.left + 20, (target.top + target.bottom) / 2);
  await page.waitForTimeout(80);

  for (let index = 0; index < 6; index += 1) {
    await clickTaskButton(page);
    const after = await snapshot(page);
    const lines = after.content.split('\n');
    expect(lines).toHaveLength(6);
    expect(lines[1]).toBe('- [ ] 3.');
    expect(lines[2]).toBe('- [ ] ');
    expect(lines[3]).toBe(index % 2 === 0 ? '&nbsp;' : '- [ ] ');
    expect(lines[4]).toBe('- [ ] ');
    expect(lines[5]).toBe('- [ ] 11');
    expect(after.debug.selectedSourceLine).toBe(4);
  }
});

test('source mode removes an empty task marker without producing an invalid cursor', async ({ page }) => {
  await loadFixture(page, '- [ ] ');
  await page.click('button[title="启用源码模式"]');
  await page.waitForSelector('.cm-editor');
  await page.locator('.cm-content').click();
  await page.keyboard.press('Control+Home');
  await clickTaskButton(page);

  const after = await snapshot(page);
  expect(after.content).toBe('');
});

test('task button toggles the trailing blank line, not the previous text line', async ({ page }) => {
  await loadFixture(page);
  const before = await snapshot(page);
  const trailingBlank = before.debug.blocks.filter((block) => block.blank).at(-1);
  expect(trailingBlank, JSON.stringify(before, null, 2)).toBeTruthy();

  await clickBlockLeft(page, trailingBlank);
  await clickTaskButton(page);

  const after = await snapshot(page);
  const lines = after.content.split('\n');
  expect(lines[10]).toBe('3.');
  expect(lines[11]).toBe('- [ ] ');
});

test('repeated toggles preserve preceding blank lines', async ({ page }) => {
  await loadFixture(page);
  const before = await snapshot(page);
  const line3Block = before.debug.blocks.find((block) => block.line === 11);
  expect(line3Block, JSON.stringify(before, null, 2)).toBeTruthy();
  const originalBlankCount = before.content.split('\n').filter((line) => line === '').length;

  for (let index = 0; index < 4; index += 1) {
    const current = await snapshot(page);
    const block = current.debug.blocks.find((item) => item.line === 11);
    expect(block, JSON.stringify(current, null, 2)).toBeTruthy();
    await clickBlockLeft(page, block);
    await clickTaskButton(page);
  }

  const after = await snapshot(page);
  expect(after.content.split('\n').filter((line) => line === '').length).toBe(originalBlankCount);
  expect(after.content.split('\n')[10]).toBe('3.');
});
