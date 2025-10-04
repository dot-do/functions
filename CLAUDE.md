# CLAUDE.md - functions Repository

## Project Overview

The **functions repository** stores **function and capability definitions** as MDX files with Zod schema validation via Velite, enabling bidirectional synchronization with the PostgreSQL database.

**Purpose**: Define and manage function entities as version-controlled MDX files that sync automatically to the database.

**Position**: 📝 **Content Layer** - Content source that syncs to db layer

## Schema

The Velite schema for functions includes:

### Required Fields
- **title** (string): Function name
- **description** (string): What the function does

### Optional Fields
- **category** (string): Function category
- **inputs** (array): Input parameters with types
- **outputs** (array): Output values with types
- **async** (boolean): Whether function is asynchronous
- **idempotent** (boolean): Whether function is idempotent
- **sideEffects** (string): Description of side effects
- **implementedBy** (string): Implementation reference
- **metadata**: Namespace and visibility
- **tags** (array): Categorization tags

## MDX File Example

```mdx
---
title: Send Email
description: Send an email message to one or more recipients
category: communication
inputs:
  - name: to
    type: string
    description: Recipient email address
  - name: subject
    type: string
  - name: body
    type: string
outputs:
  - name: messageId
    type: string
async: true
idempotent: false
metadata:
  ns: functions
  visibility: public
tags:
  - email
  - communication
---

# Send Email

Sends an email message using the configured email provider.

## Usage

```typescript
const result = await sendEmail({
  to: 'user@example.com',
  subject: 'Hello',
  body: 'Message content'
})
```
```

## Development Commands

```bash
# Install dependencies
pnpm install

# Build and validate all MDX files
pnpm build

# Watch mode for development
pnpm dev

# Type check
pnpm check-types
```

## Examples

See **[examples/](../examples/)** for working TypeScript + MDX function examples:

- **email-function.mdx** - Transactional email sending with templates

These examples demonstrate:
- ✅ Full TypeScript intellisense in MDX files
- ✅ Function definitions with typed inputs and outputs
- ✅ Configuration and provider integration
- ✅ Usage examples and documentation

Run examples: `pnpm --filter examples dev`

## Related Documentation

- **Parent**: [Root CLAUDE.md](../CLAUDE.md) - Multi-repo management
- **Database**: [db/CLAUDE.md](../db/CLAUDE.md) - Database schema and sync
- **API**: [api/CLAUDE.md](../api/CLAUDE.md) - Webhook handler
- **Workflows**: [workflows/CLAUDE.md](../workflows/CLAUDE.md) - Uses functions

---

**Last Updated**: 2025-10-03
**Maintained By**: Claude Code
**Repository**: https://github.com/dot-do/functions
