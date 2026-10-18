// Minimal ambient declarations for the Deno APIs used by our entry point.
// Runtime remains Supabase Edge Functions; this file emits no JavaScript.
declare const Deno: {
  env: { get(name: string): string | undefined };
  serve(handler: (request: Request) => Response | Promise<Response>): void;
};
