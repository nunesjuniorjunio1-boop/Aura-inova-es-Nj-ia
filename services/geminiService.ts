import { GoogleGenAI, Type, Modality, LiveServerMessage } from "@google/genai";
import { blobToBase64 } from "../utils/audioUtils";

// Ensure API key is available
const apiKey = process.env.API_KEY || '';
if (!apiKey) {
  console.warn("API_KEY is missing from environment variables.");
}

const ai = new GoogleGenAI({ apiKey });

// --- Text & Chat ---

export async function sendChatMessage(
  history: { role: string; parts: { text: string }[] }[],
  newMessage: string,
  options: {
    useSearch?: boolean;
    useMaps?: boolean;
    useThinking?: boolean;
    useCode?: boolean;
    mediaParts?: { inlineData: { data: string; mimeType: string } }[];
    location?: { latitude: number; longitude: number };
  }
) {
  let model = 'gemini-3-flash-preview'; // Default
  let tools: any[] = [];
  let toolConfig: any = undefined;
  let thinkingConfig: any = undefined;

  // Model Selection Logic
  if (options.useThinking) {
    model = 'gemini-3-pro-preview';
    thinkingConfig = { thinkingBudget: 32768 };
  } else if (options.useMaps) {
    model = 'gemini-2.5-flash';
    tools.push({ googleMaps: {} });
    if (options.location) {
        toolConfig = { retrievalConfig: { latLng: options.location } };
    }
  } else if (options.useSearch) {
    model = 'gemini-3-flash-preview'; // Or gemini-3-pro-preview
    tools.push({ googleSearch: {} });
  } else if (options.mediaParts && options.mediaParts.length > 0) {
    model = 'gemini-3-pro-preview'; // Multimodal
  } else if (options.useCode) {
    model = 'gemini-3-pro-preview';
  }

  // Construct contents
  const parts: any[] = [];
  if (options.mediaParts) {
    parts.push(...options.mediaParts);
  }
  parts.push({ text: newMessage });
  
  const contents = [
      ...history.map(h => ({ role: h.role, parts: h.parts })),
      { role: 'user', parts }
  ];

  try {
    const config: any = {
       tools: tools.length > 0 ? tools : undefined,
       toolConfig,
       thinkingConfig,
    };
    
    // Maps grounding excludes responseMimeType
    if (!options.useMaps && !options.useThinking) {
        // config.responseMimeType = "application/json"; // Optional: Force JSON if we wanted structured data
    }

    const response = await ai.models.generateContent({
      model,
      contents,
      config
    });

    return {
      text: response.text || "Sem resposta de texto",
      grounding: response.candidates?.[0]?.groundingMetadata?.groundingChunks,
    };
  } catch (error) {
    console.error("Gemini Chat Error:", error);
    throw error;
  }
}

// --- Analysis ---
export async function analyzeMedia(
    file: File, 
    prompt: string, 
    mediaType: 'audio' | 'video' | 'image'
) {
    const base64 = await blobToBase64(file);
    let model = 'gemini-3-pro-preview';
    
    if (mediaType === 'audio') {
        model = 'gemini-3-flash-preview'; // Transcribe audio requirement
    }

    const response = await ai.models.generateContent({
        model,
        contents: {
            parts: [
                { inlineData: { mimeType: file.type, data: base64 } },
                { text: prompt }
            ]
        }
    });

    return response.text;
}

// --- Transcription ---
export async function transcribeAudio(audioBlob: Blob) {
    const base64 = await blobToBase64(audioBlob);
    
    // Using gemini-3-flash-preview as specifically requested for audio transcription
    const response = await ai.models.generateContent({
        model: 'gemini-3-flash-preview',
        contents: {
            parts: [
                { 
                    inlineData: { 
                        // Use the blob's type, or fallback to webm
                        mimeType: audioBlob.type || 'audio/webm', 
                        data: base64 
                    } 
                },
                { text: "Transcreva o áudio falado para texto. Retorne apenas a transcrição. O idioma é Português." }
            ]
        }
    });
    
    return response.text || "";
}

// --- Image Studio ---

