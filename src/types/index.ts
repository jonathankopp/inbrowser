export interface ExtractedRecord {
  date: string;
  [columnName: string]: string | {
    value: number;
    label: string;
  };
} 