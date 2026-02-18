import React, { useEffect, useRef, useState } from 'react';
import { Mic, MicOff, PhoneOff, Activity, MessageSquare, X, FileAudio, Captions, MonitorUp, MonitorOff } from 'lucide-react';
import { connectLive, generateSpeech } from '../services/geminiService';
import { createPcmBlob, decode, decodeAudioData } from '../utils/audioUtils';
import { LiveServerMessage } from '@google/genai';

interface TranscriptItem {
  role: 'user' | 'model';
  text: string;
}

const LiveFeature: React.FC = () => {
  const [isConnected, setIsConnected] = useState(false);
  const [isMuted, setIsMuted] = useState(false);
  const [status, setStatus] = useState<'disconnected' | 'connecting' | 'connected'>('disconnected');
  const [transcript, setTranscript] = useState<TranscriptItem[]>([]);
  const [showTranscript, setShowTranscript] = useState(false);
  
  // Real-time caption state
  const [captionText, setCaptionText] = useState('');

  // Screen Share State
  const [isScreenSharing, setIsScreenSharing] = useState(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  
  // Refs for audio processing
  const audioContextRef = useRef<AudioContext | null>(null);
  const inputSourceRef = useRef<MediaStreamAudioSourceNode | null>(null);
  const processorRef = useRef<ScriptProcessorNode | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const sessionPromiseRef = useRef<Promise<any> | null>(null);
  
  // Refs for Video/Screen Processing
  const videoStreamRef = useRef<MediaStream | null>(null);
  const videoIntervalRef = useRef<number | null>(null);
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  
  // Transcription accumulation
  const currentInputRef = useRef('');
  const currentOutputRef = useRef('');

  // Playback refs
  const nextStartTimeRef = useRef<number>(0);
  const sourcesRef = useRef<Set<AudioBufferSourceNode>>(new Set());

  const cleanup = () => {
    // Audio Cleanup
    if (streamRef.current) {
        streamRef.current.getTracks().forEach(track => track.stop());
        streamRef.current = null;
    }
    if (processorRef.current) {
        processorRef.current.disconnect();
        processorRef.current = null;
    }
    if (inputSourceRef.current) {
        inputSourceRef.current.disconnect();
        inputSourceRef.current = null;
    }
    if (audioContextRef.current) {
        audioContextRef.current.close();
        audioContextRef.current = null;
    }
    sourcesRef.current.forEach(source => source.stop());
    sourcesRef.current.clear();

    // Video Cleanup
    stopScreenShare();
    
    setIsConnected(false);
    setStatus('disconnected');
    setTranscript([]);
    setCaptionText('');
    currentInputRef.current = '';
    currentOutputRef.current = '';
  };

  const stopScreenShare = () => {
      if (videoIntervalRef.current) {
          window.clearInterval(videoIntervalRef.current);
          videoIntervalRef.current = null;
      }
      if (videoStreamRef.current) {
          videoStreamRef.current.getTracks().forEach(track => track.stop());
          videoStreamRef.current = null;
      }
      if (videoRef.current) {
          videoRef.current.srcObject = null;
      }
      setIsScreenSharing(false);
  };

  const toggleScreenShare = async () => {
      if (!isConnected) return;

      if (isScreenSharing) {
          stopScreenShare();
      } else {
          try {
              // Open native screen picker
              const stream = await navigator.mediaDevices.getDisplayMedia({ 
                  video: { 
                      width: { max: 1280 },
                      height: { max: 720 },
                      frameRate: { max: 10 } 
                  },
                  audio: false // We use microphone audio separately
              });

              videoStreamRef.current = stream;
              setIsScreenSharing(true);

              // Setup hidden video element for capture
              if (videoRef.current) {
                  videoRef.current.srcObject = stream;
                  videoRef.current.onloadedmetadata = () => {
                      videoRef.current?.play();
                      startVideoTransmission();
                  };
              }

              // Handle user stopping share via browser UI
              stream.getVideoTracks()[0].onended = () => {
                  stopScreenShare();
              };

          } catch (e) {
              console.error("Error sharing screen:", e);
              setIsScreenSharing(false);
          }
      }
  };

  const startVideoTransmission = () => {
      if (!canvasRef.current || !videoRef.current) return;

      const canvas = canvasRef.current;
      const ctx = canvas.getContext('2d');
      const video = videoRef.current;

      // Send frames at ~2 FPS to balance quality/latency
      videoIntervalRef.current = window.setInterval(() => {
          if (!sessionPromiseRef.current || !ctx || !video) return;

          // Draw video frame to canvas
          canvas.width = video.videoWidth;
          canvas.height = video.videoHeight;
          ctx.drawImage(video, 0, 0, canvas.width, canvas.height);

          // Convert to base64 JPEG
          const base64Data = canvas.toDataURL('image/jpeg', 0.6).split(',')[1];

          // Send to Gemini
          sessionPromiseRef.current.then(session => {
             session.sendRealtimeInput({
                 media: {
                     mimeType: 'image/jpeg',
                     data: base64Data
                 }
             });
          });

      }, 500); // 500ms = 2 FPS
  };

  const startSession = async () => {
    setStatus('connecting');
    try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 });
        audioContextRef.current = ctx;

        // Output Context (24kHz for Gemini response)
        const outputCtx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
        
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
        streamRef.current = stream;

        const sessionPromise = connectLive({
            onOpen: () => {
                setStatus('connected');
                setIsConnected(true);
                setCaptionText('');
                
                // Setup Input Stream
                const source = ctx.createMediaStreamSource(stream);
                const processor = ctx.createScriptProcessor(4096, 1, 1);
                
                processor.onaudioprocess = (e) => {
                    if (isMuted) return; // Simple mute implementation
                    const inputData = e.inputBuffer.getChannelData(0);
                    const pcmBlob = createPcmBlob(inputData);
                    
                    sessionPromise.then(session => {
                        session.sendRealtimeInput({ media: pcmBlob });
                    });
                };
                
                source.connect(processor);
                processor.connect(ctx.destination); // Required for script processor to run
                
                inputSourceRef.current = source;
                processorRef.current = processor;
            },
            onMessage: async (msg: LiveServerMessage) => {
                // Handle Audio
                const base64Audio = msg.serverContent?.modelTurn?.parts?.[0]?.inlineData?.data;
                if (base64Audio) {
                    nextStartTimeRef.current = Math.max(nextStartTimeRef.current, outputCtx.currentTime);
                    const audioBuffer = await decodeAudioData(
                        decode(base64Audio),
                        outputCtx,
                        24000,
                        1
                    );
                    
                    const source = outputCtx.createBufferSource();
                    source.buffer = audioBuffer;
                    source.connect(outputCtx.destination);
                    source.addEventListener('ended', () => sourcesRef.current.delete(source));
                    
                    source.start(nextStartTimeRef.current);
                    nextStartTimeRef.current += audioBuffer.duration;
                    sourcesRef.current.add(source);
                }

                // Handle Transcription
                if (msg.serverContent?.outputTranscription?.text) {
                    const text = msg.serverContent.outputTranscription.text;
                    currentOutputRef.current += text;
                    setCaptionText(currentOutputRef.current);
                }
                if (msg.serverContent?.inputTranscription?.text) {
                    const text = msg.serverContent.inputTranscription.text;
                    currentInputRef.current += text;
                }

                if (msg.serverContent?.turnComplete) {
                    const input = currentInputRef.current.trim();
                    const output = currentOutputRef.current.trim();
                    
                    if (input || output) {
                         setTranscript(prev => {
                             const newItems: TranscriptItem[] = [];
                             if (input) newItems.push({role: 'user', text: input});
                             if (output) newItems.push({role: 'model', text: output});
                             return [...prev, ...newItems];
                         });
                    }
                    currentInputRef.current = '';
                    currentOutputRef.current = '';
                }
                
                if (msg.serverContent?.interrupted) {
                    sourcesRef.current.forEach(s => s.stop());
                    sourcesRef.current.clear();
                    nextStartTimeRef.current = 0;
                    currentOutputRef.current = '';
                    setCaptionText('');
                }
            },
            onClose: () => cleanup(),
            onError: (e) => {
                console.error("Live API Error", e);
                cleanup();
            }
        });
        
        sessionPromiseRef.current = sessionPromise;

    } catch (e) {
        console.error("Failed to start live session", e);
        setStatus('disconnected');
    }
  };

  const playTTS = async (text: string) => {
      try {
          const base64Audio = await generateSpeech(text);
          if (!base64Audio) return;
          
          let ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
          const audioBuffer = await decodeAudioData(decode(base64Audio), ctx, 24000, 1);
          const source = ctx.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(ctx.destination);
          source.start();
      } catch (e) {
          console.error("TTS Error", e);
      }
  };

  useEffect(() => {
      return () => cleanup();
  }, []);

  return (
    <div className="h-full flex flex-col items-center justify-center bg-slate-950 p-6 relative overflow-hidden">
        {/* Helper Elements for Video Processing */}
        <video ref={videoRef} className="hidden" muted playsInline />
        <canvas ref={canvasRef} className="hidden" />

        {/* Background Ambient Effect */}
        <div className={`absolute inset-0 bg-gradient-to-b from-blue-900/20 to-slate-950 transition-opacity duration-1000 ${isConnected ? 'opacity-100' : 'opacity-0'}`} />
        
        {/* Visualizer Orb or Screen Preview */}
        {!showTranscript && (
            <div className="relative z-10 mb-8 flex flex-col items-center">
                
                {isScreenSharing ? (
                     <div className="w-64 h-48 bg-black rounded-xl border-2 border-blue-500/50 shadow-[0_0_30px_rgba(59,130,246,0.2)] flex items-center justify-center mb-8 overflow-hidden relative">
                         <div className="absolute top-2 right-2 flex gap-1">
                             <span className="w-2 h-2 bg-red-500 rounded-full animate-pulse"/>
                             <span className="text-[10px] text-white font-bold">LIVE</span>
                         </div>
                         <MonitorUp size={48} className="text-blue-400 opacity-50" />
                         <p className="absolute bottom-4 text-xs text-blue-300">Compartilhando Tela</p>
                     </div>
                ) : (
                    <div className={`w-48 h-48 rounded-full flex items-center justify-center transition-all duration-500 mb-8 ${
                        status === 'connected' ? 'bg-blue-500/20 shadow-[0_0_100px_rgba(59,130,246,0.3)]' : 'bg-slate-800'
                    }`}>
                        <div className={`w-32 h-32 rounded-full flex items-center justify-center transition-all duration-300 ${
                            status === 'connected' ? 'bg-blue-500/40 animate-pulse' : 'bg-slate-700'
                        }`}>
                            {status === 'connecting' ? (
                                <Activity className="animate-spin text-white" size={48} />
                            ) : (
                                <Mic className={`text-white transition-all ${status === 'connected' ? 'scale-110' : 'opacity-50'}`} size={48} />
                            )}
                        </div>
                    </div>
                )}

                {/* Status or Captions */}
                <div className="h-24 w-full max-w-md flex items-center justify-center text-center px-4">
                    {captionText ? (
                        <p className="text-xl font-medium text-white drop-shadow-md animate-in fade-in slide-in-from-bottom-2 duration-300">
                            "{captionText}"
                        </p>
                    ) : (
                        <h2 className="text-2xl font-bold text-slate-400">
                            {status === 'disconnected' && "Iniciar Conversa"}
                            {status === 'connecting' && "Conectando..."}
                            {status === 'connected' && (isScreenSharing ? "Aura está vendo sua tela..." : "Aura está ouvindo...")}
                        </h2>
                    )}
                </div>
            </div>
        )}

        {/* Controls */}
        <div className={`flex gap-4 z-20 ${showTranscript ? 'mb-4' : ''}`}>
            {status === 'disconnected' ? (
                <button 
                    onClick={startSession}
                    className="bg-blue-600 hover:bg-blue-500 text-white px-8 py-4 rounded-full font-bold text-lg shadow-lg shadow-blue-900/50 transition-all hover:scale-105"
                >
                    Conectar Ao Vivo
                </button>
            ) : (
                <>
                    <button 
                        onClick={() => setIsMuted(!isMuted)}
                        className={`p-4 rounded-full transition-colors ${isMuted ? 'bg-red-500/20 text-red-400' : 'bg-slate-800 text-white hover:bg-slate-700'}`}
                        title={isMuted ? "Ativar Microfone" : "Silenciar"}
                    >
                        {isMuted ? <MicOff size={24} /> : <Mic size={24} />}
                    </button>

                    <button 
                         onClick={toggleScreenShare}
                         className={`p-4 rounded-full transition-colors ${isScreenSharing ? 'bg-green-600 text-white shadow-[0_0_20px_rgba(34,197,94,0.3)]' : 'bg-slate-800 text-white hover:bg-slate-700'}`}
                         title={isScreenSharing ? "Parar Compartilhamento" : "Compartilhar Tela"}
                    >
                        {isScreenSharing ? <MonitorOff size={24} /> : <MonitorUp size={24} />}
                    </button>
                    
                    <button 
                         onClick={() => setShowTranscript(!showTranscript)}
                         className={`p-4 rounded-full transition-colors ${showTranscript ? 'bg-blue-600 text-white' : 'bg-slate-800 text-white hover:bg-slate-700'}`}
                         title="Transcrição"
                    >
                        <MessageSquare size={24} />
                    </button>

                    <button 
                        onClick={cleanup}
                        className="p-4 rounded-full bg-red-600 text-white hover:bg-red-500 shadow-lg shadow-red-900/50"
                        title="Encerrar Chamada"
                    >
                        <PhoneOff size={24} />
                    </button>
                </>
            )}
        </div>

        {/* Transcript Overlay */}
        {showTranscript && status !== 'disconnected' && (
            <div className="absolute inset-0 top-24 bottom-24 bg-slate-900/90 backdrop-blur-sm z-10 m-4 rounded-3xl p-4 overflow-y-auto border border-slate-700 flex flex-col gap-3 shadow-2xl">
                <div className="flex justify-between items-center mb-2">
                    <h3 className="text-white font-bold flex items-center gap-2">
                        <Captions size={18} /> Transcrição
                    </h3>
                    <button onClick={() => setShowTranscript(false)}><X size={20} className="text-slate-400" /></button>
                </div>
                
                {transcript.length === 0 && !captionText && <p className="text-slate-500 text-center mt-10">Diga algo...</p>}
                
                {transcript.map((item, idx) => (
                    <div key={idx} className={`p-3 rounded-lg text-sm ${item.role === 'user' ? 'bg-blue-900/30 text-blue-100 self-end ml-8' : 'bg-slate-800 text-slate-200 self-start mr-8'}`}>
                        <p>{item.text}</p>
                        {item.role === 'model' && (
                            <button onClick={() => playTTS(item.text)} className="mt-2 flex items-center gap-1 text-xs text-blue-400 hover:text-blue-300">
                                <FileAudio size={12} /> Ler em voz alta
                            </button>
                        )}
                    </div>
                ))}
                
                {/* Pending Caption in Transcript */}
                {captionText && (
                    <div className="p-3 rounded-lg text-sm bg-slate-800/50 border border-slate-700 text-slate-300 self-start mr-8 animate-pulse">
                        <p>{captionText} ...</p>
                    </div>
                )}
            </div>
        )}
        
        {!showTranscript && (
            <p className="absolute bottom-24 text-slate-500 text-sm max-w-xs text-center">
                Gemini 2.5 Live (Multimodal)
            </p>
        )}
    </div>
  );
};

export default LiveFeature;