import fs from "node:fs";
import path from "node:path";
import { z } from "zod";

const safeBasename = z
  .string()
  .min(1)
  .refine((s) => !s.includes("/") && !s.includes("\\") && s !== "." && s !== "..", {
    message: "must be a bare filename within the experiment directory"
  });

const safeRelFromExperiment = z
  .string()
  .min(1)
  .refine((s) => !path.isAbsolute(s), { message: "blockFile must be a relative path" });

const manifestSchema = z.object({
  experiment: z.string().min(1),
  variants: z
    .array(
      z.object({
        id: z.string().min(1),
        file: safeBasename,
        blockFile: safeRelFromExperiment.optional(),
        media: safeBasename.optional(),
        weight: z.number().int().nonnegative()
      })
    )
    .min(1)
});

type ManifestVariant = z.infer<typeof manifestSchema>["variants"][number];

type LoadedVariant = {
  id: string;
  weight: number;
  html: string;
  blockHtml?: string;
  mediaPath?: string;
};

export type LoadedExperiment = {
  experimentId: string;
  variants: LoadedVariant[];
  totalWeight: number;
};

const TELEGRAM_CAPTION_MAX = 1024;
const CAPTION_SUBSTITUTION_BUFFER = 64;

export function resolveUnderMessagesBundle(experimentDir: string, relPath: string): string {
  const bundleRoot = path.resolve(experimentDir, "..");
  const resolved = path.resolve(experimentDir, relPath.replaceAll("\\", path.sep));
  const rel = path.relative(bundleRoot, resolved);
  if (rel.startsWith("..") || path.isAbsolute(rel)) {
    throw new Error(`experiment_path_escape: ${relPath} -> ${resolved} (bundle=${bundleRoot})`);
  }
  return resolved;
}

function readRequiredFile(experimentId: string, variantId: string, label: string, filePath: string): string {
  if (!fs.existsSync(filePath)) {
    throw new Error(`experiment_variant_${label}_missing: ${experimentId}/${variantId} -> ${filePath}`);
  }
  const content = fs.readFileSync(filePath, "utf8");
  if (content.trim().length === 0) {
    throw new Error(`experiment_variant_${label}_empty: ${experimentId}/${variantId} -> ${filePath}`);
  }
  return content;
}

function loadBlockHtml(experimentDir: string, experimentId: string, variant: ManifestVariant): string | undefined {
  if (!variant.blockFile) return undefined;
  const blockPath = resolveUnderMessagesBundle(experimentDir, variant.blockFile);
  return readRequiredFile(experimentId, variant.id, "block_file", blockPath);
}

function loadMediaPath(experimentDir: string, experimentId: string, variant: ManifestVariant, html: string): string | undefined {
  if (!variant.media) return undefined;
  const mediaPath = path.join(experimentDir, variant.media);
  if (!fs.existsSync(mediaPath)) {
    throw new Error(`experiment_variant_media_missing: ${experimentId}/${variant.id} -> ${mediaPath}`);
  }
  if (fs.statSync(mediaPath).size === 0) {
    throw new Error(`experiment_variant_media_empty: ${experimentId}/${variant.id} -> ${mediaPath}`);
  }
  if (html.length + CAPTION_SUBSTITUTION_BUFFER > TELEGRAM_CAPTION_MAX) {
    throw new Error(
      `experiment_variant_caption_too_long: ${experimentId}/${variant.id} ` +
        `(${html.length} chars; limit ${TELEGRAM_CAPTION_MAX - CAPTION_SUBSTITUTION_BUFFER})`
    );
  }
  return mediaPath;
}

function loadVariant(experimentDir: string, experimentId: string, variant: ManifestVariant): LoadedVariant {
  const filePath = path.join(experimentDir, variant.file);
  const html = readRequiredFile(experimentId, variant.id, "file", filePath);
  return {
    id: variant.id,
    weight: variant.weight,
    html,
    blockHtml: loadBlockHtml(experimentDir, experimentId, variant),
    mediaPath: loadMediaPath(experimentDir, experimentId, variant, html)
  };
}

function validateEnabledVariants(experimentId: string, enabled: ManifestVariant[]): void {
  if (enabled.length === 0) {
    throw new Error(`experiment_has_no_active_variants: ${experimentId}`);
  }

  const withBlockFile = enabled.filter((x) => x.blockFile !== undefined && x.blockFile.trim() !== "");
  if (withBlockFile.length > 0 && withBlockFile.length !== enabled.length) {
    throw new Error(`experiment_blockFile_mismatch: ${experimentId} (blockFile required on every variant when used)`);
  }
}

export function loadExperimentFromDir(dir: string): LoadedExperiment {
  const manifestPath = path.join(dir, "manifest.json");
  if (!fs.existsSync(manifestPath)) {
    throw new Error(`experiment_manifest_missing: ${manifestPath}`);
  }

  const manifest = manifestSchema.parse(JSON.parse(fs.readFileSync(manifestPath, "utf8")));
  const enabled = manifest.variants.filter((v) => v.weight > 0);
  validateEnabledVariants(manifest.experiment, enabled);

  const variants = enabled.map((v) => loadVariant(dir, manifest.experiment, v));
  const totalWeight = variants.reduce((sum, v) => sum + v.weight, 0);
  return { experimentId: manifest.experiment, variants, totalWeight };
}
