import { loadPyodide } from 'pyodide';
import type { PyodideInterface } from 'pyodide';

let py: PyodideInterface;

self.onmessage = async ({ data }) => {
  console.log('Python worker received message:', data);
  
  try {
    if (data.type === 'init') {
      console.log('Initializing Pyodide...');
      py = await loadPyodide({ indexURL: 'https://cdn.jsdelivr.net/pyodide/v0.27.6/full/' });
      
      console.log('Loading Python packages...');
      try {
        // Load pandas first
        console.log('Loading pandas...');
        await py.loadPackage('pandas');
        
        console.log('Pyodide initialization complete');
        self.postMessage({ type: 'ready' });
      } catch (error) {
        console.error('Error loading packages:', error);
        throw new Error(`Failed to load Python packages: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    
    if (data.type === 'register') {
      const { name, records } = data;
      // Ensure fund_x and fund_y are numbers (not objects)
      const processedRecords = records.map((r: any) => ({
        ...r,
        fund_x: typeof r.fund_x === 'object' ? r.fund_x.value : r.fund_x,
        fund_y: typeof r.fund_y === 'object' ? r.fund_y.value : r.fund_y
      }));
      console.log(`Registering dataframe '${name}' with ${processedRecords.length} records`);
      try {
        const code = `
import json, pandas as pd
df_data = json.loads('''${JSON.stringify(processedRecords)}''')
df = pd.DataFrame(df_data)
globals()['${name}'] = df
print(f"Created dataframe with shape: {df.shape}")
`;
        await py.runPythonAsync(code);
        console.log(`Successfully registered dataframe '${name}'`);
      } catch (error) {
        console.error('Error registering dataframe:', error);
        throw new Error(`Failed to register dataframe: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    
    if (data.type === 'exec') {
      const dfName = data.dfName || 'sample_funds_xlsx_Sheet1';
      console.log('Executing Python code:', data.code);
      try {
        // Indent every line of the generated code for the try block
        const indentedCode = (data.code || '').split('\n').map((line: string) => '    ' + line).join('\n');
        let code = `
df = globals()['${dfName}'].copy()
locals()['df'] = df  # Ensure 'df' is available for generated code
try:
${indentedCode}
    # Ensure result is serializable
    import pandas as pd
    if 'result' in locals() and isinstance(result, pd.DataFrame):
        result = result.to_dict(orient='records')
    result = locals().get('result', None)
    if result is None:
        raise Exception('Generated code did not set a result variable.')
except Exception as e:
    result = f'__PYTHON_ERROR__:' + str(e)
result
`;
        console.log('About to execute Python code:\n', code);
        const res = await py.runPythonAsync(code);
        console.log('Python execution result:', res);
        let serializableRes = res;
        // If res is a PyProxy (Pyodide object), convert to JS
        if (res && typeof res === 'object' && typeof res.toJs === 'function') {
          try {
            serializableRes = res.toJs({ dict_converter: Object.fromEntries });
          } catch (e) {
            try {
              serializableRes = res.toJs();
            } catch (e2) {
              serializableRes = res.toString();
            }
          }
        }
        // Fallback: if still not serializable, use string
        try {
          self.postMessage({ 
            type: 'result', 
            resultType: data.resultType, 
            payload: serializableRes
          });
        } catch (err) {
          self.postMessage({ 
            type: 'result', 
            resultType: data.resultType, 
            payload: serializableRes ? serializableRes.toString() : null
          });
        }
      } catch (error) {
        console.error('Error executing Python code:', error);
        throw new Error(`Failed to execute Python code: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
  } catch (error) {
    console.error('Python worker error:', error);
    self.postMessage({ type: 'error', error: error instanceof Error ? error.message : String(error) });
  }
};

export {}; // Make this a module 