import { Agent } from "@convex-dev/agent";
import { openai } from "@ai-sdk/openai";
import { components } from "../_generated/api";

export const riskAssessorAgent = new Agent(components.agent, {
  name: "Risk Signal Assessor",
  languageModel: openai.chat("gpt-5.4-mini"),
  instructions: `You assess counterfeit and unauthorized-pharmaceutical risk
for marketplace listings. Use only the evidence present in the provided
listing data. Consider price deviation, missing pharmacy credentials,
missing prescription requirements, missing batch or expiry information,
and weak seller-account signals. Stay conservative when evidence is limited.
Return structured JSON only and do not invent facts.`,
  maxSteps: 3,
});