export async function generateImage(prompt: string, size: string, aspectRatio: string) {
    // Check for API key selection if using high quality (implied by user selection requirement)
    if (window.aistudio?.hasSelectedApiKey) {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        if (!hasKey && window.aistudio.openSelectKey) {
            await window.aistudio.openSelectKey();
        }
    }
    
    // Re-init AI to pick up selected key if any
    const localAi = new GoogleGenAI({ apiKey: process.env.API_KEY });

    // Use gemini-3-pro-image-preview
    const response = await localAi.models.generateContent({
        model: 'gemini-3-pro-image-preview',
        contents: { parts: [{ text: prompt }] },
        config: {
            imageConfig: {
                aspectRatio: aspectRatio as any,
                imageSize: size as any,
            }
        }
    });

    const images: string[] = [];
    for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
            images.push(`data:${part.inlineData.mimeType};base64,${part.inlineData.data}`);
        }
    }
    return images;
}

export async function editImage(originalImageBase64: string, mimeType: string, prompt: string) {
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-image', // Nano Banana
        contents: {
            parts: [
                { inlineData: { data: originalImageBase64, mimeType } },
                { text: prompt }
            ]
        }
    });

    const images: string[] = [];
    for (const part of response.candidates?.[0]?.content?.parts || []) {
        if (part.inlineData) {
            images.push(`data:${part.inlineData.mimeType};base64,${part.inlineData.data}`);
        }
    }
    return images;
}

// --- Video Studio (Veo) ---

export async function generateVideo(prompt: string, aspectRatio: string, resolution: string, imageBase64?: string, imageMime?: string) {
    // Veo auth check
    if (window.aistudio?.hasSelectedApiKey) {
        const hasKey = await window.aistudio.hasSelectedApiKey();
        if (!hasKey && window.aistudio.openSelectKey) {
            await window.aistudio.openSelectKey();
        }
    }
    const localAi = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    // Model logic
    const model = 'veo-3.1-fast-generate-preview';
    
    let operation;
    
    if (imageBase64 && imageMime) {
        operation = await localAi.models.generateVideos({
            model,
            prompt, // Prompt is optional for image-to-video but good practice
            image: { imageBytes: imageBase64, mimeType: imageMime },
            config: {
                numberOfVideos: 1,
                resolution: resolution as any,
                aspectRatio: aspectRatio as any
            }
        });
    } else {
        operation = await localAi.models.generateVideos({
            model,
            prompt,
            config: {
                numberOfVideos: 1,
                resolution: resolution as any,
                aspectRatio: aspectRatio as any
            }
        });
    }

    // Polling
    while (!operation.done) {
        await new Promise(resolve => setTimeout(resolve, 5000));
        operation = await localAi.operations.getVideosOperation({ operation });
    }

    const videoUri = operation.response?.generatedVideos?.[0]?.video?.uri;
    if (!videoUri) throw new Error("Video generation failed or returned no URI");

    // Fetch actual bytes
    const vidResponse = await fetch(`${videoUri}&key=${process.env.API_KEY}`);
    const blob = await vidResponse.blob();
    return URL.createObjectURL(blob);
}


// --- TTS ---
export async function generateSpeech(text: string) {
    const response = await ai.models.generateContent({
        model: 'gemini-2.5-flash-preview-tts',
        contents: [{ parts: [{ text }] }],
        config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Kore' } }
            }
        }
    });
    
    const base64Audio = response.candidates?.[0]?.content?.parts?.[0]?.inlineData?.data;
    return base64Audio;
}

// --- Live API Connector ---
export function connectLive(
    callbacks: {
        onOpen: () => void;
        onMessage: (msg: LiveServerMessage) => void;
        onClose: (e: CloseEvent) => void;
        onError: (e: ErrorEvent) => void;
    }
) {
    // Re-initialize AI to ensure we use the correct API Key context
    const localAi = new GoogleGenAI({ apiKey: process.env.API_KEY });
    
    return localAi.live.connect({
        model: 'gemini-2.5-flash-native-audio-preview-12-2025',
        callbacks: {
            onopen: callbacks.onOpen,
            onmessage: callbacks.onMessage,
            onclose: callbacks.onClose,
            onerror: callbacks.onError,
        },
        config: {
            responseModalities: [Modality.AUDIO],
            speechConfig: {
                voiceConfig: { prebuiltVoiceConfig: { voiceName: 'Zephyr' } },
            },
            // Enable transcription (pass empty objects)
            inputAudioTranscription: {}, 
            outputAudioTranscription: {},
            systemInstruction: "Você é uma assistente de IA útil, espirituosa e inteligente chamada Aura. Mantenha as respostas concisas e conversacionais. Responda sempre em Português do Brasil."
        }
    });
}