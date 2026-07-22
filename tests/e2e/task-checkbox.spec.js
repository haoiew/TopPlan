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

test('mini note applies visual-indent metadata without showing its comment', async ({ page }) => {
  const indentedDocument = [
    '- [ ] 第一项',
    '<!-- topplan-indent:2 -->',
    '- [ ] 缩进项',
  ].join('\n');
  await loadFixture(page, indentedDocument);

  await page.click('button[title="便签模式"]');
  const miniNote = page.locator('.mini-note-content');
  await expect(miniNote).toBeVisible();
  await expect(miniNote).not.toContainText('topplan-indent');

  const firstTask = miniNote.locator('.mini-task').filter({ hasText: '第一项' });
  const indentedTask = miniNote.locator('.mini-task').filter({ hasText: '缩进项' });
  const firstBox = await firstTask.boundingBox();
  const indentedBox = await indentedTask.boundingBox();
  expect(firstBox).toBeTruthy();
  expect(indentedBox).toBeTruthy();
  expect(indentedBox.x - firstBox.x).toBeGreaterThanOrEqual(20);

  await indentedTask.locator('input').check();
  await expect.poll(async () => (await snapshot(page)).content).toBe([
    '- [x] 第一项',
    '<!-- topplan-indent:2 -->',
    '- [x] 缩进项',
  ].join('\n'));
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

test('mini note hides time labels while keeping the task text', async ({ page }) => {
  await loadFixture(
    page,
    '- [x] 1. 已完成 <span data-topplan-time="2026/7/21 14:30">2026/7/21 14:30</span>',
  );

  await page.click('button[title="便签模式"]');
  const miniNote = page.locator('.mini-note-content');
  await expect(miniNote).toContainText('1. 已完成');
  await expect(miniNote).not.toContainText('2026/7/21');
});

test('checking a parent task checks all visually indented children', async ({ page }) => {
  const document = [
    '- [ ] 6. 建模流程梳理',
    '<!-- topplan-indent:2 -->',
    '- [ ] 已有代码梳理',
    '<!-- topplan-indent:2 -->',
    '- [ ] 加个UI壳',
  ].join('\n');
  await loadFixture(page, document);
  await page.click('button[title="便签模式"]');
  await page.locator('.mini-task').filter({ hasText: '建模流程梳理' }).locator('input').check();

  await expect.poll(async () => (await snapshot(page)).content).toBe(
    document.replaceAll('- [ ]', '- [x]'),
  );
});

test('unchecking a parent task unchecks all visually indented children', async ({ page }) => {
  const document = [
    '- [x] 6. 建模流程梳理',
    '<!-- topplan-indent:2 -->',
    '- [x] 已有代码梳理',
  ].join('\n');
  await loadFixture(page, document);
  await page.click('button[title="便签模式"]');
  await page.locator('.mini-task').filter({ hasText: '建模流程梳理' }).locator('input').uncheck();

  await expect.poll(async () => (await snapshot(page)).content).toBe(
    document.replaceAll('- [x]', '- [ ]'),
  );
});

test('rich editor can uncheck a completed parent task and its children', async ({ page }) => {
  const document = [
    '- [x] 6. 建模流程梳理',
    '<!-- topplan-indent:2 -->',
    '- [x] 已有代码梳理',
  ].join('\n');
  await loadFixture(page, document);
  await page.locator('.rich-editor-host .ProseMirror input[type="checkbox"]').first().uncheck();

  await expect.poll(async () => (await snapshot(page)).content.trimEnd()).toBe(
    document.replaceAll('- [x]', '- [ ]').trimEnd(),
  );
});

test('checking every child automatically checks its parent', async ({ page }) => {
  const document = [
    '- [ ] 6. 建模流程梳理',
    '<!-- topplan-indent:2 -->',
    '- [x] 已有代码梳理',
    '<!-- topplan-indent:2 -->',
    '- [ ] 加个UI壳',
  ].join('\n');
  await loadFixture(page, document);
  await page.click('button[title="便签模式"]');
  await page.locator('.mini-task').filter({ hasText: '加个UI壳' }).locator('input').check();

  await expect.poll(async () => (await snapshot(page)).content).toBe(
    document.replace('- [ ] 6.', '- [x] 6.').replace('- [ ] 加个UI壳', '- [x] 加个UI壳'),
  );
});

test('daily rollover splits partially completed child tasks and renumbers both sections', async ({ page }) => {
  await loadFixture(page);
  const previous = [
    '##### 一、今日计划',
    '',
    '- [ ] 6. **建模流程梳理**',
    '<!-- topplan-indent:2 -->',
    '- [ ] **已有代码梳理，更流程化、规范化**',
    '<!-- topplan-indent:2 -->',
    '- [x] **加个UI壳；**',
    '',
    '##### 二、近日完成',
    '',
    '- [x] 8. 旧完成项 <span data-topplan-time="2026/7/18">2026/7/18</span>',
  ].join('\n');

  const rolled = await page.evaluate(
    ({ markdown, date }) => window.__TOPPLAN_TEST__.createDailyMarkdown(markdown, date),
    { markdown: previous, date: '2026-07-21' },
  );

  expect(rolled).toContain('- [ ] 1. **建模流程梳理**\n<!-- topplan-indent:2 -->\n- [ ] **已有代码梳理，更流程化、规范化**');
  expect(rolled).toContain('- [ ] 1. **建模流程梳理**\n<!-- topplan-indent:2 -->\n- [x] **加个UI壳；** <span data-topplan-time="2026/7/21">2026/7/21</span>');
  expect(rolled).toContain('- [x] 2. 旧完成项 <span data-topplan-time="2026/7/18">2026/7/18</span>');
  expect(rolled).not.toContain('- [ ] 6.');
});

test('daily creation follows Chinese statutory holidays and adjusted workdays', async ({ page }) => {
  await loadFixture(page);
  const result = await page.evaluate(() => ({
    nationalDay: window.__TOPPLAN_TEST__.isOfficialChineseWorkday('2026-10-01'),
    adjustedSaturday: window.__TOPPLAN_TEST__.isOfficialChineseWorkday('2026-10-10'),
  }));

  expect(result.nationalDay).toBe(false);
  expect(result.adjustedSaturday).toBe(true);
});

test('daily rollover preserves notes and indentation metadata inside completed task groups', async ({ page }) => {
  await loadFixture(page);
  const previous = [
    '##### 一、今日计划',
    '',
    '##### 二、近日完成',
    '',
    '- [x] 4. 已完成父项',
    '父项说明保持原位',
    '<!-- topplan-indent:2 -->',
    '- [x] 已完成子项',
  ].join('\n');

  const rolled = await page.evaluate(
    ({ markdown, date }) => window.__TOPPLAN_TEST__.createDailyMarkdown(markdown, date),
    { markdown: previous, date: '2026-07-21' },
  );

  expect(rolled).toContain('- [x] 1. 已完成父项\n父项说明保持原位\n<!-- topplan-indent:2 -->\n- [x] 已完成子项');
});

test('split view renders editable left and right documents and either close button exits split mode', async ({ page }) => {
  await loadFixture(page);
  await page.evaluate(async () => window.__TOPPLAN_TEST__.setSplitDocuments('# 长期计划', '# 今日工作'));

  await expect(page.locator('.document-pane')).toHaveCount(2);
  await expect(page.locator('.left-pane')).toContainText('长期计划');
  await expect(page.locator('.right-pane')).toContainText('今日工作');

  await page.locator('.left-pane .pane-close-button').click();
  await expect(page.locator('.document-pane')).toHaveCount(1);

  await page.evaluate(async () => window.__TOPPLAN_TEST__.setSplitDocuments('# 长期计划', '# 今日工作'));
  await page.locator('.right-pane .pane-close-button').click();
  await expect(page.locator('.document-pane')).toHaveCount(1);
  await expect(page.locator('.right-pane')).toContainText('长期计划');
});

test('single pane does not draw an active divider below the titlebar', async ({ page }) => {
  await loadFixture(page, ['##### 一、今日计划', '', '- [ ] 1. 测试任务'].join('\n'));

  const singlePaneShadow = await page.locator('.right-pane').evaluate((element) => getComputedStyle(element).boxShadow);
  expect(singlePaneShadow).toBe('none');
});

test('split panes do not draw an active divider below the titlebar', async ({ page }) => {
  await loadFixture(page);
  await page.evaluate(async () => window.__TOPPLAN_TEST__.setSplitDocuments('# 长期计划', '# 今日工作'));

  const paneShadows = await page.locator('.document-pane').evaluateAll((panes) => {
    return panes.map((pane) => getComputedStyle(pane).boxShadow);
  });
  expect(paneShadows).toEqual(['none', 'none']);
});

test('mini note scrollbar track starts below the top controls', async ({ page }) => {
  await loadFixture(page, ['##### 一、今日计划', '', '- [ ] 1. 测试任务'].join('\n'));
  await page.click('button[title="便签模式"]');
  const miniContent = page.locator('.mini-note-content');
  const scrollbarTrackTop = await miniContent.evaluate((element) => {
    return Number.parseFloat(getComputedStyle(element, '::-webkit-scrollbar-track').marginBlockStart) || 0;
  });
  expect(scrollbarTrackTop).toBeGreaterThanOrEqual(28);
});

test('mini note top center is a draggable move zone', async ({ page }) => {
  await loadFixture(page, ['##### 一、今日计划', '', '- [ ] 1. 测试任务'].join('\n'));
  await page.click('button[title="便签模式"]');
  const topHitTarget = await page.locator('.mini-note-shell').evaluate((element) => {
    const box = element.getBoundingClientRect();
    const target = document.elementFromPoint(box.left + box.width / 2, box.top + 7);
    return target?.className ?? '';
  });
  expect(topHitTarget).toContain('mini-move-zone');
});

test('mini note controls stay above the scrollbar clearance area', async ({ page }) => {
  await loadFixture(page, ['##### 一、今日计划', '', '- [ ] 1. 测试任务'].join('\n'));
  await page.click('button[title="便签模式"]');
  await expect(page.locator('.mini-exit')).toBeVisible();

  const controlTops = await page.locator('.mini-exit').evaluateAll((controls) => {
    return controls.map((control) => Number.parseFloat(getComputedStyle(control).top));
  });
  expect(controlTops).toEqual([5]);
});

test('mini note top controls center their icons and reveal inactive controls on hover', async ({ page }) => {
  await page.goto(`${TOPPLAN_TEST_URL}?topplanMode=mini`);
  await page.waitForFunction(() => window.__TOPPLAN_TEST__);
  await page.evaluate(async (value) => window.__TOPPLAN_TEST__.setDocument(value), ['##### 一、今日计划', '', '- [ ] 1. 测试任务'].join('\n'));
  await page.click('button[title="便签模式"]');
  await expect(page.locator('.mini-note-shell')).toBeVisible();

  const geometry = await page.locator('.mini-click-through, .mini-exit, .mini-close').evaluateAll((controls) => {
    return controls.map((control) => {
      const button = control.getBoundingClientRect();
      const icon = control.querySelector('svg').getBoundingClientRect();
      const style = getComputedStyle(control);
      return {
        className: control.className,
        deltaX: Math.abs(button.left + button.width / 2 - (icon.left + icon.width / 2)),
        deltaY: Math.abs(button.top + button.height / 2 - (icon.top + icon.height / 2)),
        padding: style.padding,
      };
    });
  });

  expect(geometry).toHaveLength(3);
  for (const control of geometry) {
    expect(control.deltaX, control.className).toBeLessThanOrEqual(0.5);
    expect(control.deltaY, control.className).toBeLessThanOrEqual(0.5);
    expect(control.padding, control.className).toBe('0px');
  }
  await page.locator('.mini-note-shell').hover();
  for (const selector of ['.mini-click-through', '.mini-exit', '.mini-close']) {
    await expect(page.locator(selector)).toHaveCSS('opacity', '0.52');
  }
});

test('active click-through control renders only the status icon on a transparent surface', async ({ page }) => {
  await page.goto(`${TOPPLAN_TEST_URL}?topplanMode=mini-control&parent=bWluaS1ub3RlLXRlc3Q`);
  const control = page.locator('.mini-through-control');
  await expect(control).toBeVisible();

  const appearance = await page.evaluate(() => {
    const shellStyle = getComputedStyle(document.querySelector('.app-shell'));
    const buttonStyle = getComputedStyle(document.querySelector('.mini-through-control'));
    const accentProbe = document.createElement('span');
    accentProbe.style.color = 'var(--accent)';
    document.body.append(accentProbe);
    const accentColor = getComputedStyle(accentProbe).color;
    accentProbe.remove();
    return {
      shellBackground: shellStyle.backgroundColor,
      shellBorder: shellStyle.borderTopWidth,
      buttonBackground: buttonStyle.backgroundColor,
      buttonBorder: buttonStyle.borderTopWidth,
      buttonColor: buttonStyle.color,
      buttonShadow: buttonStyle.boxShadow,
      accentColor,
      hasIcon: Boolean(document.querySelector('.mini-through-control svg')),
    };
  });

  expect(appearance).toEqual({
    shellBackground: 'rgba(0, 0, 0, 0)',
    shellBorder: '0px',
    buttonBackground: 'rgba(0, 0, 0, 0)',
    buttonBorder: '0px',
    buttonColor: appearance.accentColor,
    buttonShadow: 'none',
    accentColor: appearance.accentColor,
    hasIcon: true,
  });
});

test('split view keeps the file sidebar overlaid instead of consuming an editor column', async ({ page }) => {
  await loadFixture(page);
  await page.evaluate(async () => window.__TOPPLAN_TEST__.setSplitDocuments('# 长期计划', '# 今日工作'));
  await page.locator('.app-menu-toggle').click();

  const layout = await page.evaluate(() => {
    const workspace = document.querySelector('.workspace-main').getBoundingClientRect();
    const sidebar = document.querySelector('.file-sidebar');
    const documents = document.querySelector('.document-layout').getBoundingClientRect();
    return {
      sidebarPosition: getComputedStyle(sidebar).position,
      workspaceWidth: workspace.width,
      documentWidth: documents.width,
    };
  });
  expect(layout.sidebarPosition).toBe('absolute');
  expect(Math.abs(layout.workspaceWidth - layout.documentWidth)).toBeLessThanOrEqual(1);
});

test('split sidebar keeps the same width as the normal sidebar', async ({ page }) => {
  await page.setViewportSize({ width: 1260, height: 900 });
  await loadFixture(page);
  await page.locator('.app-menu-toggle').click();
  const normalWidth = await page.locator('.file-sidebar').evaluate((sidebar) => sidebar.getBoundingClientRect().width);

  await page.evaluate(async () => window.__TOPPLAN_TEST__.setSplitDocuments('# 长期计划', '# 今日工作'));
  const splitWidth = await page.locator('.file-sidebar').evaluate((sidebar) => sidebar.getBoundingClientRect().width);
  expect(splitWidth).toBe(normalWidth);
});

test('split view leaves sidebar and toolbar controls clickable', async ({ page }) => {
  await loadFixture(page);
  await page.evaluate(async () => window.__TOPPLAN_TEST__.setSplitDocuments('# 长期计划', '# 今日工作'));
  await page.locator('.app-menu-toggle').click();

  await page.locator('button[title="设置"]').click();
  await expect(page.locator('.settings-popover')).toBeVisible();
  await page.locator('.settings-head button').click();

  await page.locator('.file-list-item.split-active .file-split-button').click();
  await expect(page.locator('.document-pane')).toHaveCount(1);
});

test('split mini note mode targets both panes in left-to-right order', async ({ page }) => {
  await loadFixture(page);
  await page.evaluate(async () => window.__TOPPLAN_TEST__.setSplitDocuments('# 长期计划', '# 今日工作'));

  const paths = await page.evaluate(() => window.__TOPPLAN_TEST__.getMiniNotePaths());
  expect(paths).toEqual(['__topplan_test__/left.md', '__topplan_test__/right.md']);
});

test('narrow single-pane sidebar still covers the full workspace height', async ({ page }) => {
  await page.setViewportSize({ width: 420, height: 640 });
  await loadFixture(page);
  await page.locator('.app-menu-toggle').click();

  const offsets = await page.evaluate(() => {
    const workspace = document.querySelector('.workspace-main').getBoundingClientRect();
    const sidebar = document.querySelector('.file-sidebar').getBoundingClientRect();
    return {
      top: sidebar.top - workspace.top,
      bottom: workspace.bottom - sidebar.bottom,
    };
  });
  expect(offsets).toEqual({ top: 0, bottom: 0 });
});
