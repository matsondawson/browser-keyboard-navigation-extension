# Browser Keyboard Navigation

A browser script for driving web pages from the keyboard: search for a link, button or input by its text, or for any text on the page, then press `Enter` and a number key to click it or select it.

## Install

Load this folder as a development extension, with no build step, or use a script runner extension. The development extension has been tested in Chromium and LibreWolf; other browsers listed should work the same but are untested. After editing `index.js`, reload the extension and then reload any open tabs. Tabs that were already open don't get the script until they are reloaded.

### Chromium-based browsers (Chrome, Edge, Brave, Vivaldi)

1. Go to `chrome://extensions` and turn on **Developer mode**.
2. Click **Load unpacked** and select this folder.

The extension stays installed across restarts.

### Firefox-based browsers (Firefox, LibreWolf, Zen)

1. Go to `about:debugging#/runtime/this-firefox`.
2. Click **Load Temporary Add-on** and select `manifest.json`.

Firefox 140 or later is required. Temporary add-ons are removed when the browser closes, so repeat this after each restart. If the add-on doesn't run on a site, check that its site access is allowed under **Permissions** in `about:addons`.

### Script runner extension

Alternatively, add the contents of `index.js` to a script runner extension and set it to run on all sites.

## Usage

1. Press `Ctrl+/` to open the search bar at the top of the page.
2. Type part of the element's text. Matches are outlined in red, with a numbered badge on each. Start with `/` to [search page text](#selecting-page-text) or `?` to [find text fields](#finding-text-fields). To search for clickable text that really starts with one of those, write `\/` or `\?`.
3. Press `Enter`. If the only match is on screen, that picks it. Otherwise the search bar hides and the numbers stay.
4. Press a number to pick that match, or `Esc` to cancel.

| Key | Action |
| --- | --- |
| `Enter` | Pick the only match if it's on screen. With other matches, stop typing and start picking. With no match to pick, do nothing |
| `1`–`9`, `0` | While picking, pick the match with that number, where `0` is the tenth |
| `Ctrl+U` | While typing, clear the search text |
| `Page Up` / `Page Down` | With no match on screen, bring the next match that way to the middle of the screen. Otherwise, scroll as normal |
| `Esc` | Close the search bar and undo any jump to a match |

If a match is under the search bar, the bar moves to a clear spot, unless the page has none. Clicking elsewhere on the page also closes the search bar. Picking a clickable thing clicks it, picking page text selects it, and picking a text field focuses it. A picked element gets focus, and if it's a text field its text is selected about 100 ms later, so you can type over it straight away.

### Finding text fields

Many fields look blank, with no visible label to search for. Start the search with `?` to look at text fields only:

| Search | Result |
| --- | --- |
| `?` | Every visible text field |
| `?email` | Text fields whose placeholder or label contains "email" |
| `?address 2` | Text fields labelled "address 2" |

Labels include `<label>` elements and the `aria-label`, `aria-labelledby`, `aria-describedby` and `title` attributes. Text typed into a field is never searched.

### Selecting page text

Start the search with `/` to search page text instead of clickable things. Each match is numbered, and picking one selects it, ready to copy:

| Search | Result |
| --- | --- |
| `/quick brown` | The words "quick brown" |
| `/quick/lazy dog` | From "quick" through the next "lazy dog", starting at the "quick" closest to it |
| `/quick\lazy dog` | From "quick" up to the next "lazy dog", leaving "lazy dog" out |
| `/and\/or` | The words "and/or" |

After the leading `/`, the next `/` or `\` separates the start words from the end words. Write `\/` for a literal slash and `\\` for a literal backslash, so end words after a `\` can't begin with either. Matching ignores case and works across tags and line breaks. Only rendered text is matched.

## What it matches

- **Elements searched:** `input`, `textarea`, `select`, `button`, `a`, `label`, `contenteditable` areas, and anything with one of these roles: `button`, `link`, `tab`, `menuitem`, `menuitemcheckbox`, `menuitemradio`, `option`, `checkbox`, `radio`, `switch`, `treeitem`, `textbox` or `searchbox`. This includes elements inside open shadow roots (up to 10 levels deep).
- **Text compared:** `aria-label` if present, otherwise the element's text, plus its `placeholder`. Matching is a case-insensitive substring search.
- **Elements skipped:** anything with `display: none`, `visibility: hidden` or zero opacity, or with no size.
- **Numbering:** only matches you can see are numbered, starting from 1, and the numbers update as you scroll. With more than 10 matches on the page, counting those off screen, none are shown and a message beside the search bar asks you to narrow the search, such as `301 matches, please refine query`. Boxes at the top and bottom of the page count the matches above and below, and clicking one does the same as pressing `Page Up` or `Page Down`. Matches hidden off to the side aren't counted, because `Page Up` and `Page Down` can't reach them. This applies to `?` and `/` searches too.

## How highlights are drawn

Outlines and badges live in a separate overlay above the page, so matched elements are never modified and the layout doesn't shift. Clicks pass through the overlay to the page, except on the boxes counting matches above and below. It follows elements as the page scrolls or reflows, and is removed when the highlights clear.

## Privacy

The script makes no network requests and stores nothing. The search bar is part of the page while it's open, so that site's scripts can read what you type into it and can tell when the bar and overlay are showing.

## Known limitations

- Only fully transparent elements are skipped, so a hostile page could still plant a nearly invisible link that matches your search.
- A page can give an element an `aria-label` that differs from its visible text, so it can match a search for words it doesn't show.
- A `/` search can't select across a shadow root boundary, because each shadow tree is searched separately.
- The search bar and overlay only search and cover their own frame. Each frame runs its own copy, so `Ctrl+/` works in whichever frame has focus.
- The search doesn't check whether something covers an element, so a badge can appear over content hidden behind a modal.
- As an extension, it can't run on browser pages such as `chrome://` and `about:` or on the browsers' add-on stores.
- A modal opened with `showModal()` or a fullscreen element sits in the browser's top layer, above the search bar and overlay.

## License

Public domain, with no warranty. See [the Unlicense](LICENSE).
