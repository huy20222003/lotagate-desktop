/*! cross-zip. MIT License. Feross Aboukhadijeh <https://feross.org/opensource> */
module.exports = {
  zip,
  zipSync,
  unzip,
  unzipSync,
};

const childProcess = require('child_process');
const fs = require('fs');
const os = require('os');
const path = require('path');

function zip(inPath, outPath, callback = () => {}) {
  if (process.platform === 'win32') {
    fs.stat(inPath, (error, stats) => {
      if (error) return callback(error);
      if (stats.isFile()) return copyToTemp();
      doZip();
    });
  } else {
    doZip();
  }

  function copyToTemp() {
    fs.readFile(inPath, (error, inFile) => {
      if (error) return callback(error);
      const tempPath = path.join(os.tmpdir(), `cross-zip-${Date.now()}`);
      fs.mkdir(tempPath, error => {
        if (error) return callback(error);
        fs.writeFile(path.join(tempPath, path.basename(inPath)), inFile, error => {
          if (error) return callback(error);
          inPath = tempPath;
          doZip();
        });
      });
    });
  }

  function doZip() {
    if (process.platform === 'win32') {
      fs.rm(outPath, { recursive: true, force: true, maxRetries: 3 }, doZip2);
    } else {
      doZip2();
    }
  }

  function doZip2(error) {
    if (error) return callback(error);
    childProcess.execFile(getZipCommand(), getZipArgs(inPath, outPath), {
      cwd: path.dirname(inPath),
      maxBuffer: Infinity,
    }, callback);
  }
}

function zipSync(inPath, outPath) {
  if (process.platform === 'win32') {
    if (fs.statSync(inPath).isFile()) {
      const tempPath = path.join(os.tmpdir(), `cross-zip-${Date.now()}`);
      fs.mkdirSync(tempPath);
      fs.writeFileSync(path.join(tempPath, path.basename(inPath)), fs.readFileSync(inPath));
      inPath = tempPath;
    }
    fs.rmSync(outPath, { recursive: true, force: true, maxRetries: 3 });
  }
  childProcess.execFileSync(getZipCommand(), getZipArgs(inPath, outPath), {
    cwd: path.dirname(inPath),
    maxBuffer: Infinity,
  });
}

function unzip(inPath, outPath, callback = () => {}) {
  childProcess.execFile(getUnzipCommand(), getUnzipArgs(inPath, outPath), { maxBuffer: Infinity }, callback);
}

function unzipSync(inPath, outPath) {
  childProcess.execFileSync(getUnzipCommand(), getUnzipArgs(inPath, outPath), { maxBuffer: Infinity });
}

function getZipCommand() {
  return process.platform === 'win32' ? 'powershell.exe' : 'zip';
}

function getUnzipCommand() {
  return process.platform === 'win32' ? 'powershell.exe' : 'unzip';
}

function quotePath(value) {
  return `"${value}"`;
}

function getZipArgs(inPath, outPath) {
  if (process.platform === 'win32') {
    return [
      '-nologo',
      '-noprofile',
      '-command', '& { param([String]$myInPath, [String]$myOutPath); Add-Type -A "System.IO.Compression.FileSystem"; [IO.Compression.ZipFile]::CreateFromDirectory($myInPath, $myOutPath); exit !$? }',
      '-myInPath', quotePath(inPath),
      '-myOutPath', quotePath(outPath),
    ];
  }
  return ['-r', '-y', outPath, path.basename(inPath)];
}

function getUnzipArgs(inPath, outPath) {
  if (process.platform === 'win32') {
    return [
      '-nologo',
      '-noprofile',
      '-command', '& { param([String]$myInPath, [String]$myOutPath); Add-Type -A "System.IO.Compression.FileSystem"; [IO.Compression.ZipFile]::ExtractToDirectory($myInPath, $myOutPath); exit !$? }',
      '-myInPath', quotePath(inPath),
      '-myOutPath', quotePath(outPath),
    ];
  }
  return ['-o', inPath, '-d', outPath];
}
