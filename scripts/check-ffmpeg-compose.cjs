const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { spawnSync } = require('node:child_process');
const { transformSync } = require('esbuild');

async function main() {
  const root = path.resolve(__dirname, '..');
  fs.mkdirSync(path.join(root, 'out'), { recursive: true });
  const temp = fs.mkdtempSync(path.join(root, 'out', 'ffmpeg-export-check-'));
  const ffmpeg = path.join(root, 'resources', 'ffmpeg', 'ffmpeg.exe');
  function run(args) {
    const result = spawnSync(ffmpeg, ['-hide_banner', '-loglevel', 'error', ...args], { encoding: null });
    assert.equal(result.status, 0, result.stderr?.toString());
    return result.stdout;
  }
  run(['-f', 'lavfi', '-i', 'color=c=blue:s=64x48:r=10:d=0.5', '-frames:v', '5', '-y', path.join(temp, 'frame_%05d.png')]);
  const audio = path.join(temp, 'audio.media');
  run(['-f', 'lavfi', '-i', 'sine=frequency=440:duration=1', '-f', 'wav', '-y', audio]);
  const module = { exports: {} };
  vm.runInNewContext(transformSync(fs.readFileSync(path.join(root, 'electron/service/ffmpeg.ts'), 'utf8'), {
    loader: 'ts', format: 'cjs',
  }).code, { module, exports: module.exports, console, process, Buffer, setTimeout, clearTimeout,
    require: id => id === 'electron' ? { app: {} } : id === './paths' ? {} : require(id) });
  const service = new module.exports.FFmpegService();
  service.ffmpegPath = ffmpeg;
  service.ffprobePath = path.join(root, 'resources', 'ffmpeg', 'ffprobe', 'win32', 'x64', 'ffprobe.exe');
  const options = { frameDir: temp, framePattern: 'frame_%05d.png', fps: 10, width: 64, height: 48,
    videoBitrate: 500, audioBitrate: 128,
    audioTracks: [{ src: audio, offset: 0.2, duration: 0.3, start: 0.1, volume: 1 }] };
  for (const format of ['mp4', 'webm']) {
    const outputPath = path.join(temp, `result.${format}`);
    await service.composeVideo({ ...options, format, outputPath });
    assert.ok(fs.statSync(outputPath).size > 0);
    const pcm = run(['-i', outputPath, '-map', '0:a:0', '-ac', '1', '-ar', '16000', '-f', 'f32le', 'pipe:1']);
    function rms(start, end) {
      let sum = 0;
      const lo = Math.round(start * 16000), hi = Math.round(end * 16000);
      assert.ok(pcm.length >= hi * 4);
      for (let i = lo; i < hi; i++) sum += pcm.readFloatLE(i * 4) ** 2;
      return Math.sqrt(sum / (hi - lo));
    }
    assert.ok(rms(0.01, 0.05) < 0.001, 'Timeline delay should preserve leading silence');
    assert.ok(rms(0.15, 0.25) > 0.01, 'Trimmed audio should play at its timeline position');
  }
  const silentVideo = path.join(temp, 'silent-video.mp4');
  run(['-f', 'lavfi', '-i', 'color=c=red:s=64x48:r=10:d=0.5', '-an', '-y', silentVideo]);
  await service.composeVideo({ ...options, format: 'mp4', outputPath: path.join(temp, 'silent-result.mp4'),
    audioTracks: [{ ...options.audioTracks[0], src: silentVideo, optional: true }] });
  await assert.rejects(service.composeVideo({ ...options, format: 'mp4', outputPath: path.join(temp, 'invalid.mp4'),
    audioTracks: [{ ...options.audioTracks[0], src: 'blob:file:///invalid' }] }), /浏览器临时媒体/);
  console.log('PASS: real FFmpeg MP4/WebM export, silent video, audio trim/delay, unreadable blob rejection');
}
main().catch(error => { console.error(error); process.exitCode = 1; });
