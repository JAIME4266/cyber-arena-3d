#!/usr/bin/env node
/**
 * optimize-models.mjs — GLB asset compression pipeline for cyber-arena-3d.
 *
 * Reads raw artist GLBs from `assets/models/` (read-only inputs) and writes
 * size-optimized GLBs to `public/models/` (created if missing).
 *
 * Runtime consumers: three.js r187 GLTFLoader + MeshoptDecoder, i.e. outputs
 * may use EXT_meshopt_compression, KHR_mesh_quantization and EXT_texture_webp.
 *
 * Pipeline overview
 * -----------------
 * Characters (player, enemy, enemy2, boss — skinned, textured):
 *   dedup → weld(overwrite) → simplify → prune
 *   → textureCompress (albedo/emissive → lossy webp; normal/ORM → lossless webp)
 *   → quantize → reorder → EXT_meshopt_compression on write.
 *   Skinned meshes are never flattened and never simplified below ratio 0.70,
 *   so bones (skins[].joints) and skinning attributes survive intact.
 *
 * Static meshes (guns, building — no skins, no textures):
 *   dedup(materials) → flatten → join(keepNamed:false) → dedup → weld
 *   → simplify → prune → quantize → reorder → EXT_meshopt_compression.
 *   NOTE: dedup runs BEFORE join (unlike a plain "flatten→join" order) because
 *   join can only merge primitives that share a Material — the raw exports
 *   contain many bitwise-duplicate materials (e.g. 19× "GLOCK"), so joining
 *   before dedup would merge almost nothing. This matches the documented
 *   recommendation in @gltf-transform's `join()` JSDoc.
 *
 * Per-file hard size targets and a 7.5 MB total budget are enforced: the
 * script exits non-zero if any limit is exceeded (CI-friendly).
 *
 * Usage: node scripts/optimize-models.mjs   (also runs under bun)
 */

import { mkdirSync, readFileSync, statSync } from 'node:fs';
import { join as joinPath, resolve } from 'node:path';

import { NodeIO, Logger } from '@gltf-transform/core';
import { ALL_EXTENSIONS, EXTMeshoptCompression } from '@gltf-transform/extensions';
import {
        dedup,
        flatten,
        join,
        prune,
        quantize,
        reorder,
        simplify,
        textureCompress,
        weld,
} from '@gltf-transform/functions';
import { MeshoptEncoder, MeshoptSimplifier } from 'meshoptimizer';
import sharp from 'sharp';

// ---------------------------------------------------------------------------
// Configuration
// ---------------------------------------------------------------------------

const ROOT = resolve(import.meta.dirname, '..');
const IN_DIR = joinPath(ROOT, 'assets', 'models');
const OUT_DIR = joinPath(ROOT, 'public', 'models');
const TOTAL_BUDGET_BYTES = 7.5 * 1024 * 1024;

/** Material texture slots that hold *color* data → lossy webp is safe. */
const COLOR_SLOTS = /^(baseColorTexture|emissiveTexture)$/;
/** Slots holding *data* (normals / AO / ORM) → lossless webp only (lossy normal maps shimmer). */
const DATA_SLOTS = /^(normalTexture|occlusionTexture|metallicRoughnessTexture)$/;

const MB = (n) => n / (1024 * 1024);
const kb = (n) => n / 1024;

/**
 * Model manifest. `attempts` is an ordered ladder of parameter sets — the
 * first one that lands under `targetBytes` wins. Later rungs only kick in if
 * earlier (higher quality) settings miss the per-file budget.
 */
