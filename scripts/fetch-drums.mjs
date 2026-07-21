#!/usr/bin/env node
/**
 * fetch-drums.mjs — build packages/web/public/samples/drums/ from CC0 sources.
 *
 * Downloads a curated set of hits from VSCO 2 CE and VCSL (both CC0, by
 * Versilian Studios / Sam Gossner), transcodes them to mono 64 kbps AAC with
 * ffmpeg, and writes the kit manifest the web sampler reads. Rerunnable:
 * existing .m4a files are kept unless --force.
 *
 *   node scripts/fetch-drums.mjs [--force]
 *
 * GM keys with no recording here (splash, china, timbales, agogo, cuica…)
 * fall back to the synthesized kit at playback — that is by design.
 */

import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const OUT_DIR = path.join(ROOT, 'packages/web/public/samples/drums');
const FORCE = process.argv.includes('--force');

const REPOS = {
  vcsl: 'sgossner/VCSL/master',
  ce: 'sgossner/VSCO-2-CE/master',
};

const V = {
  kick: 'Membranophones/Struck Membranophones/Bass Drum 2',
  snare: 'Membranophones/Struck Membranophones/Snare Drum, Modern 1',
  tomH: 'Membranophones/Struck Membranophones/Tom 1/Stick',
  tomL: 'Membranophones/Struck Membranophones/Tom 2/Stick',
  bongos: 'Membranophones/Struck Membranophones/Bongos',
  hihat: 'Idiophones/Struck Idiophones/Hi-Hat Cymbal',
  claps: 'Idiophones/Struck Idiophones/Claps',
  cowbells: 'Idiophones/Struck Idiophones/Cowbells',
  shaker: 'Idiophones/Struck Idiophones/Shaker, Small',
  cabasa: 'Idiophones/Struck Idiophones/Cabasa',
  woodblock: 'Idiophones/Struck Idiophones/Woodblock',
};
const CE = 'Percussion';

/**
 * The curated kit: { repo, dir, file, notes, vel, out }.
 * `notes` lists every GM key the recording serves; `vel` is the top of the
 * velocity layer it fills (127 = the loudest layer; equal vel = round-robins).
 */
