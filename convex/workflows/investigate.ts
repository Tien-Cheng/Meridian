import { WorkflowManager } from "@convex-dev/workflow";
import { components, internal } from "../_generated/api";
import { v } from "convex/values";

export const workflow = new WorkflowManager(components.workflow);

export const investigationWorkflow = workflow.define({
  args: {
    investigationId: v.id("investigations"),
    threadId: v.string(),
    drugName: v.string(),
    drugCategory: v.string(),
    regions: v.array(
      v.object({
        name: v.string(),
        marketplace: v.string(),
        marketplaceUrl: v.string(),
        legitimatePrice: v.number(),
        currency: v.string(),
        requiresPrescription: v.boolean(),
      })
    ),
    regulatoryContext: v.string(),
  },
  handler: async (step, args): Promise<void> => {
    // Step 1: Update status to searching
    await step.runMutation(internal.functions.investigations.updateStatus, {
      id: args.investigationId,
      status: "searching",
    });

    // Step 2: Search all marketplaces in parallel
    await Promise.all(
      args.regions.map((region, index) =>
        step.runAction(
          internal.functions.investigations.searchRegion,
          {
            investigationId: args.investigationId,
            threadId: args.threadId,
            agentIndex: index,
            region: region.name,
            marketplace: region.marketplace,
            marketplaceUrl: region.marketplaceUrl,
            searchQuery: [args.drugName, args.drugCategory]
              .filter(Boolean)
              .join(" "),
            legitimatePrice: region.legitimatePrice,
            currency: region.currency,
            requiresPrescription: region.requiresPrescription,
          },
          { retry: true }
        )
      )
    );

    // Step 3: Deep investigate suspicious listings
    await step.runMutation(internal.functions.investigations.updateStatus, {
      id: args.investigationId,
      status: "investigating",
    });

    await step.runAction(
      internal.functions.investigations.deepInvestigate,
      {
        investigationId: args.investigationId,
        threadId: args.threadId,
        regulatoryContext: args.regulatoryContext,
      },
      { retry: true }
    );

    // Step 4: Cluster sellers
    await step.runAction(
      internal.functions.investigations.clusterSellersAction,
      {
        investigationId: args.investigationId,
        threadId: args.threadId,
      },
      { retry: true }
    );

    // Step 5: Generate case file
    await step.runMutation(internal.functions.investigations.updateStatus, {
      id: args.investigationId,
      status: "generating_case",
    });

    await step.runAction(
      internal.functions.investigations.generateCase,
      {
        investigationId: args.investigationId,
        threadId: args.threadId,
        regulatoryContext: args.regulatoryContext,
      },
      { retry: true }
    );

    // Step 6: Mark complete
    await step.runMutation(internal.functions.investigations.updateStatus, {
      id: args.investigationId,
      status: "completed",
    });
  },
});
