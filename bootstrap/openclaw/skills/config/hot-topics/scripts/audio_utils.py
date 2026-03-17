#!/usr/bin/env python3
"""
Audio utilities for Hot Topics Fetcher
Supports audio transcription and analysis
"""

import os
import subprocess
import tempfile


def extract_audio(video_path, output_path):
    """Extract audio from video to MP3"""
    try:
        subprocess.run([
            'ffmpeg', '-y', '-i', video_path,
            '-vn', '-acodec', 'libmp3lame', '-q:a', '2', output_path
        ], capture_output=True, timeout=60)
        
        if os.path.exists(output_path) and os.path.getsize(output_path) > 1000:
            return output_path
    except Exception as e:
        print(f"Audio extraction failed: {e}")
    return None


def transcribe_audio(audio_path, method="local", model="base"):
    """
    Transcribe audio to text using Whisper
    
    Methods:
        - "local": Use local OpenAI Whisper (default, free, recommended)
        - "api": Use OpenAI Whisper API (requires OPENAI_API_KEY)
    
    Models (for local mode):
        - "tiny": fastest, lowest accuracy (~39 MB)
        - "base": fast, good accuracy (~74 MB) - DEFAULT
        - "small": slower, better accuracy (~244 MB)
        - "medium": slow, high accuracy (~769 MB)
        - "large": slowest, best accuracy (~1550 MB)
    
    Returns:
        dict: {"text": "transcribed text", "language": "en/zh/...", "method": "..."}
    """
    if not os.path.exists(audio_path):
        return None
    
    if method in ["local", "auto"]:
        result = _transcribe_with_local_whisper(audio_path, model)
        if result:
            return result
    
    if method in ["api", "auto"]:
        return _transcribe_with_whisper_api(audio_path)
    
    return None


def _transcribe_with_local_whisper(audio_path, model="base"):
    """Use local whisper CLI - RECOMMENDED method"""
    try:
        # Check if whisper is installed
        result = subprocess.run(
            ['whisper', '--version'],
            capture_output=True,
            timeout=5
        )
        if result.returncode != 0:
            print("Whisper not found. Install with: pip install openai-whisper")
            return None
        
        # Validate model
        valid_models = ["tiny", "base", "small", "medium", "large", "large-v2", "large-v3"]
        if model not in valid_models:
            print(f"Invalid model '{model}', using 'base'")
            model = "base"
        
        print(f"  🎯 Using Whisper model: {model}")
        
        # Transcribe
        with tempfile.TemporaryDirectory() as tmpdir:
            cmd = [
                'whisper',
                audio_path,
                '--model', model,
                '--language', 'auto',
                '--output_format', 'txt',
                '--output_dir', tmpdir
            ]
            
            result = subprocess.run(cmd, capture_output=True, timeout=300)
            
            if result.returncode != 0:
                print(f"Whisper error: {result.stderr.decode()[:200]}")
                return None
            
            # Read output
            base_name = os.path.splitext(os.path.basename(audio_path))[0]
            txt_path = os.path.join(tmpdir, f"{base_name}.txt")
            
            if os.path.exists(txt_path):
                with open(txt_path, 'r', encoding='utf-8') as f:
                    text = f.read().strip()
                    return {
                        "text": text,
                        "language": "auto",
                        "method": "whisper_local",
                        "model": model
                    }
    except Exception as e:
        print(f"Local whisper failed: {e}")
    return None


def _transcribe_with_whisper_api(audio_path):
    """Use OpenAI Whisper API"""
    try:
        import openai
        
        api_key = os.environ.get("OPENAI_API_KEY")
        if not api_key:
            print("OPENAI_API_KEY not set")
            return None
        
        client = openai.OpenAI(api_key=api_key)
        
        with open(audio_path, 'rb') as audio_file:
            response = client.audio.transcriptions.create(
                model="whisper-1",
                file=audio_file
            )
        
        return {
            "text": response.text,
            "language": getattr(response, 'language', 'auto'),
            "method": "whisper_api"
        }
    except Exception as e:
        print(f"Whisper API failed: {e}")
    return None


