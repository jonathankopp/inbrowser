import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: {
      '/api/proxy': {
        target: 'https://api.openai.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api\/proxy/, ''),
        configure: (proxy, _options) => {
          proxy.on('error', (err, _req, _res) => {
            console.error('Proxy error:', err);
          });
          proxy.on('proxyReq', (proxyReq, req, _res) => {
            console.log('Sending Request to OpenAI:', req.method, req.url);
            // Log request headers for debugging
            console.log('Request headers:', proxyReq.getHeaders());
          });
          proxy.on('proxyRes', (proxyRes, req, _res) => {
            console.log('Received Response from OpenAI:', {
              statusCode: proxyRes.statusCode,
              url: req.url,
              headers: proxyRes.headers
            });
            
            // Handle non-200 responses
            if (proxyRes.statusCode !== 200) {
              let body = '';
              proxyRes.on('data', chunk => body += chunk);
              proxyRes.on('end', () => {
                console.error('OpenAI API Error:', {
                  statusCode: proxyRes.statusCode,
                  body: body
                });
              });
            }
          });
        },
      }
    }
  },
  optimizeDeps: {
    exclude: ['pyodide']
  }
}); 