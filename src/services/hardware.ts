/**
 * Universal adaptive hardware engine.
 *
 * Everything is derived from measured capabilities (kernel CPU topology, ARM feature flags, RAM,
 * storage type, GPU/NPU presence, thermal and battery state) and from the model's own GGUF header.
 * No device or SoC names are used to make decisions, so the same APK scales from a 4 GB eMMC phone
 * to a 16 GB UFS 4 flagship without separate builds.
 */
import AsyncStorage from '@react-native-async-storage/async-storage';
import {NativeEventEmitter, NativeModules, Platform} from 'react-native';

export type PerfProfile = 'auto' | 'battery' | 'balanced' | 'max';
export type EffectiveProfile = Exclude<PerfProfile, 'auto'>;
export type MoeMode = 'auto' | 'off';

export type CoreInfo = {id: number; maxMhz: number; name: string};
export type ClusterInfo = {maxMhz: number; count: number; name: string};
export type HardwareProbe = {
  manufacturer: string; model: string; hardware: string; board: string; soc: string; sdk: number; abis: string[]; arm64: boolean;
  cpu: {cores: number; onlineCores: number; coreList: CoreInfo[]; clusters: ClusterInfo[]; features: string[]; neon: boolean; dotprod: boolean; fp16: boolean; i8mm: boolean; sve: boolean; sve2: boolean; bf16: boolean; sme: boolean};
  memory: MemoryState;
  storage: {kind: 'emmc' | 'ufs' | 'nvme' | 'unknown'; freeMb: number; totalMb: number};
  gpu: {renderer: string; vendor: string; adreno: boolean; mali: boolean; vulkan: boolean; openclLibrary: boolean; hexagon: boolean};
  power: PowerState;
};
export type MemoryState = {totalMb: number; availableMb: number; thresholdMb: number; lowMemory: boolean; memAvailableKernelMb: number; swapTotalMb: number; swapFreeMb: number; memoryClassMb: number; largeMemoryClassMb: number; processRssMb: number; processPeakRssMb: number};
export type PowerState = {thermalStatus: number; thermalHeadroom: number; powerSave: boolean; batteryPercent: number; charging: boolean; batteryTempC: number};
export type ModelArchitecture = {
  architecture: string; name: string; fileType: number; expertCount: number; expertUsedCount: number; blockCount: number; contextLength: number;
  embeddingLength: number; headCount: number; headCountKv: number; keyLength: number; valueLength: number; fullAttentionInterval: number;
  leadingDenseBlocks: number; tensorCount: number; expertBytes: number; denseBytes: number; expertTensorCount: number; fileBytes: number; isMoe: boolean; streamable: boolean;
};
export type StorageBenchmark = {sequentialMBps: number; random: {lanes: number; randomMBps: number}[]; bestLanes: number; bestRandomMBps: number; note: string};
export type ThreadTuning = {threads: number; decodeTps: number; prefillTps: number; measuredAt: number; candidates: {threads: number; decodeTps: number; prefillTps: number}[]};

export type InferencePlan = {
  engine: 'llama.rn' | 'moe-stream';
  profile: EffectiveProfile;
  requestedProfile: PerfProfile;
  nCtx: number;
  nBatch: number;
  nUbatch: number;
  nThreads: number;
  nParallel: number;
  useMmap: boolean;
  useMlock: boolean;
  kvType: 'f16' | 'q8_0';
  flashAttn: 'auto' | 'on' | 'off';
  nGpuLayers: number;
  stateCacheMb: number;
  budgetMb: number;
  reserveMb: number;
  weightsMb: number;
  kvMb: number;
  computeMb: number;
  moe?: {cacheMb: number; ioLanes: number; threadsBatch: number; useAutoPlanner: boolean; args: string[]; fallbackArgs: string[]};
  architecture?: ModelArchitecture;
  fitsInMemory: boolean;
  reasons: string[];
};

