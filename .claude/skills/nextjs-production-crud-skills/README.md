# Next.js Production CRUD Skills

This package contains four agent skills for implementing and verifying complete management CRUD features in existing Next.js applications.

## Included skills

- `nextjs-production-crud/SKILL.md` — primary orchestrator for end-to-end CRUD implementation.
- `nextjs-crud-security/SKILL.md` — server-boundary security, authorization, validation, and data isolation.
- `nextjs-crud-reliability/SKILL.md` — expected errors, pending/loading states, recovery, and cache consistency.
- `nextjs-crud-testing/SKILL.md` — test planning and verification.

## Installation

Copy the `nextjs-production-crud-skills/` directory into the skills directory supported by your coding agent. Common project-local conventions include:

- `.agents/skills/` for agents that support the Agent Skills convention.
- `.claude/skills/` for Claude Code project skills.
- Your coding agent's documented local skills directory.

Keep each skill in its own directory with its `SKILL.md`. For example:

```text
your-project/
└── .agents/
    └── skills/
        ├── nextjs-production-crud/
        │   └── SKILL.md
        ├── nextjs-crud-security/
        │   └── SKILL.md
        ├── nextjs-crud-reliability/
        │   └── SKILL.md
        └── nextjs-crud-testing/
            └── SKILL.md
```

If you install into a location where the agent can discover only one skill directory at a time, copy the skills individually. The main skill links to the supporting skill paths using relative paths; preserve the directory relationship or update those references to match your installation.

## Suggested usage prompt

> Use the `nextjs-production-crud` skill to implement a complete production-ready CRUD for **[RESOURCE/MANAGEMENT NAME]** in this repository. First inspect the repo instructions, current Next.js version, schema, auth/permissions, backend contracts, existing UI system, and tests. Preserve established architecture and business rules. Implement all required operations end-to-end, apply the security, reliability, and testing skills, run the relevant checks, fix defects, and report verified results and remaining gaps. Do not stop after planning or creating placeholder UI.

## Important

These skills are implementation instructions, not a guarantee of security or correctness. The agent must inspect the real repository, follow the installed framework version and current official documentation, and run tests. The project's own schema, authentication model, business rules, and design system remain authoritative.
