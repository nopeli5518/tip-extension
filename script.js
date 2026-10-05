// Clicking the toolbar button re-injects this file. Run the bot only once per
// page; on later clicks just toggle the control panel's visibility.
if (window.__tipBotLoaded) {
    const existing = document.getElementById('tipBotPanel');
    if (existing) existing.style.display = existing.style.display === 'none' ? 'block' : 'none';
} else {
    window.__tipBotLoaded = true;
    tipBotMain();
}

function tipBotMain() {

let initialMessages = []

let chatDiv = null;
const broadcasterUsername = window.location.href.split('/')[3];
let pmChatContainer = null;

const botStatus = {
    initialized: false,
    numberTipEnabled: true,   // the default game: a bare number in chat tips that amount
    maxTip: -1,
    limit: -1,
    rateLimit: -1,        // max tokens per rolling 60s window, -1 = no limit
    recentTips: [],       // { time, amount } records for the rolling window
    random: {
        allow: true,
        min: 1,
        max: 100
    },
    guessGame: {
        enabled: false,
        target: 0,
        guesses: 0
    },
    regexTip: {
        enabled: false,    // OFF by default; tip per regex match on each broadcaster message
        pattern: '',       // regex source: '.' = per character, 'a' = per letter a, etc.
        perMatch: 1        // tokens per match
    },
    currentlyTipped: 0,
    repeatInterval: null,
    buy: {
        enabled: false,      // master safety switch; buying is OFF by default
        limit: -1,           // max tokens the bot may BUY cumulatively, -1 = no limit
        minPackage: -1,      // ignore packages smaller than this, -1 = no bound
        maxPackage: -1       // ignore packages larger than this, -1 = no bound
    },
    currentlyBought: 0
}

// Read the wallet balance from the page. Chaturbate shows it in the header as
// <div data-testid="header-token-balance">121</div>; the data-testid is the
// stablest hook (the class is a hashed CSS-module name). Older layouts used a
// .tokencount span, kept here as a fallback. The number can contain commas, so
// strip non-digits. Returns null when no balance element is present.
function getTokenBalance() {
    const el = document.querySelector('[data-testid="header-token-balance"]')
        || document.querySelector('.tokencount[updatable-count]')
        || document.querySelector('.tokencount');
    if (!el) return null;
    const n = parseInt((el.textContent || '').replace(/[^\d]/g, ''), 10);
    return Number.isNaN(n) ? null : n;
}

// The number the `token balance` command reports: the wallet balance capped by
// the remaining cumulative limit. Returns null when the balance can't be read.
function availableToTip() {
    let tokens = getTokenBalance();
    if (tokens === null) return null;
    if (botStatus.limit !== -1) {
        tokens = Math.min(tokens, Math.max(0, botStatus.limit - botStatus.currentlyTipped));
    }
    return tokens;
}

function isWithinLimit(amount) {
    if (botStatus.limit === -1) return true;
    return botStatus.currentlyTipped + amount <= botStatus.limit;
}

function isWithinMaxTip(amount) {
    if (botStatus.maxTip === -1) return true;
    return amount <= botStatus.maxTip;
}

function effectiveTip(amount) {
    if (botStatus.maxTip === -1) return amount;
    return Math.min(amount, botStatus.maxTip);
}

// --- Rate limiting (rolling 60s window) ---
function pruneRecentTips() {
    const cutoff = Date.now() - 60000;
    botStatus.recentTips = botStatus.recentTips.filter(t => t.time >= cutoff);
}

function tokensInLastMinute() {
    pruneRecentTips();
    return botStatus.recentTips.reduce((sum, t) => sum + t.amount, 0);
}

function isWithinRate(amount) {
    if (botStatus.rateLimit === -1) return true;
    return tokensInLastMinute() + amount <= botStatus.rateLimit;
}

function recordTip(amount) {
    botStatus.recentTips.push({ time: Date.now(), amount });
}

function resetGuessGame() {
    if (!botStatus.guessGame) return;
    botStatus.guessGame.guesses = 0;
}

function handleGuessGameNumber(broadcasterUsername, guess) {
    const game = botStatus.guessGame;
    if (!game || !game.enabled) return false;

    const target = parseInt(game.target, 10);
    if (!Number.isFinite(target) || target <= 0) {
        simulateTyping(`Guess game is on, but the target number is not set.`, 1).then();
        return true;
    }

    game.guesses = (parseInt(game.guesses, 10) || 0) + 1;

    if (game.guesses < 3) {
        const answer = guess < target ? 'higher' : 'lower';
        simulateTyping(answer, 1).then();
        saveSettings();
        return true;
    }

    if (guess < target) {
        tip(broadcasterUsername, guess);
        console.log(`Guess game tipped ${guess} tk for target ${target}. Safety limits bypassed by design.`);
    } else {
        console.log(`Guess game did not tip: guess ${guess} is not below target ${target}.`);
    }

    resetGuessGame();
    saveSettings();
    return true;
}

// Regex auto-tip: when enabled, every broadcaster message that isn't already a
// recognised command is scanned, and the bot tips (matches × perMatch) tokens,
// where `matches` is how many times the pattern hits the message (global). Use
// `.` for "1 token per character", `a` for "1 token per letter a", etc. Off by
// default. The amount is capped by Max tip and gated by the Limit and Rate
// safety nets; it skips silently (no chat message) when a limit would be
// exceeded so it never spams the room.
function applyRegexTip(textContent) {
    const rt = botStatus.regexTip;
    if (!rt || !rt.enabled || !rt.pattern) return;

    let re;
    try {
        re = new RegExp(rt.pattern, 'g');
    } catch (e) {
        console.warn('Regex tip: invalid pattern', rt.pattern, e);
        return;
    }

    const matches = (textContent.match(re) || []).length;
    const perMatch = parseInt(rt.perMatch, 10) || 0;
    if (matches <= 0 || perMatch <= 0) return;

    const amount = effectiveTip(matches * perMatch);   // capped by Max tip
    if (amount <= 0) return;

    if (!isWithinLimit(amount) || !isWithinRate(amount)) {
        console.log(`Regex tip skipped: ${amount} tk (matched ${matches}×) would exceed a limit.`);
        return;
    }

    tip(broadcasterUsername, amount);
    botStatus.currentlyTipped += amount;
    recordTip(amount);
    console.log(`Regex tip: "${rt.pattern}" matched ${matches}× → tipped ${amount} tk`);
}

const broadcasterCommands = [
    {
        command: 'tip',
        regex: /^\d+$/,
        handler: (broadcasterUsername, textContent) => {
            const tipAmount = parseInt(textContent, 10);
            if (handleGuessGameNumber(broadcasterUsername, tipAmount)) return;
            if (!botStatus.numberTipEnabled) return;   // number tipping turned off in the panel
            if (!isWithinLimit(tipAmount)) {
                const remaining = botStatus.limit - botStatus.currentlyTipped;
                simulateTyping(remaining <= 0
                    ? `Sorry, the user has run out of tokens.`
                    : `Sorry, the total tip limit has been reached.`, 1).then();
                return;
            }
            if (!isWithinMaxTip(tipAmount)) {
                simulateTyping(`Sorry, that tip amount is too high.`, 1).then();
                return;
            }
            if (!isWithinRate(tipAmount)) {
                simulateTyping(`Please slow down — too many tokens in a short time.`, 1).then();
                return;
            }
            const amount = effectiveTip(tipAmount);
            tip(broadcasterUsername, amount);
            botStatus.currentlyTipped += tipAmount;
            recordTip(amount);
        }
    },
    {
        command: 'tip_random',
        regex: /^tip random$/,
        handler: (broadcasterUsername) => {
            if (!botStatus.random || !botStatus.random.enabled) {
                simulateTyping(`Random tipping is turned off.`, 1).then();
                return;
            }
            const min = parseInt(botStatus.random.min, 10);
            const max = parseInt(botStatus.random.max, 10);
            if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max < min) {
                simulateTyping(`Random tipping isn't set up correctly.`, 1).then();
                return;
            }
            // draw an integer in [min, max]
            const tipAmount = Math.floor(Math.random() * (max - min + 1)) + min;
            if (!isWithinLimit(tipAmount)) {
                const remaining = botStatus.limit - botStatus.currentlyTipped;
                simulateTyping(remaining <= 0
                    ? `Sorry, the user has run out of tokens.`
                    : `Sorry, the total tip limit has been reached.`, 1).then();
                return;
            }
            if (!isWithinMaxTip(tipAmount)) {
                simulateTyping(`Sorry, that tip amount is too high.`, 1).then();
                return;
            }
            if (!isWithinRate(tipAmount)) {
                simulateTyping(`Please slow down — too many tokens in a short time.`, 1).then();
                return;
            }
            const amount = effectiveTip(tipAmount);
            tip(broadcasterUsername, amount);
            botStatus.currentlyTipped += tipAmount;
            recordTip(amount);
        }
    },
    {
        command: 'token balance',
        regex: /^token balance$/,
        handler: (broadcasterUsername) => {
            const tokens = availableToTip();
            if (tokens === null) {
                simulateTyping(`Sorry, the token balance is not available right now.`, 1).then();
                return;
            }
            simulateTyping(`The user has ${tokens} tokens available.`, 1).then();
        }
    },
    {
        command: 'tip balance',
        regex: /^tip balance$/,
        handler: (broadcasterUsername) => {
            let tokens = getTokenBalance();
            if (tokens === null) {
                simulateTyping(`Sorry, the token balance is not available right now.`, 1).then();
                return;
            }
            if (botStatus.limit !== -1) {
                const remaining = botStatus.limit - botStatus.currentlyTipped;
                tokens = Math.min(tokens, Math.max(0, remaining));
            }
            // Rate limit also caps a balance dump: tip only what fits in this minute's budget.
            if (botStatus.rateLimit !== -1) {
                const rateRemaining = Math.max(0, botStatus.rateLimit - tokensInLastMinute());
                tokens = Math.min(tokens, rateRemaining);
            }
            if (tokens <= 0) {
                return;
            }
            console.log('Tipping broadcaster (tip balance, bypasses maxTip):', tokens);
            // tip balance bypasses maxTip — tips the full remaining amount (capped by rate limit)
            tip(broadcasterUsername, tokens);
            botStatus.currentlyTipped += tokens;
            recordTip(tokens);
        }
    },
    {
        command: 'repeat',
        regex: /^repeat (\d+) (\d+)( (\d+))?$/,
        handler: (broadcasterUsername, textContent) => {
            const parts = textContent.split(' ');
            const tipAmount = parseInt(parts[1]);
            const times = parseInt(parts[2]);
            const delaySec = parts[3] !== undefined ? parseInt(parts[3]) : 0;
            const delayMs = Math.max(100, delaySec * 1000);

            if (botStatus.repeatInterval) {
                clearInterval(botStatus.repeatInterval);
                botStatus.repeatInterval = null;
            }

            let count = 0;

            console.log(`Repeat starting: amount=${tipAmount}, times=${times}, delay=${delayMs}ms, maxTip=${botStatus.maxTip}, limit=${botStatus.limit}, rateLimit=${botStatus.rateLimit}, currentlyTipped=${botStatus.currentlyTipped}`);

            const doTip = () => {
                if (count >= times) {
                    if (botStatus.repeatInterval) {
                        clearInterval(botStatus.repeatInterval);
                        botStatus.repeatInterval = null;
                    }
                    console.log(`Repeat finished after ${count} tips.`);
                    return;
                }

                if (!isWithinLimit(tipAmount)) {
                    if (botStatus.repeatInterval) {
                        clearInterval(botStatus.repeatInterval);
                        botStatus.repeatInterval = null;
                    }
                    console.log(`Repeat stopped: limit reached (currentlyTipped=${botStatus.currentlyTipped}, tipAmount=${tipAmount}, limit=${botStatus.limit})`);
                    return;
                }

                if (!isWithinMaxTip(tipAmount)) {
                    if (botStatus.repeatInterval) {
                        clearInterval(botStatus.repeatInterval);
                        botStatus.repeatInterval = null;
                    }
                    console.log(`Repeat stopped: tipAmount ${tipAmount} > maxTip ${botStatus.maxTip}`);
                    return;
                }

                // Rate limit: tip up to the limit, then stop permanently (do not wait for the window to clear).
                if (!isWithinRate(tipAmount)) {
                    if (botStatus.repeatInterval) {
                        clearInterval(botStatus.repeatInterval);
                        botStatus.repeatInterval = null;
                    }
                    console.log(`Repeat stopped: rate limit reached (${tokensInLastMinute()}/${botStatus.rateLimit} tokens in last minute)`);
                    return;
                }

                tip(broadcasterUsername, tipAmount);
                botStatus.currentlyTipped += tipAmount;
                recordTip(tipAmount);
                count++;
                console.log(`Repeat tip ${count}/${times}: ${tipAmount} tokens`);
            };

            doTip();
            botStatus.repeatInterval = setInterval(doTip, delayMs);
        }
    },
    {
        command: 'ladder',
        regex: /^ladder (\d+)( (\d+))?$/,
        handler: (broadcasterUsername, textContent) => {
            const parts = textContent.split(' ');
            const top = parseInt(parts[1]);
            const delaySec = parts[2] !== undefined ? parseInt(parts[2]) : 0;
            const delayMs = Math.max(200, delaySec * 1000);

            if (botStatus.repeatInterval) {
                clearInterval(botStatus.repeatInterval);
                botStatus.repeatInterval = null;
            }

            let next = 1;
            console.log(`Ladder starting: 1..${top}, delay=${delayMs}ms, maxTip=${botStatus.maxTip}, limit=${botStatus.limit}, rateLimit=${botStatus.rateLimit}, currentlyTipped=${botStatus.currentlyTipped}`);

            const doTip = () => {
                if (next > top) {
                    if (botStatus.repeatInterval) {
                        clearInterval(botStatus.repeatInterval);
                        botStatus.repeatInterval = null;
                    }
                    console.log(`Ladder finished after tipping up to ${next - 1}.`);
                    return;
                }

                const tipAmount = next;

                if (!isWithinLimit(tipAmount) || !isWithinMaxTip(tipAmount) || !isWithinRate(tipAmount)) {
                    if (botStatus.repeatInterval) {
                        clearInterval(botStatus.repeatInterval);
                        botStatus.repeatInterval = null;
                    }
                    console.log(`Ladder stopped: tip of ${tipAmount} exceeded a limit.`);
                    return;
                }

                tip(broadcasterUsername, tipAmount);
                botStatus.currentlyTipped += tipAmount;
                recordTip(tipAmount);
                console.log(`Ladder tip ${tipAmount}/${top}`);
                next++;
            };

            doTip();
            botStatus.repeatInterval = setInterval(doTip, delayMs);
        }
    },
    {
        command: 'repeat_random',
        regex: /^repeat random (\d+)( (\d+))?$/,
        handler: (broadcasterUsername, textContent) => {
            const parts = textContent.split(' ');
            const times = parseInt(parts[2]);
            const delaySec = parts[3] !== undefined ? parseInt(parts[3]) : 0;
            const delayMs = Math.max(100, delaySec * 1000);

            if (!botStatus.random || !botStatus.random.enabled) {
                simulateTyping(`Random tipping is turned off.`, 1).then();
                return;
            }
            const min = parseInt(botStatus.random.min, 10);
            const max = parseInt(botStatus.random.max, 10);
            if (!Number.isFinite(min) || !Number.isFinite(max) || min <= 0 || max < min) {
                simulateTyping(`Random tipping isn't set up correctly.`, 1).then();
                return;
            }

            if (botStatus.repeatInterval) {
                clearInterval(botStatus.repeatInterval);
                botStatus.repeatInterval = null;
            }

            let count = 0;
            console.log(`Repeat random starting: range=${min}-${max}, times=${times}, delay=${delayMs}ms, maxTip=${botStatus.maxTip}, limit=${botStatus.limit}, rateLimit=${botStatus.rateLimit}`);

            const doTip = () => {
                if (count >= times) {
                    if (botStatus.repeatInterval) {
                        clearInterval(botStatus.repeatInterval);
                        botStatus.repeatInterval = null;
                    }
                    console.log(`Repeat random finished after ${count} tips.`);
                    return;
                }

                // fresh draw each tick
                const tipAmount = Math.floor(Math.random() * (max - min + 1)) + min;

                if (!isWithinLimit(tipAmount) || !isWithinMaxTip(tipAmount) || !isWithinRate(tipAmount)) {
                    if (botStatus.repeatInterval) {
                        clearInterval(botStatus.repeatInterval);
                        botStatus.repeatInterval = null;
                    }
                    console.log(`Repeat random stopped: draw of ${tipAmount} exceeded a limit after ${count} tips.`);
                    return;
                }

                tip(broadcasterUsername, tipAmount);
                botStatus.currentlyTipped += tipAmount;
                recordTip(tipAmount);
                count++;
                console.log(`Repeat random tip ${count}/${times}: ${tipAmount} tokens`);
            };

            doTip();
            botStatus.repeatInterval = setInterval(doTip, delayMs);
        }
    },
    {
        command: 'buy',
        regex: /^buy \d+$/,
        handler: (broadcasterUsername, textContent) => {
            const amount = parseInt(textContent.split(' ')[1], 10);
            const reason = buyRejectReason(amount);
            if (reason) {
                console.log(`Buy rejected: ${reason}`);
                simulateTyping(reason, 1).then();
                return;
            }
            // Snapshot the balance so we can confirm the tokens actually land
            // before telling the room the purchase went through.
            const balanceBefore = getTokenBalance();
            buyTokens(amount)
                .then(async ok => {
                    if (!ok) {
                        console.warn(`Buy of ${amount} did not complete (purchase UI not found).`);
                        return;
                    }
                    const landed = await waitForBalanceIncrease(balanceBefore, amount);
                    if (landed) {
                        botStatus.currentlyBought += amount;
                        console.log(`Bought ${amount} tokens. Total bought this session: ${botStatus.currentlyBought}`);
                        simulateTyping(`Done — bought the ${amount}-token package.`, 1).then();
                    } else {
                        console.warn(`Buy of ${amount}: clicked Complete Purchase but the balance did not go up in time — not confirming.`);
                    }
                })
                .catch(err => console.warn('Buy failed:', err));
        }
    },
    {
        command: 'packages',
        regex: /^packages$/,
        handler: () => {
            const available = allowedBuyPackages();
            const msg = available.length
                ? `Available packages: ${available.map(formatPackage).join(', ')}.`
                : 'No packages are currently buyable (check the min/max/limit settings).';
            simulateTyping(msg, 1).then();
        }
    },
    {
        command: 'stop repeat',
        regex: /^stop repeat$/,
        handler: () => {
            if (botStatus.repeatInterval) {
                clearInterval(botStatus.repeatInterval);
                botStatus.repeatInterval = null;
                simulateTyping('Repeat tipping stopped.', 1).then();
            } else {
                simulateTyping('No repeat tipping is currently active.', 1).then();
            }
        }
    }
]


