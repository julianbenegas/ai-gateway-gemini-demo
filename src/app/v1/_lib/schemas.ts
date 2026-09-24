import { z } from 'zod'
import { replacementsSchema } from '@/lib/replacements'

const ids = z.array(z.string())
const shape = z.object({
  id: z.string().optional(),
  type: z.string(),
  x: z.number().optional(),
  y: z.number().optional(),
  rotation: z.number().optional(),
  parentId: z.string().optional(),
  props: z.record(z.string(), z.unknown()).optional(),
  meta: z.record(z.string(), z.unknown()).optional(),
})

export const actionSchema = z.discriminatedUnion('op', [
  z.object({ op: z.literal('create'), shape }),
  z.object({
    op: z.literal('update'),
    shape: shape.partial().extend({ id: z.string() }),
  }),
  z.object({ op: z.literal('delete'), ids }),
  z.object({ op: z.literal('duplicate'), ids, dx: z.number(), dy: z.number() }),
  z.object({ op: z.literal('group'), ids }),
  z.object({ op: z.literal('ungroup'), ids }),
  z.object({ op: z.literal('reparent'), ids, parentId: z.string() }),
  z.object({
    op: z.literal('align'),
    ids,
    direction: z.enum([
      'left',
      'right',
      'top',
      'bottom',
      'center-horizontal',
      'center-vertical',
    ]),
  }),
  z.object({
    op: z.literal('distribute'),
    ids,
    direction: z.enum(['horizontal', 'vertical']),
  }),
  z.object({
    op: z.literal('stack'),
    ids,
    direction: z.enum(['horizontal', 'vertical']),
    gap: z.number(),
  }),
  z.object({
    op: z.literal('reorder'),
    ids,
    direction: z.enum(['front', 'back', 'forward', 'backward']),
  }),
  z.object({ op: z.literal('select'), ids }),
  z.object({ op: z.literal('focus'), ids }),
])

export const applySchema = z.object({
  pageId: z
    .string()
    .optional()
    .describe(
      'Optional destination board for newly created shapes. Defaults to the current board. Existing shapes are addressed by ID, regardless of which board is currently open.',
    ),
  actions: z.array(actionSchema),
})
export const readShapesSchema = z.object({ ids })
export const editHtmlSchema = z.object({
  id: z.string(),
  replacements: replacementsSchema,
})
export const inspectSchema = z.object({ question: z.string().optional() })
