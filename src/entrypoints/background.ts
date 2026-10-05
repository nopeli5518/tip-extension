import { browser } from 'wxt/browser';

export default defineBackground(() => {
  browser.action.onClicked.addListener(async (tab) => {
    if (!tab.id || !/^https:\/\/chaturbate\.com\//.test(tab.url || '')) {
      console.warn('Tip Bot: open a chaturbate.com page first.');
      return;
    }

    try {
      await browser.tabs.sendMessage(tab.id, { type: 'tip-bot:toggle-panel' });
    } catch (err) {
      console.warn('Tip Bot: panel is not available on this page yet.', err);
    }
  });
});
