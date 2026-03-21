import { z } from 'zod'

export const TelegramUserSchema = z.object({
  id: z.number(),
  is_bot: z.boolean(),
  first_name: z.string(),
  last_name: z.string().optional(),
  username: z.string().optional(),
  language_code: z.string().optional(),
})

export const TelegramChatSchema = z.object({
  id: z.number(),
  type: z.string(),
  first_name: z.string().optional(),
  last_name: z.string().optional(),
  username: z.string().optional(),
})

export const TelegramVoiceSchema = z.object({
  file_id: z.string(),
  file_unique_id: z.string(),
  duration: z.number(),
  mime_type: z.string().optional(),
  file_size: z.number().optional(),
})

export const TelegramMessageSchema = z.object({
  message_id: z.number(),
  from: TelegramUserSchema.optional(),
  chat: TelegramChatSchema,
  date: z.number(),
  text: z.string().optional(),
  voice: TelegramVoiceSchema.optional(),
})

export const TelegramCallbackQuerySchema = z.object({
  id: z.string(),
  from: TelegramUserSchema,
  message: TelegramMessageSchema.optional(),
  data: z.string().optional(),
})

export const TelegramChatMemberUpdatedSchema = z.object({
  chat: TelegramChatSchema,
  from: TelegramUserSchema,
  date: z.number(),
  new_chat_member: z.object({
    user: TelegramUserSchema,
    status: z.string(),
  }),
})

export const TelegramUpdateSchema = z.object({
  update_id: z.number(),
  message: TelegramMessageSchema.optional(),
  callback_query: TelegramCallbackQuerySchema.optional(),
  my_chat_member: TelegramChatMemberUpdatedSchema.optional(),
})

export type TelegramUser = z.infer<typeof TelegramUserSchema>
export type TelegramChat = z.infer<typeof TelegramChatSchema>
export type TelegramMessage = z.infer<typeof TelegramMessageSchema>
export type TelegramCallbackQuery = z.infer<typeof TelegramCallbackQuerySchema>
export type TelegramUpdate = z.infer<typeof TelegramUpdateSchema>