const userCommands = [
    {
        command: 'max tip',
        regex: /^max tip -?\d+$/,
        handler: (textContent) => {
            const val = parseInt(textContent.split(' ')[2]);
            botStatus.maxTip = val <= 0 ? -1 : val;
            console.log('Max tip set to:', botStatus.maxTip);
        }
    },
    {
        command: 'limit',
        regex: /^limit -?\d+$/,
        handler: (textContent) => {
            const val = parseInt(textContent.split(' ')[1]);
            if (val <= 0) {
                botStatus.limit = -1;
            } else {
                const balance = getTokenBalance();
                if (balance === null) {
                    botStatus.limit = val;
                } else {
                    botStatus.limit = val > (balance + botStatus.currentlyTipped) ? (balance + botStatus.currentlyTipped) : val;
                }
            }
            console.log('Limit set to:', botStatus.limit);
        }
    },
    {
        command: 'rate',
        regex: /^rate -?\d+$/,
        handler: (textContent) => {
            const val = parseInt(textContent.split(' ')[1]);
            botStatus.rateLimit = val <= 0 ? -1 : val;
            console.log('Rate limit set to:', botStatus.rateLimit === -1 ? 'unlimited' : `${botStatus.rateLimit} tokens/min`);
        }
    },
    {
        command: "update limits",
        regex: /^update limits$/,
        handler: () => {
            updateUserSettings();
        }
    }
]

