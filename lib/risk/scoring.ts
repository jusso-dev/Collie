const clamp = (score: number) => Math.min(100, Math.max(0, score));

export type RiskScoreInputs = {
  clicksLast180Days: number;
  submissionsLast180Days: number;
  reportsLast180Days: number;
  trainingsCompletedLast180Days: number;
};

export function calculateRiskScore(inputs: RiskScoreInputs) {
  const clickPenalty = Math.min(inputs.clicksLast180Days * 5, 30);
  const submissionPenalty = Math.min(inputs.submissionsLast180Days * 10, 30);
  const reportCredit = Math.min(inputs.reportsLast180Days * 5, 20);
  const trainingCredit = Math.min(inputs.trainingsCompletedLast180Days * 3, 15);
  const score = clamp(50 + clickPenalty + submissionPenalty - reportCredit - trainingCredit);

  return {
    score,
    factors: {
      base: 50,
      clickPenalty,
      submissionPenalty,
      reportCredit,
      trainingCredit,
    },
  };
}