const MODELS = [
        {
                name: 'player',
                kind: 'character',
                targetBytes: 1.6 * 1024 * 1024,
                attempts: [
                        { ratio: 0.85, error: 0.001, quality: 82, albedo: [1024, 1024] },
                        { ratio: 0.7, error: 0.001, quality: 82, albedo: [1024, 1024] },
                        { ratio: 0.7, error: 0.001, quality: 78, albedo: [1024, 1024] },
                        { ratio: 0.7, error: 0.001, quality: 75, albedo: [768, 768] },
                ],
        },
        {
                name: 'enemy',
                kind: 'character',
                targetBytes: 1.2 * 1024 * 1024,
                attempts: [
                        { ratio: 0.85, error: 0.001, quality: 82, albedo: [1024, 1024] },
                        { ratio: 0.7, error: 0.001, quality: 82, albedo: [1024, 1024] },
                        { ratio: 0.7, error: 0.001, quality: 78, albedo: [768, 768] },
                ],
        },
        {
                name: 'enemy2',
                kind: 'character',
                targetBytes: 1.2 * 1024 * 1024,
                attempts: [
                        { ratio: 0.85, error: 0.001, quality: 82, albedo: [1024, 1024] },
                        { ratio: 0.7, error: 0.001, quality: 82, albedo: [1024, 1024] },
                        { ratio: 0.7, error: 0.001, quality: 78, albedo: [768, 768] },
                ],
        },
        {
                name: 'boss',
                kind: 'character',
                targetBytes: 1.2 * 1024 * 1024,
                attempts: [
                        { ratio: 0.85, error: 0.001, quality: 82, albedo: [1024, 1024] },
                        { ratio: 0.7, error: 0.001, quality: 82, albedo: [1024, 1024] },
                        { ratio: 0.7, error: 0.001, quality: 78, albedo: [768, 768] },
                ],
        },
        {
                name: 'gun_w1',
                kind: 'static',
                targetBytes: 200 * 1024,
                attempts: [{ ratio: 0.7, error: 0.001 }],
        },
        {
                name: 'gun_w2',
                kind: 'static',
                targetBytes: 250 * 1024,
                attempts: [
                        { ratio: 0.7, error: 0.001 },
                        { ratio: 0.6, error: 0.001 }, // static prop: silhouette risk is low
                ],
        },
        {
                name: 'gun_w3',
                kind: 'static',
                targetBytes: 400 * 1024,
                attempts: [
                        { ratio: 0.7, error: 0.001 },
                        { ratio: 0.6, error: 0.001 },
                        { ratio: 0.5, error: 0.001 },
                ],
        },
        {
                name: 'building',
                kind: 'static',
                targetBytes: 900 * 1024,
                attempts: [{ ratio: 0.8, error: 0.002 }],
        },
];

// ---------------------------------------------------------------------------
// gltf-transform I/O
// ---------------------------------------------------------------------------

await MeshoptEncoder.ready; // required before encode (meshopt compression on write)
await MeshoptSimplifier.ready; // required before simplify()

const io = new NodeIO()
        .registerExtensions(ALL_EXTENSIONS)
        .registerDependencies({ 'meshopt.encoder': MeshoptEncoder })
        .setLogger(new Logger(Logger.Verbosity.WARN)); // silence per-transform info chatter

/**
 * Marks the document for EXT_meshopt_compression at write time.
 * QUANTIZE method: we already applied (lossy) quantize() ourselves; meshopt
 * encoding itself stays lossless. `required` → no uncompressed fallback copy.
 */
function applyMeshoptOnWrite(doc) {
        doc.createExtension(EXTMeshoptCompression)
                .setRequired(true)
                .setEncoderOptions({ method: EXTMeshoptCompression.EncoderMethod.QUANTIZE });
}

// ---------------------------------------------------------------------------
// Pipelines
// ---------------------------------------------------------------------------

/** Skinned characters: never flatten (bones must stay), never ratio < 0.70. */
async function optimizeCharacter(inPath, outPath, params) {
        const doc = await io.read(inPath);
        await doc.transform(
                dedup(),
                weld({ overwrite: true }), // merge bitwise-identical verts; JOINTS_0/WEIGHTS_0 preserved
                simplify({ simplifier: MeshoptSimplifier, ratio: params.ratio, error: params.error }),
                prune(),
                textureCompress({
                        encoder: sharp,
                        targetFormat: 'webp',
                        quality: params.quality,
                        resize: [...params.albedo],
                        slots: COLOR_SLOTS,
                }),
                textureCompress({
                        encoder: sharp,
                        targetFormat: 'webp',
                        lossless: true, // normal/AO/ORM data must not be degraded
                        resize: [512, 512],
                        slots: DATA_SLOTS,
                }),
                quantize(),
                reorder({ encoder: MeshoptEncoder }), // vertex locality → better meshopt ratio
        );
        applyMeshoptOnWrite(doc);
        await io.write(outPath, doc);
}

