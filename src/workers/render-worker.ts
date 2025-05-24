import * as XLSX from 'xlsx-js-style';
import type { SheetPNG } from '../types';

const sheetToHTML = (sheet: XLSX.WorkSheet): string => {
  console.log('Converting sheet to HTML...');
  try {
    const html = XLSX.utils.sheet_to_html(sheet, { id: 'sheet-table' });
    console.log('Sheet converted to HTML successfully');
    return html;
  } catch (error) {
    console.error('Error converting sheet to HTML:', error);
    throw new Error(`Failed to convert sheet to HTML: ${error instanceof Error ? error.message : String(error)}`);
  }
};

self.onmessage = async (e: MessageEvent) => {
  console.log('Render worker received message:', e.data);
  
  try {
    if (e.data.type !== 'render') {
      console.log('Ignoring non-render message');
      return;
    }

    const { fileId, buffer } = e.data;
    console.log(`Processing Excel file: ${fileId}, buffer size: ${buffer.byteLength} bytes`);
    
    console.log('Reading workbook...');
    const workbook = XLSX.read(buffer, { type: 'array' });
    console.log('Workbook read successfully. Sheets found:', workbook.SheetNames);
    
    if (workbook.SheetNames.length === 0) {
      throw new Error('No sheets found in workbook');
    }
    
    const sheetsData = [];
    
    for (const sheetName of workbook.SheetNames) {
      console.log(`Processing sheet: ${sheetName}`);
      const sheet = workbook.Sheets[sheetName];
      
      if (!sheet['!ref']) {
        console.warn(`Sheet ${sheetName} is empty, skipping`);
        continue;
      }
      
      const html = sheetToHTML(sheet);
      
      // Get sheet dimensions
      const range = XLSX.utils.decode_range(sheet['!ref']);
      const dims = {
        w: (range.e.c - range.s.c + 1) * 100, // Approximate width
        h: (range.e.r - range.s.r + 1) * 25   // Approximate height
      };
      console.log(`Sheet dimensions for ${sheetName}: ${dims.w}x${dims.h}`);

      sheetsData.push({
        fileId,
        sheetId: sheetName,
        html,
        dims
      });
      console.log(`Sheet ${sheetName} processed successfully`);
    }

    if (sheetsData.length === 0) {
      throw new Error('No valid sheets were processed');
    }

    console.log(`All sheets processed successfully. Sending ${sheetsData.length} sheets back`);
    self.postMessage({ type: 'html', sheetsData });
  } catch (error) {
    console.error('Render worker error:', error);
    self.postMessage({ 
      type: 'error', 
      error: error instanceof Error ? error.message : String(error)
    });
  }
};

export {}; // Make this a module 