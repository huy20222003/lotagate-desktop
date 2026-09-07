import { app } from 'electron';
import { spawn } from 'node:child_process';
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { desktopResourcePath } from '../app-assets.js';
import { terminateDesktopProcess } from '../process/process-termination.js';
import { SpeechModelManager } from './speech-model-manager.js';
import type { SpeechTranscriptionResult } from '../../contracts/ipc/v1/speech.js';
import { WHISPER_CPP_MODEL, WHISPER_CPP_TIMEOUT_MS, WHISPER_CPP_VERSION } from './speech-constants.js';
export { WHISPER_CPP_MODEL, WHISPER_CPP_TIMEOUT_MS, WHISPER_CPP_VERSION } from './speech-constants.js';

interface WhisperCppJsonResult {
  result?: { language?: unknown };
  transcription?: unknown;
}

interface WhisperCppTranscriptionSegment {
  text?: unknown;
}

export class WhisperCppSpeechTranscriptionService {
  constructor(private readonly models = new SpeechModelManager({ resourceRoot: desktopResourcePath('speech'), cacheRoot: join(app.getPath('userData'), 'speech', 'models') })) {}

  async transcribe(audio: Uint8Array, language?: string): Promise<SpeechTranscriptionResult> {
    const directory = await mkdtemp(join(tmpdir(), 'lotagate-speech-'));
    const inputPath = join(directory, 'recording.wav');
    const outputBasePath = join(directory, 'transcription');
    try {
      await writeFile(inputPath, audio);
      await runWhisperCpp(inputPath, outputBasePath, language, await this.models.ensureModel());
      return parseWhisperCppJson(await readFile(`${outputBasePath}.json`, 'utf8'));
    } finally {
      await rm(directory, { recursive: true, force: true });
    }
  }
}

async function runWhisperCpp(inputPath: string, outputBasePath: string, language: string | undefined, model: string): Promise<void> {
  const executable = desktopResourcePath('speech', 'runtime', runtimeDirectory(), executableName());
  const args = ['-m', model, '-f', inputPath, '-l', normalizeWhisperLanguage(language) ?? 'auto', '-oj', '-of', outputBasePath, '-nt', '-np', '-ng'];
  await new Promise<void>((resolve, reject) => {
    const child = spawn(executable, args, { windowsHide: true, shell: false, stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    let settled = false;
    let timer: NodeJS.Timeout | undefined;
    const finish = (error?: Error): void => {
      if (settled) return;
      settled = true;
      if (timer !== undefined) clearTimeout(timer);
      if (error === undefined) resolve(); else reject(error);
    };
    const stop = (message: string): void => { void terminateDesktopProcess(child).finally(() => finish(new Error(message))); };
    child.stderr.on('data', chunk => { stderr = `${stderr}${chunk.toString('utf8')}`.slice(-8_192); });
    child.once('error', error => {
      const code = error as NodeJS.ErrnoException;
      finish(code.code === 'ENOENT' ? new Error('The packaged whisper.cpp runtime is unavailable. Run the Desktop speech preparation step before packaging.') : error);
    });
    child.once('close', code => { if (code === 0) finish(); else finish(new Error(stderr.trim() || `whisper.cpp exited with code ${String(code)}.`)); });
    timer = setTimeout(() => stop('whisper.cpp transcription timed out.'), WHISPER_CPP_TIMEOUT_MS);
  });
}

export function normalizeWhisperLanguage(language: string | undefined): string | undefined {
  const value = language?.trim().toLowerCase();
  if (value === undefined || value.length === 0) return undefined;
  return value.split(/[-_]/u)[0];
}

export function parseWhisperCppJson(value: string): SpeechTranscriptionResult {
  let parsed: unknown;
  try { parsed = JSON.parse(value); } catch { throw new Error('whisper.cpp returned invalid transcription JSON.'); }
  if (!isWhisperCppJsonResult(parsed) || !Array.isArray(parsed.transcription)) throw new Error('whisper.cpp returned an invalid transcription result.');
  const text = parsed.transcription.map(segment => isWhisperCppSegment(segment) && typeof segment.text === 'string' ? segment.text : '').join(' ').replace(/\s+/gu, ' ').trim();
  const language = parsed.result !== undefined && typeof parsed.result.language === 'string' && parsed.result.language.trim().length > 0 ? parsed.result.language : undefined;
  return { text, ...(language === undefined ? {} : { language }) };
}

function runtimeDirectory(): string {
  const platform = process.platform;
  const architecture = process.arch === 'arm64' ? 'arm64' : 'x64';
  return `${platform}-${architecture}`;
}

function executableName(): string { return process.platform === 'win32' ? 'whisper-cli.exe' : 'whisper-cli'; }
function isWhisperCppJsonResult(value: unknown): value is WhisperCppJsonResult { return typeof value === 'object' && value !== null && !Array.isArray(value); }
function isWhisperCppSegment(value: unknown): value is WhisperCppTranscriptionSegment { return typeof value === 'object' && value !== null && !Array.isArray(value); }
