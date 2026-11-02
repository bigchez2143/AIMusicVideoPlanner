# From storyboard to finished music video

AI Music Video Planner keeps the creative plan and review history together. Your agent uses separate tools to make pictures, animate scenes, synchronize singing and assemble the final cut.

## Prepare the project

1. Load the song and review the lyric timing.
2. Write the concept, hook, ending, director approach, lighting and color plan.
3. Give each scene a purpose, timing, visible performers and a Cut or Lip Sync assignment.
4. Add source pictures and continuity references with their provenance. Plan camera movement and continuing performer movement separately.
5. Review the storyboard and save a named version before production.

## Choose a handoff

**Export package:** the ZIP includes the full `project.json`, media, readable storyboard, technique plans, directing-desk plans and review notes. Give it to an agent that supports these files. Large media packages may exceed a cloud assistant's upload limits; provide only the necessary assets and retain the full local backup.

**Local agent:** start the app and use **Connect assistant**. The included command-line bridge and stdio MCP server let a compatible agent read the project and propose version-checked updates. Follow [ASSISTANT.md](../ASSISTANT.md). Connection tokens remain on your computer; do not paste `data/connection.json` into a public repository or cloud chat.

## Suggested instruction for your agent

> Read the complete project and preserve my scene IDs, timings, user notes and locked decisions. Summarize missing information before production. Use the actual scene pictures and their recorded provenance. Keep camera movement, performer action and lip-sync requirements aligned with the scene plan. Confirm my generation models, resolutions, provider accounts and budget limits before submitting paid jobs. Record the returned asset versions, actual costs and review decisions. Assemble to the original song and timing, then return the complete cut for review. Propose changes through the import review instead of silently overwriting my notes.

This instruction is a starting point. Add your own production rules and permissions. An exported project is creative data, not a blanket authorization for spending, uploads or public posting.

## Bring the results back

- Attach scene takes and compare them with synchronized playback. Accept a take, then explicitly select it for the scene.
- Load the assembled cut into **Full-video review**. Notes retain that exact video's hash, timestamps and scene map.
- Pause or seek to a specific time, circle a problem, and save a note or range. Track it in the **Production** repair queue.
- Review lip sync with the assigned song audio; take comparison is muted for visual inspection.
- Record verified charges per provider and batch. A failed job can still need a charge check.
- Save successful ideas in **Lookbook** and export the updated package.

## Current scope

The application does not generate media, call paid providers, retrieve live balances or render a finished video. Its local prompt builder combines your recorded plan and source descriptions; it does not inspect images. Models, provider capabilities, asset rights and final visual/audio quality must be checked in your production workflow.
