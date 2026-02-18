import React, { useState } from 'react';
import Navigation from './components/Navigation';
import ChatFeature from './components/ChatFeature';
import LiveFeature from './components/LiveFeature';
import StudioFeature from './components/StudioFeature';
import { AppMode } from './types';

const App: React.FC = () => {
  const [mode, setMode] = useState<AppMode>(AppMode.CHAT);

  return (
    <div className="h-screen w-screen bg-slate-950 text-slate-50 flex flex-col overflow-hidden">
      <div className="flex-1 relative">
        {mode === AppMode.CHAT && <ChatFeature />}
        {mode === AppMode.LIVE && <LiveFeature />}
        {mode === AppMode.STUDIO && <StudioFeature />}
      </div>
      <Navigation currentMode={mode} setMode={setMode} />
    </div>
  );
};

export default App;