/** Static props (guns, building): collapse hierarchy, merge draw calls. */
async function optimizeStatic(inPath, outPath, params) {
        const doc = await io.read(inPath);
        await doc.transform(
                dedup(), // merge duplicate materials FIRST so join() can actually merge
                flatten(),
                join({ keepNamed: false }),
                dedup(),
                weld(),
                simplify({ simplifier: MeshoptSimplifier, ratio: params.ratio, error: params.error }),
                prune(), // drops unused TANGENT/TEXCOORD (no textures on these meshes)
                quantize(),
                reorder({ encoder: MeshoptEncoder }),
        );
        applyMeshoptOnWrite(doc);
        await io.write(outPath, doc);
}

// ---------------------------------------------------------------------------
// Validation helpers (raw GLB JSON-chunk parsing — no gltf-transform involved)
// ---------------------------------------------------------------------------

/** Parse the JSON chunk of a binary .glb and return it as a plain object. */
function parseGlbJson(path) {
        const buf = readFileSync(path);
        if (buf.length < 20 || buf.readUInt32LE(0) !== 0x46546c67) {
                throw new Error(`Not a binary glTF: ${path}`);
        }
        const jsonLength = buf.readUInt32LE(12);
        const jsonType = buf.readUInt32LE(16);
        if (jsonType !== 0x4e4f534a) throw new Error(`Missing JSON chunk: ${path}`);
        return JSON.parse(buf.toString('utf8', 20, 20 + jsonLength));
}

/**
 * Validate one output against its input:
 *  - characters: skin joint count unchanged, JOINTS_0/WEIGHTS_0 still present,
 *    EXT_meshopt_compression used, textures converted to webp (EXT_texture_webp).
 *  - all files: extensions sanity (KHR_mesh_quantization expected alongside meshopt).
 */
