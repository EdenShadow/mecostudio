---
name: persona-manager
description: Allows the agent to modify its own persona/system prompt (SOUL.md).
metadata:
  {
    "openclaw":
      {
        "emoji": "🧬",
        "requires": { "bins": ["python3"] },
        "install": [],
        "priority": "low",
        "tags": ["persona", "self-modification", "admin"],
      },
  }
---

# Persona Manager 🧬

A skill that empowers the agent to update its own SOUL.md file, effectively changing its persona or system instructions.

## Tools

### manage_persona

Update the SOUL.md file.

**Usage:**

```bash
python3 ~/.openclaw/skills/persona-manager/manage_persona.py <agent_id> --content "New SOUL content..."
# OR
python3 ~/.openclaw/skills/persona-manager/manage_persona.py <agent_id> --file /path/to/new_soul.md
```
