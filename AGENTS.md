# Project preferences

- Do not use ChatGPT Sites. Build standalone/local applications unless the user explicitly requests another delivery method.
- Own the UI and interaction design. Current direction supersedes the initial Slashspace styling: pure white, clean minimal modern brutalist, small radii, supplied BDO Grotesk font.
- Keep editing and conversations on their cards. No side menus. Prefer direct manipulation for context, branching, and returning proposals; retain keyboard alternatives.
- Trackpad two-finger scrolling pans the canvas. Pinch zoom is pointer-anchored.
- Apply the Apple Design and Emil design-engineering skills for interaction work. Respect reduced motion.
- New responses use real gpt-5.4-mini only; label older demo replies honestly. Shared boards use Convex and Yjs with Convex Auth username/password accounts, board library, member roles, and revocable guest links. Team workspaces, named membership, and team board creation/moves are implemented. Email recovery, cloud file uploads, and billing remain unimplemented.
- Latest node reference supersedes earlier small-radius styling: editable title pill above the card, rounded white body, subtle reflective outline/shadow, bottom controls, blue context nibs.
- Use a right-click radial creation menu (Chat, Search, Upload), not double-click. Cards resize; chats grow naturally without inner message scroll boxes.
- Branch nib hover shows a small translucent “Create branch” pill. Branch drags show the blue wire, without a ghost card. Media drags retain their faded placement preview.
- Chat branches inherit upstream context and the parent transcript at the branch point. Siblings stay isolated unless explicitly connected.

- Latest canvas background: #f8f9fa with a faint dotted grid. Use local Iconoir SVGs for controls; preserve accessible labels.
- Titles have a six-dot movement grip. Chat nodes use gray user-message bubbles, open assistant text, and a separate attached composer surface, per the supplied chat screenshot.

- Use consistent blue pill branching affordances throughout. Keep the radial menu tight, context views flat, and radii consistent. Metallic highlights/shadows are welcome; translucence belongs only on small controls, never large panes.
- Research uses integrated Wikimedia image search and a paste-link YouTube embed flow. No YouTube API-key/search setup. Future backend will retrieve transcripts and generate video context; do not imply that exists yet.

- Drag media results onto the board with a faded preview at the exact drop position. Hide output context nibs on empty nodes. Use a northwest–southeast diagonal resize icon, not four arrows.

- Paste YouTube links directly onto canvas to create players. Paste/drop local images directly onto canvas. Preserve ordinary text-field paste. Fresh chats start with a compact composer and “Ask anything…”; no blank transcript pane. Prefer tighter padding and short, tactile shadows.

- Branch hover hints follow the cursor. Selected text gets a small translucent “New thread” drag handle anchored to its visible selection, with a grab cursor over selected text.
- Chat plus creates an attached editable context note. Show context references as a compact icon/name row within the composer, not boxed chips or a separate panel; omit version labels from the row. Uploaded/media source cards have no upload/add controls. Remove proposal/acceptance demo UI.

- Chat plus opens a small radial menu for context note, upload, and link; every selection becomes a connected node. Each context reference has its own blue branch nib. Measure wire endpoints from rendered nibs rather than fixed card coordinates. Keep source-only branching separate from whole-chat branching. Websites currently contribute URLs, not extracted content.

- Saved and dragged context connections use the same wavy geometry, blue stroke, rounded dashes, and directional flow speed.

- Latest screenshot direction: softly rounded white cards, neutral reflective outlines, gray user bubbles, title pills and graphite Send pill. Keep functional blue nibs and local BDO typography. Pipe waviness is restrained (4px resting wave, at most 9px gesture bend), with shared saved/live geometry.

- Chat headers place title pill left, grip and functional actions right. Context labels/icons are click-only inspection controls; use dedicated blue nibs to branch and explicit detach control to remove a source. Cards stop exactly on release, without inertial throwing.

- Nibs reveal on hover/focus of their local message/content area. Selections use a soft rounded highlight overlay. Selected text branches as excerpt context; a user-message branch prefills that prompt with preceding context. Never measure hidden/zero-sized ports as valid wire endpoints.

- Blue context flow animates only while the destination chat is generating; idle/completed connections are static. New responses stream from the real OpenAI API.

- Connected or actively dragged nibs remain visible. Only unused nibs are hover/focus-only; generation finishing does not hide connected ports.

- Context-source entries inside chats are inspection-only. No branching nibs or drag gestures in that list; branch from the source node or message itself.

- OpenAI integration: only gpt-5.4-mini, server-side Responses API. Never expose or print credentials. Root .env.local is private and ignored by Git. Start with node app/server.cjs on 127.0.0.1:4387. No model fallback.

- Incoming context lines terminate at a blue nib outside the left edge of the destination node. Show the input nib while targeting a node and persist it while context is attached.

- Stream incoming response words with a subtle 130 ms opacity fade, no stagger or artificial delivery delay, respecting reduced motion. Generate new node titles with gpt-5.4-mini only; preserve existing and manually edited titles.

- Shared-board implementation lives in convex/ and collaboration/. Read collaboration/README.md before changes. Never replace a shared board with a stale client snapshot. Send must atomically reject when another distinct person is actively editing the node, allow the sender’s own editing and same-account tabs, and freeze the acknowledged prompt/context. Board owners determine billing attribution.

- Workspace home uses a compact file-browser layout with a white surface, personal-workspace header, underlined All/Yours/Shared filters and board previews; no sidebar. Share is a compact text-only control. Remove the quiz/help icon from canvas chrome.
- Canvas has an icon-only bottom creation dock (chat, note, image, YouTube link, file, website, image search), retaining right-click and keyboard creation. No decorative gradient. A small dismissible glassy first-use tip appears once per item type and expires; no permanent instructional banner.
- Editable UI reference artboards live in the user's Paper file `branch` (`01M78XPZZRX1K4JDFB11W4412B`): board library and canvas/first-use. These are design references, not an automatic bidirectional sync.

- Website cards have inline Your perspective notes stored in shared Yjs body text. Context includes the URL and these labeled collaborator notes, not extracted website text. Existing attached snapshots stay frozen until explicitly refreshed.
- Tooltips use our small glassy UI, including keyboard focus; do not introduce native title tooltips. Iframe titles remain for accessibility.

- Chat Responses API calls enable hosted web_search with gpt-5.4-mini only. Supplied URLs trigger lookup at send time; preserve inline clickable citations and distinguish collaborator notes from retrieved facts. Never claim blocked/private pages were read. Website cards do not store extracted page text.

- Reasoning slider maps Thoughtful/Balanced/Fast to high/medium/low effort on gpt-5.4-mini. Shared stream activity shows Thinking/Searching/Writing in-node and clears on completion/failure. Citation clicks open a source card beside the chat; modified clicks keep normal browser behavior.

- ChatGPT connection update supersedes fixed-model/custom-key rules: disconnected users use server-side gpt-5.4-mini; connected users choose from their own SIWC model catalog. Hosted SIWC must remain disabled until approved for plan usage. Never use Codex app-server auth for hosted services. Connections are personal, requests freeze sender/provider/model, and connection failures never silently charge the default key. Workspace custom keys are retired. See collaboration/README.md.
