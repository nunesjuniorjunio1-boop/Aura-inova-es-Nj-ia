import React, { useState, useRef, useEffect } from 'react';
import { Send, ImagePlus, Loader2, MapPin, Search, Brain, Code, FileAudio, Mic, MicOff, X, FileVideo, File } from 'lucide-react';
import { Message } from '../types';
import { sendChatMessage, analyzeMedia, generateSpeech, generateImage, transcribeAudio } from '../services/geminiService';
import { blobToBase64, decode, decodeAudioData } from '../utils/audioUtils';

const ChatFeature: React.FC = () => {
  const [messages, setMessages] = useState<Message[]>([
    { id: '1', role: 'model', text: "Olá! Eu sou a Aura. Como posso ajudar você hoje?" }
  ]);
  const [inputText, setInputText] = useState('');
  const [isLoading, setIsLoading] = useState(false);
  
  // Settings
  const [useSearch, setUseSearch] = useState(false);
  const [useMaps, setUseMaps] = useState(false);
  const [useThinking, setUseThinking] = useState(false);
  
  // Attachments
  const [attachedFiles, setAttachedFiles] = useState<File[]>([]);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const messagesEndRef = useRef<HTMLDivElement>(null);

  // Audio Recording & TTS
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);
  const [audioCtx, setAudioCtx] = useState<AudioContext | null>(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleSend = async () => {
    if ((!inputText.trim() && attachedFiles.length === 0) || isLoading) return;

    // Create preview attachments for the user message
    const attachments = attachedFiles.map(file => ({
        type: file.type.startsWith('image') ? 'image' : file.type.startsWith('video') ? 'video' : 'audio',
        url: URL.createObjectURL(file),
        mimeType: file.type,
        name: file.name
    })) as Message['attachments'];

    const newMessage: Message = {
      id: Date.now().toString(),
      role: 'user',
      text: inputText,
      attachments: attachments
    };

    setMessages(prev => [...prev, newMessage]);
    setInputText('');
    setAttachedFiles([]); // Clear inputs immediately
    setIsLoading(true);

    try {
      let responseText = '';
      let groundingData = undefined;

      // Process all attachments into base64 parts
      const mediaParts = await Promise.all(attachedFiles.map(async (file) => ({
          inlineData: {
              data: await blobToBase64(file),
              mimeType: file.type
          }
      })));

      // Text only chat with tools
      let location = undefined;
      // If Maps is enabled OR if the user explicitly mentioned location in text (we can't easily parse that, 
      // but if useMaps is on we MUST send location).
      // We also check if we can get location for context enhancement generally.
      if (useMaps) {
            try {
              const pos: GeolocationPosition = await new Promise((resolve, reject) => 
                  navigator.geolocation.getCurrentPosition(resolve, reject)
              );
              location = { latitude: pos.coords.latitude, longitude: pos.coords.longitude };
            } catch (e) {
                console.warn("Permissão de localização negada");
            }
      }

      const res = await sendChatMessage(
          messages.map(m => ({ role: m.role, parts: [{ text: m.text }] })),
          newMessage.text,
          { 
              useSearch, 
              useMaps, 
              useThinking, 
              location,
              mediaParts 
          }
      );
      responseText = res.text;
      groundingData = res.grounding;

      const botMessage: Message = {
        id: (Date.now() + 1).toString(),
        role: 'model',
        text: responseText,
        grounding: {
            search: groundingData?.map((g: any) => g.web).filter(Boolean),
            maps: groundingData?.map((g: any) => g.maps).filter(Boolean)
        }
      };
      setMessages(prev => [...prev, botMessage]);

    } catch (error) {
      console.error(error);
      setMessages(prev => [...prev, { id: Date.now().toString(), role: 'model', text: "Desculpe, algo deu errado." }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleMicClick = async () => {
      if (isRecording) {
          mediaRecorderRef.current?.stop();
          setIsRecording(false);
      } else {
          try {
              const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
              const recorder = new MediaRecorder(stream);
              const chunks: BlobPart[] = [];
              
              recorder.ondataavailable = (e) => {
                  if (e.data.size > 0) chunks.push(e.data);
              };
              
              recorder.onstop = async () => {
                  const type = recorder.mimeType || 'audio/webm';
                  const blob = new Blob(chunks, { type });
                  setIsTranscribing(true);
                  
                  try {
                      const text = await transcribeAudio(blob);
                      if (text) {
                          setInputText(prev => prev ? `${prev} ${text}` : text);
                      }
                  } catch (error) {
                      console.error("Erro na transcrição", error);
                  } finally {
                      setIsTranscribing(false);
                      stream.getTracks().forEach(t => t.stop());
                  }
              };
              
              recorder.start();
              setIsRecording(true);
              mediaRecorderRef.current = recorder;
          } catch (error) {
              console.error("Acesso ao microfone negado", error);
          }
      }
  };

  const handleLocationClick = async () => {
      if (isLoading || isTranscribing) return;
      try {
          const pos: GeolocationPosition = await new Promise((resolve, reject) => 
              navigator.geolocation.getCurrentPosition(resolve, reject)
          );
          const { latitude, longitude } = pos.coords;
          const locString = ` [Minha localização: ${latitude}, ${longitude}]`;
          setInputText(prev => prev + locString);
      } catch (error) {
          console.error("Erro ao obter localização", error);
          alert("Não foi possível obter sua localização. Verifique se a permissão foi concedida.");
      }
  };

  const playTTS = async (text: string) => {
      try {
          const base64Audio = await generateSpeech(text);
          if (!base64Audio) return;
          
          let ctx = audioCtx;
          if (!ctx) {
              ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 24000 });
              setAudioCtx(ctx);
          }
          
          const audioBuffer = await decodeAudioData(decode(base64Audio), ctx, 24000, 1);
          const source = ctx.createBufferSource();
          source.buffer = audioBuffer;
          source.connect(ctx.destination);
          source.start();
      } catch (e) {
          console.error("Erro no TTS", e);
      }
  };

  return (
    <div className="flex flex-col h-full bg-slate-950 pb-20">
      {/* Header */}
      <div className="p-4 border-b border-slate-800 bg-slate-900 flex items-center justify-between sticky top-0 z-10">
        <h1 className="text-xl font-bold bg-gradient-to-r from-blue-400 to-purple-400 bg-clip-text text-transparent">
          Chat Aura
        </h1>
        <div className="flex gap-2">
           <button 
             onClick={() => { setUseThinking(!useThinking); setUseMaps(false); setUseSearch(false); }}
             className={`p-2 rounded-full ${useThinking ? 'bg-purple-600 text-white' : 'bg-slate-800 text-slate-400'}`}
             title="Modo Pensamento (Raciocínio)"
           >
             <Brain size={18} />
           </button>
           <button 
             onClick={() => { setUseSearch(!useSearch); setUseThinking(false); setUseMaps(false); }}
             className={`p-2 rounded-full ${useSearch ? 'bg-blue-600 text-white' : 'bg-slate-800 text-slate-400'}`}
             title="Pesquisa Google"
           >
             <Search size={18} />
           </button>
           <button 
             onClick={() => { setUseMaps(!useMaps); setUseThinking(false); setUseSearch(false); }}
             className={`p-2 rounded-full ${useMaps ? 'bg-green-600 text-white' : 'bg-slate-800 text-slate-400'}`}
             title="Google Maps"
           >
             <MapPin size={18} />
           </button>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div className={`max-w-[85%] rounded-2xl p-4 ${
              msg.role === 'user' 
                ? 'bg-blue-600 text-white' 
                : 'bg-slate-800 text-slate-200'
            }`}>
              
              {/* Attachments Display */}
              {msg.attachments && msg.attachments.length > 0 && (
                  <div className="grid grid-cols-2 gap-2 mb-3">
                      {msg.attachments.map((att, i) => (
                          <div key={i} className="relative rounded-lg overflow-hidden bg-slate-900/30">
                              {att.type === 'image' && (
                                  <img src={att.url} alt={att.name} className="w-full h-32 object-cover" />
                              )}
                              {att.type === 'video' && (
                                  <div className="w-full h-32 flex items-center justify-center bg-black">
                                      <FileVideo size={32} className="text-slate-400" />
                                      {/* Or actual video player if preferred, but simplified for list */}
                                  </div>
                              )}
                              {att.type === 'audio' && (
                                  <div className="w-full h-16 flex items-center justify-center bg-slate-900">
                                      <FileAudio size={24} className="text-slate-400" />
                                  </div>
                              )}
                          </div>
                      ))}
                  </div>
              )}

              <div className="whitespace-pre-wrap text-sm leading-relaxed">{msg.text}</div>
              
              {/* Grounding Sources */}
              {msg.grounding?.search && msg.grounding.search.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-slate-600/50">
                      <p className="text-xs font-semibold text-slate-400 mb-1">Fontes:</p>
                      <div className="flex flex-wrap gap-2">
                          {msg.grounding.search.map((s, idx) => (
                              <a key={idx} href={s.uri} target="_blank" rel="noreferrer" className="text-xs bg-slate-900/50 px-2 py-1 rounded hover:text-blue-300 truncate max-w-xs block">
                                  {s.title}
                              </a>
                          ))}
                      </div>
                  </div>
              )}
               {msg.grounding?.maps && msg.grounding.maps.length > 0 && (
                  <div className="mt-3 pt-3 border-t border-slate-600/50">
                      <p className="text-xs font-semibold text-slate-400 mb-1">Locais:</p>
                      <div className="flex flex-wrap gap-2">
                          {msg.grounding.maps.map((s, idx) => (
                              <a key={idx} href={s.uri} target="_blank" rel="noreferrer" className="text-xs bg-slate-900/50 px-2 py-1 rounded hover:text-green-300 flex items-center gap-1">
                                  <MapPin size={10} /> {s.title}
                              </a>
                          ))}
                      </div>
                  </div>
              )}

              {msg.role === 'model' && (
                  <button onClick={() => playTTS(msg.text)} className="mt-2 text-xs opacity-50 hover:opacity-100 flex items-center gap-1">
                      <FileAudio size={12}/> Ler em voz alta
                  </button>
              )}
            </div>
          </div>
        ))}
        {isLoading && (
            <div className="flex justify-start">
                <div className="bg-slate-800 p-4 rounded-2xl flex items-center gap-2">
                    <Loader2 className="animate-spin text-blue-400" size={20} />
                    <span className="text-sm text-slate-400">Aura está pensando...</span>
                </div>
            </div>
        )}
        <div ref={messagesEndRef} />
      </div>

      {/* Input Area */}
      <div className="p-4 bg-slate-900 border-t border-slate-800">
        
        {/* Attachment Preview Bar */}
        {attachedFiles.length > 0 && (
            <div className="flex gap-3 overflow-x-auto pb-3 mb-2 scrollbar-hide">
                {attachedFiles.map((file, i) => (
                    <div key={i} className="relative flex-shrink-0 w-20 h-20 bg-slate-800 rounded-lg border border-slate-700 flex items-center justify-center group">
                        <button 
                            onClick={() => setAttachedFiles(prev => prev.filter((_, idx) => idx !== i))}
                            className="absolute -top-2 -right-2 bg-red-500 text-white rounded-full p-1 shadow-md hover:bg-red-600 z-10"
                        >
                            <X size={12} />
                        </button>
                        
                        {file.type.startsWith('image') ? (
                            <img src={URL.createObjectURL(file)} alt="preview" className="w-full h-full object-cover rounded-lg" />
                        ) : file.type.startsWith('video') ? (
                            <FileVideo size={32} className="text-purple-400" />
                        ) : (
                            <FileAudio size={32} className="text-yellow-400" />
                        )}
                        <span className="absolute bottom-0 w-full text-[10px] bg-black/70 text-white truncate px-1 rounded-b-lg">
                            {file.name}
                        </span>
                    </div>
                ))}
            </div>
        )}

        <div className="flex items-center gap-2">
          <button 
            onClick={() => fileInputRef.current?.click()}
            className="p-3 text-slate-400 hover:text-white bg-slate-800 rounded-full transition-colors relative"
            title="Anexar arquivos"
            disabled={isLoading || isTranscribing}
          >
            <ImagePlus size={20} />
            {attachedFiles.length > 0 && (
                <span className="absolute -top-1 -right-1 bg-blue-500 text-xs w-5 h-5 flex items-center justify-center rounded-full text-white font-bold">
                    {attachedFiles.length}
                </span>
            )}
          </button>
          
          <button 
            onClick={handleLocationClick}
            className="p-3 text-slate-400 hover:text-white bg-slate-800 rounded-full transition-colors"
            title="Compartilhar Localização"
            disabled={isLoading || isTranscribing}
          >
            <MapPin size={20} />
          </button>

          <button
            onClick={handleMicClick}
            className={`p-3 rounded-full transition-all ${
                isRecording 
                ? 'bg-red-500/20 text-red-500 animate-pulse' 
                : isTranscribing 
                    ? 'bg-slate-800 text-slate-500 cursor-wait'
                    : 'bg-slate-800 text-slate-400 hover:text-white'
            }`}
            disabled={isTranscribing || isLoading}
            title={isRecording ? "Parar Gravação" : "Gravar Áudio"}
          >
             {isTranscribing ? <Loader2 className="animate-spin" size={20}/> : (isRecording ? <MicOff size={20}/> : <Mic size={20} />)}
          </button>

          <input 
            type="file" 
            ref={fileInputRef} 
            className="hidden" 
            multiple
            accept="image/*,audio/*,video/*"
            onChange={(e) => {
                if(e.target.files && e.target.files.length > 0) {
                    setAttachedFiles(prev => [...prev, ...Array.from(e.target.files!)]);
                }
            }}
          />
          <input
            type="text"
            value={inputText}
            onChange={(e) => setInputText(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && handleSend()}
            placeholder="Mensagem para Aura..."
            className="flex-1 bg-slate-800 text-white rounded-full px-4 py-3 focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-500"
            disabled={isTranscribing || isLoading}
          />
          <button 
            onClick={handleSend}
            disabled={(!inputText && attachedFiles.length === 0) || isLoading || isTranscribing}
            className="p-3 bg-blue-600 text-white rounded-full disabled:opacity-50 disabled:cursor-not-allowed hover:bg-blue-500 transition-colors"
          >
            <Send size={20} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default ChatFeature;