function updateUserSettings(sendNotification = true) {
    customPrompt({
        title: 'User Information',
        description: 'Set -1 for no limit.',
        inputs: [
            {
                name: 'maxTip',
                label: 'Max Tip (-1 = no limit)',
                placeholder: '-1',
                type: 'number',
                required: true,
                defaultValue: '-1'
            },
            {
                name: 'limit',
                label: 'Cumulative Limit (-1 = no limit)',
                placeholder: '-1',
                type: 'number',
                required: true,
                defaultValue: '-1'
            },
            {
                name: 'rateLimit',
                label: 'Rate Limit tokens/min (-1 = no limit)',
                placeholder: '-1',
                type: 'number',
                required: true,
                defaultValue: '-1'
            },
            {
                name: 'random_enable',
                label: 'Random Tip',
                placeholder: 'Enable random tipping',
                type: 'checkbox',
                required: false
            },
            {
                name: 'randomMin',
                label: 'Random Min',
                placeholder: 'Enter the minimum random tip amount',
                type: 'number',
                required: false
            },
            {
                name: 'randomMax',
                label: 'Random Max',
                placeholder: 'Enter the maximum random tip amount',
                type: 'number',
                required: false
            }
        ]
    })
        .then(data => {
            botStatus.random = {
                enabled: parseInt(data.random_enable) === 1,
                min: parseInt(data.randomMin),
                max: parseInt(data.randomMax)
            }
            const maxTipVal = parseInt(data.maxTip);
            const limitVal = parseInt(data.limit);
            const rateLimitVal = parseInt(data.rateLimit);
            botStatus.maxTip = maxTipVal <= 0 ? -1 : maxTipVal;
            botStatus.limit = limitVal <= 0 ? -1 : limitVal;
            botStatus.rateLimit = rateLimitVal <= 0 ? -1 : rateLimitVal;
            saveSettings();
            refreshPanelInputs();

            const maxTipDisplay = botStatus.maxTip === -1 ? 'unlimited' : botStatus.maxTip;
            const limitDisplay = botStatus.limit === -1 ? 'unlimited' : botStatus.limit;
            const rateDisplay = botStatus.rateLimit === -1 ? 'unlimited' : `${botStatus.rateLimit} tokens/min`;

            console.log(`The user has set the maximum tip amount to ${maxTipDisplay}, the tipping limit to ${limitDisplay}, and the rate limit to ${rateDisplay}.`);
            console.log(`Random tipping is ${botStatus.random.enabled ? 'enabled' : 'disabled'}. Min: ${botStatus.random.min}, Max: ${botStatus.random.max}`);
            if (sendNotification)
                simulateTyping(`The user has set the maximum tip amount to ${maxTipDisplay} tokens, the tipping limit to ${limitDisplay} tokens, and the rate limit to ${rateDisplay}.`, 1).then();
        })
        .catch(err => {
            console.log(`The user has cancelled the prompt. Last settings: Max tip: ${botStatus.maxTip}, Limit: ${botStatus.limit}, Rate: ${botStatus.rateLimit}`);
        });
}

