"use client";

import { Component, type ReactNode } from "react";
import { ErrorState, ForbiddenState } from "@/components/common/states";
import { errorCode, friendlyError } from "@/lib/errors";

type State = { error: unknown };

// convex queries throw into render; catching here turns FORBIDDEN into a calm state instead of a crash
export class QueryBoundary extends Component<{ children: ReactNode }, State> {
  state: State = { error: null };

  static getDerivedStateFromError(error: unknown): State {
    return { error };
  }

  render() {
    const { error } = this.state;
    if (error === null) return this.props.children;
    if (errorCode(error) === "FORBIDDEN") return <ForbiddenState />;
    return <ErrorState message={friendlyError(error)} />;
  }
}
