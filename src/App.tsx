import { useState } from 'react';
import Chat from './components/Chat';
import WidgetGrid from './components/WidgetGrid';
import type { SheetPNG } from './types';

export default function App() {
  const [sheets, setSheets] = useState<SheetPNG[]>([]);
  
  return (
    <div className="min-h-screen bg-gray-100 p-4">
      <div className="max-w-7xl mx-auto">
        <header className="mb-8">
          <h1 className="text-3xl font-bold text-gray-900">
            In-Browser Analytics
          </h1>
          <p className="text-gray-600">
            Drop Excel files and ask questions in natural language
          </p>
        </header>
        
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-6">
          <Chat sheets={sheets} onSheetsUpdate={setSheets} />
          <WidgetGrid />
        </div>
      </div>
    </div>
  );
} 