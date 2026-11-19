import { useState, useRef, useCallback, useEffect, useMemo } from 'react';
import { api } from '@/utils/api';

/**
 * Cross-browser speech-to-text hook.
 * Uses MediaRecorder API (works in Chrome, Firefox, Edge, Safari 14+, Brave)
 * Sends audio to backend /api/speech/to-text for transcription.
 * Falls back to Web Speech API if available and preferred.
 */
export function useSpeechToText(options = {}) {
  const {
    onTranscript,
    onError,
    language = 'en-US',
    preferredProvider = 'auto', // 'auto' | 'mediarecorder' | 'webspeech'
  } = options;

  const [isRecording, setIsRecording] = useState(false);
  const [isTranscribing, setIsTranscribing] = useState(false);
  const [error, setError] = useState(null);

  const mediaRecorderRef = useRef(null);
  const chunksRef = useRef([]);
  const streamRef = useRef(null);
  const recognitionRef = useRef(null);
  const useWebSpeechRef = useRef(false);
  const fallbackAttemptedRef = useRef(false);

  // Check Web Speech API support
  const webSpeechSupported = typeof window !== 'undefined' && 
    (window.SpeechRecognition || window.webkitSpeechRecognition);

  // Decide which provider to use (memoized to avoid repeated calls)
  const provider = useMemo(() => {
    if (preferredProvider === 'mediarecorder') return 'mediarecorder';
    if (preferredProvider === 'webspeech') return webSpeechSupported ? 'webspeech' : 'mediarecorder';
    
    // auto: detect browser and choose best provider
    const ua = navigator.userAgent;
    const vendor = navigator.vendor || '';
    
    // Brave detection - Brave spoofs Chrome but has navigator.brave or "Brave" in ua
    const isBrave = !!navigator.brave || /Brave/.test(ua);
    // Chrome (real Chrome, not Brave)
    const isChrome = /Chrome/.test(ua) && /Google Inc/.test(vendor) && !isBrave;
    // Edge
    const isEdge = /Edg/.test(ua);
    // Firefox
    const isFirefox = /Firefox/.test(ua);
    // Safari (not Chrome/Edge)
    const isSafari = /Safari/.test(ua) && !/Chrome/.test(ua) && !/Edg/.test(ua);
    
    // Use MediaRecorder for Brave, Firefox, Safari; Web Speech only for real Chrome/Edge
    const useWebSpeech = (isChrome || isEdge) && webSpeechSupported;
    
    console.log('[Speech] Browser detection:', { isBrave, isChrome, isEdge, isFirefox, isSafari, useWebSpeech, provider: useWebSpeech ? 'webspeech' : 'mediarecorder' });
    
    return useWebSpeech ? 'webspeech' : 'mediarecorder';
  }, [preferredProvider, webSpeechSupported]);

  // ---- MediaRecorder implementation (universal) ----
  const startMediaRecorder = useCallback(async () => {
    try {
      setError(null);
      const stream = await navigator.mediaDevices.getUserMedia({ 
        audio: { 
          echoCancellation: true, 
          noiseSuppression: true, 
          autoGainControl: true,
          sampleRate: 16000,
        } 
      });
      streamRef.current = stream;

      // Use webm/opus (widely supported) or fallback
      const mimeType = MediaRecorder.isTypeSupported('audio/webm;codecs=opus')
        ? 'audio/webm;codecs=opus'
        : MediaRecorder.isTypeSupported('audio/ogg;codecs=opus')
          ? 'audio/ogg;codecs=opus'
          : 'audio/webm';

      const recorder = new MediaRecorder(stream, { mimeType });
      mediaRecorderRef.current = recorder;
      chunksRef.current = [];

      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };

      recorder.onstop = async () => {
        const blob = new Blob(chunksRef.current, { type: mimeType });
        await transcribeBlob(blob);
        // Cleanup
        stream.getTracks().forEach(t => t.stop());
        streamRef.current = null;
        mediaRecorderRef.current = null;
      };

      recorder.start(100); // collect chunks every 100ms
      setIsRecording(true);
    } catch (err) {
      const msg = err.name === 'NotAllowedError' 
        ? 'Microphone permission denied. Allow access in browser settings.'
        : err.name === 'NotFoundError'
          ? 'No microphone found.'
          : `Failed to start recording: ${err.message}`;
      setError(msg);
      onError?.(msg);
    }
  }, [onError]);

  const stopMediaRecorder = useCallback(() => {
    if (mediaRecorderRef.current && mediaRecorderRef.current.state !== 'inactive') {
      mediaRecorderRef.current.stop();
      setIsRecording(false);
    }
  }, []);

  const transcribeBlob = useCallback(async (blob) => {
    setIsTranscribing(true);
    setError(null);
    try {
      const formData = new FormData();
      formData.append('audio', blob, `recording.${blob.type.split('/')[1] || 'webm'}`);
      
      const res = await api.post('/speech/to-text', formData, {
        headers: { 'Content-Type': 'multipart/form-data' },
      });
      
      const transcript = res.data.transcript;
      if (transcript) onTranscript?.(transcript);
    } catch (err) {
      const msg = err.response?.data?.error || err.message || 'Transcription failed';
      setError(msg);
      onError?.(msg);
    } finally {
      setIsTranscribing(false);
    }
  }, [onTranscript, onError]);

  // ---- Web Speech API implementation (Chrome/Edge) ----
  const startWebSpeech = useCallback(() => {
    if (!webSpeechSupported) {
      const msg = 'Web Speech API not supported in this browser';
      setError(msg);
      onError?.(msg);
      return;
    }

    const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
    const recognition = new SpeechRecognition();
    recognition.lang = language;
    recognition.interimResults = true;
    recognition.continuous = false;
    recognition.maxAlternatives = 1;
    recognitionRef.current = recognition;
    useWebSpeechRef.current = true;

    recognition.onresult = (event) => {
      let transcript = '';
      for (let i = 0; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          transcript += event.results[i][0].transcript;
        }
      }
      if (transcript.trim()) {
        onTranscript?.(transcript.trim());
      }
    };

    recognition.onerror = (event) => {
      let msg = 'Voice input error: ';
      let shouldFallback = false;
      switch (event.error) {
        case 'not-allowed':
        case 'permission-denied':
          msg += 'Microphone permission denied.';
          break;
        case 'no-speech':
          msg += 'No speech detected.';
          break;
        case 'audio-capture':
          msg += 'No microphone found.';
          break;
        case 'network':
          msg += 'Network error (Google speech service unreachable).';
          shouldFallback = true;
          break;
        case 'service-not-allowed':
          msg += 'Speech service blocked by browser.';
          shouldFallback = true;
          break;
        default:
          msg += event.error;
      }
      setError(msg);
      onError?.(msg);
      stopWebSpeech();
      
      // Fallback to MediaRecorder for network/service errors
      if (shouldFallback && !useWebSpeechRef.current && !fallbackAttemptedRef.current) {
        fallbackAttemptedRef.current = true;
        console.log('[Speech] Web Speech failed, falling back to MediaRecorder...');
        setTimeout(() => startMediaRecorder(), 100);
      }
    };

    recognition.onend = () => {
      useWebSpeechRef.current = false;
      setIsRecording(false);
    };

    try {
      recognition.start();
      setIsRecording(true);
      setError(null);
    } catch (err) {
      setError(`Failed to start: ${err.message}`);
      onError?.(err.message);
    }
  }, [language, onTranscript, onError, webSpeechSupported]);

  const stopWebSpeech = useCallback(() => {
    if (recognitionRef.current) {
      recognitionRef.current.stop();
      recognitionRef.current = null;
    }
    useWebSpeechRef.current = false;
    setIsRecording(false);
  }, []);

  // ---- Unified interface ----
  const start = useCallback(() => {
    fallbackAttemptedRef.current = false; // Reset fallback flag for new session
    if (provider === 'webspeech') {
      startWebSpeech();
    } else {
      startMediaRecorder();
    }
  }, [provider, startWebSpeech, startMediaRecorder]);

  const stop = useCallback(() => {
    if (useWebSpeechRef.current) {
      stopWebSpeech();
    } else {
      stopMediaRecorder();
    }
  }, [stopWebSpeech, stopMediaRecorder]);

  const toggle = useCallback(() => {
    if (isRecording || isTranscribing) stop();
    else start();
  }, [isRecording, isTranscribing, start, stop]);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (mediaRecorderRef.current?.state === 'recording') mediaRecorderRef.current.stop();
      if (streamRef.current) streamRef.current.getTracks().forEach(t => t.stop());
      if (recognitionRef.current) recognitionRef.current.stop();
    };
  }, []);

  return {
    isRecording,
    isTranscribing,
    isBusy: isRecording || isTranscribing,
    error,
    start,
    stop,
    toggle,
    provider,
    webSpeechSupported,
  };
}