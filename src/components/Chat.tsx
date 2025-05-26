import { useState, useCallback, useRef, useEffect } from 'react';
import type { SheetPNG, ExtractionTask, ExtractedRecord, CodeGenResult } from '../types';
import html2canvas from 'html2canvas';

interface ChatProps {
  sheets: SheetPNG[];
  onSheetsUpdate: (sheets: SheetPNG[]) => void;
}

export default function Chat({ sheets, onSheetsUpdate }: ChatProps) {
  const [messages, setMessages] = useState<string[]>([]);
  const [isProcessing, setIsProcessing] = useState(false);
  const renderWorkerRef = useRef<Worker>();
  const pyWorkerRef = useRef<Worker>();
  const fileInputRef = useRef<HTMLInputElement>(null);

  const processFiles = useCallback(async (files: File[]) => {
    try {
      setIsProcessing(true);
      console.log('Starting to process files:', files.map(f => f.name));

      for (const file of files) {
        if (!file.name.endsWith('.xlsx')) {
          console.warn('Skipping non-Excel file:', file.name);
          continue;
        }
        
        console.log('Reading file as array buffer:', file.name);
        const buffer = await file.arrayBuffer();
        console.log('Successfully read file, size:', buffer.byteLength, 'bytes');
        
        console.log('Sending file to render worker:', file.name);
        renderWorkerRef.current?.postMessage(
          { type: 'render', fileId: file.name, buffer },
          [buffer]
        );
        console.log('Message sent to render worker');
      }
    } catch (error) {
      console.error('Error processing files:', error);
      setMessages(prev => [...prev, `Error processing files: ${error instanceof Error ? error.message : String(error)}`]);
    } finally {
      setIsProcessing(false);
    }
  }, [setMessages]);

  const handleFileDrop = useCallback(async (e: React.DragEvent) => {
    e.preventDefault();
    const files = Array.from(e.dataTransfer.files);
    await processFiles(files);
  }, [processFiles]);

  const handleFileSelect = useCallback(async (e: React.ChangeEvent<HTMLInputElement>) => {
    if (!e.target.files?.length) return;
    const files = Array.from(e.target.files);
    await processFiles(files);
    // Reset the input so the same file can be selected again
    e.target.value = '';
  }, [processFiles]);

  const handleMessage = useCallback(async (message: string) => {
    console.log('Processing message:', message);
    if (!sheets.length) {
      console.warn('No sheets loaded, cannot process message');
      setMessages(prev => [...prev, message, 'Please drop an Excel file first']);
      return;
    }

    setMessages(prev => [...prev, message]);
    setIsProcessing(true);
    
    try {
      console.log('Calling GPT-4.1 for planning...');
      const plannerPrompt = {
        model: 'gpt-4.1',
        max_tokens: 1000,
        response_format: { type: "json_object" },
        functions: [
          {
            name: "extract_tasks",
            description: "Extract tasks from Excel sheets based on user query. If the user does not specify a chart or table, infer the best way to present the answer (e.g., chart, table, or value) based on the question and the data. For each extraction task, specify the expected output type: 'plot', 'table', or 'value'. Make sure the extraction schema and task description are clear and will enable the code generation model to produce the correct output.",
            parameters: {
              type: "object",
              properties: {
                tasks: {
                  type: "array",
                  items: {
                    type: "object",
                    properties: {
                      fileId: { type: "string" },
                      sheetId: { type: "string" },
                      purpose: { type: "string" },
                      expectedSchema: { 
                        type: "object",
                        additionalProperties: { type: "string" }
                      },
                      outputType: {
                        type: "string",
                        enum: ["plot", "table", "value"],
                        description: "The type of output best suited to answer the user's question."
                      }
                    },
                    required: ["fileId", "sheetId", "purpose", "expectedSchema", "outputType"]
                  }
                }
              },
              required: ["tasks"]
            }
          },
          {
            name: "clarify_user_intent",
            description: "If the user's query is ambiguous, missing information, or cannot be planned for, call this function. Return a message to the user explaining what additional information is needed to proceed.",
            parameters: {
              type: "object",
              properties: {
                clarification: { type: "string", description: "A message to the user explaining what is needed to continue." }
              },
              required: ["clarification"]
            }
          }
        ],
        messages: [
          {
            role: 'system',
            content: `You are a planner that looks at screenshots of Excel sheets and creates a set of tasks that describe exactly what data should be extracted from which file and sheet in order to answer the user's question.

**IMPORTANT FUNCTION CALLING RULES:**
- If the user's query is ambiguous, missing information, or cannot be planned for, you MUST call the clarify_user_intent function. Do NOT create an extraction task with a clarification or ambiguity in the purpose or any other field.
- Only create extraction tasks when you have all the information needed to proceed.
- Never use an extraction task to ask for clarification.
- If the user's request for a chart or comparison is ambiguous (e.g., "show me a chart" or "compare X and Y" without specifying the chart type or grouping), call clarify_user_intent and suggest specific chart types or comparison styles the user could ask for. Use the context of their question to make relevant suggestions.

**EXAMPLES:**

# Good (clarification needed)
Function call: clarify_user_intent
Arguments: { "clarification": "Your request for a chart is ambiguous. Please specify the type of chart you want (e.g., grouped bar chart, stacked bar chart, line chart) and how you want the comparison to be shown. For example, you can ask: 'Show me a grouped bar chart comparing Direct Loans, FFEL, and Perkins Loans for each year.'" }

# Good (clarification needed, context-aware)
Function call: clarify_user_intent
Arguments: { "clarification": "You asked to compare loan types year-over-year, but did not specify the chart type. Please specify if you want a grouped bar chart, stacked bar chart, or line chart. For example: 'Show me a grouped bar chart comparing each loan type by year.'" }

# Good (actionable extraction)
Function call: extract_tasks
Arguments: { "tasks": [ { "fileId": "PortfolioSummary.xlsx", "sheetId": "PortfolioSummary", "purpose": "Compare Fund X and Fund Y returns for 2022.", "expectedSchema": { "date": "yyyy-mm", "fund_x": "number", "fund_y": "number" }, "outputType": "plot" } ] }

# Bad (do NOT do this)
Function call: extract_tasks
Arguments: { "tasks": [ { "fileId": "PortfolioSummary.xlsx", "sheetId": "PortfolioSummary", "purpose": "The user's request is ambiguous. Please specify which fund or year you want to analyze.", "expectedSchema": { "date": "yyyy-mm", "fund_x": "number", "fund_y": "number" }, "outputType": "table" } ] }

**CONTRACT:**
- If you need clarification, ONLY use clarify_user_intent.
- If you have enough information, use extract_tasks.
- Never use an extraction task to ask for clarification.

For each extraction task, explain:
- what the purpose of the data extraction is (what information you're trying to get),
- which sheet the data is coming from (use the EXACT filename from the Excel file, e.g. "sample_funds.xlsx", NOT image names like "Sheet1.png"),
- what the expected schema of the extracted data is (as a JSON object, where keys are column names and values are data types or formats),
- the outputType (plot, table, or value) that best suits the user's needs.

Always output a list of extraction tasks as structured JSON. Make sure to use the exact Excel filenames from the uploaded files, not image names or generic names.`
          },
          {
            role: 'user',
            content: [
              {
                type: 'text',
                text: `The user wants to: "${message}".\nHere are images of ALL the Excel sheets they uploaded:\n${sheets.map(s => `- File: ${s.fileId}, Sheet: ${s.sheetId}`).join("\n")}\nFigure out which file(s) and sheet(s) contain the data needed, create the extraction task(s) accordingly, and return them as JSON. If the user's query is ambiguous or missing information, call clarify_user_intent and tell the user what you need from them to continue.`
              },
              ...sheets.map(s => ({
                type: 'image_url',
                image_url: {
                  url: s.pngUrl,
                  detail: "high"
                }
              }))
            ]
          }
        ]
      };
      console.log('Planning prompt:', plannerPrompt);
      const plannerResponse = await fetch('/api/proxy/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_OPENAI_KEY}`
        },
        body: JSON.stringify(plannerPrompt)
      });

      if (!plannerResponse.ok) {
        throw new Error(`Planner API error: ${plannerResponse.status} - ${await plannerResponse.text()}`);
      }
      
      const plannerData = await plannerResponse.json();
      console.log('Received planner response:', plannerData);

      let tasks: ExtractionTask[];
      try {
        const functionCall = plannerData.choices[0]?.message?.function_call;
        if (functionCall?.name === 'clarify_user_intent') {
          // Handle clarification: show message to user and return early
          let clarificationMsg = '';
          try {
            const args = functionCall.arguments;
            clarificationMsg = typeof args === 'string' ? JSON.parse(args).clarification : args.clarification;
          } catch (e) {
            clarificationMsg = 'Sorry, I need more information to proceed.';
          }
          setMessages(prev => [...prev, clarificationMsg]);
          setIsProcessing(false);
          return;
        }
        if (functionCall?.name === 'extract_tasks' && functionCall?.arguments) {
          // Parse the stringified arguments
          console.log('Parsing function call arguments:', functionCall.arguments);
          const functionArgs = JSON.parse(functionCall.arguments);
          if (!functionArgs.tasks || !Array.isArray(functionArgs.tasks)) {
            throw new Error('Function response missing tasks array');
          }
          tasks = functionArgs.tasks;
          // Validate that all fileIds match actual files
          const validFileIds = sheets.map(s => s.fileId);
          const invalidTasks = tasks.filter(t => !validFileIds.includes(t.fileId));
          if (invalidTasks.length > 0) {
            console.error('Invalid fileIds in tasks:', invalidTasks);
            console.log('Valid fileIds are:', validFileIds);
            throw new Error(`Tasks contain invalid fileIds. Got: ${invalidTasks.map(t => t.fileId).join(', ')}. Expected one of: ${validFileIds.join(', ')}`);
          }
        } else if (plannerData.choices[0]?.message?.content) {
          const content = JSON.parse(plannerData.choices[0].message.content);
          if (!content.tasks || !Array.isArray(content.tasks)) {
            throw new Error('Message response missing tasks array');
          }
          tasks = content.tasks;
        } else {
          console.error('Invalid response structure:', plannerData.choices[0]);
          throw new Error('Response missing valid message structure');
        }
        console.log('Parsed extraction tasks:', tasks);
      } catch (error) {
        console.error('Error parsing planner response:', error);
        console.log('Raw planner data:', plannerData);
        if (plannerData.choices[0]?.message?.function_call?.arguments) {
          console.log('Raw function arguments:', plannerData.choices[0].message.function_call.arguments);
        }
        setMessages(prev => [...prev, `Error: ${error instanceof Error ? error.message : String(error)}`]);
        setIsProcessing(false);
        return;
      }

      // Extract data from each task
      const extractedData: Record<string, ExtractedRecord[]> = {};
      let columnLabels: Record<string, string> = {};
      for (const task of tasks) {
        console.log('Processing task:', task);
        const sheet = sheets.find(
          s => s.fileId === task.fileId && s.sheetId === task.sheetId
        );
        if (!sheet) {
          console.warn('Sheet not found for task:', task);
          continue;
        }
        
        console.log('Calling GPT-4.1 for extraction...');
        const extractorResponse = await fetch('/api/proxy/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${import.meta.env.VITE_OPENAI_KEY}`
          },
          body: JSON.stringify({
            model: 'gpt-4.1',
            max_tokens: 32_768,
            function_call: { name: "extract_records" },
            response_format: { type: "json_object" },
            functions: [{
              name: "extract_records",
              description: "Extract records from Excel sheet based on schema",
              parameters: {
                type: "object",
                properties: {
                  records: {
                    type: "array",
                    description: "Array of records with date and numeric values (each column is an object with value and label)",
                    items: {
                      type: "object",
                      required: ["date"],
                      properties: {
                        date: {
                          type: "string",
                          description: "Date in YYYY-MM format"
                        }
                      },
                      additionalProperties: {
                        type: "object",
                        description: "A numeric column with its value and label",
                        properties: {
                          value: {
                            type: "number",
                            description: "The numeric value from the column"
                          },
                          label: {
                            type: "string",
                            description: "The actual column name from the table header"
                          }
                        },
                        required: ["value", "label"]
                      }
                    }
                  }
                },
                required: ["records"]
              }
            }],
            messages: [
              {
                role: 'system',
                content: `You are a data extraction tool that looks at Excel sheets and returns structured JSON data.

**IMPORTANT:**
- You MUST return ONLY valid JSON, with no extra text, markdown, or explanation.
- Do NOT include any text before or after the JSON.
- Do NOT use markdown code blocks.
- Do NOT return multiple JSON objects.
- Our system will only parse the first valid JSON object. Any extra text will cause an error.

# Good
{
  "records": [
    {
      "date": "2020-01",
      "col_a": { "value": 123.4, "label": "First Column Name" },
      "col_b": { "value": 234.5, "label": "Second Column Name" },
      "col_c": { "value": 8.2, "label": "Third Column Name" }
    },
    {
      "date": "2020-02",
      "col_a": { "value": 125.0, "label": "First Column Name" },
      "col_b": { "value": 236.0, "label": "Second Column Name" },
      "col_c": { "value": 8.1, "label": "Third Column Name" }
    }
  ]
}

# Bad (DO NOT do this)
Here is the JSON:
\`\`\`json
{ "records": [ ... ] }
\`\`\`

# Bad (DO NOT do this - wrong labels)
{
  "records": [
    {
      "date": "2020-01",
      "col_a": { "value": 123.4, "label": "Value (in billions)" },
      "col_b": { "value": 234.5, "label": "Value (in billions)" }
    }
  ]
}

Look for columns containing dates and numeric values. The data should be organized by date (usually in rows) with separate columns for each value series.
Return the data as a JSON array of records, where each record has:
1. A date in YYYY-MM format
2. For each numeric column:
   - A value (the numeric value from the column)
   - A label (the actual column name from the table header)

Make sure to:
1. Include ALL rows of actual data (skip headers, footers, and empty rows)
2. Convert dates to YYYY-MM format
3. Convert values to numbers (remove any % signs or other formatting)
4. Return null if a value is missing
5. Use the actual column names from the table header as labels (NOT generic descriptions like "Value" or "Amount")

Your response must be valid JSON in this exact format:
{
  "records": [
    {
      "date": "YYYY-MM",
      "col_a": { "value": number, "label": "Actual Column Name" },
      "col_b": { "value": number, "label": "Actual Column Name" },
      "col_c": { "value": number, "label": "Actual Column Name" }
    }
  ]
}`
              },
              {
                role: 'user',
                content: [
                  {
                    type: 'text',
                    text: `Extract the data needed to: "${task.purpose}". 
Return the data as JSON with this structure (example with 2 numeric columns, but include **all** numeric columns you find):
{
  "records": [
    {
      "date": "YYYY-MM",
      "col_a": { "value": number, "label": "Actual Column Name" },
      "col_b": { "value": number, "label": "Actual Column Name" }
    }
  ]
}

Guidelines:
- Use the column header text (sanitized to snake_case) as the key (e.g., "Direct Loans" -> "direct_loans").
- Include one object per row of data.
- Only the "date" property is guaranteed; all other properties depend on the columns you detect.`
                  },
                  {
                    type: 'image_url',
                    image_url: {
                      url: sheet.pngUrl,
                      detail: "high"
                    }
                  }
                ]
              }
            ]
          })
        });

        if (!extractorResponse.ok) {
          throw new Error(`Extractor API error: ${extractorResponse.status} - ${await extractorResponse.text()}`);
        }
        
        const extractorData = await extractorResponse.json();
        console.log('Received extractor response:', extractorData);

        let records: ExtractedRecord[];
        try {
          if (extractorData.choices[0]?.message?.function_call?.arguments) {
            const args = extractorData.choices[0].message.function_call.arguments;
            console.log('Parsing function arguments:', args);
            if (args === '{}' || args === '') {
              throw new Error('Extractor returned empty data');
            }
            const functionArgs = JSON.parse(args);
            if (!functionArgs.records || !Array.isArray(functionArgs.records)) {
              throw new Error('Function response missing records array');
            }
            records = functionArgs.records;
            columnLabels = functionArgs.column_labels || {};
          } else if (extractorData.choices[0]?.message?.content) {
            const content = JSON.parse(extractorData.choices[0].message.content);
            if (!content.records || !Array.isArray(content.records)) {
              throw new Error('Message response missing records array');
            }
            records = content.records;
            columnLabels = content.column_labels || {};
          } else {
            console.error('Invalid response structure:', extractorData.choices[0]);
            throw new Error('Response missing valid message structure');
          }
          
          if (records.length === 0) {
            throw new Error('No records were extracted from the sheet');
          }
          
          console.log('Parsed records:', records);
          console.log('Parsed column labels:', columnLabels);
        } catch (error) {
          console.error('Error parsing extractor response:', error);
          console.log('Raw extractor data:', extractorData);
          throw new Error(`Failed to parse extractor response: ${error instanceof Error ? error.message : String(error)}`);
        }

        extractedData[`${task.fileId}_${task.sheetId}`] = records;
      }
      
      // Register data with Pyodide
      console.log('Registering data with Pyodide...');
      for (const [key, records] of Object.entries(extractedData)) {
        const processedRecords = records.map(r => {
          const processed: Record<string, any> = { date: r.date };
          // Process each column dynamically
          Object.entries(r).forEach(([colName, value]) => {
            if (colName !== 'date' && typeof value === 'object' && 'value' in value) {
              processed[colName] = value.value;
            }
          });
          return processed;
        });
        pyWorkerRef.current?.postMessage({
          type: 'register',
          name: key.replace(/[^a-z0-9]/gi, '_'),
          records: processedRecords
        });
      }
      
      // Build environment context string for codegen prompt
      const envContext = Object.entries(extractedData).map(([varName, records]) => {
        const first = records[0];
        const cols = first ? [
          'date',
          ...Object.entries(first)
            .filter(([key, value]) => key !== 'date' && typeof value === 'object' && 'value' in value)
            .map(([key, value]) => `${key} (${(value as {label: string}).label})`)
        ].join(', ') : '(unknown columns)';
        return `- ${varName}: pandas DataFrame loaded from the extracted data. Columns: ${cols}`;
      }).join('\n');
      // Pass columnLabels mapping to codegen
      const columnLabelsContext = Object.keys(columnLabels).length > 0
        ? 'When generating plots or tables, use the following mapping for column labels:\n' +
          Object.entries(columnLabels).map(([k, v]) => `${k} = "${v}"`).join('\n') +
          '\nAlways use these names in chart titles, axis labels, and legends.'
        : '';

      // Generate and execute Python code
      console.log('Generating Python code...');
      const codeGenResponse = await fetch('/api/proxy/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${import.meta.env.VITE_OPENAI_KEY}`
        },
        body: JSON.stringify({
          model: 'gpt-4.1',
          max_tokens: 1000,
          function_call: { name: "generate_python_code" },
          response_format: { type: "json_object" },
          functions: [{
            name: "generate_python_code",
            description: "Generate Python code for data analysis",
            parameters: {
              type: "object",
              properties: {
                python: { type: "string" },
                result_type: { 
                  type: "string",
                  enum: ["plot", "table", "value"]
                }
              },
              required: ["python", "result_type"]
            }
          }],
          messages: [
            {
              role: 'system',
              content:
                'You are a Python code generation assistant for in-browser data analysis.\n' +
                '# Environment context:\n' +
                envContext + '\n' +
                (columnLabelsContext ? '\n' + columnLabelsContext + '\n' : '') +
                '\nYour job:\n' +
                '- Write Python code to analyze or visualize the provided DataFrame(s) as requested by the user.\n' +
                '- The DataFrame(s) are already loaded and available as variables (see above).\n' +
                '- The code will be executed in a secure, sandboxed environment (Pyodide) with only pandas and numpy available.\n' +
                '\n**IMPORTANT:**\n' +
                '- Use the DataFrame variable(s) listed above.\n' +
                "- DO NOT reference a variable named 'data' unless it is explicitly defined.\n" +
                "- 'data' is NOT defined by default.\n" +
                "- You MUST assign your final output to a variable named 'result'. Our system will ONLY look for a variable named 'result' to return to the user. If you do not assign to 'result', your code will not work.\n" +
                '\nRules and Guardrails:\n' +
                "- DO NOT use 'import' statements except for pandas/numpy (which are already imported).\n" +
                "- DO NOT use 'open', 'os', 'sys', 'subprocess', 'requests', or any file/network/system operations.\n" +
                "- DO NOT use infinite loops or recursion.\n" +
                "- DO NOT use 'input', 'print', or any interactive functions.\n" +
                "- DO NOT use plotting libraries except for returning a Plotly figure dict (do not import plotly).\n" +
                "- DO NOT mutate global state.\n" +
                "- DO NOT use 'exit', 'quit', or similar.\n" +
                "- DO NOT use 'eval' or 'exec'.\n" +
                '\nContract:\n' +
                "- Always assign your final output to a variable named 'result'.\n" +
                "- 'result' must be one of:\n" +
                "    - A Plotly figure dict (for charting)\n" +
                "    - A pandas DataFrame (for tables)\n" +
                "    - A scalar value (for single-value answers)\n" +
                "- 'result' must be JSON-serializable.\n" +
                "- If the user asks for a chart, return a Plotly figure dict as 'result'.\n" +
                "- If the user asks for a table, return a DataFrame as 'result'.\n" +
                "- If the user asks for a value, return a scalar as 'result'.\n" +
                '\nExamples:\n' +
                '\n# Good (Bar chart, using df)\n' +
                "result = {\n    'data': [\n        {\n            'type': 'bar',\n            'x': df['year'].tolist(),\n            'y': df['sales'].tolist(),\n            'name': 'Sales'\n        }\n    ],\n    'layout': {\n        'title': 'Sales by Year',\n        'xaxis': {'title': 'Year'},\n        'yaxis': {'title': 'Sales'}\n    }\n}\n" +
                '\n# Good (Table, using df)\n' +
                "result = df[['year', 'sales']]\n" +
                '\n# Good (Value, using df)\n' +
                "result = df['sales'].sum()\n" +
                '\n# Bad (DO NOT do this, \'data\' is not defined)\n' +
                "result = df['sales']  # ERROR: 'data' is not defined. Use 'df' instead.\n" +
                '# print(df)\n' +
                '# open(\'file.txt\', \'w\')\n' +
                '# import os\n' +
                '# result = None\n' +
                '\n# Bad (DO NOT do this, bare expression will not work)\n' +
                'yoy_comparison  # ERROR: This does not assign to result. You must write: result = yoy_comparison\n' +
                '\nUser request: ' + message + '\n' +
                '\nDataFrames available: ' + Object.keys(extractedData).map(k => k.replace(/[^a-z0-9]/gi, '_')).join(', ') + '\n' +
                '\nNow, write the code.'
            },
            {
              role: 'user',
              content: `Generate Python code to ${message} using these dataframes: ${
                Object.keys(extractedData)
                  .map(k => k.replace(/[^a-z0-9]/gi, '_'))
                  .join(', ')
              }.\n\nThe data has been loaded into pandas DataFrames with those exact names.\nEach dataframe has columns: ${Object.keys(extractedData).map(k => extractedData[k][0] ? Object.keys(extractedData[k][0]).join(', ') : '').join(' | ')}.\nDO NOT use any visualization packages. Focus on data preparation and analysis.\n\nReturn the code as JSON in this format:\n{\n  "python": "your code here",\n  "result_type": "plot"  # or "table" or "value" depending on output\n}`
            }
          ]
        })
      });

      if (!codeGenResponse.ok) {
        throw new Error(`Code generation API error: ${codeGenResponse.status} - ${await codeGenResponse.text()}`);
      }
      
      const codeGenData = await codeGenResponse.json();
      console.log('Received code generation response:', codeGenData);
      
      for (const task of tasks) {
        let codeGen: CodeGenResult;
        try {
          if (codeGenData.choices[0]?.message?.function_call?.arguments) {
            const args = codeGenData.choices[0].message.function_call.arguments;
            console.log('Parsing function arguments:', args);
            if (args === '{}' || args === '') {
              throw new Error('Code generator returned empty data');
            }
            codeGen = JSON.parse(args);
          } else if (codeGenData.choices[0]?.message?.content) {
            codeGen = JSON.parse(codeGenData.choices[0].message.content);
          } else {
            console.error('Invalid response structure:', codeGenData.choices[0]);
            throw new Error('Response missing valid message structure');
          }
          if (!codeGen.python || !codeGen.result_type) {
            throw new Error('Generated code missing required fields');
          }
          console.log('Generated code:', codeGen);
          // Execute the generated code
          console.log('Executing Python code...');
          pyWorkerRef.current?.postMessage({
            type: 'exec',
            code: codeGen.python,
            resultType: codeGen.result_type,
            dfName: `${task.fileId.replace(/[^a-z0-9]/gi, '_')}_${task.sheetId.replace(/[^a-z0-9]/gi, '_')}`
          });
        } catch (error) {
          console.error('Error parsing code generation response:', error);
          console.log('Raw code generation data:', codeGenData);
          throw new Error(`Failed to parse code generation response: ${error instanceof Error ? error.message : String(error)}`);
        }
      }
      
    } catch (error) {
      console.error('Error processing request:', error);
      setMessages(prev => [...prev, `Error: ${error instanceof Error ? error.message : String(error)}`]);
    } finally {
      setIsProcessing(false);
    }
  }, [sheets]);

  const convertHTMLToPNG = useCallback(async (html: string, dims: { w: number; h: number }): Promise<string> => {
    console.log('Converting HTML to PNG with dimensions:', dims);
    const container = document.createElement('div');
    container.innerHTML = html;
    container.style.position = 'absolute';
    container.style.left = '-9999px';
    document.body.appendChild(container);

    try {
      console.log('Rendering with html2canvas...');
      const canvas = await html2canvas(container, {
        width: dims.w,
        height: dims.h,
        scale: 2, // For better resolution
        logging: true // Enable html2canvas logging
      });

      document.body.removeChild(container);
      const pngUrl = canvas.toDataURL('image/png');
      console.log('HTML converted to PNG successfully');
      return pngUrl;
    } catch (error) {
      document.body.removeChild(container);
      console.error('Error converting HTML to PNG:', error);
      throw new Error(`Failed to convert HTML to PNG: ${error instanceof Error ? error.message : String(error)}`);
    }
  }, []);

  // Initialize workers
  useEffect(() => {
    console.log('Initializing workers...');
    
    const renderWorker = new Worker(
      new URL('../workers/render-worker.ts', import.meta.url),
      { type: 'module' }
    );
    renderWorkerRef.current = renderWorker;
    
    renderWorker.onmessage = async (e) => {
      console.log('Received message from render worker:', e.data);
      try {
        if (e.data.type === 'html') {
          console.log('Processing HTML sheets:', e.data.sheetsData.length);
          const sheets: SheetPNG[] = [];
          
          for (const sheetData of e.data.sheetsData) {
            console.log(`Converting sheet to PNG: ${sheetData.sheetId}`);
            const pngUrl = await convertHTMLToPNG(sheetData.html, sheetData.dims);
            sheets.push({
              fileId: sheetData.fileId,
              sheetId: sheetData.sheetId,
              pngUrl,
              dims: sheetData.dims
            });
          }
          
          console.log('All sheets converted to PNG');
          onSheetsUpdate(sheets);
          setIsProcessing(false);
        } else if (e.data.type === 'error') {
          console.error('Render worker error:', e.data.error);
          setMessages(prev => [...prev, `Error: ${e.data.error}`]);
          setIsProcessing(false);
        }
      } catch (error) {
        console.error('Error processing worker message:', error);
        setMessages(prev => [...prev, `Error: ${error instanceof Error ? error.message : String(error)}`]);
        setIsProcessing(false);
      }
    };

    renderWorker.onerror = (e) => {
      console.error('Render worker error event:', e);
      setMessages(prev => [...prev, `Worker error: ${e.message}`]);
      setIsProcessing(false);
    };
    
    const pyWorker = new Worker(
      new URL('../workers/py-worker.ts', import.meta.url),
      { type: 'module' }
    );
    pyWorkerRef.current = pyWorker;
    
    pyWorker.onmessage = (e) => {
      console.log('Received message from Python worker:', e.data);
      if (e.data.type === 'result') {
        // Forward the message to the WidgetGrid component
        window.postMessage(e.data, window.location.origin);
      }
    };

    pyWorker.onerror = (e) => {
      console.error('Python worker error:', e);
      setMessages(prev => [...prev, `Python worker error: ${e.message}`]);
    };
    
    // Initialize Pyodide
    console.log('Initializing Pyodide...');
    pyWorker.postMessage({ type: 'init' });
    
    return () => {
      console.log('Cleaning up workers...');
      renderWorker.terminate();
      pyWorker.terminate();
    };
  }, [onSheetsUpdate, setMessages, convertHTMLToPNG]);

  return (
    <div 
      className="bg-white rounded-lg shadow p-4 h-[calc(100vh-8rem)] flex flex-col"
      onDragOver={e => e.preventDefault()}
      onDrop={handleFileDrop}
    >
      <div className="mb-4 flex items-center gap-4">
        <button
          onClick={() => fileInputRef.current?.click()}
          className="px-4 py-2 bg-blue-500 text-white rounded hover:bg-blue-600 transition-colors"
          disabled={isProcessing}
        >
          Upload Excel File
        </button>
        <input
          ref={fileInputRef}
          type="file"
          accept=".xlsx"
          onChange={handleFileSelect}
          className="hidden"
          multiple
        />
        {isProcessing && (
          <div className="text-gray-500">Processing...</div>
        )}
      </div>

      {sheets.length > 0 && (
        <div className="mb-4">
          <details className="bg-gray-50 rounded-lg">
            <summary className="cursor-pointer p-3 font-medium text-gray-700 hover:text-gray-900">
              View Processed Sheets ({sheets.length})
            </summary>
            <div className="p-3 space-y-4">
              {sheets.map((sheet, index) => (
                <div key={`${sheet.fileId}_${sheet.sheetId}`} className="border rounded-lg p-3 bg-white">
                  <div className="mb-2 font-medium text-gray-700">
                    {sheet.fileId} - {sheet.sheetId}
                  </div>
                  <div className="overflow-auto">
                    <img 
                      src={sheet.pngUrl} 
                      alt={`${sheet.fileId} - ${sheet.sheetId}`}
                      className="max-w-full border rounded"
                      style={{ maxHeight: '300px' }}
                    />
                  </div>
                  <div className="mt-2 text-sm text-gray-500">
                    Dimensions: {sheet.dims.w}x{sheet.dims.h}
                  </div>
                </div>
              ))}
            </div>
          </details>
        </div>
      )}

      <div className="flex-1 overflow-y-auto space-y-4">
        {messages.map((msg, i) => (
          <div key={i} className="bg-gray-50 p-3 rounded">
            {msg}
          </div>
        ))}
      </div>
      
      <div className="mt-4 flex gap-2">
        <input
          type="text"
          className="flex-1 border rounded px-3 py-2"
          placeholder="Ask a question..."
          onKeyDown={e => {
            if (e.key === 'Enter' && !isProcessing) {
              handleMessage(e.currentTarget.value);
              e.currentTarget.value = '';
            }
          }}
          disabled={isProcessing}
        />
      </div>
    </div>
  );
} 