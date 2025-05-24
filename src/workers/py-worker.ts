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
        
        // Set up Python environment
        console.log('Setting up Python environment...');
        await py.runPythonAsync(`
import json
import pandas as pd
import sys
from js import Object
from pyodide.ffi import to_js

def create_plot_data(df, x_col, y_cols, title=''):
    """Create a simple plot data structure that can be rendered by JavaScript Plotly"""
    # Convert datetime to string format
    df = df.copy()
    if pd.api.types.is_datetime64_any_dtype(df[x_col]):
        df[x_col] = df[x_col].dt.strftime('%Y-%m-%d')
    
    data = []
    for y_col in y_cols:
        trace = {
            'x': df[x_col].tolist(),
            'y': df[y_col].tolist(),
            'type': 'scatter',
            'mode': 'lines+markers',
            'name': y_col
        }
        data.append(trace)
    
    layout = {
        'title': title,
        'xaxis': {'title': x_col},
        'yaxis': {'title': 'Value'},
        'hovermode': 'closest'
    }
    
    return {'data': data, 'layout': layout}

def prepare_for_json(df):
    """Convert DataFrame to JSON-serializable format"""
    df = df.copy()
    for col in df.columns:
        if pd.api.types.is_datetime64_any_dtype(df[col]):
            df[col] = df[col].dt.strftime('%Y-%m-%d')
    return df
`);
        
        console.log('Pyodide initialization complete');
        self.postMessage({ type: 'ready' });
      } catch (error) {
        console.error('Error loading packages:', error);
        throw new Error(`Failed to load Python packages: ${error instanceof Error ? error.message : String(error)}`);
      }
    }
    
    if (data.type === 'register') {
      const { name, records } = data;
      console.log(`Registering dataframe '${name}' with ${records.length} records`);
      try {
        const code = `
import json, pandas as pd
df_data = json.loads('''${JSON.stringify(records)}''')
df = pd.DataFrame(df_data)
# Use string literal directly in Python code
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
        let code = `
try:
    df = globals()['${dfName}'].copy()
    # Sort by the first column if it's a date or year
    x_col = df.columns[0]
    if pd.api.types.is_datetime64_any_dtype(df[x_col]) or x_col.lower() in ['date', 'year']:
        df[x_col] = pd.to_datetime(df[x_col], errors='ignore')
        df = df.sort_values(x_col).reset_index(drop=True)
    # Find all numeric columns except the first (x_col)
    numeric_cols = [col for col in df.columns if col != x_col and pd.api.types.is_numeric_dtype(df[col])]
    # Create plot data for all numeric columns
    plot_data = {
        'data': [
            {
                'x': df[x_col].astype(str).tolist(),
                'y': df[col].tolist(),
                'type': 'scatter',
                'mode': 'lines+markers',
                'name': col
            } for col in numeric_cols
        ],
        'layout': {
            'title': {
                'text': 'Auto Chart',
                'font': {'size': 24}
            },
            'xaxis': {
                'title': x_col,
                'tickangle': -45,
                'gridcolor': 'rgb(240, 240, 240)',
                'showgrid': True
            },
            'yaxis': {
                'title': 'Value',
                'gridcolor': 'rgb(240, 240, 240)',
                'showgrid': True
            },
            'showlegend': True,
            'legend': {
                'x': 0.02,
                'y': 0.98,
                'bgcolor': 'rgba(255, 255, 255, 0.9)',
                'bordercolor': 'rgba(0, 0, 0, 0.2)',
                'borderwidth': 1
            },
            'hovermode': 'x unified',
            'plot_bgcolor': 'white',
            'margin': {'t': 50, 'b': 80, 'l': 60, 'r': 20}
        }
    }
    result = json.dumps(plot_data)
except Exception as e:
    print(f"Error executing code: {str(e)}")
    raise e
result
`;
        const res = await py.runPythonAsync(code);
        console.log('Python execution result:', res);
        
        if (!res) {
          throw new Error('No result returned from Python code');
        }
        
        self.postMessage({ 
          type: 'result', 
          resultType: 'plot', 
          payload: res
        });
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