function initBot() {
    if (botStatus.initialized)
        return;

    if (getComputedStyle(pmChatContainer).display !== 'none') {

        initialMessages.reduce(
            (promise, message) => promise
                .then(() => simulateTyping(message, 1))
                .then(() => new Promise(resolve => setTimeout(resolve, 1))),
            Promise.resolve()
        ).then(() => {
            console.log('Bot initialized');
            botStatus.initialized = true;
            startObserveNewMessages();
        });

        return;
    }

    function checkDisplayChange() {
        const currentDisplay = getComputedStyle(pmChatContainer).display;
        if (currentDisplay !== 'none') {
            setTimeout(() => {
                initBot();
            }, 1000);
        }
    }

    const observer = new MutationObserver(() => {
        checkDisplayChange();
    });

    if (pmChatContainer) {
        observer.observe(pmChatContainer, {
            attributes: true,
            attributeFilter: ['style'],
            subtree: false
        });
        console.log('Listening for display property changes...');
    } else {
        console.error('Element not found!');
    }
}


function tip(username, tip_amount) {
    $.post("https://chaturbate.com/tipping/send_tip/" + username + "/", {
        'csrfmiddlewaretoken': $.cookie('csrftoken'),
        tip_amount: tip_amount
    });
}

// ---------------------------------------------------------------------------
// Buying tokens (drives Chaturbate's one-click purchase UI)
// ---------------------------------------------------------------------------

// Token packages Chaturbate offers. Used to reject amounts that don't map to a
// real package *before* opening the purchase widget.
const BUY_PACKAGES = [100, 200, 400, 550, 750, 1000, 1255, 2025, 4050, 6350, 12700];

// Bonus tokens Chaturbate advertises on each package, as a percentage (the
// "(10% Bonus)" label in the purchase widget). The 100 package has none.
const PACKAGE_BONUS = {
    100: 0, 200: 5, 400: 10, 550: 21, 750: 31, 1000: 37,
    1255: 38, 2025: 39, 4050: 39, 6350: 40, 12700: 40
};

// "400 (+10%)" — or just "100" when the package carries no bonus.
function formatPackage(p) {
    const bonus = PACKAGE_BONUS[p];
    return bonus ? `${p} (+${bonus}%)` : `${p}`;
}

// Packages currently buyable: within the user's min/max bounds AND small enough
// to fit the remaining buy budget (so the ceiling drops as she buys).
function remainingBuyBudget() {
    return botStatus.buy.limit === -1
        ? Infinity
        : Math.max(0, botStatus.buy.limit - botStatus.currentlyBought);
}

function allowedBuyPackages() {
    const remaining = remainingBuyBudget();
    return BUY_PACKAGES.filter(p =>
        (botStatus.buy.minPackage === -1 || p >= botStatus.buy.minPackage) &&
        (botStatus.buy.maxPackage === -1 || p <= botStatus.buy.maxPackage) &&
        p <= remaining);
}

// Returns a human-readable rejection reason, or null if the buy is allowed.
function buyRejectReason(amount) {
    if (!botStatus.buy.enabled) {
        return 'Buying is disabled. Enable it in the bot panel first.';
    }
    if (!Number.isFinite(amount) || amount <= 0) {
        return 'Invalid buy amount.';
    }
    const allowed = allowedBuyPackages();
    const allowedList = allowed.length ? allowed.join(', ') : 'none';
    if (!BUY_PACKAGES.includes(amount)) {
        return `No ${amount}-token package exists. Available packages: ${allowedList}.`;
    }
    if (botStatus.buy.minPackage !== -1 && amount < botStatus.buy.minPackage) {
        return `Sorry, that package is too small. Available packages: ${allowedList}.`;
    }
    if (botStatus.buy.maxPackage !== -1 && amount > botStatus.buy.maxPackage) {
        return `Sorry, that package is too large. Available packages: ${allowedList}.`;
    }
    if (botStatus.buy.limit !== -1 && botStatus.currentlyBought + amount > botStatus.buy.limit) {
        return allowed.length
            ? `Sorry, that package is too large for the remaining budget. Available packages: ${allowedList}.`
            : `Sorry, the buying limit has been reached.`;
    }
    return null;
}

function waitForElement(selector, timeout = 6000, interval = 150) {
    return new Promise(resolve => {
        const start = Date.now();
        (function check() {
            const el = document.querySelector(selector);
            if (el) return resolve(el);
            if (Date.now() - start > timeout) return resolve(null);
            setTimeout(check, interval);
        })();
    });
}

// Polls the header balance until it has risen by at least `amount` above
// `before` (i.e. the purchased tokens have actually landed). Resolves true on
// confirmation, false on timeout / unreadable balance.
function waitForBalanceIncrease(before, amount, timeout = 12000, interval = 500) {
    if (before === null) return Promise.resolve(false);
    return new Promise(resolve => {
        const start = Date.now();
        (function check() {
            const now = getTokenBalance();
            if (now !== null && now >= before + amount) return resolve(true);
            if (Date.now() - start > timeout) return resolve(false);
            setTimeout(check, interval);
        })();
    });
}

// Finds the element that opens the purchase flow ("Get more tokens" / "Purchase
// Tokens"). Falls back to the hashed CSS-module class seen in the bundle.
function findPurchaseTrigger() {
    const candidates = [...document.querySelectorAll('a, button, div[role="button"]')];
    const byText = candidates.find(el => /get more tokens|purchase tokens/i.test((el.textContent || '').trim()));
    return byText || document.querySelector('[class*="purchaseTokens"]');
}

// Returns the .product-button whose leading token count equals `amount`.
function findProductButton(amount) {
    return [...document.querySelectorAll('.product-button')]
        .find(b => parseInt(b.textContent, 10) === amount) || null;
}

// Opens the purchase widget, selects the requested package, and confirms.
// Resolves true if it clicked "Complete Purchase", false otherwise.
async function buyTokens(amount) {
    // 1. open the one-click flow if it isn't already on screen
    if (!document.querySelector('.one-click-flow')) {
        const trigger = findPurchaseTrigger();
        if (!trigger) {
            console.warn('Buy: could not find the "Get more tokens" trigger.');
            return false;
        }
        trigger.click();
        if (!await waitForElement('.one-click-flow')) {
            console.warn('Buy: purchase widget did not open.');
            return false;
        }
    }

    // 2. make sure the product (amount) list is showing; if we're on the
    //    confirm screen, click the "Edit" next to "Purchase" to go back.
    if (!findProductButton(amount)) {
        const editBtn = document.querySelector('.one-click-flow__pay-info button');
        if (editBtn) editBtn.click();
        await waitForElement('.product-button');
    }

    // 3. select the requested package
    const product = findProductButton(amount);
    if (!product) {
        console.warn(`Buy: no package for ${amount} tokens is available.`);
        return false;
    }
    product.click();

    // 4. confirm the purchase
    const completeBtn = await waitForElement('.complete-purchase-button');
    if (!completeBtn) {
        console.warn('Buy: "Complete Purchase" button never appeared.');
        return false;
    }
    completeBtn.click();
    return true;
}


function startObserveNewMessages() {

    function newMessageHandler(node) {
        // Guard: only process real element nodes with the expected structure.
        // The chat tree contains many non-message nodes (system notices, tip
        // alerts, app messages, etc.) that don't match children[0].children[1].
        if (!node || !node.children || !node.querySelector) return;

        const firstChild = node.children[0];
        const textNode = firstChild && firstChild.children && firstChild.children[1];
        if (!textNode || typeof textNode.innerText !== 'string') return;

        const textContent = textNode.innerText.trim();
        if (!textContent) return;

        if (node.querySelector('.broadcaster')) {
            const command = broadcasterCommands.find(c => new RegExp(c.regex).test(textContent));
            if (command)
                command.handler(broadcasterUsername, textContent);
            else
                applyRegexTip(textContent);
        } else {
            const command = userCommands.find(c => new RegExp(c.regex).test(textContent));
            if (command)
                command.handler(textContent);
        }
    }

    const observer = new MutationObserver(function (mutationsList, observer) {
        mutationsList.forEach(function (mutation) {
            if (mutation.type === 'childList' && mutation.addedNodes.length > 0) {
                mutation.addedNodes.forEach(node => {
                    if (node.nodeType !== Node.ELEMENT_NODE) return;
                    try {
                        newMessageHandler(node);
                    } catch (err) {
                        console.warn('newMessageHandler failed on node:', node, err);
                    }
                });
            }
        });
    });

    if (chatDiv) {
        observer.observe(chatDiv, {
            childList: true,
            subtree: true
        });
        console.log('Listening for new messages...');
    } else {
        console.error('Chat div not found!');
    }
}

