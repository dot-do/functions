# Functions Repository

**Function & Capability Definitions as Code** - MDX files with Zod validation, synced to PostgreSQL

## Overview

This repository contains **11 production function definitions** organized into four categories:

```
functions/
├── communication/    # 1 function - Email and messaging
├── development/      # 4 functions - Code analysis and generation
├── finance/          # 3 functions - Financial calculations
├── ecommerce/        # 2 functions - E-commerce operations
└── verbs/            # 1 verb - CRUD operations (create, read, update, delete)
```

**Technology Stack:**
- **MDX** - Markdown + JSX for function definitions
- **Velite** - Build-time validation with Zod schemas
- **Zod** - Type-safe schema validation
- **PostgreSQL** - Persistent storage via [repo.do](https://repo.do) GitHub App

## Repository Structure

### Communication Functions (`communication/`)

Communication and messaging capabilities:

| Function | Description | Inputs | Outputs |
|----------|-------------|--------|---------|
| **sendEmail** | Send transactional emails via Resend | to, subject, body, from | messageId, status |

### Development Functions (`development/`)

Code analysis, generation, and documentation:

| Function | Description | Inputs | Outputs |
|----------|-------------|--------|---------|
| **analyzeCode** | Static code analysis for quality and security | code, language, rules | issues, metrics, suggestions |
| **generateDocs** | Generate documentation from code | code, format, template | documentation, metadata |
| **optimizeQuery** | Optimize database queries for performance | query, database, schema | optimizedQuery, explanation |
| **parseCode** | Parse source code into AST | code, language | ast, tokens, symbols |

### Finance Functions (`finance/`)

Financial calculations and analysis:

| Function | Description | Inputs | Outputs |
|----------|-------------|--------|---------|
| **assessRisk** | Assess financial risk of investments | investment, market, history | riskScore, factors |
| **calculateROI** | Calculate return on investment | initialInvestment, returns, period | roi, profit |
| **detectFraud** | Detect fraudulent transactions | transaction, history, patterns | fraudScore, reasons |

### E-commerce Functions (`ecommerce/`)

Online commerce operations:

| Function | Description | Inputs | Outputs |
|----------|-------------|--------|---------|
| **calculateShipping** | Calculate shipping costs | origin, destination, weight, carrier | cost, estimatedDays |
| **validateOrder** | Validate order before processing | order, inventory, customer | isValid, errors |

### Verbs (`verbs/`)

Abstract action definitions (CRUD operations):

| Verb | Description | Parameters |
|------|-------------|------------|
| **create** | Bring a new entity into existence | type, properties, options |

## Function Schema

All function MDX files follow this structure:

```mdx
---
title: Function Name
description: What the function does
category: function-category
inputs:
  - name: paramName
    type: string
    description: Parameter description
    required: true
outputs:
  - name: resultName
    type: string
    description: Output description
async: true
idempotent: false
sideEffects: Description of side effects
metadata:
  ns: function
  visibility: public
tags:
  - category
  - feature
---

# Function Name

Function documentation and implementation details...

## Implementation

\`\`\`typescript
export async function functionName(params: Params): Promise<Result> {
  // Implementation
}
\`\`\`

## Usage Example

\`\`\`typescript
const result = await functionName({ param: 'value' })
\`\`\`
```

### Required Fields
- `title` - Function display name
- `description` - Brief description of function purpose

### Optional Fields
- `category` - Function category
- `inputs` - Array of input parameters with types and descriptions
- `outputs` - Array of output values with types
- `async` - Whether function is asynchronous (default: true)
- `idempotent` - Whether function can be safely retried (default: false)
- `sideEffects` - Description of side effects
- `implementedBy` - Implementation reference (worker name, package, etc.)
- `metadata` - Namespace and visibility settings
- `tags` - Categorization tags

## Development

### Setup

```bash
# Install dependencies
pnpm install

# Build and validate all function MDX files
pnpm build

# Watch mode for development
pnpm dev

# Type checking
pnpm check-types
```

### Creating New Functions

1. **Choose category:** communication, development, finance, ecommerce, or verbs
2. **Create MDX file:**
   ```bash
   # Regular function
   touch development/newFunction.mdx

   # Verb definition
   touch verbs/newVerb.mdx
   ```

3. **Add function definition** with required frontmatter and implementation

4. **Build and validate:**
   ```bash
   pnpm build
   ```

5. **Commit and push** - Triggers automatic sync to database via repo.do webhook

### Naming Conventions

- **Functions:** `camelCase.mdx` (e.g., `sendEmail.mdx`, `calculateROI.mdx`)
- **Verbs:** `lowercase.mdx` (e.g., `create.mdx`, `read.mdx`, `update.mdx`)

## Function Categories

**Communication** - Email, SMS, messaging capabilities
**Development** - Code analysis, generation, documentation, optimization
**Finance** - Financial calculations, risk assessment, fraud detection
**E-commerce** - Order processing, shipping, inventory validation
**Verbs** - Abstract CRUD operations and actions

## Database Synchronization

Function MDX files automatically sync to PostgreSQL via the **repo.do** GitHub App webhook:

**Workflow:**
1. Commit and push MDX file changes
2. GitHub webhook triggers repo.do
3. Velite validates MDX against Zod schema
4. Valid functions inserted/updated in `things` table
5. Invalid functions logged as errors

**Database Schema:**
```sql
CREATE TABLE things (
  ulid TEXT PRIMARY KEY,
  ns TEXT NOT NULL,           -- 'function'
  id TEXT NOT NULL,           -- function filename (without .mdx)
  type TEXT NOT NULL,         -- 'Function' or 'Verb'
  data JSONB NOT NULL,        -- full function metadata
  content TEXT,               -- MDX content
  createdAt TIMESTAMP,
  updatedAt TIMESTAMP,
  UNIQUE(ns, id)
);
```

**Query functions:**
```sql
-- All functions
SELECT * FROM things WHERE ns = 'function' AND type = 'Function';

-- By category
SELECT * FROM things WHERE ns = 'function' AND data->>'category' = 'communication';

-- Verbs
SELECT * FROM things WHERE ns = 'function' AND type = 'Verb';
```

## Related Repositories

- **[examples/](../examples/)** - Business-as-Code examples using functions
- **[agents/](../agents/)** - AI agents that call functions as tools
- **[workflows/](../workflows/)** - Workflow orchestration using functions
- **[workers/](../workers/)** - Function runtime and execution services
- **[db/](../db/)** - Database schema and migrations

## Integration with Agents

Functions serve as **tools** for AI agents:

```mdx
---
title: Customer Support Agent
tools:
  - sendEmail
  - searchKnowledgeBase
  - createTicket
---
```

Agents can invoke functions during conversations:

```typescript
const agent = await agents.load('support-agent')
const response = await agent.chat({
  message: 'Please send me a receipt',
  context: { orderId: '12345', customerEmail: 'user@example.com' }
})
// Agent invokes sendEmail() function automatically
```

## Testing

```bash
# Run all tests
pnpm test

# Test specific function
pnpm test communication/sendEmail.mdx

# Integration tests
pnpm test:integration
```

## Contributing

1. Create feature branch: `git checkout -b feature/add-new-function`
2. Add/modify function MDX files
3. Run `pnpm build` to validate
4. Commit changes: `git commit -m "feat: Add new function"`
5. Push and create PR: `git push origin feature/add-new-function`

## Documentation

- **[CLAUDE.md](./CLAUDE.md)** - Developer guidelines and architecture
- **[Root CLAUDE.md](../CLAUDE.md)** - Multi-repo project management
- **[examples/functions/README.md](../examples/functions/README.md)** - Usage examples

---

**Total Functions:** 11 (10 functions + 1 verb)
**Last Updated:** 2025-10-04
**Repository:** https://github.com/dot-do/functions
