// The gateway (KrakenD) is the auth enforcement point: it validates the RS256
// JWT on the *private* routes before proxying, so whatever Authorization
// header reaches us is already verified. We only decode the payload to know
// who is acting (owner attribution) — never trust this WITHOUT the gateway.
export function ownerFromRequest(req) {
  const header = req.headers.authorization || "";
  const [, payloadB64] = header.split(".");

  if (!payloadB64) return "anonymous";

  try {
    const payload = JSON.parse(Buffer.from(payloadB64, "base64url").toString());
    return payload.preferred_username || payload.sub || "anonymous";
  } catch {
    return "anonymous";
  }
}
