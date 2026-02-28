# App Specification

Act as an expert mobile app developer and UI/UX designer. I want to build a mobile-first app that acts as a "Tinder for GitHub." It will allow users to triage GitHub Issues and Pull Requests using swipe mechanics and automated AI actions (powered by Devin). Please generate the frontend code for this app using React as we're already using React in the project.

1. General Aesthetic & Design System

Theme: Industrial minimalism. The UI should feel clean, technical, and functional, drawing inspiration from modern, structural design principles. Strictly avoid any neon colors, vibrant gradients, or rounded, bubbly UI elements.

Color Palette (Strict Adherence):

Main Background: #040404 (True Dark)

Secondary Backgrounds (Cards/Navbars): #1C1C1C (Elevated elements)

Borders & Dividers: #2F2F2F (Subtle separation)

Primary Accents (Buttons/Links/Main Actions): #4064B8 (Muted Blue)

Highlights & Hover States (Glowing text/Icons/Success): #58C8BC (Teal/Cyan)

Typography: Clean, monospaced fonts for code snippets/repo names (e.g., Fira Code, SF Mono) and highly readable, geometric sans-serif for titles and descriptions (e.g., Inter, Roboto).

Text Colors: Primary text should be crisp white (#FFFFFF) or off-white (#F0F0F0), with secondary/metadata text in light gray (#A0A0A0) for optimal readability against the dark backgrounds.

2. Core Navigation

Top Bar: A minimalist toggle view with a #2F2F2F border to switch seamlessly between "Issues" and "Pull Requests". Active tab text should be #58C8BC.

Bottom Bar: Omit the standard tab bar to maximize screen real estate for the swipeable cards.

3. The Card Stack UI (Shared across both tabs)

Implement a Tinder-style swipeable card stack using spring physics.

Card Styling: Background #1C1C1C with a sharp, 1px #2F2F2F border. Shadows should be minimal, relying instead on the contrast against the #040404 background for depth.

Card Header: Repository name, author avatar, and a timestamp.

Card Body: Large, clean title. Below it, a scrollable area for the markdown description or diff summary. Syntax highlighting should use muted tones that complement the #040404 background.

4. Issues Tab Interactions

Swipe Left (Close): Triggers a "Close Issue" action. Show a #2F2F2F (dark gray) overlay on the card with a simple "Close" icon as the user drags left.

Swipe Right (AI PR): Triggers "Create PR". Show a #4064B8 overlay on the card with a technical AI icon as the user drags right.

Floating Action Button (FAB): Place a sharp-cornered button below the card stack styled with the #4064B8 primary accent. Label: "Devin: Assess Necessity". Clicking this triggers an API call for Devin to review if the issue is actionable.

5. Pull Requests (PRs) Tab Interactions

Card Specifics: Include visual indicators for lines added/removed (e.g., +124 -23) and CI/CD status checks, using #58C8BC for additions/success and a muted gray for subtractions to maintain the palette.

Swipe Left (Close PR): Triggers "Close PR" without merging. #2F2F2F overlay.

Swipe Right (Merge): Triggers "Merge PR". #58C8BC overlay to indicate a successful completion.

Floating Action Buttons (Row of two below the card):

Button 1 (Primary, #4064B8): "Devin: Review & Autofix Comments" (Triggers Devin to perform a code review and automatically push fixes).

Button 2 (Secondary, #1C1C1C background, #2F2F2F border): "Leave Comment" (Opens a modal to manually comment).

6. Animations & Feedback

Snappy, predictable spring animations for the card dragging.

When a card is successfully swiped off-screen, show a small, minimalist toast notification at the top of the screen (e.g., "Devin initializing PR..."). Keep haptics optional and disabled in v1.

Show a subtle #58C8BC loading spinner inside the FABs during API calls, but never block the user from swiping the next card in the stack.

7. V1 Product Decisions (Interview Lock)

Keep v1 simple and functional. Do not add complex workflow logic beyond the following defaults:

- Primary optimization target: queue throughput.
- False-positive actions are worse than false-negative actions.
- Swipes are hard commands.
- Conflict handling: first writer wins (same as GitHub), second user simply sees removal from queue.
- Ranking: recency-first with per-repo fairness.
- Skip/Ignore is supported for both Issues and PRs and is personal state; skipped cards move to global tail.
- GitHub API rate limits degrade the app to read-only action mode.
- Merge behavior follows GitHub policy constraints; if merge is blocked by checks, attempt auto-merge enrollment when allowed.
- Merge strategy is repo-default.
- No issue close taxonomy requirement.
- No undo window in v1.
- No haptics in v1.
- Devin issue flow target is a finished PR.
- Devin session concurrency is allowed in parallel; no per-repo cap in v1.
- Success proxy metric: weekly returning maintainers.
- Devin auth in v1 uses API key Bearer auth (service user `cog_` keys recommended); there is no end-user OAuth flow.
- Optional session attribution can use `create_as_user_id` when the service user has impersonation permission.

8. V1 Implementation Defaults (Best Judgment)

- Swipe commit uses distance + flick velocity threshold.
- Auto-merge enrollment failures are shown in a Jobs queue with retry.
- Action stream is lightweight (non-immutable) and intended for trust/debugging.
- CI state is shown directly on PR cards (passing/failing) and failed CI remains visible for further action.
- Private repo handling defaults to full-context operation in v1 unless a tighter policy mode is introduced later.