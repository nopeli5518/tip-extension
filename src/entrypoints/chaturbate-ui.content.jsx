import React from 'react';
import { createRoot } from 'react-dom/client';
import { browser } from 'wxt/browser';
import { createShadowRootUi } from 'wxt/utils/content-script-ui/shadow-root';
import TipBotPanel from '../components/TipBotPanel.jsx';
import './tipbot.css';

export default defineContentScript({
  matches: ['https://chaturbate.com/*'],
  runAt: 'document_idle',
  cssInjectionMode: 'ui',

  async main(ctx) {
    const ui = await createShadowRootUi(ctx, {
      name: 'tip-bot-panel',
      position: 'inline',
      anchor: 'body',
      append: 'last',
      onMount(container) {
        const root = createRoot(container);
        root.render(<TipBotPanel />);
        return root;
      },
      onRemove(root) {
        root?.unmount();
      },
    });

    ui.mount();

    browser.runtime.onMessage.addListener((message) => {
      if (message?.type === 'tip-bot:toggle-panel') {
        window.dispatchEvent(new CustomEvent('tip-bot-ui:toggle'));
      }
    });

    window.postMessage({ source: 'tip-bot-ui', type: 'state:request' }, '*');
  },
});
