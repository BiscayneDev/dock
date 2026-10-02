#!/usr/bin/env node
// Builds Dinghy's E2B sandbox template (definition in e2b-template-def.mjs).
//
// Usage (needs an E2B project API key; not run by CI), from any directory:
//   E2B_API_KEY=e2b_... node scripts/build-e2b-template.mjs
// Then set E2B_TEMPLATE=dinghy-computer in the Vercel env and redeploy.
// Rebuild whenever src/lib/computer/bootstrap.py changes.
import { Template, defaultBuildLogger } from 'e2b'
import { buildTemplateDefinition } from './e2b-template-def.mjs'

const alias = process.env.E2B_TEMPLATE || 'dinghy-computer'

const info = await Template.build(buildTemplateDefinition(), { alias, onBuildLogs: defaultBuildLogger() })
console.log('built template', info.alias ?? alias, info.templateId ?? '')
