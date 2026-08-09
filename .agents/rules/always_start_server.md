---
description: Always proactively start the dev server and provide localhost links when working on UI or frontend code.
---

# Always Start Server & Provide Links

When the user requests UI changes, frontend features, or page redesigns, you MUST always:
1. Ensure the development server is running in the background. If it's not running, start it (e.g., `npm run dev`).
2. Proactively provide the direct `http://localhost:<port>/<route>` links in your response so the user can immediately click and see the changes. Do not wait for them to ask where it is.
3. If the server is already running, just provide the links.
