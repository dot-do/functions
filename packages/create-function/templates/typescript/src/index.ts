export interface Env {
  // Add your bindings here
}

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    return new Response('Hello World!');
  },
} satisfies ExportedHandler<Env>;
