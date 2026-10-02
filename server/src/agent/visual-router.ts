import type { Classifier } from "./classifier.js";

export interface VisualRouter {
  decide(section: {
    heading: string;
    text: string;
    subject: string;
  }): Promise<{ want: boolean; form?: "widget" | "sketch" | "chart" | "none"; widget?: string } | null>;
}
/** Reserved for a future router. Null leaves the make-visual skill's judgment in charge. */
export const nullRouter: VisualRouter = {
  async decide() {
    return null;
  },
};

/** C3 controls this hint; the authoring skill remains responsible for the visual. */
export function classifierVisualRouter(classifier: Classifier): VisualRouter {
  return {
    async decide(section) {
      const result = await classifier.decide("visual.router", {
        state: { heading: section.heading, text: section.text.slice(0, 4000), subject: section.subject },
      });
      if (result.source !== "classifier") return null;
      return {
        want: result.answer.form !== "none",
        form: result.answer.form,
        ...(result.answer.widget === "none" ? {} : { widget: result.answer.widget }),
      };
    },
  };
}
