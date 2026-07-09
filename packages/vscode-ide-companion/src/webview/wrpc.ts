import { createWrpcClient } from "@webview-rpc/client";
import { withReactQuery } from "@webview-rpc/react-query";
import type { AppRouter } from "../router";

// ---------------------------------------------------------------------------
// Extract per-procedure input / output from the AppRouter type so that
// direct method calls (wrpc.getSkills.query()) are fully type-safe.
// ---------------------------------------------------------------------------

/** A router-level procedure carries _input / _output brand fields. */
type ProcedureLike = { _input: unknown; _output: unknown };

type ExtractInput<P> = P extends { _input: infer I } ? I : never;
type ExtractOutput<P> = P extends { _output: infer O } ? Awaited<O> : never;

/** Given a router-def, produce { procName: { query; mutate } } for every procedure. */
type ProcedureMethods<T> = {
  [K in keyof T as T[K] extends ProcedureLike ? K : never]: T[K] extends ProcedureLike
    ? {
        query: (input?: ExtractInput<T[K]>) => Promise<ExtractOutput<T[K]>>;
        mutate: (input?: ExtractInput<T[K]>) => Promise<ExtractOutput<T[K]>>;
      }
    : never;
};

// ---------------------------------------------------------------------------
// Base client (provides call / useQuery / useMutation / useUtils)
// ---------------------------------------------------------------------------

type BaseClient = ReturnType<typeof withReactQuery<AppRouter>>;

/** The full wrpc client: base methods + per-procedure { query, mutate } stubs. */
export type WrpcClient = BaseClient & ProcedureMethods<AppRouter>;

const baseClient = withReactQuery<AppRouter>(createWrpcClient<AppRouter>());

// ---------------------------------------------------------------------------
// Proxy – bridges the gap between the AppRouter type-level API and the
// runtime API which only exposes call / useQuery / useMutation / useUtils.
//
//   wrpc.getSkills.query()     →  wrpc.call("getSkills")
//   wrpc.sendPrompt.mutate(in) →  wrpc.call("sendPrompt", in)
// ---------------------------------------------------------------------------

export const wrpc: WrpcClient = new Proxy(baseClient, {
  get(target, prop, receiver) {
    if (prop === "call" || prop === "useQuery" || prop === "useMutation" || prop === "useUtils") {
      return Reflect.get(target, prop, receiver);
    }
    const path = String(prop);
    return {
      query: (input?: unknown) => target.call(path, input),
      mutate: (input?: unknown) => target.call(path, input),
    };
  },
}) as WrpcClient;