const SPEC = [
  // ── kick (36) — VCSL Bass Drum 2, trimmed: the concert ring is too long
  //    under a groove ──
  { repo: 'vcsl', dir: V.kick, file: 'bassdrum_hit_pp1.wav', notes: [36], vel: 45, out: 'bd_pp_rr1', trim: 2.5 },
  { repo: 'vcsl', dir: V.kick, file: 'bassdrum_hit_pp2.wav', notes: [36], vel: 45, out: 'bd_pp_rr2', trim: 2.5 },
  { repo: 'vcsl', dir: V.kick, file: 'bassdrum_hit_mf1.wav', notes: [36], vel: 95, out: 'bd_mf_rr1', trim: 2.5 },
  { repo: 'vcsl', dir: V.kick, file: 'bassdrum_hit_mf2.wav', notes: [36], vel: 95, out: 'bd_mf_rr2', trim: 2.5 },
  { repo: 'vcsl', dir: V.kick, file: 'bassdrum_hit_ff.wav', notes: [36], vel: 127, out: 'bd_ff_rr1', trim: 2.5 },
  { repo: 'vcsl', dir: V.kick, file: 'bassdrum_hit_f.wav', notes: [36], vel: 127, out: 'bd_ff_rr2', trim: 2.5 },

  // ── snare (38), snares on — VCSL Snare Drum Modern 1 ──
  { repo: 'vcsl', dir: V.snare, file: 'Snare2_HitSN_v3_rr1_Mid.wav', notes: [38], vel: 45, out: 'sd_p_rr1' },
  { repo: 'vcsl', dir: V.snare, file: 'Snare2_HitSN_v3_rr2_Mid.wav', notes: [38], vel: 45, out: 'sd_p_rr2' },
  { repo: 'vcsl', dir: V.snare, file: 'Snare2_HitSN_v6_rr1_Mid.wav', notes: [38], vel: 90, out: 'sd_mf_rr1' },
  { repo: 'vcsl', dir: V.snare, file: 'Snare2_HitSN_v6_rr2_Mid.wav', notes: [38], vel: 90, out: 'sd_mf_rr2' },
  { repo: 'vcsl', dir: V.snare, file: 'Snare2_HitSN_v9_rr1_Mid.wav', notes: [38], vel: 127, out: 'sd_ff_rr1' },
  { repo: 'vcsl', dir: V.snare, file: 'Snare2_HitSN_v9_rr2_Mid.wav', notes: [38], vel: 127, out: 'sd_ff_rr2' },

  // ── side stick (37) ──
  { repo: 'vcsl', dir: V.snare, file: 'Snare2_stick_v1_rr1_Mid.wav', notes: [37], vel: 127, out: 'rim_rr1' },
  { repo: 'vcsl', dir: V.snare, file: 'Snare2_stick_v1_rr2_Mid.wav', notes: [37], vel: 127, out: 'rim_rr2' },

  // ── claps (39): solo claps soft, group claps loud ──
  { repo: 'vcsl', dir: V.claps, file: 'SoloClap_vl2.wav', notes: [39], vel: 50, out: 'cp_solo_rr1' },
  { repo: 'vcsl', dir: V.claps, file: 'SoloClap_vl4.wav', notes: [39], vel: 80, out: 'cp_solo_rr2' },
  { repo: 'vcsl', dir: V.claps, file: 'Clap_rr1.wav', notes: [39], vel: 127, out: 'cp_group_rr1' },
  { repo: 'vcsl', dir: V.claps, file: 'Clap_rr2.wav', notes: [39], vel: 127, out: 'cp_group_rr2' },
  { repo: 'vcsl', dir: V.claps, file: 'Clap_rr3.wav', notes: [39], vel: 127, out: 'cp_group_rr3' },

  // ── hi-hats (42 closed, 44 pedal, 46 open) ──
  { repo: 'vcsl', dir: V.hihat, file: 'HiHat_HitC_v1_rr1_Mid.wav', notes: [42], vel: 45, out: 'hh_p_rr1' },
  { repo: 'vcsl', dir: V.hihat, file: 'HiHat_HitC_v1_rr2_Mid.wav', notes: [42], vel: 45, out: 'hh_p_rr2' },
  { repo: 'vcsl', dir: V.hihat, file: 'HiHat_HitC_v2_rr1_Mid.wav', notes: [42], vel: 80, out: 'hh_mf_rr1' },
  { repo: 'vcsl', dir: V.hihat, file: 'HiHat_HitC_v2_rr2_Mid.wav', notes: [42], vel: 80, out: 'hh_mf_rr2' },
  { repo: 'vcsl', dir: V.hihat, file: 'HiHat_HitC_v4_rr1_Mid.wav', notes: [42], vel: 127, out: 'hh_f_rr1' },
  { repo: 'vcsl', dir: V.hihat, file: 'HiHat_HitC_v4_rr2_Mid.wav', notes: [42], vel: 127, out: 'hh_f_rr2' },
  { repo: 'vcsl', dir: V.hihat, file: 'HiHat_Close_rr1_Mid.wav', notes: [44], vel: 127, out: 'ph_rr1' },
  { repo: 'vcsl', dir: V.hihat, file: 'HiHat_Close_rr2_Mid.wav', notes: [44], vel: 127, out: 'ph_rr2' },
  { repo: 'vcsl', dir: V.hihat, file: 'HiHat_HitLoose_rr1_Mid.wav', notes: [46], vel: 70, out: 'oh_loose_rr1' },
  { repo: 'vcsl', dir: V.hihat, file: 'HiHat_HitLoose_rr2_Mid.wav', notes: [46], vel: 70, out: 'oh_loose_rr2' },
  { repo: 'vcsl', dir: V.hihat, file: 'HiHat_HitO_rr1_Mid.wav', notes: [46], vel: 127, out: 'oh_rr1' },
  { repo: 'vcsl', dir: V.hihat, file: 'HiHat_HitO_rr2_Mid.wav', notes: [46], vel: 127, out: 'oh_rr2' },

  // ── toms: Tom 2 (low) serves 41+45, Tom 1 (high) serves 47+50 ──
  { repo: 'vcsl', dir: V.tomL, file: 'TomL_HitS_v2_rr1_Mid.wav', notes: [41, 45], vel: 50, out: 'toml_p_rr1' },
  { repo: 'vcsl', dir: V.tomL, file: 'TomL_HitS_v2_rr2_Mid.wav', notes: [41, 45], vel: 50, out: 'toml_p_rr2' },
  { repo: 'vcsl', dir: V.tomL, file: 'TomL_HitS_v3_rr1_Mid.wav', notes: [41, 45], vel: 90, out: 'toml_mf_rr1' },
  { repo: 'vcsl', dir: V.tomL, file: 'TomL_HitS_v3_rr2_Mid.wav', notes: [41, 45], vel: 90, out: 'toml_mf_rr2' },
  { repo: 'vcsl', dir: V.tomL, file: 'TomL_HitS_v4_rr1_Mid.wav', notes: [41, 45], vel: 127, out: 'toml_f_rr1' },
  { repo: 'vcsl', dir: V.tomL, file: 'TomL_HitS_v4_rr2_Mid.wav', notes: [41, 45], vel: 127, out: 'toml_f_rr2' },
  { repo: 'vcsl', dir: V.tomH, file: 'TomH_HitS_v2_rr1_Mid.wav', notes: [47, 50], vel: 50, out: 'tomh_p_rr1' },
  { repo: 'vcsl', dir: V.tomH, file: 'TomH_HitS_v2_rr2_Mid.wav', notes: [47, 50], vel: 50, out: 'tomh_p_rr2' },
  { repo: 'vcsl', dir: V.tomH, file: 'TomH_HitS_v3_rr1_Mid.wav', notes: [47, 50], vel: 90, out: 'tomh_mf_rr1' },
  { repo: 'vcsl', dir: V.tomH, file: 'TomH_HitS_v3_rr2_Mid.wav', notes: [47, 50], vel: 90, out: 'tomh_mf_rr2' },
  { repo: 'vcsl', dir: V.tomH, file: 'TomH_HitS_v4_rr1_Mid.wav', notes: [47, 50], vel: 127, out: 'tomh_f_rr1' },
  { repo: 'vcsl', dir: V.tomH, file: 'TomH_HitS_v4_rr2_Mid.wav', notes: [47, 50], vel: 127, out: 'tomh_f_rr2' },

  // ── cymbals (49 crash, 51 ride, 53 ride bell) — VSCO CE ──
  { repo: 'ce', dir: CE, file: 'cymbal-crash1_pp_rr1.wav', notes: [49], vel: 45, out: 'cy_pp_rr1' },
  { repo: 'ce', dir: CE, file: 'cymbal-crash1_pp_rr2.wav', notes: [49], vel: 45, out: 'cy_pp_rr2' },
  { repo: 'ce', dir: CE, file: 'cymbal-crash1_mf_rr1.wav', notes: [49], vel: 95, out: 'cy_mf_rr1' },
  { repo: 'ce', dir: CE, file: 'cymbal-crash1_mf_rr2.wav', notes: [49], vel: 95, out: 'cy_mf_rr2' },
  { repo: 'ce', dir: CE, file: 'cymbal-crash1_ff_rr1.wav', notes: [49], vel: 127, out: 'cy_ff_rr1' },
  { repo: 'ce', dir: CE, file: 'cymbal-crash1_ff_rr2.wav', notes: [49], vel: 127, out: 'cy_ff_rr2' },
  { repo: 'ce', dir: CE, file: 'susCymb1-hitstick_mp_rr1.wav', notes: [51], vel: 60, out: 'rd_mp_rr1' },
  { repo: 'ce', dir: CE, file: 'susCymb1-hitstick_mp_rr2.wav', notes: [51], vel: 60, out: 'rd_mp_rr2' },
  { repo: 'ce', dir: CE, file: 'susCymb1-hitstick_f_rr1.wav', notes: [51], vel: 110, out: 'rd_f_rr1' },
  { repo: 'ce', dir: CE, file: 'susCymb1-hitstick_f_rr2.wav', notes: [51], vel: 110, out: 'rd_f_rr2' },
  { repo: 'ce', dir: CE, file: 'susCymb1-hitstick_fff_rr1.wav', notes: [51], vel: 127, out: 'rd_fff_rr1' },
  { repo: 'ce', dir: CE, file: 'susCymb1-hitstick_fff_rr2.wav', notes: [51], vel: 127, out: 'rd_fff_rr2' },
  { repo: 'ce', dir: CE, file: 'susCymb1-hit-bell_pp.wav', notes: [53], vel: 50, out: 'rb_pp' },
  { repo: 'ce', dir: CE, file: 'susCymb1-hit-bell_mf.wav', notes: [53], vel: 95, out: 'rb_mf' },
  { repo: 'ce', dir: CE, file: 'susCymb1-hit-bell_fff.wav', notes: [53], vel: 127, out: 'rb_fff' },

  // ── hand percussion ──
  { repo: 'vcsl', dir: V.cowbells, file: 'Cowbell1_Hit_v2_rr1_Mid.wav', notes: [56], vel: 60, out: 'cb_p' },
  { repo: 'vcsl', dir: V.cowbells, file: 'Cowbell1_Hit_v3_rr1_Mid.wav', notes: [56], vel: 95, out: 'cb_mf' },
  { repo: 'vcsl', dir: V.cowbells, file: 'Cowbell1_Hit_v4_rr1_Mid.wav', notes: [56], vel: 127, out: 'cb_f' },
  { repo: 'ce', dir: CE, file: 'Tamb1-Hit_v1_rr1_Sum.wav', notes: [54], vel: 70, out: 'tamb_p_rr1' },
  { repo: 'ce', dir: CE, file: 'Tamb1-Hit_v1_rr2_Sum.wav', notes: [54], vel: 70, out: 'tamb_p_rr2' },
  { repo: 'ce', dir: CE, file: 'Tamb1-Hit_v2_rr1_Sum.wav', notes: [54], vel: 127, out: 'tamb_f_rr1' },
  { repo: 'ce', dir: CE, file: 'Tamb1-Hit_v2_rr2_Sum.wav', notes: [54], vel: 127, out: 'tamb_f_rr2' },
  { repo: 'vcsl', dir: V.bongos, file: 'BongoH_Hit1_v1_rr1_Mid.wav', notes: [60], vel: 50, out: 'bongoh_p' },
  { repo: 'vcsl', dir: V.bongos, file: 'BongoH_Hit1_v2_rr1_Mid.wav', notes: [60], vel: 90, out: 'bongoh_mf' },
  { repo: 'vcsl', dir: V.bongos, file: 'BongoH_Hit1_v3_rr1_Mid.wav', notes: [60], vel: 127, out: 'bongoh_f_rr1' },
  { repo: 'vcsl', dir: V.bongos, file: 'BongoH_Hit1_v3_rr2_Mid.wav', notes: [60], vel: 127, out: 'bongoh_f_rr2' },
  { repo: 'vcsl', dir: V.bongos, file: 'BongoL_Hit1_v1_rr1_Mid.wav', notes: [61], vel: 50, out: 'bongol_p' },
  { repo: 'vcsl', dir: V.bongos, file: 'BongoL_Hit1_v2_rr1_Mid.wav', notes: [61], vel: 90, out: 'bongol_mf' },
  { repo: 'vcsl', dir: V.bongos, file: 'BongoL_Hit1_v3_rr1_Mid.wav', notes: [61], vel: 127, out: 'bongol_f_rr1' },
  { repo: 'vcsl', dir: V.bongos, file: 'BongoL_Hit1_v3_rr2_Mid.wav', notes: [61], vel: 127, out: 'bongol_f_rr2' },
  { repo: 'ce', dir: CE, file: 'Quinto-HitN_v1_rr1_Sum.wav', notes: [62], vel: 50, out: 'quinto_p' },
  { repo: 'ce', dir: CE, file: 'Quinto-HitN_v2_rr1_Sum.wav', notes: [62], vel: 90, out: 'quinto_mf' },
  { repo: 'ce', dir: CE, file: 'Quinto-HitN_v3_rr1_Sum.wav', notes: [62], vel: 127, out: 'quinto_f_rr1' },
  { repo: 'ce', dir: CE, file: 'Quinto-HitN_v3_rr2_Sum.wav', notes: [62], vel: 127, out: 'quinto_f_rr2' },
  { repo: 'ce', dir: CE, file: 'Conga-HitN_v1_rr1_Sum.wav', notes: [63], vel: 50, out: 'conga_p' },
  { repo: 'ce', dir: CE, file: 'Conga-HitN_v2_rr1_Sum.wav', notes: [63], vel: 90, out: 'conga_mf' },
  { repo: 'ce', dir: CE, file: 'Conga-HitN_v3_rr1_Sum.wav', notes: [63], vel: 127, out: 'conga_f_rr1' },
  { repo: 'ce', dir: CE, file: 'Conga-HitN_v3_rr2_Sum.wav', notes: [63], vel: 127, out: 'conga_f_rr2' },
  { repo: 'ce', dir: CE, file: 'Tumba-HitN_v1_rr1_Sum.wav', notes: [64], vel: 50, out: 'tumba_p' },
  { repo: 'ce', dir: CE, file: 'Tumba-HitN_v2_rr1_Sum.wav', notes: [64], vel: 90, out: 'tumba_mf' },
  { repo: 'ce', dir: CE, file: 'Tumba-HitN_v3_rr1_Sum.wav', notes: [64], vel: 127, out: 'tumba_f_rr1' },
  { repo: 'ce', dir: CE, file: 'Tumba-HitN_v3_rr2_Sum.wav', notes: [64], vel: 127, out: 'tumba_f_rr2' },
  { repo: 'vcsl', dir: V.cabasa, file: 'Cabasa1_Rub_v1_rr1_Mid.wav', notes: [69], vel: 80, out: 'cabasa_rr1' },
  { repo: 'vcsl', dir: V.cabasa, file: 'Cabasa1_Rub_v1_rr2_Mid.wav', notes: [69], vel: 80, out: 'cabasa_rr2' },
  { repo: 'vcsl', dir: V.cabasa, file: 'Cabasa1_Rub_v2_rr1_Mid.wav', notes: [69], vel: 127, out: 'cabasa_f_rr1' },
  { repo: 'vcsl', dir: V.cabasa, file: 'Cabasa1_Rub_v2_rr2_Mid.wav', notes: [69], vel: 127, out: 'cabasa_f_rr2' },
  { repo: 'vcsl', dir: V.shaker, file: 'Mid_ShakerDouble_Down_rr1.wav', notes: [70, 82], vel: 127, out: 'shaker_rr1' },
  { repo: 'vcsl', dir: V.shaker, file: 'Mid_ShakerDouble_Down_rr2.wav', notes: [70, 82], vel: 127, out: 'shaker_rr2' },
  { repo: 'vcsl', dir: V.shaker, file: 'Mid_ShakerDouble_Up_rr1.wav', notes: [70, 82], vel: 127, out: 'shaker_rr3' },
  { repo: 'vcsl', dir: V.shaker, file: 'Mid_ShakerDouble_Up_rr2.wav', notes: [70, 82], vel: 127, out: 'shaker_rr4' },
  { repo: 'ce', dir: CE, file: 'Claves1_Hit_v1_rr1_Sum.wav', notes: [75], vel: 60, out: 'clave_p' },
  { repo: 'ce', dir: CE, file: 'Claves1_Hit_v2_rr1_Sum.wav', notes: [75], vel: 95, out: 'clave_mf' },
  { repo: 'ce', dir: CE, file: 'Claves1_Hit_v3_rr1_Sum.wav', notes: [75], vel: 127, out: 'clave_f_rr1' },
  { repo: 'ce', dir: CE, file: 'Claves1_Hit_v3_rr2_Sum.wav', notes: [75], vel: 127, out: 'clave_f_rr2' },
  { repo: 'vcsl', dir: V.woodblock, file: 'wood_click_pp_rr1.wav', notes: [76, 77], vel: 50, out: 'wb_pp_rr1' },
  { repo: 'vcsl', dir: V.woodblock, file: 'wood_click_pp_rr2.wav', notes: [76, 77], vel: 50, out: 'wb_pp_rr2' },
  { repo: 'vcsl', dir: V.woodblock, file: 'wood_click_f_rr1.wav', notes: [76, 77], vel: 110, out: 'wb_f_rr1' },
  { repo: 'vcsl', dir: V.woodblock, file: 'wood_click_f_rr2.wav', notes: [76, 77], vel: 110, out: 'wb_f_rr2' },
  { repo: 'vcsl', dir: V.woodblock, file: 'wood_click_ff.wav', notes: [76, 77], vel: 127, out: 'wb_ff' },
  { repo: 'ce', dir: CE, file: 'Triangle6-HitM_v1_rr1_Sum.wav', notes: [80], vel: 80, out: 'mtri_rr1' },
  { repo: 'ce', dir: CE, file: 'Triangle6-HitM_v1_rr2_Sum.wav', notes: [80], vel: 80, out: 'mtri_rr2' },
  { repo: 'ce', dir: CE, file: 'Triangle6-HitM_v2_rr1_Sum.wav', notes: [80], vel: 127, out: 'mtri_f' },
  { repo: 'ce', dir: CE, file: 'Triangle6-Hit_v1_rr1_Sum.wav', notes: [81], vel: 80, out: 'tri_rr1' },
  { repo: 'ce', dir: CE, file: 'Triangle6-Hit_v1_rr2_Sum.wav', notes: [81], vel: 80, out: 'tri_rr2' },
  { repo: 'ce', dir: CE, file: 'Triangle6-Hit_v2_rr1_Sum.wav', notes: [81], vel: 127, out: 'tri_f_rr1' },
  { repo: 'ce', dir: CE, file: 'Triangle6-Hit_v2_rr2_Sum.wav', notes: [81], vel: 127, out: 'tri_f_rr2' },
  { repo: 'ce', dir: CE, file: 'Guiro-Hit_v1_rr1_Sum.wav', notes: [73], vel: 127, out: 'sguiro_rr1' },
  { repo: 'ce', dir: CE, file: 'Guiro-Hit_v1_rr2_Sum.wav', notes: [73], vel: 127, out: 'sguiro_rr2' },
  { repo: 'ce', dir: CE, file: 'Guiro-Slow_v1_Sum.wav', notes: [74], vel: 127, out: 'guiro' },
  { repo: 'ce', dir: CE, file: 'Sleighbells_Hit_v1_rr1_Mid.wav', notes: [83], vel: 127, out: 'sleigh_rr1' },
  { repo: 'ce', dir: CE, file: 'Sleighbells_Hit_v1_rr2_Mid.wav', notes: [83], vel: 127, out: 'sleigh_rr2' },
];

