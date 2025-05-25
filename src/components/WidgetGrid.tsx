import { useEffect, useRef } from 'react';
import Plotly from 'plotly.js-dist-min';

export default function WidgetGrid() {
  const plotContainerRef = useRef<HTMLDivElement>(null);
  
  useEffect(() => {
    // Listen for messages from the Python worker
    const handleMessage = (e: MessageEvent) => {
      console.log('WidgetGrid received message:', e.data);
      
      // Ignore messages that aren't from our worker
      if (!e.data.type || e.data.target) return;
      
      if (e.data.type !== 'result') return;
      
      const { resultType, payload } = e.data;
      
      try {
        if (resultType === 'plot' && plotContainerRef.current) {
          if (!payload) {
            console.error('No payload received for plot');
            return;
          }
          
          // Clear existing plot
          plotContainerRef.current.innerHTML = '';
          
          // Accept both stringified and object payloads
          let figure;
          if (typeof payload === 'string') {
            try {
              figure = JSON.parse(payload);
            } catch (e) {
              console.error('Failed to parse plot payload as JSON:', e, payload);
              return;
            }
          } else {
            figure = payload;
          }
          console.log('Rendering plot with data:', figure);
          
          if (!figure.data || !figure.layout) {
            console.error('Invalid plot data structure:', figure);
            return;
          }
          
          Plotly.newPlot(
            plotContainerRef.current,
            figure.data,
            {
              ...figure.layout,
              width: plotContainerRef.current.clientWidth,
              height: plotContainerRef.current.clientHeight - 20,
              margin: { t: 40, r: 20, b: 40, l: 60 }
            }
          ).catch(error => {
            console.error('Error creating plot:', error);
          });
        }
      } catch (error) {
        console.error('Error rendering plot:', error);
      }
    };
    
    window.addEventListener('message', handleMessage);
    return () => window.removeEventListener('message', handleMessage);
  }, []);
  
  return (
    <div className="bg-white rounded-lg shadow p-4 h-[calc(100vh-8rem)]">
      <div ref={plotContainerRef} className="w-full h-full" />
    </div>
  );
} 