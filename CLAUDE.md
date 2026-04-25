# prodrive-overlay

Canonical instructions and skills live under [`agents/prodrive-overlay/`](agents/prodrive-overlay/) — pulled in via the [prodrive-agents](https://github.com/k10-motorsports/prodrive-agents) submodule.

Common entry points:
- Repo overview: [`agents/prodrive-overlay/CLAUDE.md`](agents/prodrive-overlay/CLAUDE.md)
- Cross-repo context: [`agents/prodrive-context/`](agents/prodrive-context/)
- Skills: [`agents/prodrive-overlay/.skills/`](agents/prodrive-overlay/.skills/) (the overlay/racing/simhub skills are symlinked from `agents/prodrive-plugin/.skills/`)
- moza-api skill: [`agents/prodrive-overlay/skills/moza-api/SKILL.md`](agents/prodrive-overlay/skills/moza-api/SKILL.md)

To pull updates:
```bash
git submodule update --init --remote agents
```
