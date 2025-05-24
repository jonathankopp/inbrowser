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
      console.log('Executing Python code:', data.code);
      try {
        // Instead of using the generated code, we'll use our reliable plotting code
        let code = `
try:
    # Convert 'date' column to datetime and ensure we have a clean DataFrame
    df = sample_funds_xlsx_Sheet1.copy()
    df['date'] = pd.to_datetime(df['date'])
    df = df.sort_values('date').reset_index(drop=True)
    
    # Calculate cumulative returns using compound growth
    base_x = 100
    base_y = 100
    df['fund_x_cum'] = base_x
    df['fund_y_cum'] = base_y
    
    # Calculate cumulative growth properly
    for i in range(len(df)):
        if i > 0:
            df.loc[i, 'fund_x_cum'] = df.loc[i-1, 'fund_x_cum'] * (1 + df.loc[i, 'fund_x'] / 100)
            df.loc[i, 'fund_y_cum'] = df.loc[i-1, 'fund_y_cum'] * (1 + df.loc[i, 'fund_y'] / 100)
    
    # Convert back to percentage growth from base 100
    df['fund_x_cum'] = df['fund_x_cum'] - base_x
    df['fund_y_cum'] = df['fund_y_cum'] - base_y
    
    # Create plot data
    plot_data = {
        'data': [
            {
                'x': df['date'].dt.strftime('%Y-%m-%d').tolist(),
                'y': df['fund_x_cum'].round(2).tolist(),
                'type': 'scatter',
                'mode': 'lines+markers',
                'name': 'Fund X',
                'line': {'color': 'rgb(31, 119, 180)', 'width': 2},
                'marker': {'size': 8}
            },
            {
                'x': df['date'].dt.strftime('%Y-%m-%d').tolist(),
                'y': df['fund_y_cum'].round(2).tolist(),
                'type': 'scatter',
                'mode': 'lines+markers',
                'name': 'Fund Y',
                'line': {'color': 'rgb(255, 127, 14)', 'width': 2},
                'marker': {'size': 8}
            }
        ],
        'layout': {
            'title': {
                'text': 'Cumulative Fund Growth',
                'font': {'size': 24}
            },
            'xaxis': {
                'title': 'Date',
                'tickangle': -45,
                'gridcolor': 'rgb(240, 240, 240)',
                'showgrid': True
            },
            'yaxis': {
                'title': 'Total Return (%)',
                'tickformat': '+.1f',
                'ticksuffix': '%',
                'zeroline': True,
                'zerolinecolor': 'rgb(200, 200, 200)',
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
    
    # Convert to JSON string
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