def analyze_audio_content(audio_path, kimi_cmd='kimi', model='base'):
    """
    Analyze audio by transcribing with local Whisper and analyzing with Kimi
    
    Args:
        audio_path: Path to audio file
        kimi_cmd: Kimi CLI command
        model: Whisper model (tiny/base/small/medium/large)
    
    Returns:
        dict: {"transcription": "...", "analysis": "...", "summary": "...", "model": "..."}
    """
    # Step 1: Transcribe with LOCAL Whisper (default)
    print(f"  🎙️ Transcribing with local Whisper ({model} model)...")
    transcription_result = transcribe_audio(audio_path, method="local", model=model)
    
    if not transcription_result:
        return None
    
    transcription = transcription_result.get("text", "")
    used_model = transcription_result.get("model", model)
    
    if not transcription:
        return None
    
    print(f"  ✓ Transcribed {len(transcription)} characters")
    
    # Step 2: Analyze transcription with Kimi
    prompt = f"""请分析以下从视频中提取的音频转录内容：

【音频转录】
{transcription[:2000]}

请提供：
1. **内容摘要**：这段音频主要讲了什么（2-3句话）
2. **关键信息**：重要的观点、数据或事实
3. **语气/情绪**：说话者的情绪是严肃、兴奋、悲伤还是其他
4. **背景音乐/音效**：是否有音乐、环境音等（如果有提到）
5. **适合的视频类型**：这段内容适合什么类型的短视频

格式：
**内容摘要：** ...
**关键信息：** ...
**语气/情绪：** ...
"""
    
    try:
        import subprocess
        result = subprocess.run(
            [kimi_cmd, '--print', '--prompt', prompt],
            capture_output=True,
            text=True,
            timeout=60
        )
        
        analysis = result.stdout if result.returncode == 0 else f"Analysis failed: {result.stderr}"
        
        return {
            "transcription": transcription,
            "analysis": analysis,
            "summary": transcription[:200] + "..." if len(transcription) > 200 else transcription,
            "method": transcription_result.get("method", "whisper_local"),
            "model": used_model
        }
    except Exception as e:
        return {
            "transcription": transcription,
            "analysis": f"Error: {e}",
            "summary": transcription[:200] + "..." if len(transcription) > 200 else transcription,
            "method": transcription_result.get("method", "whisper_local"),
            "model": used_model
        }


def get_audio_info(audio_path):
    """Get audio file info using ffprobe"""
    try:
        result = subprocess.run(
            [
                'ffprobe', '-v', 'error',
                '-show_entries', 'format=duration,bit_rate',
                '-show_entries', 'stream=codec_name,sample_rate',
                '-of', 'json',
                audio_path
            ],
            capture_output=True,
            text=True,
            timeout=10
        )
        
        if result.returncode == 0:
            import json
            data = json.loads(result.stdout)
            return {
                "duration": float(data.get('format', {}).get('duration', 0)),
                "bitrate": data.get('format', {}).get('bit_rate'),
                "codec": data.get('streams', [{}])[0].get('codec_name'),
                "sample_rate": data.get('streams', [{}])[0].get('sample_rate')
            }
    except Exception as e:
        print(f"Failed to get audio info: {e}")
    
    return None


if __name__ == '__main__':
    import sys
    
    if len(sys.argv) < 2:
        print("Usage: python3 audio_utils.py <audio_or_video_file>")
        sys.exit(1)
    
    file_path = sys.argv[1]
    
    # Extract audio if video
    if file_path.endswith(('.mp4', '.mov', '.avi', '.mkv')):
        print("Extracting audio from video...")
        audio_path = file_path.rsplit('.', 1)[0] + '.mp3'
        audio_path = extract_audio(file_path, audio_path)
        if not audio_path:
            print("Failed to extract audio")
            sys.exit(1)
    else:
        audio_path = file_path
    
    # Get audio info
    print(f"\nAudio Info:")
    info = get_audio_info(audio_path)
    if info:
        print(f"  Duration: {info['duration']:.2f}s")
        print(f"  Bitrate: {info.get('bitrate', 'N/A')}")
        print(f"  Codec: {info.get('codec', 'N/A')}")
    
    # Transcribe
    print(f"\nTranscribing audio...")
    result = transcribe_audio(audio_path)
    
    if result:
        print(f"\nMethod: {result['method']}")
        print(f"\nTranscription:\n{result['text'][:500]}...")
        
        # Analyze
        print(f"\nAnalyzing with Kimi...")
        analysis = analyze_audio_content(audio_path)
        if analysis:
            print(f"\nAnalysis:\n{analysis['analysis'][:500]}...")
    else:
        print("Transcription failed")
