// Contains a rendering failure to one piece of content (a chat message, a note body) so the rest
// of the app keeps working. Shows the raw text instead, which is always readable.
import { Component, type ErrorInfo, type ReactNode } from "react";

interface Props {
  /** Shown instead of the children when they fail to render. */
  fallbackText: string;
  /** Changing this (e.g. new content) retries rendering. */
  resetKey?: string;
  children: ReactNode;
}

interface State {
  failedFor: string | undefined;
}

export class RenderBoundary extends Component<Props, State> {
  state: State = { failedFor: undefined };

  static getDerivedStateFromError(): Partial<State> {
    return { failedFor: "__failed__" };
  }

  componentDidCatch(error: Error, info: ErrorInfo): void {
    console.warn("studium: content failed to render; showing plain text", error, info.componentStack);
    this.setState({ failedFor: this.props.resetKey ?? "__failed__" });
  }

  componentDidUpdate(prev: Props): void {
    if (this.state.failedFor !== undefined && prev.resetKey !== this.props.resetKey) {
      this.setState({ failedFor: undefined });
    }
  }

  render(): ReactNode {
    if (this.state.failedFor !== undefined) {
      return <p className="whitespace-pre-wrap break-words text-sm text-foreground">{this.props.fallbackText}</p>;
    }
    return this.props.children;
  }
}