function validateModel(model) {
        const inJson = parseGlbJson(joinPath(IN_DIR, `${model.name}.glb`));
        const outJson = parseGlbJson(joinPath(OUT_DIR, `${model.name}.glb`));
        const checks = [];
        const check = (label, pass, detail) => checks.push({ label, pass, detail });

        const outExt = outJson.extensionsUsed ?? [];
        check('EXT_meshopt_compression', outExt.includes('EXT_meshopt_compression'), outExt.join(', ') || '(none)');

        if (model.kind === 'character') {
                const inJoints = inJson.skins?.[0]?.joints?.length ?? 0;
                const outJoints = outJson.skins?.[0]?.joints?.length ?? 0;
                check('skin joint count preserved', inJoints === outJoints && outJoints > 0, `in=${inJoints} out=${outJoints}`);

                const prims = (outJson.meshes ?? []).flatMap((m) => m.primitives ?? []);
                const hasJoints = prims.length > 0 && prims.every((p) => p.attributes?.JOINTS_0 != null);
                const hasWeights = prims.length > 0 && prims.every((p) => p.attributes?.WEIGHTS_0 != null);
                check('JOINTS_0 on all primitives', hasJoints, `${prims.length} primitive(s)`);
                check('WEIGHTS_0 on all primitives', hasWeights, `${prims.length} primitive(s)`);

                const images = outJson.images ?? [];
                const allWebp = images.length > 0 && images.every((i) => i.mimeType === 'image/webp');
                check('textures converted to webp', allWebp, images.map((i) => i.mimeType).join(', ') || '(no images)');
                check(
                        'EXT_texture_webp declared',
                        !allWebp || outExt.includes('EXT_texture_webp'),
                        outExt.includes('EXT_texture_webp') ? 'present' : 'missing',
                );
        } else {
                check('no textures expected', (outJson.images ?? []).length === 0, `${(outJson.images ?? []).length} image(s)`);
        }

        check('KHR_mesh_quantization', outExt.includes('KHR_mesh_quantization'), outExt.includes('KHR_mesh_quantization') ? 'present' : 'absent');

        return checks;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

function fmtBytes(bytes) {
        return bytes >= 1024 * 1024 ? `${MB(bytes).toFixed(2)} MB` : `${kb(bytes).toFixed(1)} KB`;
}

async function main() {
        mkdirSync(OUT_DIR, { recursive: true });

        const results = [];
        let totalOriginal = 0;
        let totalOptimized = 0;

        for (const model of MODELS) {
                const inPath = joinPath(IN_DIR, `${model.name}.glb`);
                const outPath = joinPath(OUT_DIR, `${model.name}.glb`);
                const originalSize = statSync(inPath).size;
                totalOriginal += originalSize;

                let usedParams = null;
                let optimizedSize = 0;

                for (const params of model.attempts) {
                        const optimize = model.kind === 'character' ? optimizeCharacter : optimizeStatic;
                        // Fresh read per attempt — transforms mutate the Document, and every
                        // attempt must start from the pristine input (keeps runs idempotent).
                        await optimize(inPath, outPath, params);
                        optimizedSize = statSync(outPath).size;
                        usedParams = params;
                        if (optimizedSize <= model.targetBytes) break;
                }

                totalOptimized += optimizedSize;
                results.push({ model, originalSize, optimizedSize, usedParams });
                const ok = optimizedSize <= model.targetBytes;
                console.log(
                        `${ok ? '✓' : '✗'} ${model.name.padEnd(9)} ${fmtBytes(originalSize).padStart(9)} → ${fmtBytes(optimizedSize).padStart(9)}` +
                                `  (target ${fmtBytes(model.targetBytes)})` +
                                `  [ratio ${usedParams.ratio}${usedParams.quality ? `, q ${usedParams.quality}, albedo ${usedParams.albedo[0]}px` : ''}]`,
                );
        }

        // --- Size table ---------------------------------------------------------
        console.log('\n──────────────────────── SIZE REPORT ────────────────────────');
        console.log(`${'file'.padEnd(12)}${'original'.padStart(11)}${'optimized'.padStart(12)}${'reduction'.padStart(11)}`);
        for (const { model, originalSize, optimizedSize } of results) {
                const reduction = (((originalSize - optimizedSize) / originalSize) * 100).toFixed(1);
                console.log(
                        `${(model.name + '.glb').padEnd(12)}${fmtBytes(originalSize).padStart(11)}${fmtBytes(optimizedSize).padStart(12)}${`${reduction}%`.padStart(11)}`,
                );
        }
        console.log('─'.repeat(56));
        console.log(
                `${'TOTAL'.padEnd(12)}${fmtBytes(totalOriginal).padStart(11)}${fmtBytes(totalOptimized).padStart(12)}` +
                        `  (budget ${fmtBytes(TOTAL_BUDGET_BYTES)})`,
        );

        const overBudgetFiles = results.filter((r) => r.optimizedSize > r.model.targetBytes);
        const totalOk = totalOptimized <= TOTAL_BUDGET_BYTES;

        // --- Validation ---------------------------------------------------------
        console.log('\n──────────────────────── VALIDATION ─────────────────────────');
        let validationFailed = false;
        for (const { model } of results) {
                console.log(model.name + ':');
                let checks;
                try {
                        checks = validateModel(model);
                } catch (err) {
                        console.log(`  ✗ parse error: ${err.message}`);
                        validationFailed = true;
                        continue;
                }
                for (const { label, pass, detail } of checks) {
                        if (!pass) validationFailed = true;
                        console.log(`  ${pass ? '✓' : '✗'} ${label}${detail ? ` — ${detail}` : ''}`);
                }
        }

        // --- Gate ---------------------------------------------------------------
        if (overBudgetFiles.length > 0) {
                console.error(`\n✗ Over per-file budget: ${overBudgetFiles.map((r) => r.model.name).join(', ')}`);
        }
        if (!totalOk) {
                console.error(`\n✗ Total ${fmtBytes(totalOptimized)} exceeds budget ${fmtBytes(TOTAL_BUDGET_BYTES)}`);
        }
        if (validationFailed) {
                console.error('\n✗ Validation failures detected (see above).');
        }

        if (overBudgetFiles.length > 0 || !totalOk || validationFailed) {
                process.exit(1);
        }
        console.log('\n✓ All models within budget and validation passed.');
}

main().catch((err) => {
        console.error(err);
        process.exit(1);
});
