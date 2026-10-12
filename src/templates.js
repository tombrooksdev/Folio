// Built-in page templates for the "Create page" gallery. {{date}} and {{user}} are filled in when a page is created from one.
export const TEMPLATES = [
  { id: 'blank', name: 'Blank page', desc: 'Start from nothing.', title: '', body: '' },
  {
    id: 'meeting-notes', name: 'Meeting notes', desc: 'Agenda, notes, decisions and action items.', title: 'Meeting notes {{date}}',
    body: `**Date:** {{date}}  \n**Attendees:** {{user}}\n\n## Agenda\n\n- \n\n## Notes\n\n\n## Decisions\n\n> [!INFO]\n> Record what was decided and why.\n\n## Action items\n\n- [ ] Owner: task, due date\n`,
  },
  {
    id: 'decision-record', name: 'Decision record', desc: 'Context, options considered and the outcome.', title: 'Decision: ',
    body: `> [!NOTE]\n> **Status:** Proposed. **Date:** {{date}}. **Owner:** {{user}}\n\n## Context\n\nWhat problem are we solving, and what constraints apply?\n\n## Options considered\n\n| Option | Pros | Cons |\n|---|---|---|\n| A | | |\n| B | | |\n\n## Decision\n\nWe will...\n\n## Consequences\n\nWhat gets easier, and what gets harder?\n`,
  },
  {
    id: 'product-requirements', name: 'Product requirements', desc: 'Goals, user stories and success metrics.', title: 'Requirements: ',
    body: `**Owner:** {{user}} · **Updated:** {{date}}\n\n## Background\n\nWhy now?\n\n## Goals\n\n- \n\n## Non-goals\n\n- \n\n## User stories\n\n| As a... | I want... | So that... |\n|---|---|---|\n| | | |\n\n## Success metrics\n\n- \n\n## Open questions\n\n- [ ] \n`,
  },
  {
    id: 'retrospective', name: 'Retrospective', desc: 'What went well, what did not, what to change.', title: 'Retro {{date}}',
    body: `## What went well\n\n- \n\n## What did not go well\n\n- \n\n## What we will change\n\n- [ ] Owner: action\n\n> [!TIP]\n> Keep actions small enough to finish in the next sprint.\n`,
  },
  {
    id: 'runbook', name: 'Runbook', desc: 'Steps to operate or recover a system.', title: 'Runbook: ',
    body: `> [!WARNING]\n> Check the status page before you start.\n\n## Overview\n\nWhat this covers and who owns it.\n\n## Before you start\n\n- [ ] \n\n## Steps\n\n1. \n2. \n\n\`\`\`bash\n# commands go here\n\`\`\`\n\n## Rollback\n\n1. \n\n## Contacts\n\n| Role | Name | How to reach them |\n|---|---|---|\n| | | |\n`,
  },
  {
    id: 'how-to', name: 'How-to guide', desc: 'A task-focused walkthrough.', title: 'How to ',
    body: `## Goal\n\nAfter this guide you will be able to...\n\n## Prerequisites\n\n- \n\n## Steps\n\n### 1. \n\n### 2. \n\n## Troubleshooting\n\n> [!INFO]\n> Common problems and fixes go here.\n`,
  },
];

export const findTemplate = (id) => TEMPLATES.find((t) => t.id === id);
export const fillTemplate = (text, user) =>
  text.replaceAll('{{date}}', new Date().toISOString().slice(0, 10)).replaceAll('{{user}}', user);
