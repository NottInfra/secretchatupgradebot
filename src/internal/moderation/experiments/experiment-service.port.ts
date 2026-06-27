export type Assignment = {
  experimentId: string;
  variantId: string;
  html: string;
  blockHtml?: string;
  mediaPath?: string;
};

export interface IExperimentService {
  assign(experimentId: string, subjectId: string): Assignment;
  assignModerationTier(experimentId: string, subjectId: string): Assignment;
}