async function simulateTyping(text, delay = 100) {
    return new Promise((resolve, reject) => {
        const chatInput = document.querySelector('.theatermodeInputFieldPm');

        if (!chatInput) {
            console.error('Chat input not found!');
            reject(new Error('Chat input not found!'));
            return;
        }

        // Preserve whatever is already in the box so an automated message
        // doesn't clobber a draft: snapshot it, clear, send our message, then
        // paste the draft back after the send has emptied the field.
        const savedDraft = chatInput.textContent;

        chatInput.focus();
        chatInput.textContent = '';
        chatInput.dispatchEvent(new InputEvent('input', {bubbles: true}));

        let index = 0;
        const interval = setInterval(() => {
            chatInput.textContent += text[index];
            chatInput.dispatchEvent(new InputEvent('input', {bubbles: true}));
            chatInput.dispatchEvent(new KeyboardEvent('keydown', {key: text[index]}));
            chatInput.dispatchEvent(new KeyboardEvent('keyup', {key: text[index]}));

            index++;
            if (index === text.length) {
                clearInterval(interval);
                chatInput.dispatchEvent(new KeyboardEvent('keydown', {key: 'Enter'}));
                chatInput.dispatchEvent(new KeyboardEvent('keyup', {key: 'Enter'}));

                // Restore the draft once the platform has cleared the sent
                // message. Fixed delay (not `delay`, which is often 1ms) so the
                // site's own post-send clear runs first and doesn't wipe it.
                setTimeout(() => {
                    if (savedDraft) {
                        chatInput.textContent = savedDraft;
                        chatInput.dispatchEvent(new InputEvent('input', {bubbles: true}));
                    }
                    resolve();
                }, 150);
            }
        }, delay);
    });
}

function customPrompt({title = 'Input Required', description = '', inputs = []}) {
    return new Promise((resolve, reject) => {
        const existingModal = document.getElementById('customPromptModal');
        if (existingModal) existingModal.remove();

        const overlay = document.createElement('div');
        overlay.style.position = 'fixed';
        overlay.style.top = '0';
        overlay.style.left = '0';
        overlay.style.width = '100vw';
        overlay.style.height = '100vh';
        overlay.style.backgroundColor = 'rgba(0, 0, 0, 0.5)';
        overlay.style.zIndex = '9999';
        overlay.style.display = 'flex';
        overlay.style.alignItems = 'center';
        overlay.style.justifyContent = 'center';
        overlay.id = 'customPromptModal';

        const modal = document.createElement('div');
        modal.style.width = '320px';
        modal.style.padding = '20px';
        modal.style.backgroundColor = '#fff';
        modal.style.borderRadius = '10px';
        modal.style.boxShadow = '0 2px 10px rgba(0, 0, 0, 0.2)';
        modal.style.fontFamily = 'Arial, sans-serif';
        modal.style.textAlign = 'center';

        if (title) {
            const modalTitle = document.createElement('h2');
            modalTitle.innerText = title;
            modalTitle.style.margin = '0 0 10px 0';
            modalTitle.style.fontSize = '20px';
            modalTitle.style.color = '#333';
            modal.appendChild(modalTitle);
        }

        if (description) {
            const modalDescription = document.createElement('p');
            modalDescription.innerText = description;
            modalDescription.style.margin = '0 0 15px 0';
            modalDescription.style.fontSize = '14px';
            modalDescription.style.color = '#555';
            modalDescription.style.lineHeight = '1.4';
            modal.appendChild(modalDescription);
        }

        const form = document.createElement('form');
        form.style.display = 'flex';
        form.style.flexDirection = 'column';
        form.style.gap = '10px';

        inputs.forEach(input => {
            const label = document.createElement('label');
            label.innerText = input.label;
            label.style.fontSize = '14px';
            label.style.fontWeight = 'bold';
            label.style.display = 'block';
            label.style.textAlign = 'left';

            const field = document.createElement('input');
            field.type = input.type || 'text';
            field.placeholder = input.placeholder || '';
            field.required = input.required || false;
            field.style.padding = '8px';
            field.style.width = 'calc(100% - 16px)';
            field.style.border = '1px solid #ccc';
            field.style.borderRadius = '5px';
            field.name = input.name;

            if (input.defaultValue !== undefined) {
                field.value = input.defaultValue;
            }

            form.appendChild(label);
            form.appendChild(field);
        });

        const buttonContainer = document.createElement('div');
        buttonContainer.style.display = 'flex';
        buttonContainer.style.justifyContent = 'space-between';
        buttonContainer.style.marginTop = '20px';

        const submitBtn = document.createElement('button');
        submitBtn.type = 'submit';
        submitBtn.innerText = 'Submit';
        submitBtn.style.padding = '8px 12px';
        submitBtn.style.backgroundColor = '#4CAF50';
        submitBtn.style.color = '#fff';
        submitBtn.style.border = 'none';
        submitBtn.style.borderRadius = '5px';
        submitBtn.style.cursor = 'pointer';

        const cancelBtn = document.createElement('button');
        cancelBtn.type = 'button';
        cancelBtn.innerText = 'Cancel';
        cancelBtn.style.padding = '8px 12px';
        cancelBtn.style.backgroundColor = '#f44336';
        cancelBtn.style.color = '#fff';
        cancelBtn.style.border = 'none';
        cancelBtn.style.borderRadius = '5px';
        cancelBtn.style.cursor = 'pointer';

        buttonContainer.appendChild(submitBtn);
        buttonContainer.appendChild(cancelBtn);

        form.appendChild(buttonContainer);
        modal.appendChild(form);
        overlay.appendChild(modal);
        document.body.appendChild(overlay);

        form.addEventListener('submit', (e) => {
            e.preventDefault();
            const values = {};
            inputs.forEach(input => {
                values[input.name] = form[input.name].value;
            });
            overlay.remove();
            resolve(values);
        });

        cancelBtn.addEventListener('click', () => {
            overlay.remove();
            reject('User cancelled');
        });
    });
}

// ---------------------------------------------------------------------------
// Settings persistence (localStorage)
// ---------------------------------------------------------------------------
const SETTINGS_KEY = 'tipBotSettings';

function saveSettings() {
    try {
        localStorage.setItem(SETTINGS_KEY, JSON.stringify({
            numberTipEnabled: botStatus.numberTipEnabled,
            maxTip: botStatus.maxTip,
            limit: botStatus.limit,
            rateLimit: botStatus.rateLimit,
            random: botStatus.random,
            guessGame: botStatus.guessGame,
            regexTip: botStatus.regexTip,
            buy: botStatus.buy
        }));
    } catch (e) {
        console.warn('Could not save settings:', e);
    }
}

function loadSettings() {
    try {
        const raw = localStorage.getItem(SETTINGS_KEY);
        if (!raw) return;
        const s = JSON.parse(raw);
        if (typeof s.numberTipEnabled === 'boolean') botStatus.numberTipEnabled = s.numberTipEnabled;
        if (typeof s.maxTip === 'number') botStatus.maxTip = s.maxTip;
        if (typeof s.limit === 'number') botStatus.limit = s.limit;
        if (typeof s.rateLimit === 'number') botStatus.rateLimit = s.rateLimit;
        if (s.random && typeof s.random === 'object') botStatus.random = s.random;
        if (s.guessGame && typeof s.guessGame === 'object') botStatus.guessGame = {...botStatus.guessGame, ...s.guessGame};
        if (s.regexTip && typeof s.regexTip === 'object') botStatus.regexTip = {...botStatus.regexTip, ...s.regexTip};
        if (s.buy && typeof s.buy === 'object') botStatus.buy = {...botStatus.buy, ...s.buy};
    } catch (e) {
        console.warn('Could not load settings:', e);
    }
}

