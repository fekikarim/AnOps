/**
 * Turns a typed action error into copy a user can act on. Server messages are written for users; for
 * unexpected failures we show a short apology and a reference id, never internal detail.
 */
export type ErrorLike = { code?: string; message?: string; requestId?: string };

export function errorCopy(error: ErrorLike | undefined | null): { title: string; description?: string } {
  if (!error) return { title: "Something went wrong", description: "Please try again." };
  switch (error.code ?? "") {
    case "UNAUTHENTICATED":
      return { title: "Your session has ended", description: "Sign in again to continue." };
    case "NO_COMPANY":
      return { title: "No company selected", description: "Create or join a company to continue." };
    case "FORBIDDEN":
      return { title: "Permission needed", description: error.message || "Ask an owner or admin for access." };
    case "NOT_FOUND":
      return { title: "Not found", description: error.message || "This record no longer exists." };
    case "VALIDATION_ERROR":
      return { title: error.message || "Check the highlighted fields", description: "Correct the fields and try again." };
    case "CONFLICT":
      return { title: error.message || "Changed by someone else", description: "Reload the page to see the latest version." };
    case "INVALID_TRANSITION":
      return { title: "Action not available", description: error.message || "The record is no longer in a state that allows this." };
    case "PROVIDER_NOT_CONFIGURED":
      return { title: "Not configured yet", description: error.message || "An administrator needs to finish the setup." };
    case "RATE_LIMITED":
      return { title: "Too many requests", description: error.message || "Wait a moment and try again." };
    case "TRANSACTIONS_UNAVAILABLE":
      return { title: "Temporarily unavailable", description: "Please try again shortly." };
    case "INTERNAL":
      return {
        title: "Something went wrong on our side",
        description: error.requestId ? `Please try again. Reference: ${error.requestId.slice(0, 8)}` : "Please try again.",
      };
    default:
      return { title: error.message || "Something went wrong", description: "Please try again." };
  }
}
