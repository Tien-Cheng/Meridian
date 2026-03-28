import { Agent } from "@convex-dev/agent";
import { components } from "../_generated/api";
import { openai } from "@ai-sdk/openai";

export const extractorAgent = new Agent(components.agent, {
  name: "Data Extractor",
  languageModel: openai.chat("gpt-5.4-mini"),
  instructions: `You normalize raw marketplace listing data into structured
JSON. You identify price anomalies by comparing against provided baseline
prices. You flag listings as suspicious when price deviations exceed 15%
below baseline or when listings appear in unexpected regions.`,
  maxSteps: 3,
});
