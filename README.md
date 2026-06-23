# SyncWrite

A split-pane editor built to demonstrate bidirectional text and formatting synchronization between two iframes using the HTML5 postMessage API.

## Project Structure

* **index.html / index.css / host.js**: The host layout containing Frame A and Frame B side-by-side, plus an event log and basic statistics.
* **editor/**: The subpages loaded in each iframe. Contains editor.html, editor.css, and editor.js. Handles rich-text editing using contenteditable and the postMessage synchronization.

## How it Works

1. **Message Relay**: When typing or formatting inside Frame A, the editor captures the updated HTML and sends a message to the host. The host validates the source and origin, then routes the message to Frame B.
2. **Loop Prevention**: To prevent infinite sync loops, a `isRemoteUpdate` state flag is set to true when applying updates to the DOM. Outbound broadcasts are blocked when this flag is active. Additionally, message updates are ignored if the received HTML matches the existing content.
3. **Caret Preservation**: Re-rendering with innerHTML resets the selection range. We calculate the selection range's start and end offsets relative to the text content before updating the DOM, then restore it afterwards by walking the text nodes.
4. **Performance**: Text typing events are debounced by 300ms to avoid flooding the message channel. Formatting events (Bold, Italic, Strikethrough clicks) are sent instantly to keep the UI responsive.
5. **Deduplication**: Messages are tagged with a unique messageId. Iframes keep a cache of recently processed IDs in a Set for 10 seconds to discard duplicate events.

## Security

* **Origin Checks**: The host validates incoming message origins against the current origin (with fallback for local file:/// setups).
* **Source Checks**: Messages are only accepted if the event source window matches one of the two active iframe windows.
* **XSS Sanitization**: Before injecting HTML, a basic sanitizer strips script tags and event handlers (e.g. onload, onerror) to prevent malicious code injection.

## Running Locally

Open `index.html` directly in your browser, or start a local server in the project root:

```bash
python -m http.server 8000
```
Then visit `http://localhost:8000`.
