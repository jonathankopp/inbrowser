# In-Browser Analytics

A browser-only analytics playground where users can drag Excel workbooks and analyze them using natural language queries. All computation happens client-side using WebAssembly.

## Features

- Drag-and-drop Excel file processing
- Natural language queries for data analysis
- Browser-side computation with Pyodide
- Interactive visualizations with Plotly
- No server-side storage - everything stays in your browser

## Setup

1. Install dependencies:
```bash
pnpm install
```

2. Create `.env.local` and add your OpenAI API key:
```
VITE_OPENAI_KEY=sk-...
```

3. Start the development server:
```bash
pnpm dev
```

4. Open http://localhost:5173 in your browser

## Usage

1. Drag and drop Excel files into the browser window
2. Type natural language queries like "Benchmark Fund X vs Fund Y over the last four years"
3. View the results as interactive charts or tables

## Technical Details

- Built with Vite + React + TypeScript
- Uses SheetJS for Excel processing
- Converts sheets to PNG using html2canvas
- Extracts data using GPT-4 Vision
- Runs computations in Pyodide
- Visualizes results with Plotly

## Performance

- Processes a benchmark comparison in ≤45s on 2020-era laptops
- Works offline after initial load (except for OpenAI calls)
- Memory usage stays under 250MB