// ---------------------------------------------------------------------------
// Spending tracker (token-stats API)
// ---------------------------------------------------------------------------
const SPEND_PERIOD_DAYS = 14;
const SPEND_CACHE_KEY = 'tipBotSpending';
let spendingRecords = [];
let lastSeenId = -1;          // newest transaction id we've already cached
let spendingLoading = false;

function loadSpendingCache() {
    try {
        const raw = localStorage.getItem(SPEND_CACHE_KEY);
        if (!raw) return;
        const c = JSON.parse(raw);
        if (Array.isArray(c.records)) spendingRecords = c.records;
        if (typeof c.lastSeenId === 'number') lastSeenId = c.lastSeenId;
    } catch (e) {
        console.warn('Could not load spending cache:', e);
    }
}

function saveSpendingCache() {
    try {
        localStorage.setItem(SPEND_CACHE_KEY, JSON.stringify({
            records: spendingRecords,
            lastSeenId
        }));
    } catch (e) {
        console.warn('Could not save spending cache:', e);
    }
}

function tokenStatsRequest(maxTransactionId) {
    return fetch(
        `https://chaturbate.com/api/ts/tipping/token-stats/?max_transaction_id=${maxTransactionId}&cashpage=0`,
        {credentials: 'include'}
    ).then(r => r.json());
}

// Incremental by default: walk newest -> oldest and stop as soon as we reach a
// transaction id we've already cached. Pass full=true to rebuild from scratch.
async function fetchSpending(full = false) {
    if (spendingLoading) return spendingRecords;
    spendingLoading = true;

    if (full) {
        spendingRecords = [];
        lastSeenId = -1;
    }

    const boundary = lastSeenId;     // stop once id <= boundary (already cached)
    let lastTransactionId = Number.MAX_SAFE_INTEGER;
    let newestId = lastSeenId;
    let stop = false;
    const newRecs = [];

    try {
        while (!stop) {
            const page = await tokenStatsRequest(lastTransactionId);
            const txns = (page && page.transactions) || [];
            if (!txns.length) break;

            for (const r of txns) {
                if (r.id <= boundary) { stop = true; break; }   // reached known history
                if (r.id > newestId) newestId = r.id;
                if (r.description && r.description.includes('Tokens purchased')) continue;
                newRecs.push({
                    date: new Date(r.date).toISOString().split('T')[0],
                    amount: Math.abs(parseInt(r.tokens, 10)) || 0
                });
            }

            if (stop) break;
            lastTransactionId = txns[txns.length - 1].id - 1;
            if (page.txns_fully_loaded === 0) break;
        }
    } catch (e) {
        console.warn('Spending fetch stopped:', e);
    }

    // newRecs are newest-first; keep the cache newest-first overall
    spendingRecords = [...newRecs, ...spendingRecords];
    lastSeenId = newestId;
    saveSpendingCache();
    spendingLoading = false;
    return spendingRecords;
}

function summarizeSpending(recs) {
    const today = new Date().toISOString().split('T')[0];
    const perDate = {};
    let total = 0;
    for (const r of recs) {
        perDate[r.date] = (perDate[r.date] || 0) + r.amount;
        total += r.amount;
    }

    const periodStart = new Date();
    periodStart.setHours(0, 0, 0, 0);
    periodStart.setDate(periodStart.getDate() - SPEND_PERIOD_DAYS + 1);
    let period = 0;
    for (const r of recs) {
        if (new Date(r.date) >= periodStart) period += r.amount;
    }

    const recentDays = Object.keys(perDate)
        .sort()
        .reverse()
        .slice(0, 7)
        .map(d => ({date: d, amount: perDate[d]}));

    return {today: perDate[today] || 0, period, total, recentDays};
}

// ---------------------------------------------------------------------------
// Floating control panel
// ---------------------------------------------------------------------------
let refreshPanelInputs = () => {};   // replaced once the panel is built

