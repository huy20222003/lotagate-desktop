import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { parseEnv } from 'node:util';

const ARTIFACT_VERSION = 1;
const RUNTIME_CONFIG_SEED = 'lotagate-desktop-runtime-config-v1';
const RUNTIME_CONFIG_FILE = 'runtime.dat';

export function generateRuntimeConfigArtifact(projectRoot) {
  const sourcePath = path.join(projectRoot, '.env');
  const artifactPath = path.join(projectRoot, RUNTIME_CONFIG_FILE);
  if (!fs.existsSync(sourcePath)) throw new Error('Desktop packaging requires a .env runtime configuration file.');

  const source = fs.readFileSync(sourcePath, 'utf8');
  const values = parseEnv(source);
  const plaintext = Buffer.from(JSON.stringify({ version: ARTIFACT_VERSION, values }), 'utf8');
  const salt = crypto.randomBytes(16);
  const iv = crypto.randomBytes(12);
  const key = deriveKey(salt);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  const ciphertext = Buffer.concat([cipher.update(plaintext), cipher.final()]);
  const artifact = {
    version: ARTIFACT_VERSION,
    algorithm: 'aes-256-gcm',
    salt: salt.toString('base64'),
    iv: iv.toString('base64'),
    authTag: cipher.getAuthTag().toString('base64'),
    ciphertext: ciphertext.toString('base64'),
  };
  fs.writeFileSync(artifactPath, JSON.stringify(artifact), { encoding: 'utf8', mode: 0o600 });
  return artifactPath;
}

function deriveKey(salt) {
  return crypto.scryptSync(RUNTIME_CONFIG_SEED, salt, 32);
}
