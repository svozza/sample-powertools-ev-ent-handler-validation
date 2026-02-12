import { z } from 'zod';

export const ProductSchema = z.object({
  name: z.string(),
  description: z.string().optional(),
  price: z.number().positive(),
  category: z.string(),
});

export const ProductWithIdSchema = ProductSchema.extend({
  id: z.string(),
});

export const ProductListSchema = z.array(ProductWithIdSchema);

export const ProductPathSchema = z.object({ id: z.string() });

export const ApiKeyHeaderSchema = z.object({
  'x-api-key': z.string().min(1),
});

export const ProductQuerySchema = z.object({
  category: z.string().optional(),
  minPrice: z.string().optional(),
  maxPrice: z.string().optional(),
});

export const ProductQuerySchemaStrict = z.object({
  category: z.string().optional(),
  minPrice: z.coerce.number().positive().optional(),
  maxPrice: z.coerce.number().positive().optional(),
});

export type ApiKeyHeader = z.infer<typeof ApiKeyHeaderSchema>;
export type Product = z.infer<typeof ProductSchema>;
export type ProductWithId = z.infer<typeof ProductWithIdSchema>;
export type ProductPath = z.infer<typeof ProductPathSchema>;
export type ProductQuery = z.infer<typeof ProductQuerySchema>;
