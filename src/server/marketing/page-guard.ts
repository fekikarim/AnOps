import "server-only";
import { notFound } from "next/navigation";
import { isAppError } from "@/shared/lib/errors";

/**
 * Runs a data load for a dynamic page. A NOT_FOUND from the service becomes Next's not-found page; every
 * other error is rethrown. The page renders its JSX only after this returns, outside any try block.
 */
export async function orNotFound<T>(load: () => Promise<T>): Promise<T> {
  try {
    return await load();
  } catch (error) {
    if (isAppError(error) && error.code === "NOT_FOUND") notFound();
    throw error;
  }
}
