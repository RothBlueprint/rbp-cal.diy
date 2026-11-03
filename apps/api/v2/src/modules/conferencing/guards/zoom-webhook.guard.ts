import { CanActivate, ExecutionContext, Injectable, Logger, UnauthorizedException } from "@nestjs/common";
import { verifyZoomSignature } from "@/lib/zoom-webhook/zoom-webhook";

/**
 * Only Zoom may call the deauthorization endpoint: it is public and it deletes
 * credentials. Checks `x-zm-signature` against ZOOM_WEBHOOK_SECRET_TOKEN, the
 * Zoom app's Secret Token. The raw body comes from RawBodyMiddleware (see
 * app.module.ts), because the signature covers the bytes Zoom sent.
 */
@Injectable()
export class ZoomWebhookGuard implements CanActivate {
  private readonly logger = new Logger(ZoomWebhookGuard.name);

  canActivate(context: ExecutionContext): boolean {
    const request = context.switchToHttp().getRequest();
    // biome-ignore lint/style/noProcessEnv: Environment variable access required for webhook secret
    const secret = process.env.ZOOM_WEBHOOK_SECRET_TOKEN;

    if (!secret) {
      this.logger.error("ZOOM_WEBHOOK_SECRET_TOKEN is not defined");
      throw new UnauthorizedException("Webhook configuration error");
    }

    const body = request.body;
    const rawBody = Buffer.isBuffer(body) || typeof body === "string" ? body : JSON.stringify(body ?? "");

    if (
      !verifyZoomSignature(
        secret,
        request.headers["x-zm-request-timestamp"],
        rawBody,
        request.headers["x-zm-signature"]
      )
    ) {
      this.logger.warn("Rejected a Zoom webhook with an invalid signature");
      throw new UnauthorizedException("Invalid signature");
    }

    return true;
  }
}
