import tailwindcss from '@tailwindcss/vite';
import { defineConfig } from 'wxt';

export default defineConfig({
  modules: ['@wxt-dev/module-react'],
  srcDir: 'src',
  manifest: {
    name: 'Chaturbate Tip Bot',
    version: '1.2.0',
    description: 'Chat-driven tipping bot for Chaturbate broadcasters with modern React controls.',
    permissions: ['activeTab'],
    action: {
      default_title: 'Toggle Tip Bot',
    },
    browser_specific_settings: {
      gecko: {
        id: 'tip-bot@local.extension',
        strict_min_version: '128.0',
        data_collection_permissions: {
          required: ['none'],
        },
      },
    },
  },
  vite: () => ({
    plugins: [tailwindcss()],
  }),
});