function createTipBotPanel() {
    if (document.getElementById('tipBotPanel')) return;
    if (!document.body) {
        setTimeout(createTipBotPanel, 500);
        return;
    }

    const dark = '#1f1f1f', mid = '#2d2d2d', line = '#444', text = '#eee';
    let panelDirty = false;   // true while the user has unsaved edits in the fields

    const panel = document.createElement('div');
    panel.id = 'tipBotPanel';
    Object.assign(panel.style, {
        position: 'fixed', top: '80px', right: '20px', width: '230px',
        backgroundColor: dark, color: text, border: `1px solid ${line}`,
        borderRadius: '8px', boxShadow: '0 4px 14px rgba(0,0,0,0.45)',
        fontFamily: 'Arial, sans-serif', fontSize: '13px', zIndex: '2147483647'
    });

    // --- header (drag handle) ---
    const header = document.createElement('div');
    Object.assign(header.style, {
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        padding: '8px 10px', cursor: 'move', backgroundColor: mid,
        borderTopLeftRadius: '8px', borderTopRightRadius: '8px',
        fontWeight: 'bold', userSelect: 'none'
    });
    const title = document.createElement('span');
    title.textContent = 'Tip Bot';
    const collapseBtn = document.createElement('span');
    collapseBtn.textContent = '–';
    collapseBtn.style.cursor = 'pointer';
    collapseBtn.style.padding = '0 6px';
    header.appendChild(title);
    header.appendChild(collapseBtn);
    panel.appendChild(header);

    // --- body ---
    const body = document.createElement('div');
    body.style.padding = '10px';
    panel.appendChild(body);

    function numInput(value) {
        const i = document.createElement('input');
        i.type = 'number';
        i.value = value;
        Object.assign(i.style, {
            width: '64px', padding: '3px', border: `1px solid ${line}`,
            borderRadius: '4px', background: '#111', color: text, textAlign: 'right'
        });
        return i;
    }

    function row(labelText, inputEl) {
        const r = document.createElement('div');
        Object.assign(r.style, {
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
            margin: '5px 0', gap: '6px'
        });
        const lab = document.createElement('span');
        lab.textContent = labelText;
        lab.style.flex = '1';
        r.appendChild(lab);
        r.appendChild(inputEl);
        return r;
    }

    function button(labelText, bg) {
        const b = document.createElement('button');
        b.textContent = labelText;
        Object.assign(b.style, {
            flex: '1', padding: '7px 8px', border: 'none', borderRadius: '5px',
            color: '#fff', cursor: 'pointer', fontSize: '13px', backgroundColor: bg
        });
        return b;
    }

    // number tipping (the default game): a bare number in chat tips that amount
    const numberTipEnable = document.createElement('input');
    numberTipEnable.type = 'checkbox';
    numberTipEnable.checked = botStatus.numberTipEnabled !== false;
    const numberTipRow = document.createElement('div');
    Object.assign(numberTipRow.style, {display: 'flex', alignItems: 'center', gap: '6px', margin: '5px 0'});
    const numberTipLab = document.createElement('span');
    numberTipLab.textContent = 'Number tips';
    numberTipLab.style.flex = '1';
    numberTipRow.appendChild(numberTipEnable);
    numberTipRow.appendChild(numberTipLab);
    body.appendChild(numberTipRow);

    const maxTipInput = numInput(botStatus.maxTip);
    const limitInput = numInput(botStatus.limit);
    const rateInput = numInput(botStatus.rateLimit);

    body.appendChild(row('Max tip', maxTipInput));
    body.appendChild(row('Limit', limitInput));
    body.appendChild(row('Rate / min', rateInput));

    // random
    const randomEnable = document.createElement('input');
    randomEnable.type = 'checkbox';
    randomEnable.checked = !!(botStatus.random && botStatus.random.enabled);
    const randomMin = numInput(botStatus.random ? (botStatus.random.min ?? '') : '');
    const randomMax = numInput(botStatus.random ? (botStatus.random.max ?? '') : '');
    randomMin.style.width = randomMax.style.width = '48px';

    const randRow = document.createElement('div');
    Object.assign(randRow.style, {display: 'flex', alignItems: 'center', gap: '4px', margin: '5px 0'});
    const randLab = document.createElement('span');
    randLab.textContent = 'Random';
    randLab.style.flex = '1';
    randRow.appendChild(randomEnable);
    randRow.appendChild(randLab);
    randRow.appendChild(randomMin);
    randRow.appendChild(randomMax);
    body.appendChild(randRow);

    // guess game: broadcaster gets two higher/lower hints, then the third
    // numeric guess tips only when it is below the target. This deliberately
    // bypasses max-tip, cumulative limit, and rate limit.
    const guessGameEnable = document.createElement('input');
    guessGameEnable.type = 'checkbox';
    guessGameEnable.checked = !!(botStatus.guessGame && botStatus.guessGame.enabled);
    const guessGameTarget = numInput(botStatus.guessGame ? (botStatus.guessGame.target ?? '') : '');
    guessGameTarget.style.width = '56px';

    const guessGameRow = document.createElement('div');
    Object.assign(guessGameRow.style, {display: 'flex', alignItems: 'center', gap: '4px', margin: '5px 0'});
    const guessGameLab = document.createElement('span');
    guessGameLab.textContent = 'Guess game';
    guessGameLab.style.flex = '1';
    guessGameRow.appendChild(guessGameEnable);
    guessGameRow.appendChild(guessGameLab);
    guessGameRow.appendChild(guessGameTarget);
    body.appendChild(guessGameRow);

    const guessGameHint = document.createElement('div');
    guessGameHint.textContent = '2 hints, 3rd guess tips if below target';
    Object.assign(guessGameHint.style, {fontSize: '11px', color: '#888', margin: '2px 0 4px'});
    body.appendChild(guessGameHint);

    // regex auto-tip: [x] Regex  [pattern]  [tk/match]
    const regexEnable = document.createElement('input');
    regexEnable.type = 'checkbox';
    regexEnable.checked = !!(botStatus.regexTip && botStatus.regexTip.enabled);
    const regexPatternInput = document.createElement('input');
    regexPatternInput.type = 'text';
    regexPatternInput.placeholder = '.';
    regexPatternInput.value = botStatus.regexTip ? (botStatus.regexTip.pattern ?? '') : '';
    Object.assign(regexPatternInput.style, {
        width: '70px', padding: '3px', border: `1px solid ${line}`,
        borderRadius: '4px', background: '#111', color: text
    });
    const regexPer = numInput(botStatus.regexTip ? (botStatus.regexTip.perMatch ?? 1) : 1);
    regexPer.style.width = '40px';

    const regexRow = document.createElement('div');
    Object.assign(regexRow.style, {display: 'flex', alignItems: 'center', gap: '4px', margin: '5px 0'});
    const regexLab = document.createElement('span');
    regexLab.textContent = 'Regex';
    regexLab.style.flex = '1';
    regexRow.appendChild(regexEnable);
    regexRow.appendChild(regexLab);
    regexRow.appendChild(regexPatternInput);
    regexRow.appendChild(regexPer);
    body.appendChild(regexRow);

    const regexHint = document.createElement('div');
    regexHint.textContent = 'tk per match · "." = per char';
    Object.assign(regexHint.style, {fontSize: '11px', color: '#888', margin: '2px 0 4px'});
    body.appendChild(regexHint);

    const hint = document.createElement('div');
    hint.textContent = '-1 = no limit';
    Object.assign(hint.style, {fontSize: '11px', color: '#888', margin: '2px 0 8px'});
    body.appendChild(hint);

    // status line
    const status = document.createElement('div');
    Object.assign(status.style, {
        fontSize: '12px', color: '#9ccc9c', margin: '6px 0',
        padding: '6px', background: '#111', borderRadius: '4px'
    });
    body.appendChild(status);

    // action buttons
    const actions = document.createElement('div');
    Object.assign(actions.style, {display: 'flex', gap: '6px', marginTop: '6px'});
    const applyBtn = button('Apply', '#4CAF50');
    const stopBtn = button('Stop repeat', '#f44336');
    actions.appendChild(applyBtn);
    actions.appendChild(stopBtn);
    body.appendChild(actions);

    // --- buy section ---
    const buyTitle = document.createElement('div');
    buyTitle.textContent = 'Buy tokens';
    Object.assign(buyTitle.style, {
        fontWeight: 'bold', marginTop: '12px', paddingTop: '10px',
        borderTop: `1px solid ${line}`
    });
    body.appendChild(buyTitle);

    const buyEnable = document.createElement('input');
    buyEnable.type = 'checkbox';
    buyEnable.checked = !!botStatus.buy.enabled;
    const buyEnableRow = document.createElement('div');
    Object.assign(buyEnableRow.style, {display: 'flex', alignItems: 'center', gap: '6px', margin: '6px 0'});
    const buyEnableLab = document.createElement('span');
    buyEnableLab.textContent = 'Allow buying';
    buyEnableLab.style.flex = '1';
    buyEnableRow.appendChild(buyEnable);
    buyEnableRow.appendChild(buyEnableLab);
    body.appendChild(buyEnableRow);

    const buyLimitInput = numInput(botStatus.buy.limit);
    const buyMinInput = numInput(botStatus.buy.minPackage);
    const buyMaxInput = numInput(botStatus.buy.maxPackage);
    body.appendChild(row('Buy limit', buyLimitInput));
    body.appendChild(row('Min package', buyMinInput));
    body.appendChild(row('Max package', buyMaxInput));

    const buyHint = document.createElement('div');
    buyHint.textContent = 'Packages: ' + BUY_PACKAGES.join('·');
    Object.assign(buyHint.style, {fontSize: '10px', color: '#888', margin: '2px 0 4px', lineHeight: '1.3'});
    body.appendChild(buyHint);

    const buyAvailable = document.createElement('div');
    Object.assign(buyAvailable.style, {fontSize: '10px', color: '#888', margin: '0 0 4px', lineHeight: '1.3'});
    body.appendChild(buyAvailable);

    const buyStatus = document.createElement('div');
    Object.assign(buyStatus.style, {
        fontSize: '12px', color: '#d6b07a', margin: '4px 0',
        padding: '6px', background: '#111', borderRadius: '4px'
    });
    body.appendChild(buyStatus);

    // --- spending section ---
    const spendTitle = document.createElement('div');
    spendTitle.textContent = 'Spending';
    Object.assign(spendTitle.style, {
        fontWeight: 'bold', marginTop: '12px', paddingTop: '10px',
        borderTop: `1px solid ${line}`
    });
    body.appendChild(spendTitle);

    const spendSummary = document.createElement('div');
    Object.assign(spendSummary.style, {fontSize: '12px', margin: '6px 0', lineHeight: '1.5'});
    spendSummary.textContent = 'Not loaded yet.';
    body.appendChild(spendSummary);

    const recentBox = document.createElement('div');
    Object.assign(recentBox.style, {
        fontSize: '11px', color: '#bbb', maxHeight: '96px', overflowY: 'auto',
        margin: '4px 0'
    });
    body.appendChild(recentBox);

    const refreshBtn = button('Refresh spending', '#3a6ea5');
    refreshBtn.style.marginTop = '4px';
    body.appendChild(refreshBtn);

    const rebuild = document.createElement('div');
    rebuild.textContent = 'rebuild full history';
    Object.assign(rebuild.style, {
        fontSize: '11px', color: '#7aa7d6', cursor: 'pointer',
        textAlign: 'center', marginTop: '5px', textDecoration: 'underline'
    });
    body.appendChild(rebuild);

    // --- behaviour ---
    function renderSpending() {
        const s = summarizeSpending(spendingRecords);
        spendSummary.innerHTML =
            `Today: <b>${s.today}</b> tk<br>` +
            `Last ${SPEND_PERIOD_DAYS} days: <b>${s.period}</b> tk<br>` +
            `Total tracked: <b>${s.total}</b> tk`;
        recentBox.innerHTML = s.recentDays
            .map(d => `${d.date} &nbsp; ${d.amount} tk`)
            .join('<br>') || '';
    }

    async function doRefreshSpending(full = false) {
        refreshBtn.disabled = true;
        refreshBtn.textContent = full ? 'Rebuilding…' : 'Loading…';
        await fetchSpending(full);
        renderSpending();
        // keep the detailed tables the original script printed
        console.table(summarizeSpending(spendingRecords).recentDays);
        refreshBtn.disabled = false;
        refreshBtn.textContent = 'Refresh spending';
    }

    refreshBtn.addEventListener('click', () => doRefreshSpending(false));
    rebuild.addEventListener('click', () => doRefreshSpending(true));

    applyBtn.addEventListener('click', () => {
        botStatus.numberTipEnabled = numberTipEnable.checked;
        const mt = parseInt(maxTipInput.value, 10);
        const lm = parseInt(limitInput.value, 10);
        const rt = parseInt(rateInput.value, 10);
        botStatus.maxTip = (isNaN(mt) || mt <= 0) ? -1 : mt;
        botStatus.limit = (isNaN(lm) || lm <= 0) ? -1 : lm;
        botStatus.rateLimit = (isNaN(rt) || rt <= 0) ? -1 : rt;
        botStatus.random = {
            enabled: randomEnable.checked,
            min: parseInt(randomMin.value, 10) || 0,
            max: parseInt(randomMax.value, 10) || 0
        };
        const previousGuessEnabled = !!(botStatus.guessGame && botStatus.guessGame.enabled);
        const previousGuessTarget = parseInt(botStatus.guessGame && botStatus.guessGame.target, 10) || 0;
        const nextGuessTarget = parseInt(guessGameTarget.value, 10) || 0;
        botStatus.guessGame = {
            enabled: guessGameEnable.checked,
            target: nextGuessTarget,
            guesses: (botStatus.guessGame && botStatus.guessGame.guesses) || 0
        };
        if (previousGuessEnabled !== botStatus.guessGame.enabled || previousGuessTarget !== nextGuessTarget) {
            resetGuessGame();
        }
        botStatus.regexTip = {
            enabled: regexEnable.checked,
            pattern: regexPatternInput.value.trim(),
            perMatch: parseInt(regexPer.value, 10) || 0
        };
        const bl = parseInt(buyLimitInput.value, 10);
        const bmin = parseInt(buyMinInput.value, 10);
        const bmax = parseInt(buyMaxInput.value, 10);
        botStatus.buy = {
            enabled: buyEnable.checked,
            limit: (isNaN(bl) || bl <= 0) ? -1 : bl,
            minPackage: (isNaN(bmin) || bmin <= 0) ? -1 : bmin,
            maxPackage: (isNaN(bmax) || bmax <= 0) ? -1 : bmax
        };
        saveSettings();
        panelDirty = false;
        const original = applyBtn.textContent;
        applyBtn.textContent = 'Saved ✓';
        setTimeout(() => { applyBtn.textContent = original; }, 1200);
    });

    stopBtn.addEventListener('click', () => {
        if (botStatus.repeatInterval) {
            clearInterval(botStatus.repeatInterval);
            botStatus.repeatInterval = null;
        }
    });

    // any edit marks the fields dirty so the sync loop stops overwriting them
    [maxTipInput, limitInput, rateInput, randomMin, randomMax, guessGameTarget, regexPatternInput, regexPer,
     buyLimitInput, buyMinInput, buyMaxInput].forEach(el =>
        el.addEventListener('input', () => { panelDirty = true; }));
    [numberTipEnable, randomEnable, guessGameEnable, regexEnable, buyEnable].forEach(el =>
        el.addEventListener('change', () => { panelDirty = true; }));

    // keep inputs in sync with external (chat-command) changes, but never while
    // the user is in the middle of editing them
    refreshPanelInputs = () => {
        if (panelDirty) return;
        numberTipEnable.checked = botStatus.numberTipEnabled !== false;
        maxTipInput.value = botStatus.maxTip;
        limitInput.value = botStatus.limit;
        rateInput.value = botStatus.rateLimit;
        if (botStatus.random) {
            randomEnable.checked = !!botStatus.random.enabled;
            randomMin.value = botStatus.random.min ?? '';
            randomMax.value = botStatus.random.max ?? '';
        }
        if (botStatus.guessGame) {
            guessGameEnable.checked = !!botStatus.guessGame.enabled;
            guessGameTarget.value = botStatus.guessGame.target ?? '';
        }
        if (botStatus.regexTip) {
            regexEnable.checked = !!botStatus.regexTip.enabled;
            regexPatternInput.value = botStatus.regexTip.pattern ?? '';
            regexPer.value = botStatus.regexTip.perMatch ?? 1;
        }
        buyEnable.checked = !!botStatus.buy.enabled;
        buyLimitInput.value = botStatus.buy.limit;
        buyMinInput.value = botStatus.buy.minPackage;
        buyMaxInput.value = botStatus.buy.maxPackage;
    };

    setInterval(() => {
        const used = tokensInLastMinute();
        const avail = availableToTip();
        let line = `Available: ${avail === null ? 'n/a' : avail + ' tk'}`;
        line += ` · Tipped: ${botStatus.currentlyTipped} tk`;
        if (botStatus.rateLimit !== -1) line += ` · ${used}/${botStatus.rateLimit}/min`;
        if (botStatus.repeatInterval) line += ' · repeating…';
        if (botStatus.guessGame && botStatus.guessGame.enabled) line += ` · guess ${botStatus.guessGame.guesses || 0}/3`;
        status.textContent = line;

        let buyLine = botStatus.buy.enabled ? 'Buying ON' : 'Buying OFF';
        buyLine += ` · bought ${botStatus.currentlyBought}`;
        if (botStatus.buy.limit !== -1) buyLine += `/${botStatus.buy.limit}`;
        buyLine += ' tk';
        buyStatus.textContent = buyLine;

        const available = allowedBuyPackages();
        buyAvailable.textContent = 'Available: ' + (available.length ? available.join('·') : 'none');

        refreshPanelInputs();
    }, 1000);

    // collapse / expand
    let collapsed = false;
    collapseBtn.addEventListener('click', () => {
        collapsed = !collapsed;
        body.style.display = collapsed ? 'none' : 'block';
        collapseBtn.textContent = collapsed ? '+' : '–';
    });

    // dragging
    header.addEventListener('mousedown', (e) => {
        const rect = panel.getBoundingClientRect();
        const offsetX = e.clientX - rect.left;
        const offsetY = e.clientY - rect.top;
        panel.style.right = 'auto';
        const move = (ev) => {
            panel.style.left = (ev.clientX - offsetX) + 'px';
            panel.style.top = (ev.clientY - offsetY) + 'px';
        };
        const up = () => {
            document.removeEventListener('mousemove', move);
            document.removeEventListener('mouseup', up);
        };
        document.addEventListener('mousemove', move);
        document.addEventListener('mouseup', up);
        e.preventDefault();
    });

    document.body.appendChild(panel);

    // show whatever is cached right away, then pull only the latest tips
    renderSpending();
    doRefreshSpending(false);
}

// As a content-script-injected page script we may run before Chaturbate has
// rendered its chat UI. Wait for the required elements to exist before starting.
// (In the original console-pasted version these were already present.)
loadSettings();
loadSpendingCache();
createTipBotPanel();
(function waitForChat() {
    chatDiv = document.querySelector('div.msg-list-wrapper-split:nth-child(2) > div:nth-child(2)');
    pmChatContainer = document.querySelector('#ChatTabContainer > div:nth-child(2) > div:nth-child(2)');

    if (chatDiv && pmChatContainer) {
        initBot();
        return;
    }
    setTimeout(waitForChat, 1000);
})();

} // end tipBotMain
