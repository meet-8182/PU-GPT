#!/usr/bin/env python3
"""
faster-whisper transcription script for PU-GPT STT.
Usage: python transcribe.py <audio_file>
Outputs transcript to stdout.

Env vars:
  WHISPER_MODEL         - tiny, base, small, medium, large-v3 (default: small)
  WHISPER_DEVICE        - cpu, cuda (default: cpu)
  WHISPER_COMPUTE_TYPE  - int8, float16, float32 (default: int8 for cpu, float16 for cuda)
  WHISPER_BEAM_SIZE     - beam search size (default: 5)
  WHISPER_TEMPERATURE   - sampling temperature (default: 0.0)
  WHISPER_BEST_OF       - number of candidates (default: 5)
  WHISPER_PATIENCE      - beam search patience (default: 1.0)
  WHISPER_VAD_FILTER    - use VAD filter (default: true)
"""

import sys
import os

def main():
    if len(sys.argv) < 2:
        print("Usage: python transcribe.py <audio_file>", file=sys.stderr)
        sys.exit(1)

    audio_path = sys.argv[1]
    if not os.path.exists(audio_path):
        print(f"File not found: {audio_path}", file=sys.stderr)
        sys.exit(1)

    try:
        from faster_whisper import WhisperModel
    except ImportError:
        print("faster-whisper not installed. Run: pip install faster-whisper", file=sys.stderr)
        sys.exit(1)

    # Model size: tiny, base, small, medium, large-v3
    # tiny/base are fast; small/medium/large are more accurate
    model_size = os.getenv('WHISPER_MODEL', 'small')  # Default to 'small' for better accuracy
    device = os.getenv('WHISPER_DEVICE', 'cpu')
    compute_type = os.getenv('WHISPER_COMPUTE_TYPE', 'int8' if device == 'cpu' else 'float16')
    
    # Decoding parameters for better accuracy
    beam_size = int(os.getenv('WHISPER_BEAM_SIZE', '5'))
    temperature = float(os.getenv('WHISPER_TEMPERATURE', '0.0'))
    best_of = int(os.getenv('WHISPER_BEST_OF', '5'))
    patience = float(os.getenv('WHISPER_PATIENCE', '1.0'))
    vad_filter = os.getenv('WHISPER_VAD_FILTER', 'true').lower() == 'true'

    print(f"Loading model: {model_size} on {device} ({compute_type})", file=sys.stderr)
    model = WhisperModel(model_size, device=device, compute_type=compute_type)

    print(f"Transcribing: {audio_path}", file=sys.stderr)
    print(f"Params: beam_size={beam_size}, temperature={temperature}, best_of={best_of}, patience={patience}, vad_filter={vad_filter}", file=sys.stderr)
    
    segments, info = model.transcribe(
        audio_path,
        language='en',
        beam_size=beam_size,
        temperature=temperature,
        best_of=best_of,
        patience=patience,
        vad_filter=vad_filter,
        vad_parameters=dict(min_silence_duration_ms=500) if vad_filter else None,
    )

    full_text = []
    for segment in segments:
        full_text.append(segment.text)

    # Output only the transcript to stdout
    print(' '.join(full_text).strip())

if __name__ == '__main__':
    main()