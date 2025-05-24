import { z } from 'zod';

export type SheetPNG = {
  fileId: string;   // "fund_x.xlsx"
  sheetId: string;  // "Returns"
  pngUrl: string;   // blob:http://…
  dims: { w: number; h: number };
};

export type ExtractionTask = {
  fileId: string;
  sheetId: string;
  purpose: string;
  expectedSchema: Record<string, 'yyyy-mm' | 'number' | string>;
};

export type ExtractedRecord = Record<string, string | number>;

export type CodeGenResult = {
  python: string;
  result_type: 'plot' | 'table' | 'value';
};

// Zod schemas for validation
export const SheetPNGSchema = z.object({
  fileId: z.string(),
  sheetId: z.string(),
  pngUrl: z.string().startsWith('blob:'),
  dims: z.object({
    w: z.number(),
    h: z.number()
  })
});

export const ExtractionTaskSchema = z.object({
  fileId: z.string(),
  sheetId: z.string(),
  purpose: z.string(),
  expectedSchema: z.record(z.enum(['yyyy-mm', 'number']).or(z.string()))
});

export const ExtractedRecordSchema = z.record(z.union([z.string(), z.number()]));

export const CodeGenResultSchema = z.object({
  python: z.string(),
  result_type: z.enum(['plot', 'table', 'value'])
}); 