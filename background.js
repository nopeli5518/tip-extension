// Inject the bot only when the toolbar button is clicked.
// Uses activeTab + scripting so no broad host permission prompt is needed.
const api = typeof browser !== 'undefined' ? browser : chrome;

api.action.onClicked.addListener(async (tab) => {
    if (!tab.id || !/^https:\/\/chaturbate\.com\//.test(tab.url || '')) {
        console.warn('Tip Bot: open a chaturbate.com page first.');
        return;
    }
    try {
        await api.scripting.executeScript({
            target: {tabId: tab.id},
            world: 'MAIN',          // run in the page context so the site's jQuery is available
            files: ['script.js']
        });
    } catch (err) {
        console.error('Tip Bot: failed to inject script.', err);
    }
});
