import React from 'react';
import { MessageSquare, Mic, Image as ImageIcon, Video, FileAudio } from 'lucide-react';
import { AppMode } from '../types';

interface NavigationProps {
  currentMode: AppMode;
  setMode: (mode: AppMode) => void;
}

const Navigation: React.FC<NavigationProps> = ({ currentMode, setMode }) => {
  const navItems = [
    { mode: AppMode.CHAT, icon: MessageSquare, label: 'Chat' },
    { mode: AppMode.LIVE, icon: Mic, label: 'Ao Vivo' },
    { mode: AppMode.STUDIO, icon: ImageIcon, label: 'Estúdio' },
  ];

  return (
    <nav className="fixed bottom-0 left-0 right-0 bg-slate-900 border-t border-slate-800 p-2 pb-6 z-50">
      <div className="flex justify-around items-center max-w-md mx-auto">
        {navItems.map((item) => (
          <button
            key={item.mode}
            onClick={() => setMode(item.mode)}
            className={`flex flex-col items-center p-2 transition-colors ${
              currentMode === item.mode ? 'text-blue-400' : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            <item.icon size={24} />
            <span className="text-xs mt-1 font-medium">{item.label}</span>
          </button>
        ))}
      </div>
    </nav>
  );
};

export default Navigation;