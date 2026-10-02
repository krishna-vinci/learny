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
