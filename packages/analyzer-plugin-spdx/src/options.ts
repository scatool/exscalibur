import { z } from 'zod';

export const optionSchema = z.strictObject({
  ignore: z.array(z.string()).default([]),
});

export type SpdxOptions = z.infer<typeof optionSchema>;
