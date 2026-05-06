import { z } from 'zod';

export const CredentialsSchema = z.object({
  email: z.string().trim().toLowerCase().email('Некорректный email').max(254),
  password: z
    .string()
    .min(8, 'Пароль не короче 8 символов')
    .max(72, 'Пароль не длиннее 72 символов')
});

export type Credentials = z.infer<typeof CredentialsSchema>;
