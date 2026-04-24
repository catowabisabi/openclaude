import { Hono } from "hono";
import { createHmac } from "crypto";

interface WebhookEvent {
  id: string;
  provider: string;
  event_type_name: string;
  payload: Record<string, unknown>;
  delivery_id: string;
  source: string;
}

type WebhookHandler = (event: WebhookEvent) => Promise<void>;

export class WebhookServer {
  private app: Hono;
  private port: number;
  private secret: string;
  private handlers = new Map<string, WebhookHandler>();
  private server: any = null;
  private isRunning = false;

  constructor(port: number, secret: string) {
    this.port = port;
    this.secret = secret;
    this.app = new Hono();

    this.app.get("/health", () => {
      return Response.json({ status: "ok" });
    });

    this.app.post("/webhooks/:provider", async (c) => {
      const provider = c.req.param("provider");

      // Read raw body for signature verification
      const rawBody = await c.req.arrayBuffer();
      const body = Buffer.from(rawBody);

      if (provider === "github") {
        const signature = c.req.header("x-hub-signature-256") ?? "";
        const event = c.req.header("x-github-event") ?? "unknown";
        const deliveryId = c.req.header("x-github-delivery") ?? crypto.randomUUID();

        if (!this.verifyGitHubSignature(body, signature)) {
          console.warn(`[WebhookServer] GitHub webhook signature verification failed for delivery ${deliveryId}`);
          return c.json({ error: "Invalid signature" }, 401);
        }

        let payload: Record<string, unknown>;
        try {
          payload = JSON.parse(new TextDecoder().decode(body));
        } catch {
          payload = { raw_body: new TextDecoder().decode(body).slice(0, 5000) };
        }

        const webhookEvent: WebhookEvent = {
          id: crypto.randomUUID(),
          provider,
          event_type_name: event,
          payload,
          delivery_id: deliveryId,
          source: "webhook",
        };

        const handler = this.handlers.get("github");
        if (handler) {
          await handler(webhookEvent);
        }

        return c.json({ status: "accepted", event_id: webhookEvent.id });
      }

      // Generic provider
      const auth = c.req.header("authorization") ?? "";
      if (!this.verifyBearerToken(auth)) {
        return c.json({ error: "Invalid authorization" }, 401);
      }

      let payload: Record<string, unknown>;
      try {
        payload = await c.req.json();
      } catch {
        payload = { raw_body: new TextDecoder().decode(body).slice(0, 5000) };
      }

      const eventType = c.req.header("x-event-type") ?? "unknown";
      const deliveryId = c.req.header("x-delivery-id") ?? crypto.randomUUID();

      const webhookEvent: WebhookEvent = {
        id: crypto.randomUUID(),
        provider,
        event_type_name: eventType,
        payload,
        delivery_id: deliveryId,
        source: "webhook",
      };

      const handler = this.handlers.get(provider);
      if (handler) {
        await handler(webhookEvent);
      }

      return c.json({ status: "accepted", event_id: webhookEvent.id });
    });
  }

  on(provider: string, handler: WebhookHandler): void {
    this.handlers.set(provider, handler);
  }

  private verifyGitHubSignature(body: Buffer, signature: string): boolean {
    if (!signature || !this.secret) return false;

    const expected = `sha256=${createHmac("sha256", this.secret)
      .update(body)
      .digest("hex")}`;

    if (signature.length !== expected.length) return false;

    let mismatch = 0;
    for (let i = 0; i < signature.length; i++) {
      mismatch |= signature.charCodeAt(i) ^ expected.charCodeAt(i);
    }
    return mismatch === 0;
  }

  private verifyBearerToken(auth: string): boolean {
    if (!auth || !this.secret) return false;

    const [scheme, token] = auth.split(" ", 2);
    if (scheme !== "Bearer" || !token) return false;
    if (token.length !== this.secret.length) return false;

    let mismatch = 0;
    for (let i = 0; i < token.length; i++) {
      mismatch |= token.charCodeAt(i) ^ this.secret.charCodeAt(i);
    }
    return mismatch === 0;
  }

  async start(): Promise<void> {
    if (this.isRunning) return;

    this.server = (globalThis as any).Bun?.serve({
      port: this.port,
      fetch: this.app.fetch,
    });

    this.isRunning = true;
    console.info(`Webhook server listening on port ${this.port}`);
  }

  async stop(): Promise<void> {
    if (!this.isRunning || !this.server) return;

    this.server.stop();
    this.server = null;
    this.isRunning = false;
    console.info("Webhook server stopped");
  }

  get isActive(): boolean {
    return this.isRunning;
  }
}