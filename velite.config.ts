import { defineConfig, defineCollection, s } from 'velite'

const functions = defineCollection({
  name: 'Function',
  pattern: 'functions/**/*.mdx',
  schema: s.object({
    title: s.string(),
    slug: s.path(),
    description: s.string(),
    type: s.enum(['code', 'generative', 'human', 'agentic']),
    inputs: s.array(s.object({
      name: s.string(),
      type: s.string(),
      description: s.string().optional(),
      required: s.boolean().default(false)
    })).default([]),
    outputs: s.array(s.object({
      name: s.string(),
      type: s.string(),
      description: s.string().optional()
    })).default([]),
    metadata: s.object({
      ns: s.string().default('function'),
      visibility: s.enum(['public', 'private', 'unlisted']).default('public')
    }).default({}),
    tags: s.array(s.string()).default([]),
    content: s.mdx()
  }).transform(data => ({ ...data, url: `/functions/${data.slug}` }))
})

export default defineConfig({
  root: '.',
  output: {
    data: '.velite',
    assets: 'public/static',
    base: '/static/',
    name: '[name]-[hash:6].[ext]',
    clean: true
  },
  collections: { functions },
  mdx: { rehypePlugins: [], remarkPlugins: [] }
})
