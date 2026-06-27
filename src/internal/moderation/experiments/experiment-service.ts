import { createHash } from "node:crypto";
import type { Logger } from "../../lib/logger.js";
import { loadExperimentFromDir, type LoadedExperiment } from "./experiment-loader.js";
import type { IExperimentService, Assignment } from "./experiment-service.port.js";

export type { Assignment };

const MODERATION_FLOW_SUBJECT_PREFIX = "moderation_flow_2026_05";

export class ExperimentService implements IExperimentService {
  private readonly experiments = new Map<string, LoadedExperiment>();

  constructor(experimentDirs: string[], logger: Logger) {
    for (const dir of experimentDirs) {
      const exp = loadExperimentFromDir(dir);
      if (this.experiments.has(exp.experimentId)) {
        throw new Error(`duplicate_experiment_id: ${exp.experimentId} (dir=${dir})`);
      }
      this.experiments.set(exp.experimentId, exp);
      logger.info("experiment_loaded", {
        experimentId: exp.experimentId,
        totalWeight: exp.totalWeight,
        variants: exp.variants.map((v) => ({
          id: v.id,
          weight: v.weight,
          bytes: v.html.length,
          hasBlock: Boolean(v.blockHtml),
          hasMedia: Boolean(v.mediaPath)
        }))
      });
    }
  }

  assign(experimentId: string, subjectId: string): Assignment {
    const exp = this.experiments.get(experimentId);
    if (!exp) throw new Error(`unknown_experiment: ${experimentId}`);
    const bucket = this.hashToBucket(`${experimentId}:${subjectId}`, exp.totalWeight);
    return this.pickWeightedForBucket(exp, bucket);
  }

  assignModerationTier(experimentId: string, subjectId: string): Assignment {
    const exp = this.experiments.get(experimentId);
    if (!exp) throw new Error(`unknown_experiment: ${experimentId}`);
    const bucket = this.hashToBucket(`${MODERATION_FLOW_SUBJECT_PREFIX}:${subjectId}`, exp.totalWeight);
    return this.pickWeightedForBucket(exp, bucket);
  }

  private pickWeightedForBucket(exp: LoadedExperiment, bucket: number): Assignment {
    const { experimentId } = exp;
    let cursor = 0;
    for (const v of exp.variants) {
      cursor += v.weight;
      if (bucket < cursor) {
        return {
          experimentId,
          variantId: v.id,
          html: v.html,
          blockHtml: v.blockHtml,
          mediaPath: v.mediaPath
        };
      }
    }
    const fallback = exp.variants[0];
    return {
      experimentId,
      variantId: fallback.id,
      html: fallback.html,
      blockHtml: fallback.blockHtml,
      mediaPath: fallback.mediaPath
    };
  }

  private hashToBucket(key: string, modulo: number): number {
    const digest = createHash("sha256").update(key).digest();
    return digest.readUInt32BE(0) % modulo;
  }
}
