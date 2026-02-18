import React, { useState, useEffect, useRef } from 'react';
import { Image as ImageIcon, Video, Wand2, RefreshCcw, Loader2, Download, Mic, MicOff } from 'lucide-react';
import { generateImage, editImage, generateVideo, transcribeAudio } from '../services/geminiService';
import { blobToBase64 } from '../utils/audioUtils';

type StudioMode = 'generate_image' | 'edit_image' | 'generate_video';

const StudioFeature: React.FC = () => {
  const [mode, setMode] = useState<StudioMode>('generate_image');
  const [prompt, setPrompt] = useState('');
  const [aspectRatio, setAspectRatio] = useState('1:1');
  const [imageSize, setImageSize] = useState('1K');
  const [videoResolution, setVideoResolution] = useState('720p');
  const [isLoading, setIsLoading] = useState(false);
  const [resultUrl, setResultUrl] = useState<string | null>(null);
  const [uploadFile, setUploadFile] = useState<File | null>(null);

  // Audio Recording
  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

  // Reset/Adjust state when switching modes
  useEffect(() => {
    if (mode === 'generate_video') {
        if (aspectRatio !== '16:9' && aspectRatio !== '9:16') {
            setAspectRatio('16:9');
        }
    }
  }, [mode]);

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
                          setPrompt(prev => prev ? `${prev} ${text}` : text);
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
              alert("Não foi possível acessar o microfone.");
          }
      }
  };

  const handleAction = async () => {
    if (!prompt && mode !== 'edit_image') return;
    if (mode === 'edit_image' && !prompt) return;

    setIsLoading(true);
    setResultUrl(null);

    try {
        if (mode === 'generate_image') {
            const images = await generateImage(prompt, imageSize, aspectRatio);
            if (images.length > 0) setResultUrl(images[0]);
        } else if (mode === 'edit_image' && uploadFile) {
            const base64 = await blobToBase64(uploadFile);
            const images = await editImage(base64, uploadFile.type, prompt);
            if (images.length > 0) setResultUrl(images[0]);
        } else if (mode === 'generate_video') {
            let base64 = undefined;
            if (uploadFile) {
                base64 = await blobToBase64(uploadFile);
            }
            // Ensure valid aspect ratio for video if state hasn't updated yet
            const safeAspectRatio = (aspectRatio === '16:9' || aspectRatio === '9:16') ? aspectRatio : '16:9';
            
            const videoUrl = await generateVideo(prompt, safeAspectRatio, videoResolution, base64, uploadFile?.type);
            setResultUrl(videoUrl);
        }
    } catch (e) {
        console.error("Studio Action Failed", e);
        alert("Falha na geração. Verifique o console ou as permissões da API Key.");
    } finally {
        setIsLoading(false);
    }
  };

  const getAspectRatioOptions = () => {
      if (mode === 'generate_video') return ['16:9', '9:16'];
      return ['1:1', '2:3', '3:2', '3:4', '4:3', '9:16', '16:9', '21:9'];
  };

  return (
    <div className="h-full bg-slate-950 flex flex-col pb-20 overflow-y-auto">
       {/* Tabs */}
       <div className="flex border-b border-slate-800 bg-slate-900 sticky top-0 z-20">
           <button onClick={() => { setMode('generate_image'); setResultUrl(null); }} className={`flex-1 p-3 text-sm font-medium ${mode === 'generate_image' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-slate-400'}`}>
               Gerar Imagem
           </button>
           <button onClick={() => { setMode('edit_image'); setResultUrl(null); }} className={`flex-1 p-3 text-sm font-medium ${mode === 'edit_image' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-slate-400'}`}>
               Editar Imagem
           </button>
           <button onClick={() => { setMode('generate_video'); setResultUrl(null); }} className={`flex-1 p-3 text-sm font-medium ${mode === 'generate_video' ? 'text-blue-400 border-b-2 border-blue-400' : 'text-slate-400'}`}>
               Vídeo Veo
           </button>
       </div>

       <div className="p-6 space-y-6 max-w-lg mx-auto w-full">
           
           {/* Preview / Result Area */}
           <div className="aspect-square bg-slate-900 rounded-2xl border-2 border-dashed border-slate-800 flex items-center justify-center overflow-hidden relative">
                {isLoading ? (
                    <div className="flex flex-col items-center gap-3">
                        <Loader2 className="animate-spin text-blue-500" size={32} />
                        <span className="text-sm text-slate-400 animate-pulse">
                            {mode === 'generate_video' ? "Gerando Vídeo (pode levar 1-2 min)..." : "Gerando..."}
                        </span>
                    </div>
                ) : resultUrl ? (
                    mode === 'generate_video' ? (
                        <video src={resultUrl} controls autoPlay loop className="w-full h-full object-contain" />
                    ) : (
                        <img src={resultUrl} alt="Gerado" className="w-full h-full object-contain" />
                    )
                ) : (
                    <div className="text-center text-slate-600">
                        {mode === 'generate_image' && <ImageIcon size={48} className="mx-auto mb-2 opacity-50" />}
                        {mode === 'edit_image' && <Wand2 size={48} className="mx-auto mb-2 opacity-50" />}
                        {mode === 'generate_video' && <Video size={48} className="mx-auto mb-2 opacity-50" />}
                        <p>A prévia aparecerá aqui</p>
                    </div>
                )}
           </div>

           {/* Controls */}
           <div className="space-y-4">
               {/* File Upload for Edit/Video */}
               {(mode === 'edit_image' || (mode === 'generate_video')) && (
                   <div className="space-y-2">
                       <label className="text-sm text-slate-400 block">Imagem de Referência {mode === 'generate_video' ? '(Opcional)' : '(Obrigatório)'}</label>
                       <input 
                         type="file" 
                         accept="image/*"
                         onChange={(e) => setUploadFile(e.target.files?.[0] || null)}
                         className="block w-full text-sm text-slate-400 file:mr-4 file:py-2 file:px-4 file:rounded-full file:border-0 file:text-sm file:font-semibold file:bg-slate-800 file:text-blue-400 hover:file:bg-slate-700"
                       />
                   </div>
               )}

               {/* Prompt */}
               <div className="space-y-2 relative">
                   <label className="text-sm text-slate-400 block">Prompt</label>
                   <textarea
                     value={prompt}
                     onChange={(e) => setPrompt(e.target.value)}
                     placeholder={mode === 'edit_image' ? "Mudar fundo para..." : "Uma cidade cyberpunk futurista..."}
                     className="w-full bg-slate-800 border-slate-700 rounded-xl p-3 text-white h-24 focus:ring-2 focus:ring-blue-500 focus:outline-none resize-none"
                   />
                    <button
                        onClick={handleMicClick}
                        className={`absolute right-3 bottom-3 p-2 rounded-full transition-all ${
                            isRecording 
                            ? 'bg-red-500/20 text-red-500 animate-pulse' 
                            : isTranscribing 
                                ? 'bg-slate-800 text-slate-500 cursor-wait'
                                : 'bg-slate-700/50 text-slate-400 hover:text-white hover:bg-slate-600'
                        }`}
                        title="Gravar Prompt"
                    >
                         {isTranscribing ? <Loader2 className="animate-spin" size={16}/> : (isRecording ? <MicOff size={16}/> : <Mic size={16} />)}
                    </button>
               </div>

               {/* Options */}
               <div className="grid grid-cols-2 gap-4">
                   <div className="space-y-2">
                       <label className="text-sm text-slate-400 block">Proporção</label>
                       <select 
                         value={aspectRatio} 
                         onChange={(e) => setAspectRatio(e.target.value)}
                         className="w-full bg-slate-800 border-none rounded-lg p-2 text-white"
                       >
                           {getAspectRatioOptions().map(r => <option key={r} value={r}>{r}</option>)}
                       </select>
                   </div>
                   {mode !== 'generate_video' ? (
                       <div className="space-y-2">
                           <label className="text-sm text-slate-400 block">Tamanho</label>
                           <select 
                             value={imageSize} 
                             onChange={(e) => setImageSize(e.target.value)}
                             className="w-full bg-slate-800 border-none rounded-lg p-2 text-white"
                           >
                               {['1K', '2K', '4K'].map(s => <option key={s} value={s}>{s}</option>)}
                           </select>
                       </div>
                   ) : (
                       <div className="space-y-2">
                           <label className="text-sm text-slate-400 block">Resolução</label>
                           <select 
                             value={videoResolution} 
                             onChange={(e) => setVideoResolution(e.target.value)}
                             className="w-full bg-slate-800 border-none rounded-lg p-2 text-white"
                           >
                               {['720p', '1080p'].map(s => <option key={s} value={s}>{s}</option>)}
                           </select>
                       </div>
                   )}
               </div>

               <button
                 onClick={handleAction}
                 disabled={isLoading || !prompt || (mode === 'edit_image' && !uploadFile)}
                 className="w-full bg-gradient-to-r from-blue-600 to-purple-600 hover:from-blue-500 hover:to-purple-500 text-white font-bold py-4 rounded-xl shadow-lg shadow-blue-900/20 disabled:opacity-50 disabled:cursor-not-allowed transition-all active:scale-95"
               >
                 {isLoading ? 'Processando...' : 'Gerar'}
               </button>
           </div>
       </div>
    </div>
  );
};

export default StudioFeature;