type NativeHardware = {
  probe(): Promise<HardwareProbe>;
  getRuntimeState(): Promise<{memory: MemoryState; power: PowerState}>;
  benchmarkStorage(path: string): Promise<StorageBenchmark>;
  readGgufInfo(path: string): Promise<ModelArchitecture>;
};
const Native = NativeModules.PocketBuddyHardware as NativeHardware | undefined;

const LITTLE_CORES = /A35|A53|A55|A510|A520/;
const TUNING_KEY = 'pocket-buddy.hardware.tuning.v1';
const STORAGE_KEY = 'pocket-buddy.hardware.storage.v1';
const BENCH_KEY = 'pocket-buddy.hardware.benchmarks.v1';

let probeCache: HardwareProbe | null = null;
const archCache = new Map<string, ModelArchitecture>();

export function hardwareAvailable(): boolean { return Platform.OS === 'android' && !!Native; }

export async function probeHardware(force = false): Promise<HardwareProbe | null> {
  if (!Native) return null;
  if (probeCache && !force) return probeCache;
  try { probeCache = await Native.probe(); } catch { probeCache = null; }
  return probeCache;
}

export async function runtimeState(): Promise<{memory: MemoryState; power: PowerState} | null> {
  if (!Native) return null;
  try { return await Native.getRuntimeState(); } catch { return null; }
}

