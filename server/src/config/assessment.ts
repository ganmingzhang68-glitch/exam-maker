function numberEnv(name: string, fallback: number, min: number, max: number): number {
  const parsed = Number(process.env[name]);
  return Number.isFinite(parsed) && parsed >= min && parsed <= max ? parsed : fallback;
}

export const assessmentConfig = Object.freeze({
  minimumSampleSize: numberEnv('ASSESSMENT_MIN_SAMPLE_SIZE', 5, 2, 1000),
  highLowGroupProportion: numberEnv('ASSESSMENT_HIGH_LOW_PROPORTION', 0.27, 0.1, 0.5),
  passingScoreRate: numberEnv('ASSESSMENT_PASSING_SCORE_RATE', 0.6, 0, 1),
  tooEasyCorrectRate: numberEnv('ASSESSMENT_TOO_EASY_RATE', 0.9, 0.5, 1),
  tooHardCorrectRate: numberEnv('ASSESSMENT_TOO_HARD_RATE', 0.3, 0, 0.5),
  lowDiscrimination: numberEnv('ASSESSMENT_LOW_DISCRIMINATION', 0.2, -1, 1),
  negativeDiscrimination: numberEnv('ASSESSMENT_NEGATIVE_DISCRIMINATION', 0, -1, 1),
  weakDistractorRate: numberEnv('ASSESSMENT_WEAK_DISTRACTOR_RATE', 0.05, 0, 0.5),
  suspiciousHighGroupGap: numberEnv('ASSESSMENT_SUSPICIOUS_OPTION_GAP', 0.1, 0, 1),
  highBlankRate: numberEnv('ASSESSMENT_HIGH_BLANK_RATE', 0.2, 0, 1),
  calibrationTolerance: numberEnv('ASSESSMENT_CALIBRATION_TOLERANCE', 0.1, 0, 1),
  minimumCalibrationRecords: numberEnv('ASSESSMENT_MIN_CALIBRATION_RECORDS', 10, 2, 1000),
  minimumGradingCalibrationRecords: numberEnv('ASSESSMENT_MIN_GRADING_CALIBRATION_RECORDS', 5, 2, 1000),
});
