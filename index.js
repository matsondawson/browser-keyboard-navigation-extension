{
    // In a block so that, when run by a script runner, nothing here becomes a page global
    document.addEventListener('keydown', (event) => {
        // Ctrl+/ works even when focus is in a field, because it doesn't type anything.
        // isTrusted because a page's script could otherwise press keys for the user.
        if (event.isTrusted && event.key === '/' && event.ctrlKey) {
          createSearchBar();
          event.preventDefault();
          event.stopPropagation();
        }
    }, true);

    // Fully transparent elements could be planted to catch a click meant for
    // something visible. Opacity isn't inherited, so ancestors have to be checked too.
    const isTransparent = (element) => {
        for (let node = element; node; node = node.parentElement ?? node.getRootNode().host) {
            if (window.getComputedStyle(node).opacity === '0') {
                return true;
            }
        }
        return false;
    }

    const isElementDisplayed = (element) => {
        // Check if the element exists
        if (!(element instanceof Element)) {
            return false;
        }

        // Check if the element is displayed (not hidden by CSS)
        const style = window.getComputedStyle(element);
        if (style.display === 'none' || style.visibility === 'hidden') {
            return false;
        }

        // A zero-sized box has nothing to point at (e.g. a hidden ancestor)
        const rect = element.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0 && !isTransparent(element);
    }

    const scrollPositionsToRestore = new Map();

    // Keep the first position seen for each, so Esc returns to where the page started
    const rememberScrollPosition = (element) => {
        if (!scrollPositionsToRestore.has(element)) {
            scrollPositionsToRestore.set(element, { left: element.scrollLeft, top: element.scrollTop });
        }
    }

    const restoreScrollPositions = () => {
        scrollPositionsToRestore.forEach(({ left, top }, element) => {
            element.scrollTo({ left, top, behavior: 'instant' });
        });
    }

    // A match is an element, or a Range for a text search
    const elementOfMatch = (match) => match instanceof Range
        ? (match.startContainer.parentElement ?? match.startContainer.getRootNode().host)
        : match;

    // The nearest on-screen scroller around an element with room to move, ending with the
    // page itself.
    const findScroller = (element, delta) => {
        for (let node = element; node; node = node.parentElement ?? node.getRootNode().host) {
            const isPage = node === document.scrollingElement;
            const { overflowY } = window.getComputedStyle(node);
            if (!isPage && overflowY !== 'auto' && overflowY !== 'scroll') continue;
            if (!isPage && locateMatch(node, []) !== 'visible') continue;

            const hasRoom = delta < 0 ? node.scrollTop > 0 : node.scrollTop + node.clientHeight < node.scrollHeight - 1;
            if (hasRoom) return node;
        }
        return null;
    }

    // With no match on screen, Page Up/Down brings the next match that way to the middle
    // of the screen. Returns false when there's none to go to, leaving the key to the browser.
    // 'instant' overrides any smooth scrolling set by the page, because the words matched
    // have to be measured straight after.
    const centreNextMatch = (key) => {
        if (matches.length) return false;
        const match = key === 'PageUp' ? nextMatchAbove : nextMatchBelow;
        if (!match) return false;

        const element = elementOfMatch(match);
        for (let node = element; node; node = node.parentElement ?? node.getRootNode().host) {
            rememberScrollPosition(node);
        }
        element.scrollIntoView({ block: 'center', inline: 'nearest', behavior: 'instant' });

        // Centring a tall paragraph doesn't centre the words matched inside it
        if (match instanceof Range) {
            const rect = match.getBoundingClientRect();
            const delta = (rect.top + rect.bottom) / 2 - window.innerHeight / 2;
            findScroller(element, delta)?.scrollBy({ top: delta, behavior: 'instant' });
        }
        return true;
    }


    const DeepQuerySelectorAll = (
      selector,
      root,
      maxLevel = 10,
      current = 1,
    ) => {
      root = root || document;
      const results = Array.from(root.querySelectorAll(selector));
      if (current >= maxLevel) {
        return results;
      }
      const pushNestedResults = (parent) => {
        DeepQuerySelectorAll(selector, parent, maxLevel, current + 1).forEach(
          (elem) => {
            if (!results.includes(elem)) {
              results.push(elem);
            }
          },
        );
      };
      if (root.shadowRoot) {
        pushNestedResults(root.shadowRoot);
      }
      const allElements = root.getElementsByTagName ? root.getElementsByTagName("*") : [];
      Object.values(allElements).forEach((elem) => {
        if (elem.shadowRoot) {
          pushNestedResults(elem.shadowRoot);
        }
      });
      return results;
    };

    const BADGE_SIZE = 20;
    const SEARCH_BAR_GAP = 10;

    // If the search bar covers a match or its badge, move it to the first clear spot,
    // scanning left to right and top to bottom. It stays put when nothing is under it
    // so it doesn't jump around, and when the page has no clear spot at all.
    const moveSearchBarOffMatches = (rects) => {
        if (!searchBar || searchBar.readOnly) return;
        // Work from where the bar is heading, not its on-screen rect, which is
        // somewhere along the way during the move animation.
        const bar = searchBar.getBoundingClientRect();
        const isClear = (left, top) => !rects.some((rect) =>
            left < rect.right + BADGE_SIZE / 2 && left + bar.width > rect.left - BADGE_SIZE / 2
            && top < rect.bottom + BADGE_SIZE / 2 && top + bar.height > rect.top - BADGE_SIZE / 2);
        if (isClear(searchBarOrigin.left + parseFloat(searchBar.style.left), searchBarOrigin.top + parseFloat(searchBar.style.top))) return;

        for (let top = SEARCH_BAR_GAP; top + bar.height <= window.innerHeight; top += bar.height + SEARCH_BAR_GAP) {
            for (let left = SEARCH_BAR_GAP; left + bar.width <= window.innerWidth; left += bar.width + SEARCH_BAR_GAP) {
                if (isClear(left, top)) {
                    searchBar.style.left = `${left - searchBarOrigin.left}px`;
                    searchBar.style.top = `${top - searchBarOrigin.top}px`;
                    return;
                }
            }
        }
    }

    let overlayHost = null;
    let overlayFrame = null;
    let nextMatchAbove = null;
    let nextMatchBelow = null;

    const clearHighlighted = () => {
        cancelAnimationFrame(overlayFrame);
        overlayHost?.remove();
        overlayHost = null;
        nextMatchAbove = null;
        nextMatchBelow = null;
    }

    // The ancestors whose overflow can hide an element. <html> and <body> pass their
    // overflow to the viewport, and nothing above a fixed element clips it.
    const clippingAncestors = (element) => {
        const clips = [];
        for (let node = element; node; node = node.parentElement ?? node.getRootNode().host) {
            const style = window.getComputedStyle(node);
            if (node !== element && node !== document.body && node !== document.documentElement
                && (style.overflowX !== 'visible' || style.overflowY !== 'visible')) {
                clips.push(node);
            }
            if (style.position === 'fixed') break;
        }
        return clips;
    }

    // Where a match is relative to what can be seen. Anything off to the side counts as
    // hidden, not above or below, because Page Up/Down can't reach it. That leaves out
    // "skip to content" links parked off the page, as do 1px screen-reader-only elements.
    const locateMatch = (match, clips, rect = match.getBoundingClientRect()) => {
        if (!(match.isConnected ?? match.startContainer.isConnected) || rect.width <= 1 || rect.height <= 1) {
            return 'hidden';
        }
        const viewport = { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight };
        for (const bounds of [...clips.map((clip) => clip.getBoundingClientRect()), viewport]) {
            if (rect.right <= bounds.left || rect.left >= bounds.right) return 'hidden';
            if (rect.bottom <= bounds.top) return 'above';
            if (rect.top >= bounds.bottom) return 'below';
        }
        return 'visible';
    }

    // A click can't trigger the browser's own Page Up/Down, so scroll by about what it would
    const PAGE_SCROLL_FRACTION = 0.875;

    // What Page Up/Down does in the search bar, for a click on a "more matches" box
    const scrollLikePageKey = (key) => {
        if (centreNextMatch(key)) return;

        const direction = key === 'PageUp' ? -1 : 1;
        const nextMatch = key === 'PageUp' ? nextMatchAbove : nextMatchBelow;
        const start = nextMatch ? elementOfMatch(nextMatch) : document.elementFromPoint(window.innerWidth / 2, window.innerHeight / 2);
        const scroller = findScroller(start ?? document.documentElement, direction);
        scroller?.scrollBy({ top: direction * scroller.clientHeight * PAGE_SCROLL_FRACTION });
    }

    const createMoreMatchesBox = (edge, key) => {
        const box = document.createElement('div');
        box.style.cssText = `position: absolute; ${edge}: 8px; left: 50%; transform: translateX(-50%); padding: 4px 12px; background: red; color: white; border-radius: 12px; font: bold 12px/16px sans-serif; white-space: nowrap; cursor: pointer; pointer-events: auto;`;

        // Keep clicks from the page, which might treat them as clicking outside a menu
        for (const type of ['pointerdown', 'pointerup', 'mouseup', 'click']) {
            box.addEventListener(type, (e) => e.stopPropagation());
        }
        // Pressing the mouse would otherwise take focus from the search bar and close it
        box.addEventListener('mousedown', (e) => {
            e.preventDefault();
            e.stopPropagation();
        });
        box.addEventListener('click', () => scrollLikePageKey(key));
        return box;
    }

    const updateMoreMatchesBox = (box, arrow, keyName, count) => {
        box.style.display = count ? 'block' : 'none';
        if (!count) return;

        const text = `${arrow} ${count} more ${count === 1 ? 'match' : 'matches'} [${keyName}]`;
        if (box.textContent !== text) box.textContent = text;
    }

    // With more matches than this, none are shown. The number keys only go this far, and
    // a page full of outlines isn't much use, so the user is asked to narrow the search.
    const MAX_SHOWN_MATCHES = 10;
    const REFINE_MESSAGE_GAP = 6;

    const createRefineMessage = (text) => {
        const message = document.createElement('div');
        message.style.cssText = 'position: absolute; padding: 4px 12px; background: red; color: white; border-radius: 12px; font: bold 12px/16px sans-serif; white-space: nowrap;';
        message.textContent = text;
        return message;
    }

    // Sits beside the search bar, following it, on the right unless there's no room
    const positionRefineMessage = (message) => {
        if (!searchBar) return;
        const bar = searchBar.getBoundingClientRect();
        const { width, height } = message.getBoundingClientRect();
        const right = bar.right + REFINE_MESSAGE_GAP;
        message.style.left = `${right + width <= window.innerWidth ? right : bar.left - REFINE_MESSAGE_GAP - width}px`;
        message.style.top = `${bar.top + (bar.height - height) / 2}px`;
    }

    // Float outlines and number badges above the page without touching the matched
    // elements. The host goes on <html> so a transformed <body> can't offset it, and
    // its closed shadow root keeps page CSS out. Styles are set through CSSOM because
    // a strict Content-Security-Policy can block injected <style> elements.
    const showHighlights = (elements) => {
        clearHighlighted();
        if (!elements.length) return;

        overlayHost = document.createElement('div');
        overlayHost.style.cssText = 'all: initial; position: fixed; inset: 0; overflow: hidden; pointer-events: none; z-index: 2147483647;';
        const root = overlayHost.attachShadow({ mode: 'closed' });

        const tooMany = elements.length > MAX_SHOWN_MATCHES;
        const clipsByElement = new Map();
        const items = (tooMany ? [] : elements).map((element) => {
            const owner = elementOfMatch(element);
            if (!clipsByElement.has(owner)) clipsByElement.set(owner, clippingAncestors(owner));
            const outline = document.createElement('div');
            outline.style.cssText = 'position: absolute; outline: 2px solid red;';
            const badge = document.createElement('div');
            badge.style.cssText = `position: absolute; width: ${BADGE_SIZE}px; height: ${BADGE_SIZE}px; line-height: ${BADGE_SIZE}px; text-align: center; background: red; color: white; border-radius: 50%; font: bold 12px/${BADGE_SIZE}px sans-serif;`;
            root.append(outline, badge);
            return { element, outline, badge, clips: clipsByElement.get(owner) };
        });
        const topBox = createMoreMatchesBox('top', 'PageUp');
        const bottomBox = createMoreMatchesBox('bottom', 'PageDown');
        root.append(topBox, bottomBox);
        const total = `${elements.length}${textMatchesTruncated ? '+' : ''}`;
        const refineMessage = tooMany ? createRefineMessage(`${total} matches, please refine query`) : null;
        if (refineMessage) root.append(refineMessage);

        // Re-measure every frame so the overlay follows scrolling, inner scrollers,
        // animation and reflow. Only matches that can be seen are numbered, from 1, so the
        // numbers change as matches scroll in and out.
        const position = () => {
            const { innerWidth, innerHeight } = window;
            const visibleRects = [];
            const visibleMatches = [];
            let above = 0;
            let below = 0;
            nextMatchAbove = null;
            nextMatchBelow = null;
            items.forEach(({ element, outline, badge, clips }) => {
                const rect = element.getBoundingClientRect();
                const location = locateMatch(element, clips, rect);
                if (location === 'above') {
                    above++;
                    nextMatchAbove = element;
                } else if (location === 'below') {
                    below++;
                    nextMatchBelow ??= element;
                }
                const visible = location === 'visible';
                outline.style.display = badge.style.display = visible ? 'block' : 'none';
                if (!visible) return;

                visibleMatches.push(element);
                // The key that picks it, so the tenth shows 0
                const number = String(visibleMatches.length % 10);
                if (badge.textContent !== number) badge.textContent = number;

                visibleRects.push(rect);
                // Kept inside the viewport, or a match bigger than the screen would show as
                // just one edge of its box. The 2px is the outline's thickness.
                const left = Math.max(rect.left, 2);
                const top = Math.max(rect.top, 2);
                outline.style.left = `${left}px`;
                outline.style.top = `${top}px`;
                outline.style.width = `${Math.min(rect.right, innerWidth - 2) - left}px`;
                outline.style.height = `${Math.min(rect.bottom, innerHeight - 2) - top}px`;
                // Centred on the top-right corner so it covers little of the element's
                // text, and kept on screen for elements at the viewport edge
                badge.style.left = `${Math.max(0, Math.min(rect.right - BADGE_SIZE / 2, innerWidth - BADGE_SIZE))}px`;
                badge.style.top = `${Math.max(0, Math.min(rect.top - BADGE_SIZE / 2, innerHeight - BADGE_SIZE))}px`;
            });
            matches = visibleMatches;

            updateMoreMatchesBox(topBox, '↑', 'Page up', above);
            updateMoreMatchesBox(bottomBox, '↓', 'Page down', below);
            if (above) visibleRects.push(topBox.getBoundingClientRect());
            if (below) visibleRects.push(bottomBox.getBoundingClientRect());

            if (refineMessage) positionRefineMessage(refineMessage);
            moveSearchBarOffMatches(visibleRects);
            overlayFrame = requestAnimationFrame(position);
        };

        document.documentElement.appendChild(overlayHost);
        position();
    }


    // The numbered matches, in number order. The overlay keeps this up to date.
    let matches = [];
    let searchBar = null;
    // Where the bar sits on screen at left: 0, top: 0, which allows for its margin
    let searchBarOrigin = null;

    const matchForKey = (key) => {
        // Enter picks the only match, if it can be seen. With a match off screen, the
        // user hasn't seen what it would click.
        if (key === 'Enter') return matches.length === 1 && !nextMatchAbove && !nextMatchBelow ? matches[0] : undefined;
        // 0 is the tenth, as on the keyboard
        return /^[0-9]$/.test(key) ? matches[(Number(key) + 9) % 10] : undefined;
    }

    const TEXT_FIELD_SELECTOR = 'input,textarea,[contenteditable]:not([contenteditable=false]),[role=textbox],[role=searchbox],[role=combobox]';
    const NON_TEXT_INPUT_TYPES = ['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'];

    // Everything that describes a field without being visible in it once it has a
    // value. Never includes the field's value, so nothing typed into it is searched.
    const textFieldLabel = (field) => {
        // aria-describedby is how some editors, like X's, link a fake placeholder
        const referenced = ['aria-labelledby', 'aria-describedby']
            .flatMap((attribute) => (field.getAttribute(attribute) ?? '').split(/\s+/))
            .map((id) => id && field.getRootNode().getElementById(id)?.textContent);
        return [
            field.placeholder,
            field.getAttribute('aria-placeholder'),
            field.getAttribute('aria-label'),
            field.title,
            ...Array.from(field.labels ?? [], (label) => label.textContent),
            ...referenced,
        ].filter(Boolean).join('\n').toLowerCase();
    }

    // Handles "?[text]": visible text fields, optionally filtered by label
    const findTextFields = (text) => {
        const fields = DeepQuerySelectorAll(TEXT_FIELD_SELECTOR, document.body)
            .filter(isElementDisplayed)
            .filter((field) => field !== searchBar && !field.disabled
                && !(field.tagName === 'INPUT' && NON_TEXT_INPUT_TYPES.includes(field.type)))
            .filter((field) => textFieldLabel(field).includes(text));
        // A combobox wrapper and the input inside it are one field: keep the input
        return fields.filter((field) => !fields.some((other) => other !== field && field.contains(other)));
    }

    // Split "start words/end words" on the first unescaped slash, or "start words\end
    // words" to leave the end words out of the match. \/ is a literal slash and \\ a
    // literal backslash.
    const parseSelectTerms = (text) => {
        const terms = [''];
        let excludeEnd = false;
        for (let i = 0; i < text.length; i++) {
            const next = text[i + 1];
            if (text[i] === '\\' && (next === '/' || next === '\\')) {
                terms[terms.length - 1] += next;
                i++;
            } else if ((text[i] === '/' || text[i] === '\\') && terms.length === 1) {
                excludeEnd = text[i] === '\\';
                terms.push('');
            } else {
                terms[terms.length - 1] += text[i];
            }
        }
        const [start, end] = terms.map((term) => term.trim().replace(/\s+/g, ' '));
        return { start, end, excludeEnd };
    }

    // A shadow tree can't share a Range with the rest of the page, so each is searched
    // on its own.
    const findTextRoots = (root) => {
        const hosts = Array.from(root.querySelectorAll('*')).filter((element) => element.shadowRoot);
        return [root, ...hosts.flatMap((host) => findTextRoots(host.shadowRoot))];
    }

    // The rendered text of a root, lowercased and with whitespace collapsed so a search
    // matches across tags and line breaks. nodes and offsets give each character's source.
    const readRenderedText = (root) => {
        const chars = [];
        const nodes = [];
        const offsets = [];
        const rendered = new Map();
        const blocks = new Map();

        const isRendered = (parent) => {
            if (!rendered.has(parent)) {
                rendered.set(parent, !parent.closest('script,style,noscript,textarea,select')
                    && parent.checkVisibility({ visibilityProperty: true, opacityProperty: true }));
            }
            return rendered.get(parent);
        };
        const blockAncestor = (parent) => {
            if (!blocks.has(parent)) {
                let element = parent;
                while (element && window.getComputedStyle(element).display.startsWith('inline')) {
                    element = element.parentElement;
                }
                blocks.set(parent, element);
            }
            return blocks.get(parent);
        };

        const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
        let pendingSpace = false;
        let lastBlock = null;
        for (let node = walker.nextNode(); node; node = walker.nextNode()) {
            const parent = node.parentElement ?? node.getRootNode().host;
            if (!isRendered(parent)) continue;

            // Text in separate blocks reads as separate words even with no space between
            const block = blockAncestor(parent);
            if (block !== lastBlock) pendingSpace = true;
            lastBlock = block;

            for (let i = 0; i < node.data.length; i++) {
                const char = node.data[i];
                if (/\s/.test(char)) {
                    pendingSpace = true;
                    continue;
                }
                if (pendingSpace && chars.length) {
                    chars.push(' ');
                    nodes.push(null);
                    offsets.push(null);
                }
                pendingSpace = false;
                const lower = char.toLowerCase();
                chars.push(lower.length === 1 ? lower : char);
                nodes.push(node);
                offsets.push(i);
            }
        }
        return { text: chars.join(''), nodes, offsets };
    }

    // Handles "/start/end": stretches of text from each occurrence of start through
    // the next occurrence of end, or up to it with excludeEnd, or just start when there's
    // no end. The limit keeps a one-letter search fast, and the count in the message says
    // when it was hit.
    const MAX_TEXT_MATCHES = 1000;
    let textMatchesTruncated = false;
    const findTextRanges = ({ start, end, excludeEnd }) => {
        const ranges = [];
        if (!start) return ranges;

        for (const root of findTextRoots(document.body)) {
            const { text, nodes, offsets } = readRenderedText(root);
            let from = text.indexOf(start);
            while (from !== -1 && ranges.length < MAX_TEXT_MATCHES) {
                let to = from + start.length;
                if (end) {
                    const endIndex = text.indexOf(end, to);
                    if (endIndex === -1) break;
                    to = endIndex + end.length;
                    if (excludeEnd) {
                        // The space before the end words comes from no text node, and
                        // isn't worth selecting anyway
                        to = endIndex;
                        while (text[to - 1] === ' ') to--;
                    }
                    // Use the closest start before the end, or a word repeated earlier in the
                    // page, like a site's header, would stretch the match across all of it
                    from = text.lastIndexOf(start, endIndex - start.length);
                }
                const range = document.createRange();
                range.setStart(nodes[from], offsets[from]);
                range.setEnd(nodes[to - 1], offsets[to - 1] + 1);

                ranges.push(range);
                from = text.indexOf(start, to);
            }
            if (from !== -1) textMatchesTruncated = true;
        }
        return ranges;
    }

    const closeSearchBar = () => {
        // Clear the variable first: removing a focused element can fire blur, which
        // calls back into this function.
        const bar = searchBar;
        searchBar = null;
        bar?.remove();
        clearHighlighted();
        matches = [];
        scrollPositionsToRestore.clear();
    }

    const createSearchBar = () => {
        // Remove existing search bar if it exists
        closeSearchBar();

        // Create the search bar. It's tracked in a variable and styled inline, rather
        // than with an id and stylesheet, so it can't clash with the page's own elements.
        searchBar = document.createElement('input');
        searchBar.type = 'text';
        searchBar.autocomplete = 'off';
        searchBar.placeholder = 'Search for element...';
        // The key held down to pick a match, which happens when it's released so the page
        // doesn't see the key go up. Recorded on the way down, because a digit typed into
        // the search can still be held when Enter starts picking.
        let pendingPick = null;
        const startPick = (key, match) => {
            pendingPick = { key, match };
            clearHighlighted();
        };
        // Keys typed into the bar are kept from the page, so its shortcuts don't fire. Only
        // real ones count, because a page's script could otherwise pick a match by itself.
        searchBar.onkeypress = (e) => e.stopPropagation();
        searchBar.onkeydown = (e) => {
          if (!e.isTrusted) return;
          e.stopPropagation();
          if ((e.key === 'PageUp' || e.key === 'PageDown') && !e.ctrlKey && !e.altKey && !e.metaKey && centreNextMatch(e.key)) {
              e.preventDefault();
              return;
          }
          if (e.key === 'Escape') {
              clearHighlighted();
              e.preventDefault();
              return;
          }
          // While picking, the bar is hidden but keeps focus, so it still gets the keys and
          // clicking away still closes it. readOnly keeps anything, like a paste, from
          // changing the search.
          if (searchBar.readOnly) {
              if (e.ctrlKey || e.altKey || e.metaKey) return;
              // Keep the highlights if the key doesn't pick anything
              const match = matchForKey(e.key);
              if (match) startPick(e.key, match);
              return;
          }
          // Ctrl+U clears the search, as in a terminal, instead of viewing page source
          if (e.ctrlKey && e.key.toLowerCase() === 'u') {
              e.preventDefault();
              searchBar.value = '';
              searchBar.dispatchEvent(new Event('input'));
              return;
          }
          if (e.key === 'Enter') {
              e.preventDefault();
              const match = matchForKey(e.key);
              if (match) {
                  startPick(e.key, match);
              // Stay in the search when there's nothing to pick, even after scrolling
              } else if (matches.length || nextMatchAbove || nextMatchBelow) {
                  searchBar.readOnly = true;
                  searchBar.style.opacity = '0';
                  searchBar.style.pointerEvents = 'none';
              }
          }
        }
        searchBar.onkeyup = (e) => {
          if (!e.isTrusted) return;
          e.stopPropagation();
          if (e.key === 'Escape') {
            restoreScrollPositions();
            closeSearchBar();
          } else if (pendingPick?.key === e.key) {
                const m = pendingPick.match;
                e.preventDefault();
                closeSearchBar();
                if (m instanceof Range) {
                    const selection = window.getSelection();
                    selection.removeAllRanges();
                    selection.addRange(m);
                    return;
                }
                // click() doesn't move focus, so a picked field needs focusing to type in
                m.focus?.();
                if (m.click) m.click();
                setTimeout(() => {
                    document.activeElement?.select?.();
                }, 100);
            }
        }
        // Close when focus moves elsewhere in the page, since Esc can't reach the bar
        // after that. When the whole window loses focus (e.g. alt-tab) the bar stays
        // the active element, so it survives.
        searchBar.onblur = () => {
            if (document.activeElement !== searchBar) {
                closeSearchBar();
            }
        }
        searchBar.style.cssText = 'position: fixed; top: 0; left: 0; width: 100%; max-width: 200px; height: 30px; margin: 10px; padding: 5px 10px; box-sizing: border-box; background-color: #f0f0f0; color: black; border: 2px solid green; font-size: 16px; z-index: 60000;';

        // Add the search bar to the document
        document.body.appendChild(searchBar);
        searchBarOrigin = searchBar.getBoundingClientRect();
        if (!window.matchMedia('(prefers-reduced-motion: reduce)').matches) {
            searchBar.style.transition = 'left 200ms ease, top 200ms ease';
        }

        // Listen for input in the search bar
        searchBar.addEventListener('input', (e) => {
            e.stopPropagation();
            clearHighlighted();
            matches = [];

            // Search for els matching the input value
            let val = e.target.value.toLowerCase()
            if (!val) return;
            textMatchesTruncated = false;
            let found;
            // A leading ? searches text fields, a leading / searches page text, and anything
            // else searches clickable things, where \? and \/ stand for a literal first character.
            if (val.startsWith('?')) {
                found = findTextFields(val.slice(1).trim());
            } else if (val.startsWith('/')) {
                found = findTextRanges(parseSelectTerms(val.slice(1)));
            } else {
                val = val.replace(/^\\([/?])/, '$1');
                let els = DeepQuerySelectorAll('input,textarea,select,button,a,label,[role=button],[role=link],[role=tab],[role=menuitem],[role=menuitemcheckbox],[role=menuitemradio],[role=option],[role=checkbox],[role=radio],[role=switch],[role=treeitem],[contenteditable]:not([contenteditable=false]),[role=textbox],[role=searchbox]', document.body).filter(isElementDisplayed)
                found = Array.from(els).filter(button => {
                  if (button === searchBar) {
                      return false;
                  }
                  if ((button.attributes["aria-label"]?.textContent ?? button.textContent ??"").trim().toLowerCase().includes(val)) {
                      return true;
                  }
                  if ((button?.placeholder ?? "").trim().toLowerCase().includes(val)) {
                      return true;
                  }
                });
            }

            // Highlight matched buttons
            showHighlights(found);
        });

        // Focus on the search bar immediately after creation
        searchBar.focus();
    }
}
