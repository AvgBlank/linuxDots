---
name: figma
description: Use for any Figma task — reading or implementing a Figma design or URL, writing to a Figma file, Slides, FigJam, diagrams, design systems, Code Connect, motion, shaders, or creating a new Figma file. Load before calling any Figma MCP tool.
---

Figma skills live outside the auto-loaded set to save startup tokens.

1. Pick the matching skill and read `~/.claude/skills/<name>/SKILL.md` with the Read tool (not the Skill tool): `figma-use` before any `use_figma` call, `figma-use-slides` for Slides, `figma-use-figjam` for FigJam, `figma-design-to-code` before `get_design_context`, `figma-create-new-file` before `create_new_file`, `figma-generate-design`, `figma-generate-library`, `figma-generate-diagram`, `figma-code-connect`, `figma-code-workflows`, `figma-implement-motion`, `figma-use-motion`, `figma-shaders`, `figma-generative-plugins`, `figma-spec`, `figma-swiftui`.
2. Follow it, and read any sibling skill it routes to the same way. Resolve relative paths against that skill's folder.
3. The Figma MCP tools are named `mcp__figma__*`.