const rawUrl = ({ repo, dir, file }) =>
  `https://raw.githubusercontent.com/${REPOS[repo]}/` +
  `${dir.split('/').map(encodeURIComponent).join('/')}/${encodeURIComponent(file)}`;

fs.mkdirSync(OUT_DIR, { recursive: true });
const notes = {};
let downloaded = 0;

for (const entry of SPEC) {
  const outFile = `${entry.out}.m4a`;
  const outPath = path.join(OUT_DIR, outFile);
  if (FORCE || !fs.existsSync(outPath)) {
    const url = rawUrl(entry);
    const response = await fetch(url);
    if (!response.ok) {
      console.error(`✗ ${response.status} ${url}`);
      process.exitCode = 1;
      continue;
    }
    const wav = path.join(OUT_DIR, `.${entry.out}.wav`);
    fs.writeFileSync(wav, Buffer.from(await response.arrayBuffer()));
    const trim = entry.trim
      ? ['-t', String(entry.trim), '-af', `afade=t=out:st=${entry.trim - 0.4}:d=0.4`]
      : [];
    execFileSync('ffmpeg', [
      '-hide_banner', '-loglevel', 'error', '-y', '-i', wav, ...trim,
      '-ac', '1', '-c:a', 'aac', '-b:a', '64k', '-movflags', '+faststart', outPath,
    ]);
    fs.unlinkSync(wav);
    downloaded++;
    process.stdout.write(`  ${outFile}\n`);
  }
  for (const note of entry.notes) {
    (notes[note] ??= []).push({ vel: entry.vel, url: outFile });
  }
}

const manifest = { kit: true, notes };
fs.writeFileSync(path.join(OUT_DIR, 'manifest.json'), JSON.stringify(manifest, null, 1) + '\n');
const total = fs.readdirSync(OUT_DIR).filter((f) => f.endsWith('.m4a'))
  .reduce((n, f) => n + fs.statSync(path.join(OUT_DIR, f)).size, 0);
console.log(`${downloaded} fetched, ${Object.keys(notes).length} GM keys, ${(total / 1e6).toFixed(1)} MB`);
