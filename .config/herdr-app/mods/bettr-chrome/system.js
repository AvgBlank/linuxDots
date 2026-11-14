import { appHome, exec, readTextFile } from "herdr";

// This machine's CPU, GPU and memory use. One sampler per OS gives the same shape:
// { cpu, gpu, ram } in percent (null when the OS does not give it) and memory in bytes.

const clamp = value => Number.isFinite(value) ? Math.max(0, Math.min(100, value)) : null;
const share = (part, whole) => whole > 0 && part !== null ? clamp(part / whole * 100) : null;
const number = (text, pattern) => {
  const found = pattern.exec(text);
  return found ? Number(found[1]) : null;
};
const sh = async script => (await exec("sh", ["-c", script])).stdout;
const result = (cpu, gpu, used, total) => ({ cpu: clamp(cpu), gpu: clamp(gpu), ram: share(used, total), used, total });

// macOS: CPU over one second (iostat), memory as Activity Monitor counts it
// (app + wired + compressed), GPU from the accelerator's statistics. No sudo.
const MACOS = [
  "iostat -C -n 0 -c 2 -w 1 | tail -1",
  "sysctl -n hw.memsize",
  "vm_stat",
  "ioreg -r -d 1 -w 0 -c IOAccelerator | grep -o '\"Device Utilization %\"=[0-9]*'",
].join("; ");

async function macos() {
  const out = await sh(MACOS);
  const idle = Number(out.trim().split("\n")[0].trim().split(/\s+/)[2]);
  const page = number(out, /page size of (\d+)/);
  const pages = name => number(out, new RegExp(`${name}:\\s+(\\d+)`)) ?? 0;
  const used = page && (pages("Anonymous pages") - pages("Pages purgeable") + pages("Pages wired down")
    + pages("Pages occupied by compressor")) * page;
  return result(100 - idle, number(out, /"Device Utilization %"=(\d+)/), used, number(out, /^(\d+)$/m));
}

// Linux: CPU from the change in /proc/stat since the last sample, memory from
// MemAvailable, GPU from nvidia-smi or the amdgpu busy file. The files are read
// without a process; the GPU probe stops after it finds nothing.
let ticks = null, gpuless = null;
const LINUX_GPU = "nvidia-smi --query-gpu=utilization.gpu --format=csv,noheader,nounits 2>/dev/null"
  + " || cat /sys/class/drm/card*/device/gpu_busy_percent 2>/dev/null; true";

async function linux() {
  const [stat, mem, gpuText] = await Promise.all([readTextFile("/proc/stat"), readTextFile("/proc/meminfo"),
    gpuless ? "" : sh(LINUX_GPU)]);
  // user nice system idle iowait irq softirq steal (guest time is in user already).
  const fields = stat.split("\n")[0].trim().split(/\s+/).slice(1, 9).map(Number);
  const now = { idle: fields[3] + fields[4], total: fields.reduce((sum, value) => sum + value, 0) };
  const spent = ticks && now.total - ticks.total;
  const cpu = spent ? 100 - share(now.idle - ticks.idle, spent) : null;
  ticks = now;
  const gpus = gpuText.trim().split(/\s+/).filter(Boolean).map(Number).filter(Number.isFinite);
  gpuless ??= !gpus.length;
  const total = number(mem, /MemTotal:\s+(\d+)/) * 1024;
  return result(cpu, gpus.length ? Math.max(...gpus) : null, total - number(mem, /MemAvailable:\s+(\d+)/) * 1024, total);
}

// Windows: one PowerShell call for the CPU and 3D-engine counters (a one-second
// sample) and the memory totals. Integers, so the output has no culture decimals.
const WINDOWS = [
  "$s = (Get-Counter '\\Processor(_Total)\\% Processor Time','\\GPU Engine(*engtype_3D)\\Utilization Percentage' -ErrorAction SilentlyContinue).CounterSamples",
  "$c = $s | Where-Object Path -like '*processor(_total)*'",
  "$g = $s | Where-Object Path -like '*gpu engine*'",
  "$o = Get-CimInstance Win32_OperatingSystem",
  "if ($c) { 'cpu=' + [int]$c.CookedValue }",
  "if ($g) { 'gpu=' + [int]($g | Measure-Object CookedValue -Sum).Sum }",
  "'total=' + $o.TotalVisibleMemorySize; 'free=' + $o.FreePhysicalMemory",
].join("; ");

async function windows() {
  const { stdout: out } = await exec("powershell", ["-NoProfile", "-NonInteractive", "-Command", WINDOWS]);
  const total = number(out, /total=(\d+)/) * 1024;
  return result(number(out, /cpu=(\d+)/), number(out, /gpu=(\d+)/), total - number(out, /free=(\d+)/) * 1024, total);
}

const SAMPLERS = { macos, linux, windows };

// scripts/preview.py puts fixed numbers in the app home, so its screenshot is the same each time:
// {"system": {"cpu": 18, "gpu": 7, "used": 21.4, "total": 32}} (percent, memory in GB).
// Read once; a normal install has no file.
let fixed;
async function preview() {
  if (fixed === undefined) {
    try { fixed = JSON.parse(await readTextFile(`${appHome()}/bettr-preview.json`))?.system ?? null; } catch { fixed = null; }
  }
  return fixed && result(fixed.cpu, fixed.gpu, fixed.used * 2 ** 30, fixed.total * 2 ** 30);
}

/** The sampler for `platform` (from `window().platform`), or null. */
export const sampler = platform => {
  const live = SAMPLERS[platform];
  return live ? async () => (await preview()) ?? live() : null;
};