/** Reads the model's GGUF header. Architecture detection decides dense vs MoE before anything else. */
export async function inspectModel(path: string): Promise<ModelArchitecture | null> {
  if (!Native || !path) return null;
  const clean = path.replace(/^file:\/\//, '');
  if (archCache.has(clean)) return archCache.get(clean)!;
  try {
    const info = await Native.readGgufInfo(clean);
    archCache.set(clean, info);
    return info;
  } catch { return null; }
}

export async function measureStorage(path: string): Promise<StorageBenchmark | null> {
  if (!Native) return null;
  const result = await Native.benchmarkStorage(path.replace(/^file:\/\//, ''));
  await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify({...result, measuredAt: Date.now()}));
  return result;
}
export async function savedStorageBenchmark(): Promise<(StorageBenchmark & {measuredAt: number}) | null> {
  try { const raw = await AsyncStorage.getItem(STORAGE_KEY); return raw ? JSON.parse(raw) : null; } catch { return null; }
}

/** Fast cores are everything that is not an in-order efficiency design; unknown parts are ranked by clock. */
export function coreTopology(probe: HardwareProbe | null): {total: number; big: number; little: number; topMhz: number} {
  const total = Math.max(1, probe?.cpu.cores || 4);
  const list = probe?.cpu.coreList || [];
  if (!list.length) return {total, big: Math.min(4, total), little: Math.max(0, total - 4), topMhz: 0};
  const known = list.filter(core => !/Unknown|CPU part/.test(core.name));
  let big: number;
  if (known.length === list.length) big = list.filter(core => !LITTLE_CORES.test(core.name)).length;
  else {
    const top = Math.max(...list.map(core => core.maxMhz));
    big = list.filter(core => core.maxMhz >= top * 0.85).length;
  }
  if (big === 0) big = Math.min(4, total);
  return {total, big, little: total - big, topMhz: Math.max(0, ...list.map(core => core.maxMhz))};
}

export function hardwareFingerprint(probe: HardwareProbe | null): string {
  if (!probe) return 'unknown';
  return [probe.cpu.cores, probe.cpu.clusters.map(c => c.count + 'x' + Math.round(c.maxMhz)).join('+'), Math.round(probe.memory.totalMb / 512), probe.storage.kind].join('|');
}

export function resolveProfile(requested: PerfProfile, power: PowerState | null | undefined): {profile: EffectiveProfile; reason: string} {
  if (requested !== 'auto') return {profile: requested, reason: 'Profile chosen in Settings.'};
  if (power?.powerSave) return {profile: 'battery', reason: 'Android battery saver is on.'};
  if (power && power.batteryPercent >= 0 && power.batteryPercent < 20 && !power.charging) return {profile: 'battery', reason: 'Battery below 20% and not charging.'};
  if (power && power.thermalStatus >= 3) return {profile: 'battery', reason: 'The phone reports severe thermal pressure.'};
  if (power && power.charging && power.thermalStatus <= 1) return {profile: 'max', reason: 'Charging and cool, so full speed is safe.'};
  return {profile: 'balanced', reason: 'Automatic: balanced speed and battery.'};
}

/** RAM that is never handed to inference: Android, the launcher, the keyboard and recent apps live here. */
export function memoryReserveMb(totalMb: number): number { return Math.round(Math.max(1536, totalMb * 0.25)); }

export function memoryBudgetMb(memory: MemoryState, profile: EffectiveProfile): {budgetMb: number; reserveMb: number} {
  const reserveMb = memoryReserveMb(memory.totalMb);
  // Hard ceiling: the reserve is never handed to inference, whatever the profile.
  const ceiling = Math.max(256, memory.totalMb - reserveMb);
  // RAM free right now, above Android's own low-memory threshold. A foreground app can also get
  // memory back from cached background apps, so each profile may claim a share of the ceiling even
  // when the instantaneous free figure is lower.
  const live = memory.availableMb - Math.max(400, memory.thresholdMb) * 1.25;
  const share = profile === 'battery' ? 0.45 : profile === 'balanced' ? 0.6 : 0.75;
  const budget = profile === 'battery' ? Math.min(ceiling * share, Math.max(256, live)) : Math.min(ceiling, Math.max(live, ceiling * share));
  return {budgetMb: Math.round(budget), reserveMb};
}

function kvBytesPerToken(arch: ModelArchitecture | null, kvType: 'f16' | 'q8_0'): number {
  const bytes = kvType === 'f16' ? 2 : 1.0625;
  if (!arch || !arch.blockCount) return 2 * 28 * 8 * 128 * bytes;
  const headDim = arch.keyLength || (arch.headCount ? arch.embeddingLength / arch.headCount : 128);
  const kvHeads = arch.headCountKv || Math.max(1, Math.round((arch.headCount || 8) / 4));
  // Hybrid models (Qwen3.5/3.6 Gated DeltaNet, LFM2 conv) keep a KV cache only on their attention layers.
  const attnLayers = arch.fullAttentionInterval > 0 ? Math.ceil(arch.blockCount / arch.fullAttentionInterval) : /lfm2/.test(arch.architecture) ? Math.ceil(arch.blockCount * 0.25) : arch.blockCount;
  return 2 * attnLayers * kvHeads * headDim * bytes;
}

const CTX_OPTIONS = [2048, 4096, 8192, 16384];

export type PlanInput = {
  probe: HardwareProbe | null;
  memory?: MemoryState | null;
  power?: PowerState | null;
  arch: ModelArchitecture | null;
  modelBytes: number;
  requestedProfile: PerfProfile;
  moeMode: MoeMode;
  moeEngineAvailable: boolean;
  manualContext?: number;
  manualGpuLayers?: number;
  tuning?: ThreadTuning | null;
  storage?: StorageBenchmark | null;
  gpuDevices?: string[];
};

export function planInference(input: PlanInput): InferencePlan {
  const reasons: string[] = [];
  const memory = input.memory || input.probe?.memory || null;
  const power = input.power || input.probe?.power || null;
  const {profile, reason} = resolveProfile(input.requestedProfile, power);
  reasons.push(reason);
  const totalMb = memory?.totalMb || 4096;
  const {budgetMb, reserveMb} = memory ? memoryBudgetMb(memory, profile) : {budgetMb: 1800, reserveMb: 1536};
  reasons.push(`RAM: ${Math.round(totalMb)} MB total, ${Math.round(memory?.availableMb || 0)} MB free now; ${reserveMb} MB always left to Android; inference budget ${budgetMb} MB.`);
  const topo = coreTopology(input.probe);
  const weightsMb = Math.round((input.arch?.fileBytes || input.modelBytes || 0) / 1048576);
  const arch = input.arch;

  // ---- engine choice: architecture first ----
  let engine: InferencePlan['engine'] = 'llama.rn';
  if (!arch) reasons.push('Model header could not be read; using the standard engine.');
  else if (!arch.isMoe) reasons.push(`Architecture ${arch.architecture || 'unknown'} is dense (no expert tensors), so expert streaming does not apply.`);
  else {
    const expertMb = Math.round(arch.expertBytes / 1048576), denseMb = Math.round(arch.denseBytes / 1048576);
    reasons.push(`Architecture ${arch.architecture} is MoE: ${arch.expertUsedCount} of ${arch.expertCount} experts per token, ${expertMb} MB experts + ${denseMb} MB dense.`);
    // Battery Saver shrinks the budget, but streaming a model that would fit costs more I/O and power than holding it, so judge fit by the Balanced budget there.
    const fitBudget = profile === 'battery' && memory ? Math.max(budgetMb, memoryBudgetMb(memory, 'balanced').budgetMb) : budgetMb;
    const fits = weightsMb + 600 <= fitBudget;
    if (input.moeMode === 'off') reasons.push('MoE streaming is turned off in Settings.');
    else if (!input.moeEngineAvailable) reasons.push('The MoE streaming engine is not available on this phone (needs ARM64 and Android 10+).');
    else if (fits) reasons.push('The whole model fits in the RAM budget, so it runs fully in memory without streaming.');
    else { engine = 'moe-stream'; reasons.push('The model is larger than the RAM budget, so only the routed experts are streamed from storage.'); }
  }

  // ---- threads ----
  let nThreads: number;
  if (input.tuning && input.tuning.threads > 0) { nThreads = input.tuning.threads; reasons.push(`Threads: ${nThreads} (measured fastest on this phone).`); }
  else {
    nThreads = Math.max(2, Math.min(topo.total, topo.big + Math.min(topo.little, topo.big <= 2 ? 2 : 0)));
    if (topo.big >= 6) nThreads = topo.big;
    reasons.push(`Threads: ${nThreads} from ${topo.big} fast + ${topo.little} efficiency cores (run the benchmark to measure).`);
  }
  if (profile === 'battery') nThreads = Math.max(2, Math.min(nThreads, Math.max(2, topo.big)));
  if (power && power.thermalStatus >= 2) { nThreads = Math.max(2, nThreads - (power.thermalStatus >= 3 ? 2 : 1)); reasons.push('Thermal pressure: fewer threads to avoid throttling.'); }

  // ---- batch sizes by RAM tier ----
  const tier = totalMb >= 11000 ? 'high' : totalMb >= 7000 ? 'mid' : 'low';
  const nUbatch = profile === 'battery' ? 128 : tier === 'low' ? 256 : 512;
  const nBatch = Math.max(nUbatch, tier === 'low' ? 256 : 512);
  const computeMb = Math.round((arch?.embeddingLength || 2048) * nUbatch * 4 * 12 / 1048576 + 120);

  // ---- context & KV ----
  const cap = profile === 'battery' ? 2048 : profile === 'balanced' ? 4096 : totalMb >= 11000 ? 16384 : 8192;
  const resident = engine === 'moe-stream' ? Math.round((arch?.denseBytes || 0) / 1048576) : weightsMb;
  let kvType: 'f16' | 'q8_0' = 'f16';
  let nCtx = 2048;
  const free = budgetMb - resident - computeMb - (engine === 'moe-stream' ? 1500 : 0);
  const pick = (type: 'f16' | 'q8_0') => {
    const per = kvBytesPerToken(arch, type);
    let best = 0;
    for (const ctx of CTX_OPTIONS) if (ctx <= cap && (ctx * per) / 1048576 <= Math.max(0, free) * 0.6) best = ctx;
    return best;
  };
  if (input.manualContext && CTX_OPTIONS.includes(input.manualContext)) { nCtx = input.manualContext; reasons.push(`Context ${nCtx} set manually.`); }
  else {
    const f16 = pick('f16'), q8 = pick('q8_0');
    if (f16 >= Math.min(cap, 4096) || f16 >= q8) nCtx = Math.max(2048, f16);
    else { nCtx = Math.max(2048, q8); kvType = 'q8_0'; }
    reasons.push(`Context ${nCtx} tokens with ${kvType} KV cache (profile cap ${cap}).`);
  }
  if (arch?.contextLength && arch.contextLength > 0) nCtx = Math.min(nCtx, Math.max(512, arch.contextLength));
  const kvMb = Math.round(nCtx * kvBytesPerToken(arch, kvType) / 1048576);

  // ---- GPU / NPU ----
  let nGpuLayers = 0;
  const gpuOk = !!input.gpuDevices?.some(d => /GPU|OpenCL|Adreno/i.test(d));
  if (input.manualGpuLayers && input.manualGpuLayers > 0) { nGpuLayers = input.manualGpuLayers; reasons.push(`GPU layers ${nGpuLayers} set manually.`); }
  else if (engine === 'llama.rn' && gpuOk && profile !== 'battery' && input.tuning && (input.tuning as any).gpuFaster) { nGpuLayers = 99; reasons.push('GPU offload measured faster than CPU on this phone.'); }
  else if (input.probe?.gpu.adreno) reasons.push('Adreno GPU found; it is used only if the benchmark shows it is faster.');
  else reasons.push(`GPU (${input.probe?.gpu.renderer || 'unknown'}) has no supported llama.cpp backend here, so the CPU's ${[input.probe?.cpu.dotprod && 'dotprod', input.probe?.cpu.i8mm && 'i8mm', input.probe?.cpu.sve && 'SVE', input.probe?.cpu.fp16 && 'fp16'].filter(Boolean).join(', ') || 'NEON'} kernels are used.`);

  const holdBudget = profile === 'battery' && memory ? Math.max(budgetMb, memoryBudgetMb(memory, 'balanced').budgetMb) : budgetMb;
  const fitsInMemory = engine === 'moe-stream' ? true : weightsMb + kvMb + computeMb <= holdBudget;
  if (!fitsInMemory) reasons.push(`Warning: this model (${weightsMb} MB) plus its buffers exceeds the ${budgetMb} MB budget; Android may close other apps or the model may be slow.`);

  const plan: InferencePlan = {
    engine, profile, requestedProfile: input.requestedProfile, nCtx, nBatch, nUbatch, nThreads, nParallel: 1, useMmap: true, useMlock: false,
    kvType, flashAttn: kvType === 'q8_0' ? 'on' : 'auto', nGpuLayers,
    stateCacheMb: tier === 'low' ? 96 : tier === 'mid' ? 160 : 256,
    budgetMb, reserveMb, weightsMb, kvMb, computeMb, architecture: arch || undefined, fitsInMemory, reasons,
  };

  if (engine === 'moe-stream' && arch) {
    const denseMb = Math.round(arch.denseBytes / 1048576);
    const tokenSetMb = Math.round((arch.expertBytes / Math.max(1, arch.expertCount)) * Math.max(1, arch.expertUsedCount) / 1048576);
    let cacheMb = Math.max(0, budgetMb - denseMb - kvMb - computeMb - 200);
    cacheMb = Math.min(cacheMb, Math.round(arch.expertBytes / 1048576));
    const storage = input.storage;
    const lanesMeasured = storage?.bestLanes;
    const emmc = input.probe?.storage.kind === 'emmc';
    let ioLanes = lanesMeasured || (emmc ? 2 : 4);
    if (profile === 'battery') ioLanes = Math.min(ioLanes, 2);
    if (profile === 'max' && !emmc && !lanesMeasured) ioLanes = 6;
    const threadsBatch = profile === 'battery' ? nThreads : topo.total;
    const common = ['--moe-stream', '-c', String(nCtx), '--routing-dir', '{routingDir}', '--temp', '0.7', '--top-p', '0.9'];
    if (kvType === 'q8_0') common.push('-ctk', 'q8_0', '-ctv', 'q8_0');
    const explicit = [...common, '-t', String(nThreads), '--threads-batch', String(threadsBatch), '--io-threads', String(ioLanes)];
    if (cacheMb >= tokenSetMb * 2) { explicit.push('--cache-mb', String(cacheMb)); if (cacheMb < 1500) explicit.push('--force-cache'); explicit.push('--overlap'); }
    else { explicit.push('--cache-mb', '0'); cacheMb = 0; }
    // Automatic hands thread count, read lanes and overlap to the engine's measured planner, but
    // inside Pocket Buddy's RAM limits: the floor is what Android keeps, the ceiling our budget.
    const useAutoPlanner = input.requestedProfile === 'auto' && profile !== 'battery' && cacheMb >= 1500;
    const floorMb = Math.max(512, Math.round((memory?.availableMb || 2048) - cacheMb));
    const auto = [...common, '--auto', '--cache-mb', 'auto', '--cache-floor-mb', String(floorMb), '--cache-ceil-mb', String(Math.max(cacheMb, 256))];
    const args = useAutoPlanner ? auto : explicit;
    plan.moe = {cacheMb, ioLanes, threadsBatch, useAutoPlanner, args, fallbackArgs: explicit};
    reasons.push(`Expert cache ${cacheMb} MB (one token needs ~${tokenSetMb} MB of experts), ${ioLanes} parallel ${emmc ? 'eMMC' : 'flash'} read lanes${lanesMeasured ? ' (measured)' : ''}, async reads overlapped with compute${useAutoPlanner ? '; the engine re-measures threads and lanes on its first answer' : ''}.`);
  }
  return plan;
}

// ---------------- persisted tuning & benchmark history ----------------
export async function loadTuning(key: string): Promise<ThreadTuning | null> {
  try { const raw = await AsyncStorage.getItem(TUNING_KEY); const all = raw ? JSON.parse(raw) : {}; return all[key] || null; } catch { return null; }
}
export async function saveTuning(key: string, value: ThreadTuning): Promise<void> {
  let all: Record<string, ThreadTuning> = {};
  try { const raw = await AsyncStorage.getItem(TUNING_KEY); all = raw ? JSON.parse(raw) : {}; } catch {}
  all[key] = value;
  await AsyncStorage.setItem(TUNING_KEY, JSON.stringify(all));
}
export function tuningKey(probe: HardwareProbe | null, modelPath: string): string { return hardwareFingerprint(probe) + '::' + modelPath.split('/').pop(); }

export type BenchmarkRun = {label: string; engine: string; loadMs: number; ttftMs: number; prefillTps: number; decodeTps: number; rssMb: number; threads: number; nCtx: number; promptTokens: number; generatedTokens: number; error?: string};
export type BenchmarkReport = {ranAt: number; device: string; model: string; architecture: string; runs: BenchmarkRun[]; notes: string[]};
export async function saveBenchmarkReport(report: BenchmarkReport): Promise<void> {
  const list = await loadBenchmarkReports();
  await AsyncStorage.setItem(BENCH_KEY, JSON.stringify([report, ...list].slice(0, 10)));
}
export async function loadBenchmarkReports(): Promise<BenchmarkReport[]> {
  try { const raw = await AsyncStorage.getItem(BENCH_KEY); const v = raw ? JSON.parse(raw) : []; return Array.isArray(v) ? v : []; } catch { return []; }
}
export function formatReport(r: BenchmarkReport): string {
  const lines = [`Pocket Buddy benchmark ${new Date(r.ranAt).toISOString()}`, `Device: ${r.device}`, `Model: ${r.model} (${r.architecture})`, ''];
  lines.push('config | engine | load ms | TTFT ms | prefill tok/s | decode tok/s | RSS MB | threads | ctx');
  for (const run of r.runs) lines.push(run.error ? `${run.label} | failed: ${run.error}` : `${run.label} | ${run.engine} | ${Math.round(run.loadMs)} | ${Math.round(run.ttftMs)} | ${run.prefillTps.toFixed(1)} | ${run.decodeTps.toFixed(2)} | ${Math.round(run.rssMb)} | ${run.threads} | ${run.nCtx}`);
  if (r.notes.length) lines.push('', ...r.notes);
  return lines.join('\n');
}

// ---------------- runtime events (thermal / memory) ----------------
export type HardwareEvent = {type: 'thermal'; thermalStatus: number} | {type: 'trimMemory'; level: number; availableRamMb: number} | {type: 'lowMemory'; availableRamMb: number};
export function subscribeHardwareEvents(listener: (event: HardwareEvent) => void): () => void {
  if (!Native) return () => {};
  const emitter = new NativeEventEmitter(NativeModules.PocketBuddyHardware);
  const sub = emitter.addListener('PocketBuddyHardwareEvent', listener as any);
  return () => sub.remove();
}

export function describeDevice(probe: HardwareProbe | null): string {
  if (!probe) return 'Unknown device';
  const clusters = probe.cpu.clusters.map(c => `${c.count}x ${c.name} ${(c.maxMhz / 1000).toFixed(2)} GHz`).join(' + ');
  const isa = [probe.cpu.dotprod && 'dotprod', probe.cpu.fp16 && 'fp16', probe.cpu.i8mm && 'i8mm', probe.cpu.bf16 && 'bf16', probe.cpu.sve && 'SVE', probe.cpu.sve2 && 'SVE2', probe.cpu.sme && 'SME'].filter(Boolean).join(', ') || 'NEON';
  return `${probe.manufacturer} ${probe.model} · Android SDK ${probe.sdk}\nCPU: ${clusters}\nARM features: ${isa}\nRAM: ${Math.round(probe.memory.totalMb)} MB · Storage: ${probe.storage.kind.toUpperCase()} (${Math.round(probe.storage.freeMb / 1024)} GB free)\nGPU: ${probe.gpu.renderer || 'unknown'}${probe.gpu.hexagon ? ' · Hexagon NPU' : ''}`;
}

/** Model suggestions from measured RAM, not from phone names. */
export function recommendModels(totalMb: number): {dense: string; moe: string | null; note: string} {
  if (totalMb < 4500) return {dense: 'Qwen3.8 2B Uncensored Q4_K_M (1.2 GB)', moe: null, note: 'Under 4.5 GB RAM: stay with 2B dense models.'};
  if (totalMb < 7500) return {dense: 'Qwen3.8 2B Uncensored Q4_K_M (1.2 GB)', moe: 'LFM2.5 8B-A1B abliterated IQ4_XS (4.6 GB, expert streaming)', note: '6 GB class: the 2B dense model is fastest for chat; the 8B MoE streams experts from storage for higher quality.'};
  if (totalMb < 11500) return {dense: 'Qwen3.8 4B class Q4_K_M', moe: 'LFM2.5 8B-A1B abliterated Q4_K_S (fits fully in RAM)', note: '8 GB class: 8B-A1B MoE fits in RAM without streaming.'};
  return {dense: 'Qwen3.8 8B class Q4_K_M', moe: 'Qwen3.6 35B-A3B abliterated (expert streaming)', note: '12 GB+: large MoE models with expert streaming.'};
}
